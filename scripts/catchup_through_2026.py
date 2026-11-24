"""Publish PCCOE Computer Engineering papers from 2001-01-01 through 2026-11-24.

A ScholarWatch pipeline run cannot add these rows: apply.py drops new Scholar
works, and export_portal.py rewrites only rows that already have portal JSON.
This catch-up collects OpenAlex, Crossref, and Google Scholar, then writes
confirmed rows straight into web/data/publications.json.

A paper is added only when OpenAlex or Crossref shows that the credited roster
member's own affiliation names Pimpri Chinchwad College of Engineering. A
failed lookup is skipped. A Scholar listing alone is not a row.
"""

from __future__ import annotations

import json
import re
import sys
import threading
import traceback
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "scholarwatch" / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from scholarwatch.config import load_config  # noqa: E402
from scholarwatch.http.client import HttpClient, SourceDegraded, SSRFError  # noqa: E402
from scholarwatch.sources.base import norm_doi, source_should_stop  # noqa: E402
from scholarwatch.sources.crossref import _retracted  # noqa: E402
from scholarwatch.sources.openalex import (  # noqa: E402
    MAX_WORKS_PER_AUTHOR,
    _openalex_get,
    openalex_year_url,
    profile_search_name,
)
from scholarwatch.sources.scholar import (  # noqa: E402
    SCHOLAR_RPS,
    is_block_page,
    parse_profile_page,
    profile_url,
)
from scholarwatch.textutil import norm_title  # noqa: E402
from scholarwatch.venue.scimago import ScimagoIndex  # noqa: E402

import importlib.util  # noqa: E402


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


verify = _load("verify_pccoe_affiliation", ROOT / "scholarwatch" / "scripts" / "verify_pccoe_affiliation.py")
tagger = _load("tag_pccoe_authors", ROOT / "scholarwatch" / "scripts" / "tag_pccoe_authors.py")

OUT = ROOT / "scholarwatch" / "data" / "catchup"
PUBLICATIONS = ROOT / "web" / "data" / "publications.json"
FACULTY_PATH = ROOT / "web" / "data" / "faculty.json"
CONFIG_PATH = ROOT / "scholarwatch" / "config.yaml"
MASTER_XLSX = ROOT / "web" / "data" / "PCCOE_Comp_Research_Master_Audit_2025_2026.xlsx"
JULY_XLSX = ROOT / "web" / "data" / "PCCOE_Comp_Research_July2026_to_2026-11-24.xlsx"

WINDOW_START = (2001, 1, 1)
WINDOW_END = (2026, 11, 24)
MONTHS = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
}
MONTH_NAMES = {number: name for name, number in MONTHS.items()}
AFFILIATION_TOKENS = ("pimpri", "chinchwad", "chichwad", "pccoe")
OPENALEX_SEARCHES = ("pimpri", "chinchwad", "pccoe")
CROSSREF_SEARCHES = ("Pimpri Chinchwad College of Engineering", "PCCOE")
CROSSREF_PAGE_CAP = 30
SELECT = (
    "id,doi,title,publication_year,publication_date,type,cited_by_count,"
    "authorships,primary_location,biblio,is_retracted"
)


def log(message: str) -> None:
    print(message, flush=True)


def tokens_of(name: str) -> list[str]:
    """Keep single-letter initials. Drop titles. Turn 'Family, Given' into given-family."""
    text = name or ""
    if "," in text:
        family, given = text.split(",", 1)
        text = f"{given} {family}"
    pieces = re.sub(r"[^a-z.\s]", " ", text.lower()).replace(".", " ").split()
    return [piece for piece in pieces if piece and piece not in verify.STOP]


def person_matches(faculty_name: str, author_name: str) -> bool:
    """The roster person, not merely a shared surname or a coauthor.

    Full given names must agree. A roster entry that is only an initial plus a
    surname, such as K. Rajeswari, matches a given name that starts with that
    initial and does not match a different initial.
    """
    left = tokens_of(faculty_name)
    right = tokens_of(author_name)
    if len(left) < 2 or len(right) < 2 or left[-1] != right[-1]:
        return False
    left_given = [part for part in left[:-1] if len(part) > 1]
    right_given = [part for part in right[:-1] if len(part) > 1]
    left_initials = [part for part in left[:-1] if len(part) == 1]
    right_initials = [part for part in right[:-1] if len(part) == 1]
    if left_given and right_given:
        first, other = left_given[0], right_given[0]
        return first == other or first.startswith(other) or other.startswith(first)
    if not left_given and left_initials:
        initial = left_initials[0]
        if right_given:
            return right_given[0].startswith(initial)
        return bool(right_initials) and right_initials[0] == initial
    if not right_given and right_initials and left_given:
        return left_given[0].startswith(right_initials[0])
    return False


def in_window(year, month, day) -> bool:
    if year is None:
        return False
    try:
        year = int(year)
    except (TypeError, ValueError):
        return False
    if year < WINDOW_START[0] or year > WINDOW_END[0]:
        return False
    if year < WINDOW_END[0]:
        return True
    if month is None:
        return True
    month = int(month)
    if month < WINDOW_END[1]:
        return True
    if month > WINDOW_END[1]:
        return False
    if day is None:
        return True
    return int(day) <= WINDOW_END[2]


def after_cutoff(year, month, day) -> bool:
    """True when a known date falls outside the publish window."""
    if year is None:
        return False
    return not in_window(year, month, day)


def _ymd_from_parts(parts) -> tuple:
    if not parts:
        return None, None, None, "none"
    year = parts[0] if len(parts) >= 1 else None
    month = parts[1] if len(parts) >= 2 else None
    day = parts[2] if len(parts) >= 3 else None
    if month in (0, None):
        month = None
    if day in (0, None):
        day = None
    precision = "day" if day else "month" if month else "year" if year else "none"
    return year, month, day, precision


def openalex_date(work: dict) -> tuple:
    """OpenAlex stores a full date. 1 January is its year-only placeholder."""
    raw = str(work.get("publication_date") or "")
    year = work.get("publication_year")
    match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if not match:
        return year, None, None, "year" if year else "none"
    parsed_year, month, day = (int(part) for part in match.groups())
    year = year or parsed_year
    if month == 1 and day == 1:
        return year, None, None, "year"
    if day == 1:
        return year, month, None, "month"
    return year, month, day, "day"


def crossref_date(item: dict) -> tuple:
    """Prefer an issued or published date that names a month. Ignore deposit dates."""
    best = (None, None, None, "none")
    rank = {"none": 0, "year": 1, "month": 2, "day": 3}
    for key in ("published-online", "published-print", "published", "issued"):
        parts = ((item.get(key) or {}).get("date-parts") or [None])[0]
        parsed = _ymd_from_parts(parts)
        if rank[parsed[3]] > rank[best[3]]:
            best = parsed
    return best


def date_tuple(item: dict) -> tuple:
    return item.get("year"), item.get("month"), item.get("day")


def is_stop(exc: BaseException) -> bool:
    text = str(exc).lower()
    return source_should_stop(text) or "429" in text or "blocked" in text or "quota" in text


def affiliation_blob_openalex(authorship: dict) -> str:
    blob = " ".join(authorship.get("raw_affiliation_strings") or [])
    blob += " " + " ".join(
        (inst.get("display_name") or "") for inst in (authorship.get("institutions") or [])
    )
    return blob.strip()


def own_openalex_affiliation(faculty: str, work: dict) -> tuple[int, str] | None:
    for index, authorship in enumerate(work.get("authorships") or [], start=1):
        display = (authorship.get("author") or {}).get("display_name") or ""
        raw = authorship.get("raw_author_name") or ""
        if not (person_matches(faculty, display) or (raw and person_matches(faculty, raw))):
            continue
        blob = affiliation_blob_openalex(authorship)
        if verify.is_pccoe(blob):
            return index, blob
    return None


def own_crossref_affiliation(faculty: str, item: dict) -> tuple[int, str] | None:
    for index, person in enumerate(item.get("author") or [], start=1):
        name = person.get("name") or " ".join(
            part for part in (person.get("given") or "", person.get("family") or "") if part
        )
        if not person_matches(faculty, name):
            continue
        blob = " ".join((aff.get("name") or "") for aff in (person.get("affiliation") or []))
        if verify.is_pccoe(blob):
            return index, blob.strip()
    return None


def _authors_openalex(work: dict) -> list[str]:
    names = []
    for authorship in work.get("authorships") or []:
        name = (authorship.get("author") or {}).get("display_name") or authorship.get("raw_author_name") or ""
        if name:
            names.append(name.strip())
    return names


def _authors_crossref(item: dict) -> list[str]:
    names = []
    for person in item.get("author") or []:
        name = person.get("name") or " ".join(
            part for part in (person.get("given") or "", person.get("family") or "") if part
        )
        if name.strip():
            names.append(name.strip())
    return names


def pack_openalex(faculty: str, work: dict) -> dict | None:
    if not work or work.get("is_retracted"):
        return None
    title = (work.get("title") or "").strip()
    if len(title) < 3:
        return None
    matched = own_openalex_affiliation(faculty, work)
    if not matched:
        return None
    index, blob = matched
    year, month, day, precision = openalex_date(work)
    source = ((work.get("primary_location") or {}).get("source") or {})
    issns = list(source.get("issn") or [])
    if source.get("issn_l"):
        issns.append(source["issn_l"])
    biblio = work.get("biblio") or {}
    pages = ""
    if biblio.get("first_page") or biblio.get("last_page"):
        pages = "-".join(str(part) for part in (biblio.get("first_page"), biblio.get("last_page")) if part)
    doi = norm_doi(work.get("doi") or "")
    openalex_id = (work.get("id") or "").rsplit("/", 1)[-1]
    return {
        "source": "openalex",
        "faculty": faculty,
        "title": title,
        "year": int(year) if year else None,
        "month": month,
        "day": day,
        "precision": precision,
        "venue": source.get("display_name") or "",
        "publisher": source.get("host_organization_name") or "",
        "doi": doi,
        "issns": [str(value) for value in issns if value],
        "citations": work.get("cited_by_count"),
        "authors": _authors_openalex(work),
        "author_index": index,
        "affiliation": blob,
        "openalex_id": openalex_id,
        "url": f"https://doi.org/{doi}" if doi else (work.get("id") or ""),
        "evidence_url": work.get("id") or "",
        "volume": str(biblio.get("volume") or ""),
        "issue": str(biblio.get("issue") or ""),
        "pages": pages,
        "work_type": work.get("type") or "",
        "source_type": source.get("type") or "",
    }


def pack_crossref(faculty: str, item: dict) -> dict | None:
    if not item or _retracted(item):
        return None
    title = " ".join(item.get("title") or []).strip()
    if len(title) < 3:
        return None
    matched = own_crossref_affiliation(faculty, item)
    if not matched:
        return None
    index, blob = matched
    year, month, day, precision = crossref_date(item)
    doi = norm_doi(item.get("DOI") or "")
    return {
        "source": "crossref",
        "faculty": faculty,
        "title": title,
        "year": int(year) if year else None,
        "month": month,
        "day": day,
        "precision": precision,
        "venue": " ".join(item.get("container-title") or []).strip(),
        "publisher": item.get("publisher") or "",
        "doi": doi,
        "issns": [str(value) for value in (item.get("ISSN") or []) if value],
        "citations": item.get("is-referenced-by-count"),
        "authors": _authors_crossref(item),
        "author_index": index,
        "affiliation": blob,
        "openalex_id": "",
        "url": f"https://doi.org/{doi}" if doi else "",
        "evidence_url": f"https://doi.org/{doi}" if doi else "",
        "volume": str(item.get("volume") or ""),
        "issue": str(item.get("issue") or ""),
        "pages": str(item.get("page") or ""),
        "work_type": item.get("type") or "",
        "source_type": item.get("type") or "",
    }


def pack_scholar(faculty: str, row: dict, user_id: str) -> dict | None:
    title = (row.get("title") or "").strip()
    if len(title) < 3:
        return None
    year = int(row["year"]) if str(row.get("year") or "").isdigit() else None
    if year is not None and not in_window(year, None, None):
        return None
    citations = int(row["citations"]) if str(row.get("citations") or "").isdigit() else None
    return {
        "source": "scholar",
        "faculty": faculty,
        "title": title,
        "year": year,
        "month": None,
        "day": None,
        "precision": "year" if year else "none",
        "venue": row.get("venue") or "",
        "publisher": "",
        "doi": "",
        "issns": [],
        "citations": None,
        "scholar_citations": citations,
        "authors": [part.strip() for part in (row.get("authors") or "").split(",") if part.strip()],
        "author_index": None,
        "affiliation": "",
        "openalex_id": "",
        "url": row.get("url") or "",
        "evidence_url": "",
        "volume": "",
        "issue": "",
        "pages": "",
        "work_type": "",
        "source_type": "",
        "scholar_user": user_id,
    }


class CollectorState:
    def __init__(self, source: str):
        self.source = source
        self.path = OUT / f"{source}.jsonl"
        self.done_path = OUT / f"{source}.done.json"
        self.status_path = OUT / f"{source}.status.json"
        self.notes: list[str] = []
        self.stopped = False
        self.incomplete: list[str] = []
        self.done: set[str] = set()
        self.skip: set[str] = set()
        if self.done_path.exists():
            saved = json.loads(self.done_path.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                self.done = set(saved.get("done") or [])
                self.skip = set(saved.get("skip") or [])
            else:
                self.done = set(saved)
        self.skip |= self.done
        if self.status_path.exists():
            previous = json.loads(self.status_path.read_text(encoding="utf-8"))
            self.notes = list(previous.get("notes") or [])
            self.incomplete = list(previous.get("incomplete_authors") or [])

    def persist_progress(self) -> None:
        self.done_path.write_text(json.dumps({
            "done": sorted(self.done),
            "skip": sorted(self.skip),
        }), encoding="utf-8")

    def note(self, message: str) -> None:
        self.notes.append(message)
        log(f"[{self.source}] {message}")

    def mark_done(self, name: str) -> None:
        self.done.add(name)
        self.skip.add(name)
        self.persist_progress()

    def mark_incomplete(self, name: str) -> None:
        if name not in self.incomplete:
            self.incomplete.append(name)
        self.skip.add(name)
        self.persist_progress()

    def append(self, rows: list[dict]) -> None:
        if not rows:
            return
        with self.path.open("a", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def save_status(self, extra: dict | None = None) -> None:
        payload = {
            "source": self.source,
            "stopped": self.stopped,
            "completed_authors": sorted(self.done),
            "incomplete_authors": self.incomplete,
            "notes": self.notes,
        }
        if extra:
            payload.update(extra)
        self.status_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _year_slice(client, config, state: CollectorState, author_name: str, affiliation: str, start: int, end: int, seen: set[str], fetched: int) -> int:
    if state.stopped or fetched >= MAX_WORKS_PER_AUTHOR or start > end:
        return 0
    url = openalex_year_url(author_name, config.sources.openalex.mailto, affiliation, start, end)
    url += f"&select={SELECT}"
    try:
        _status, payload, _cached = _openalex_get(client, config, url)
    except SourceDegraded as exc:
        if is_stop(exc):
            state.stopped = True
            state.note(f"{author_name} stopped during {start}-{end} {affiliation}: {exc}. Later slices for this author were not checked.")
            return 0
        state.note(f"{author_name} {start}-{end} {affiliation} not checked: {exc}")
        return 0
    if not isinstance(payload, dict):
        state.note(f"{author_name} {start}-{end} {affiliation} not checked: response was not a work list")
        return 0
    count = int((payload.get("meta") or {}).get("count") or 0)
    if count > 50 and start < end:
        mid = (start + end) // 2
        left = _year_slice(client, config, state, author_name, affiliation, start, mid, seen, fetched)
        if state.stopped:
            state.note(f"{author_name} {mid + 1}-{end} {affiliation} not checked after a stop")
            return left
        right = _year_slice(client, config, state, author_name, affiliation, mid + 1, end, seen, fetched + left)
        return left + right
    rows = []
    added = 0
    for work in payload.get("results") or []:
        if fetched + added >= MAX_WORKS_PER_AUTHOR:
            break
        work_id = work.get("id") or ""
        if work_id and work_id in seen:
            continue
        if work_id:
            seen.add(work_id)
        added += 1
        packed = pack_openalex(author_name, work)
        if packed is None:
            continue
        if after_cutoff(*date_tuple(packed)):
            continue
        if not in_window(*date_tuple(packed)):
            continue
        rows.append(packed)
    if count > 50 and start == end:
        state.note(
            f"{author_name} {start} {affiliation} returned {count} works; only the first 50 were read. The rest of that year was not checked."
        )
    state.append(rows)
    return added


def collect_openalex(config) -> None:
    state = CollectorState("openalex")
    client = HttpClient(OUT / "cache-openalex")
    authors = list(config.authors)
    try:
        for position, author in enumerate(authors, start=1):
            if author.name in state.skip:
                log(f"[openalex] skip already processed {author.name}")
                continue
            if state.stopped:
                state.note(f"{author.name} not checked")
                state.mark_incomplete(author.name)
                continue
            log(f"[openalex] {position}/{len(authors)} {author.name}")
            seen: set[str] = set()
            fetched = 0
            before = len(state.notes)
            for affiliation in OPENALEX_SEARCHES:
                if state.stopped:
                    state.note(f"{author.name} {affiliation} not checked after a stop")
                    break
                fetched += _year_slice(
                    client, config, state, author.name, affiliation, 2001, 2026, seen, fetched,
                )
            if state.stopped or len(state.notes) != before:
                state.mark_incomplete(author.name)
            else:
                state.mark_done(author.name)
    finally:
        client.close()
        state.save_status()


def _crossref_query(client, config, state: CollectorState, author_name: str, affiliation: str) -> None:
    cursor = "*"
    seen_cursors: set[str] = set()
    empty_pages = 0
    pages = 0
    headers = {"User-Agent": f"ScholarWatch/0.1 (mailto:{config.sources.crossref.mailto})"}
    while cursor and empty_pages < 3 and pages < CROSSREF_PAGE_CAP:
        if cursor in seen_cursors or state.stopped:
            return
        seen_cursors.add(cursor)
        url = (
            "https://api.crossref.org/works?rows=100"
            f"&query.author={quote(profile_search_name(author_name))}"
            f"&query.affiliation={quote(affiliation)}"
            "&filter=from-pub-date:2001-01-01,until-pub-date:2026-11-24"
            f"&mailto={quote(config.sources.crossref.mailto)}"
            f"&cursor={quote(cursor, safe='')}"
        )
        try:
            _status, payload, _cached = client.get(
                url, "crossref", rps=config.budgets.requests_per_second, headers=headers,
            )
        except SourceDegraded as exc:
            if is_stop(exc):
                state.stopped = True
                state.note(f"{author_name} stopped during Crossref {affiliation}: {exc}. Later pages were not checked.")
                return
            state.note(f"{author_name} Crossref {affiliation} not checked: {exc}")
            return
        message = payload.get("message") or {}
        items = message.get("items") or []
        pages += 1
        log(f"[crossref] {author_name} {affiliation} page {pages} items {len(items)}")
        if not items:
            return
        kept = 0
        rows = []
        for item in items:
            packed = pack_crossref(author_name, item)
            if packed is None:
                continue
            if not in_window(*date_tuple(packed)):
                continue
            kept += 1
            rows.append(packed)
        state.append(rows)
        empty_pages = empty_pages + 1 if kept == 0 else 0
        cursor = message.get("next-cursor") or ""
    if pages >= CROSSREF_PAGE_CAP and cursor:
        state.note(
            f"{author_name} Crossref {affiliation} stopped after {CROSSREF_PAGE_CAP} pages. Later pages were not checked."
        )


def collect_crossref(config) -> None:
    state = CollectorState("crossref")
    client = HttpClient(OUT / "cache-crossref")
    authors = list(config.authors)
    try:
        for position, author in enumerate(authors, start=1):
            if author.name in state.skip:
                log(f"[crossref] skip already processed {author.name}")
                continue
            if state.stopped:
                state.note(f"{author.name} not checked")
                state.mark_incomplete(author.name)
                continue
            log(f"[crossref] {position}/{len(authors)} {author.name}")
            notes_before = len(state.notes)
            for affiliation in CROSSREF_SEARCHES:
                if state.stopped:
                    state.note(f"{author.name} remaining Crossref query {affiliation} not checked")
                    break
                _crossref_query(client, config, state, author.name, affiliation)
            if state.stopped or len(state.notes) != notes_before:
                state.mark_incomplete(author.name)
            else:
                state.mark_done(author.name)
    finally:
        client.close()
        state.save_status()


def collect_scholar(config) -> None:
    state = CollectorState("scholar")
    client = HttpClient(OUT / "cache-scholar")
    blocks_in_a_row = 0
    authors = [author for author in config.authors if author.scholar_user]
    try:
        for position, author in enumerate(authors, start=1):
            if author.name in state.skip:
                log(f"[scholar] skip already processed {author.name}")
                continue
            if state.stopped:
                state.note(f"{author.name} not checked")
                state.mark_incomplete(author.name)
                continue
            log(f"[scholar] {position}/{len(authors)} {author.name}")
            start = 0
            seen_titles: set[str] = set()
            blocked = False
            while True:
                url = profile_url(author.scholar_user, start)
                try:
                    _status, page = client.get_text(url, "scholar", rps=SCHOLAR_RPS)
                except (SourceDegraded, SSRFError) as exc:
                    state.note(f"{author.name} blocked on Scholar page {start}: {exc}. Later pages of this profile were not checked.")
                    blocked = True
                    break
                if is_block_page(page):
                    state.note(f"{author.name} blocked on Scholar page {start}. Later pages of this profile were not checked.")
                    blocked = True
                    break
                rows = parse_profile_page(page)
                if not rows:
                    break
                fresh = 0
                packed_rows = []
                for row in rows:
                    key = row["title"].lower()
                    if key in seen_titles:
                        continue
                    seen_titles.add(key)
                    fresh += 1
                    packed = pack_scholar(author.name, row, author.scholar_user)
                    if packed is not None:
                        packed_rows.append(packed)
                state.append(packed_rows)
                if fresh == 0 or len(rows) < 100:
                    break
                start += 100
            if blocked:
                state.mark_incomplete(author.name)
                blocks_in_a_row += 1
                if blocks_in_a_row >= 2:
                    state.stopped = True
                    state.note("Scholar blocked two profiles in a row. Remaining profiles were not checked.")
                continue
            blocks_in_a_row = 0
            state.mark_done(author.name)
    finally:
        client.close()
        state.save_status({"profiles_with_ids": [author.name for author in authors]})


def load_jsonl(source: str) -> list[dict]:
    path = OUT / f"{source}.jsonl"
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def load_status(source: str) -> dict:
    path = OUT / f"{source}.status.json"
    if not path.exists():
        return {"source": source, "missing": True, "notes": [f"{source} status file is missing"], "stopped": True}
    return json.loads(path.read_text(encoding="utf-8"))


def work_keys(item: dict) -> list[str]:
    keys = []
    doi = norm_doi(item.get("doi") or "")
    if doi:
        keys.append("doi:" + doi)
    title = norm_title(item.get("title") or "")
    if title:
        keys.append("title:" + title)
    return keys


def portal_keys(record: dict) -> list[str]:
    keys = []
    doi = norm_doi(record.get("DOI") or "")
    if doi:
        keys.append("doi:" + doi)
    title = norm_title(record.get("Paper Title") or "")
    if title:
        keys.append("title:" + title)
    return keys


def citation_number(value) -> int | None:
    text = str(value if value is not None else "").replace(",", "").strip()
    return int(text) if text.isdigit() else None


def refresh_citation(record: dict, new_count) -> bool:
    """Raise an existing count from OpenAlex or Crossref. Never store a drop."""
    incoming = citation_number(new_count)
    if incoming is None:
        return False
    current = citation_number(record.get("Citations"))
    if current is not None and incoming < current:
        return False
    if current == incoming:
        return False
    record["Citations"] = str(incoming)
    return True


def precision_rank(item: dict) -> int:
    return {"none": 0, "year": 1, "month": 2, "day": 3}.get(item.get("precision") or "", 0)


def merge_confirmed(items: list[dict]) -> dict:
    """One paper. Prefer the date that actually names a month, then a day."""
    ranked = sorted(items, key=precision_rank, reverse=True)
    chosen = dict(ranked[0])
    for item in items:
        if after_cutoff(*date_tuple(item)):
            chosen["outside_window"] = True
    citations = [citation_number(item.get("citations")) for item in items]
    counts = [value for value in citations if value is not None]
    if counts:
        chosen["citations"] = max(counts)
    sources = []
    for item in items:
        if item.get("source") and item["source"] not in sources:
            sources.append(item["source"])
    chosen["sources"] = sources
    faculties = []
    for item in sorted(items, key=lambda row: (row.get("author_index") or 999, row.get("faculty") or "")):
        if item.get("faculty") and item["faculty"] not in faculties:
            faculties.append((item["faculty"], item.get("author_index") or 0, item.get("affiliation") or ""))
    chosen["confirmed_faculty"] = faculties
    authors = max((item.get("authors") or [] for item in items), key=len, default=[])
    if authors:
        chosen["authors"] = authors
    if not chosen.get("doi"):
        for item in items:
            if item.get("doi"):
                chosen["doi"] = item["doi"]
                break
    if not chosen.get("evidence_url"):
        for item in items:
            if item.get("evidence_url"):
                chosen["evidence_url"] = item["evidence_url"]
                break
    return chosen


def group_confirmed(rows: list[dict]) -> list[dict]:
    parent: dict[str, str] = {}

    def find(key: str) -> str:
        parent.setdefault(key, key)
        if parent[key] != key:
            parent[key] = find(parent[key])
        return parent[key]

    def union(left: str, right: str) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    for offset, row in enumerate(rows):
        keys = work_keys(row) or [f"row:{offset}"]
        for key in keys[1:]:
            union(keys[0], key)
    grouped: dict[str, list[dict]] = defaultdict(list)
    for offset, row in enumerate(rows):
        keys = work_keys(row) or [f"row:{offset}"]
        grouped[find(keys[0])].append(row)
    return [merge_confirmed(group) for group in grouped.values()]


def medium_of(item: dict) -> str:
    work_type = (item.get("work_type") or "").lower()
    source_type = (item.get("source_type") or "").lower()
    if "chapter" in work_type:
        return "Book Chapter"
    if work_type in {"book", "monograph", "reference-book", "edited-book"}:
        return "Book"
    if "proceeding" in work_type or "conference" in work_type or "conference" in source_type:
        return "Conference Proceeding"
    if "preprint" in work_type or "posted-content" in work_type or "posted" in work_type:
        return "Preprint / Open Repository"
    return "Journal Article"


def known_publisher(item: dict) -> str:
    blob = " ".join([
        item.get("venue") or "",
        item.get("publisher") or "",
        item.get("doi") or "",
    ]).lower()
    if "10.1109" in blob or "ieee" in blob:
        return "IEEE"
    if "10.1007" in blob or "springer" in blob:
        return "Springer"
    if "10.1016" in blob or "elsevier" in blob:
        return "Elsevier"
    if "10.1145" in blob or re.search(r"\bacm\b", blob):
        return "ACM"
    return ""


def subject_of(title: str, venue: str) -> str:
    text = f"{title} {venue}".lower()
    scores = {
        "Artificial Intelligence & Machine Learning": 0,
        "Cybersecurity & Blockchain": 0,
        "Computer Vision & Multimedia": 0,
        "Healthcare Informatics & Biomedical": 0,
        "Cloud Computing, IoT & Networks": 0,
        "Data Systems & Software Engineering": 0,
    }
    groups = {
        "Artificial Intelligence & Machine Learning": ["machine learning", "deep learning", "neural", "transformer", "language model", "artificial intelligence", "federated", "classification", "prediction"],
        "Cybersecurity & Blockchain": ["blockchain", "security", "cryptograph", "encrypt", "privacy", "authentication", "attack", "malware", "cyber"],
        "Computer Vision & Multimedia": ["image", "vision", "video", "biometric", "facial", "object detection"],
        "Healthcare Informatics & Biomedical": ["health", "medical", "disease", "patient", "clinical", "cancer", "diagnos"],
        "Cloud Computing, IoT & Networks": ["iot", "internet of things", "cloud", "sensor", "network", "wireless", "edge", "fog"],
        "Data Systems & Software Engineering": ["database", "data mining", "software", "analytics", "big data", "testing"],
    }
    for label, words in groups.items():
        for word in words:
            if word in text:
                scores[label] += 2
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "Computer Science & Engineering (General)"
    return best


def ordinal(number: int) -> str:
    if 10 <= number % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    return f"{number}{suffix}"


def position_label(index: int, total: int) -> str:
    if index == 1:
        return f"1st Author (1 of {total})"
    if total > 1 and index == total:
        return f"Senior / Last Author ({ordinal(index)} of {total})"
    return f"Co-Author ({ordinal(index)} of {total})"


def designation_of(faculty_name: str, faculty_row: dict | None, existing: dict[str, str]) -> str:
    if faculty_name in existing and existing[faculty_name]:
        return existing[faculty_name]
    text = ((faculty_row or {}).get("Designation") or "").strip().rstrip(".")
    if re.search(r"hod", text, re.I):
        return "Professor & HOD"
    if "associate" in text.lower():
        return "Associate Professor"
    if "assistant" in text.lower():
        return "Assistant Professor"
    if "teaching" in text.lower():
        return "Teaching Assistant"
    if "professor" in text.lower():
        return "Professor"
    return text or "Assistant Professor"


def period_tag(year, month) -> str:
    if not year or not month:
        return ""
    start = int(year) if int(month) >= 7 else int(year) - 1
    return f"July {start} – June {start + 1}"


def published_date(item: dict) -> tuple[str, str, int | str]:
    year = item.get("year") or ""
    month = item.get("month")
    day = item.get("day")
    month_name = MONTH_NAMES.get(int(month), "") if month else ""
    if year and month and day:
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}", month_name, int(year)
    if year and month:
        return f"{int(year):04d}-{int(month):02d}", month_name, int(year)
    if year:
        return str(int(year)), "", int(year)
    return "", "", ""


def apply_venue(record: dict, item: dict, catalog: ScimagoIndex) -> None:
    medium = record["Publication Medium Category"]
    hit = catalog.lookup(item.get("venue") or "", item.get("issns") or [])
    record["SJR Quartile"] = "Not Ranked"
    record["SJR Score"] = "N/A"
    record["Source H-Index"] = "N/A"
    record["Canonical ISSN / eISSN"] = "N/A"
    record["Scopus Source ID"] = "N/A"
    record["Scopus Coverage Years"] = "Not in the 2021 SCImago master"
    record["Conference Series Legitimacy"] = "Not Applicable"
    record["Beall's List Flag"] = "Clean / Verified"
    if hit.method != "unmatched" and medium != "Preprint / Open Repository":
        quartile = hit.quartile if hit.quartile in {"Q1", "Q2", "Q3", "Q4"} else "Not Ranked"
        record["SJR Quartile"] = quartile
        record["SJR Score"] = hit.sjr or "N/A"
        record["Source H-Index"] = hit.h_index or "N/A"
        record["Canonical ISSN / eISSN"] = hit.issn or "N/A"
        record["Scopus Source ID"] = hit.source_id or "N/A"
        record["Scopus Coverage Years"] = hit.coverage or "Matched in the 2021 SCImago master"
        record["Scopus Indexing Status"] = "Scopus Indexed (Active)"
        record["Conference Series Legitimacy"] = "Matched in SCImago Journal Rank"
        tiers = {
            "Q1": "Tier 1A (Scopus Q1)",
            "Q2": "Tier 1B (Scopus Q2)",
            "Q3": "Tier 2A (Scopus Q3)",
            "Q4": "Tier 2A (Scopus Q4)",
        }
        record["Academic Audit Tier"] = tiers.get(quartile, "Tier 2A (Scopus Indexed)")
        return
    if medium == "Conference Proceeding":
        publisher = known_publisher(item)
        if publisher:
            record["Scopus Indexing Status"] = "Publisher-Verified Proceeding (Scopus status unconfirmed)"
            record["Scopus Coverage Years"] = "Publisher identified; source is not in the SCImago master"
            record["Conference Series Legitimacy"] = f"{publisher} proceeding; Scopus status not in the SCImago master"
            record["Academic Audit Tier"] = "Tier 3 (Publisher-Verified Proceeding, Scopus unconfirmed)"
        else:
            record["Scopus Indexing Status"] = "Conference Proceeding (Indexing Unconfirmed)"
            record["Conference Series Legitimacy"] = "Proceeding not matched to a SCImago source"
            record["Academic Audit Tier"] = "Tier 3 (Conference Unverified)"
        return
    if medium == "Preprint / Open Repository":
        record["Scopus Indexing Status"] = "Preprint / Open Repository"
        record["Academic Audit Tier"] = "Tier 3 (Open Repository / Preprint)"
        record["Conference Series Legitimacy"] = "Not Applicable"
        return
    record["Scopus Indexing Status"] = "Not Indexed in Scopus"
    record["Academic Audit Tier"] = "Tier 3 (Non-Scopus / Unindexed)"


def build_record(item: dict, faculty_by_name: dict, existing_designations: dict[str, str], scholar_users: dict[str, str]) -> dict:
    confirmed = item.get("confirmed_faculty") or [(item.get("faculty"), item.get("author_index") or 1, item.get("affiliation") or "")]
    confirmed = sorted(confirmed, key=lambda row: (row[1] or 999, row[0]))
    faculty_name = confirmed[0][0]
    faculty_row = faculty_by_name.get(faculty_name)
    authors = list(item.get("authors") or [])
    roster = tagger.load_roster(FACULTY_PATH)
    for name, index, _blob in confirmed:
        if index and 1 <= int(index) <= len(authors):
            if tagger.match_author(authors[int(index) - 1], roster) != name:
                authors[int(index) - 1] = name
    if not authors:
        authors = [faculty_name]
    author_index = int(confirmed[0][1] or 1)
    total = len(authors)
    author_index = min(max(author_index, 1), total)
    date, month_name, year = published_date(item)
    medium = medium_of(item)
    sources = item.get("sources") or [item.get("source")]
    evidence_sources = [source.upper() for source in sources if source and source != "scholar"]
    user_id = scholar_users.get(faculty_name) or ""
    record = {
        "Faculty Name": faculty_name,
        "Faculty Designation": designation_of(faculty_name, faculty_row, existing_designations),
        "Paper Title": item.get("title") or "",
        "Author Position": position_label(author_index, total),
        "Author Index": author_index,
        "Total Authors": total,
        "Is Corresponding": "",
        "Author Affiliation": " | ".join(blob for _name, _index, blob in confirmed if blob),
        "Partner Organizations": "N/A",
        "Published Date": date,
        "Published Month": month_name,
        "Published Year": year,
        "Publication Medium Category": medium,
        "Subject Domain Category": subject_of(item.get("title") or "", item.get("venue") or ""),
        "Venue / Source": item.get("venue") or "",
        "Publisher": item.get("publisher") or "",
        "All Authors": ", ".join(authors),
        "Volume": item.get("volume") or "",
        "Issue": item.get("issue") or "",
        "Pages": item.get("pages") or "",
        "DOI": item.get("doi") or "",
        "Citations": str(citation_number(item.get("citations")) or 0),
        "Paper URL": item.get("url") or item.get("evidence_url") or "",
        "Scholar Profile URL": f"https://scholar.google.com/citations?user={user_id}&hl=en" if user_id else "",
        "Faculty Status": "Active",
        "photo_url": (faculty_row or {}).get("photo_url") or "",
        "Academic Period Tag": period_tag(item.get("year"), item.get("month")),
        "Verification Evidence": "AFFILIATION; " + "; ".join(evidence_sources or ["OPENALEX"]),
        "Evidence Source URL": " | ".join(
            part for part in (item.get("evidence_url"), item.get("url")) if part
        ),
    }
    return record


def find_portal_matches(record_index: dict[str, list[dict]], item: dict) -> list[dict]:
    found = []
    seen = set()
    for key in work_keys(item):
        for record in record_index.get(key) or []:
            marker = id(record)
            if marker in seen:
                continue
            seen.add(marker)
            found.append(record)
    return found


def portal_index(records: list[dict]) -> dict[str, list[dict]]:
    index: dict[str, list[dict]] = {}
    for record in records:
        for key in portal_keys(record):
            index.setdefault(key, []).append(record)
    return index


def admit(config) -> dict:
    """Match collected works to the portal and append confirmed new rows."""
    OUT.mkdir(parents=True, exist_ok=True)
    raw = PUBLICATIONS.read_bytes()
    newline = "\r\n" if b"\r\n" in raw[:200] else "\n"
    records = json.loads(raw.decode("utf-8"))
    original_count = len(records)
    index = portal_index(records)
    openalex_rows = load_jsonl("openalex")
    crossref_rows = load_jsonl("crossref")
    scholar_rows = load_jsonl("scholar")
    for edge_row in load_jsonl("edge_scholar") + load_jsonl("edge_scopus"):
        copied = dict(edge_row)
        copied["from_edge"] = True
        scholar_rows.append(copied)
    confirmed = group_confirmed(openalex_rows + crossref_rows)
    citations_refreshed = 0
    added_items = []
    added_keys: set[str] = set()
    for item in confirmed:
        matches = find_portal_matches(index, item)
        if matches:
            for record in matches:
                if refresh_citation(record, item.get("citations")):
                    citations_refreshed += 1
            continue
        if item.get("outside_window") or not in_window(*date_tuple(item)):
            continue
        added_items.append(item)
        added_keys.update(work_keys(item))

    scholar_only = []
    scholar_not_checked = []
    lookup_cache_path = OUT / "scholar_lookup_cache.json"
    lookup_cache = {}
    if lookup_cache_path.exists():
        lookup_cache = json.loads(lookup_cache_path.read_text(encoding="utf-8"))
    verify_cache = verify.load_cache()
    stopped_lookup = False
    stop_reason = ""
    seen_scholar = set()
    pending = []
    for row in scholar_rows:
        key = row.get("faculty", "") + "|" + norm_title(row.get("title") or "")
        if not key.strip("|") or key in seen_scholar:
            continue
        seen_scholar.add(key)
        if find_portal_matches(index, row) or any(work_keys(row) and set(work_keys(row)) & set(work_keys(item)) for item in added_items):
            continue
        # Already represented by a confirmed OpenAlex or Crossref group.
        represented = False
        for item in confirmed:
            if set(work_keys(row)) & set(work_keys(item)):
                represented = True
                break
        if represented:
            continue
        pending.append(row)

    use_openalex = not load_status("openalex").get("stopped")
    edge_openalex = True
    if not use_openalex:
        log("[admit] The earlier OpenAlex author crawl stopped at quota. Edge titles still try OpenAlex, then Crossref.")
    log(f"[admit] scholar titles that still need a publisher lookup: {len(pending)}")
    looked_up = 0
    try:
        for row in pending:
            if stopped_lookup:
                scholar_not_checked.append({
                    "faculty": row.get("faculty"),
                    "title": row.get("title"),
                    "year": row.get("year"),
                    "reason": stop_reason or "lookup stopped",
                })
                continue
            row_openalex = edge_openalex if row.get("from_edge") else use_openalex
            cache_key = row.get("faculty", "") + "|" + norm_title(row.get("title") or "") + ("|oa" if row_openalex else "|cr-only")
            if cache_key in lookup_cache:
                verdict = lookup_cache[cache_key]
            else:
                try:
                    verdict = lookup_scholar_title(row, verify_cache, use_openalex=row_openalex)
                except verify.LookupError as exc:
                    recovered = False
                    if row.get("from_edge") and row_openalex and is_stop(exc):
                        edge_openalex = False
                        log("[admit] OpenAlex title lookup stopped. Later Edge titles use Crossref only.")
                        try:
                            verdict = lookup_scholar_title(row, verify_cache, use_openalex=False)
                            cache_key = row.get("faculty", "") + "|" + norm_title(row.get("title") or "") + "|cr-only"
                            recovered = True
                        except verify.LookupError as inner:
                            exc = inner
                    if not recovered:
                        lookup_cache[cache_key] = {"error": str(exc)}
                        if is_stop(exc):
                            stopped_lookup = True
                            stop_reason = str(exc)
                            scholar_not_checked.append({
                                "faculty": row.get("faculty"),
                                "title": row.get("title"),
                                "year": row.get("year"),
                                "reason": stop_reason,
                            })
                            continue
                        scholar_only.append({
                            "faculty": row.get("faculty"),
                            "title": row.get("title"),
                            "year": row.get("year"),
                            "reason": f"lookup failed and was skipped: {exc}",
                        })
                        continue
                lookup_cache[cache_key] = verdict
                looked_up += 1
                if looked_up % 25 == 0:
                    lookup_cache_path.write_text(json.dumps(lookup_cache), encoding="utf-8")
                    verify.save_cache(verify_cache)
                    log(f"[admit] looked up {looked_up} scholar titles")
            if verdict.get("error") and is_stop(Exception(verdict["error"])):
                stopped_lookup = True
                stop_reason = verdict["error"]
                scholar_not_checked.append({
                    "faculty": row.get("faculty"),
                    "title": row.get("title"),
                    "year": row.get("year"),
                    "reason": stop_reason,
                })
                continue
            packed = verdict.get("item")
            if not packed:
                entry = {
                    "faculty": row.get("faculty"),
                    "title": row.get("title"),
                    "year": row.get("year"),
                    "reason": verdict.get("reason") or "not confirmed",
                }
                status = verdict.get("status") or ""
                if not row_openalex and status != "other_college":
                    scholar_not_checked.append(entry)
                else:
                    scholar_only.append(entry)
                continue
            matches = find_portal_matches(index, packed)
            if matches:
                for record in matches:
                    if refresh_citation(record, packed.get("citations")):
                        citations_refreshed += 1
                continue
            if not in_window(*date_tuple(packed)):
                continue
            overlap = [offset for offset, item in enumerate(added_items) if set(work_keys(packed)) & set(work_keys(item))]
            if overlap:
                added_items[overlap[0]] = merge_confirmed([added_items[overlap[0]], packed])
                added_keys.update(work_keys(packed))
                continue
            added_items.append(packed)
            added_keys.update(work_keys(packed))
    finally:
        lookup_cache_path.write_text(json.dumps(lookup_cache), encoding="utf-8")
        verify.save_cache(verify_cache)

    faculty_rows = json.loads(FACULTY_PATH.read_text(encoding="utf-8"))
    faculty_by_name = {person.get("Name"): person for person in faculty_rows}
    existing_designations = {}
    for record in records:
        existing_designations.setdefault(record.get("Faculty Name") or "", record.get("Faculty Designation") or "")
    scholar_users = {author.name: author.scholar_user for author in config.authors if author.scholar_user}
    catalog = load_scimago(config)
    roster = tagger.load_roster(FACULTY_PATH)
    new_records = []
    for item in added_items:
        record = build_record(item, faculty_by_name, existing_designations, scholar_users)
        apply_venue(record, item, catalog)
        tagger.tag_record(record, roster)
        new_records.append(record)
        for key in portal_keys(record):
            index.setdefault(key, []).append(record)
    records.extend(new_records)
    for record in records:
        tagger.tag_record(record, roster)
    payload = json.dumps(records, indent=2, ensure_ascii=False).replace("\n", newline)
    backup = OUT / "publications.before.json"
    if not backup.exists():
        backup.write_bytes(raw)
    PUBLICATIONS.write_bytes(payload.encode("utf-8"))
    report = {
        "original_rows": original_count,
        "added": len(new_records),
        "final_rows": len(records),
        "citations_refreshed": citations_refreshed,
        "scholar_only_left_out": len(scholar_only),
        "scholar_not_checked": len(scholar_not_checked),
        "lookup_stopped": stop_reason,
        "openalex": load_status("openalex"),
        "crossref": load_status("crossref"),
        "scholar": load_status("scholar"),
    }
    (OUT / "scholar_only.json").write_text(json.dumps(scholar_only, indent=2), encoding="utf-8")
    (OUT / "scholar_not_checked.json").write_text(json.dumps(scholar_not_checked, indent=2), encoding="utf-8")
    (OUT / "admit_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    log(
        f"[admit] added {len(new_records)} rows, refreshed {citations_refreshed} citations, "
        f"left out {len(scholar_only)} scholar-only titles, {len(scholar_not_checked)} scholar titles not checked"
    )
    return report


def affiliation_status(faculty: str, openalex_works: list[dict], crossref_works: list[dict]) -> str:
    """What the publisher record says about this faculty member, ignoring coauthors."""
    saw_person = False
    saw_other = False
    saw_blank = False
    for work in openalex_works:
        for authorship in work.get("authorships") or []:
            display = (authorship.get("author") or {}).get("display_name") or ""
            raw = authorship.get("raw_author_name") or ""
            if not (person_matches(faculty, display) or (raw and person_matches(faculty, raw))):
                continue
            saw_person = True
            blob = affiliation_blob_openalex(authorship)
            if verify.is_pccoe(blob):
                return "pccoe"
            if blob.strip():
                saw_other = True
            else:
                saw_blank = True
    for work in crossref_works:
        for person in work.get("author") or []:
            name = person.get("name") or " ".join(
                part for part in (person.get("given") or "", person.get("family") or "") if part
            )
            if not person_matches(faculty, name):
                continue
            saw_person = True
            blob = " ".join((aff.get("name") or "") for aff in (person.get("affiliation") or []))
            if verify.is_pccoe(blob):
                return "pccoe"
            if blob.strip():
                saw_other = True
            else:
                saw_blank = True
    if saw_other:
        return "other_college"
    if saw_person or saw_blank:
        return "no_affiliation"
    if openalex_works or crossref_works:
        return "not_on_work"
    return "not_found"


def years_compatible(wanted, found) -> bool:
    if wanted in (None, "") or found in (None, ""):
        return True
    try:
        return abs(int(wanted) - int(found)) <= 1
    except (TypeError, ValueError):
        return True


def lookup_scholar_title(row: dict, cache: dict, use_openalex: bool = True) -> dict:
    """OpenAlex, then Crossref. Only a PCCOE affiliation for this faculty member counts."""
    title = row.get("title") or ""
    faculty = row.get("faculty") or ""
    wanted_year = row.get("year")
    openalex_hits = []
    crossref_hits = []
    if use_openalex:
        try:
            for work in verify.openalex_by_title(title, cache):
                if verify.title_matches(title, work.get("title") or "") and years_compatible(wanted_year, work.get("publication_year")):
                    openalex_hits.append(work)
        except verify.LookupError:
            raise
    packed = []
    for work in openalex_hits:
        item = pack_openalex(faculty, work)
        if item is not None:
            packed.append(item)
    need_crossref = not packed or all(item.get("precision") == "year" for item in packed)
    if need_crossref:
        try:
            for work in verify.crossref_by_title(title, cache):
                found = " ".join(work.get("title") or [])
                found_year = (((work.get("issued") or {}).get("date-parts") or [[None]])[0] or [None])[0]
                if verify.title_matches(title, found) and years_compatible(wanted_year, found_year):
                    crossref_hits.append(work)
        except verify.LookupError as exc:
            if not packed or is_stop(exc):
                raise
        for work in crossref_hits:
            item = pack_crossref(faculty, work)
            if item is not None:
                packed.append(item)
    if not packed:
        status = affiliation_status(faculty, openalex_hits, crossref_hits)
        reasons = {
            "other_college": "publisher record names another affiliation for this faculty member",
            "no_affiliation": "publisher record has this faculty member but no affiliation text",
            "not_on_work": "a similar title did not list this faculty member",
            "not_found": "no matching publisher work",
        }
        if not use_openalex and status == "not_found":
            reasons["not_found"] = "OpenAlex was not checked after the quota stop, and Crossref did not return a matching work"
        return {"item": None, "status": status, "reason": reasons.get(status, status)}
    merged = merge_confirmed(packed)
    if merged.get("outside_window") or not in_window(*date_tuple(merged)):
        return {"item": None, "reason": "outside 2001-01-01 through 2026-11-24"}
    return {"item": merged, "reason": "pccoe"}


def load_scimago(config) -> ScimagoIndex:
    candidates = [
        Path(config.venue.scimago_csv),
        (ROOT / "scholarwatch" / config.venue.scimago_csv).resolve(),
        ROOT / "scimagojr_master.csv",
    ]
    for path in candidates:
        if path.is_file():
            log(f"[venue] SCImago file {path}")
            return ScimagoIndex.load(path)
    raise FileNotFoundError("scimagojr_master.csv was not found")


def has_main(record: dict) -> bool:
    return "(Main)" in (record.get("PCCOE Authors") or "")


def portal_unique_key(record: dict) -> str:
    doi = norm_doi(record.get("DOI") or "")
    if doi:
        return "doi:" + doi
    title = re.sub(r"[^a-z0-9]", "", (record.get("Paper Title") or "").lower())
    return f"title:{title}|{record.get('Published Year') or ''}"


def unique_records(records: list[dict]) -> list[dict]:
    seen = set()
    chosen = []
    for record in records:
        key = portal_unique_key(record)
        if key in seen:
            continue
        seen.add(key)
        chosen.append(record)
    return chosen


def contributors(record: dict) -> list[tuple[str, str]]:
    people = []
    raw = record.get("PCCOE Authors") or ""
    for part in raw.split(";"):
        match = re.match(r"\d+\.\s+(.+)\s+\((Main|Co-Author)\)$", part.strip())
        if match:
            people.append((match.group(1).strip(), match.group(2)))
    return people


def row_in_july_slice(record: dict) -> bool:
    try:
        year = int(record.get("Published Year") or 0)
    except (TypeError, ValueError):
        return False
    month = MONTHS.get(record.get("Published Month") or "")
    if year != 2026 or month is None or month < 7 or month > 11:
        return False
    date = str(record.get("Published Date") or "")
    if re.fullmatch(r"2026-11-(\d{2})", date) and int(date[-2:]) > 23:
        return False
    if re.fullmatch(r"2026-(\d{2})-(\d{2})", date):
        stamp = tuple(int(part) for part in date.split("-"))
        if stamp < (2026, 7, 1) or stamp > (2026, 11, 24):
            return False
    return True


def write_workbook(path: Path, records: list[dict], heading: str) -> None:
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    unique = unique_records(records)
    department = [record for record in unique if has_main(record)]
    workbook = openpyxl.Workbook()
    header_fill = PatternFill("solid", fgColor="1F4E79")
    header_font = Font(name="Calibri", bold=True, color="FFFFFF")
    thin = Border(
        left=Side(style="thin", color="D9D9D9"),
        right=Side(style="thin", color="D9D9D9"),
        top=Side(style="thin", color="D9D9D9"),
        bottom=Side(style="thin", color="D9D9D9"),
    )
    wrap = Alignment(wrap_text=True, vertical="center")

    def paint_header(sheet, titles):
        for column, title in enumerate(titles, start=1):
            cell = sheet.cell(1, column, title)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = f"A1:{get_column_letter(len(titles))}1"
        sheet.row_dimensions[1].height = 30

    department_sheet = workbook.active
    department_sheet.title = "Department"
    department_sheet["A1"] = heading
    department_sheet["A1"].font = Font(name="Calibri", bold=True, size=14, color="1F4E79")
    department_sheet["A3"] = "Each title is counted once. The department total includes a paper only when a PCCOE faculty member is a main author."
    department_sheet["A4"] = "Co-author-only titles stay on the By title and Faculty counts sheets and are not added again to the department total."
    journals = sum(1 for record in department if record.get("Publication Medium Category") == "Journal Article")
    conferences = sum(1 for record in department if record.get("Publication Medium Category") == "Conference Proceeding")
    books = sum(1 for record in department if "Book" in (record.get("Publication Medium Category") or ""))
    preprints = sum(1 for record in department if record.get("Publication Medium Category") == "Preprint / Open Repository")
    datasets = sum(1 for record in department if record.get("Publication Medium Category") == "Dataset")
    main_credits = sum(1 for record in unique for _name, role in contributors(record) if role == "Main")
    co_credits = sum(1 for record in unique for _name, role in contributors(record) if role == "Co-Author")
    summary = [
        ("Unique titles", len(unique)),
        ("Department total (main author)", len(department)),
        ("Journals in the department total", journals),
        ("Conferences in the department total", conferences),
        ("Books in the department total", books),
        ("Preprints in the department total", preprints),
        ("Datasets in the department total", datasets),
        ("Main-author credits", main_credits),
        ("Co-author credits", co_credits),
    ]
    department_sheet["A6"] = "Total"
    department_sheet["B6"] = "Count"
    for offset, (label, count) in enumerate(summary, start=7):
        department_sheet.cell(offset, 1, label)
        department_sheet.cell(offset, 2, count)
    department_sheet.column_dimensions["A"].width = 88
    department_sheet.column_dimensions["B"].width = 18

    by_title = workbook.create_sheet("By title")
    titles = [
        "Published Date", "Published Year", "Title", "Type", "Venue", "Main authors", "Co-authors",
        "Main author count", "Co-author count", "All PCCOE names", "DOI", "SJR Quartile", "Department total",
    ]
    paint_header(by_title, titles)
    for row_number, record in enumerate(sorted(unique, key=lambda item: str(item.get("Published Date") or ""), reverse=True), start=2):
        people = contributors(record)
        mains = [name for name, role in people if role == "Main"]
        cos = [name for name, role in people if role == "Co-Author"]
        medium = record.get("Publication Medium Category") or ""
        if medium == "Dataset":
            kind = "Dataset"
        elif "Book" in medium:
            kind = "Book"
        elif "Conference" in medium:
            kind = "Conference"
        elif "Preprint" in medium:
            kind = "Preprint"
        else:
            kind = "Journal"
        doi = record.get("DOI") or ""
        doi_url = f"https://doi.org/{doi}" if doi and not doi.startswith("http") else doi
        values = [
            record.get("Published Date") or "",
            record.get("Published Year") or "",
            record.get("Paper Title") or "",
            kind,
            record.get("Venue / Source") or "",
            "; ".join(mains),
            "; ".join(cos),
            len(mains),
            len(cos),
            "; ".join(name for name, _role in people),
            doi_url,
            record.get("SJR Quartile") or "",
            "Yes" if has_main(record) else "No",
        ]
        for column, value in enumerate(values, start=1):
            cell = by_title.cell(row_number, column, value)
            cell.alignment = wrap
            cell.border = thin
    widths = [16, 12, 72, 14, 42, 36, 36, 14, 14, 42, 42, 14, 18]
    for column, width in enumerate(widths, start=1):
        by_title.column_dimensions[get_column_letter(column)].width = width

    faculty_sheet = workbook.create_sheet("Faculty counts")
    faculty_titles = [
        "Faculty", "Journal main", "Journal co-author", "Total journals",
        "Conference main", "Conference co-author", "Total conferences", "Books", "Overall total",
    ]
    paint_header(faculty_sheet, faculty_titles)
    stats: dict[str, dict[str, int]] = {}

    def bump(name: str, field: str) -> None:
        stats.setdefault(name, {title: 0 for title in faculty_titles[1:]})
        stats[name][field] += 1

    for record in unique:
        medium = record.get("Publication Medium Category") or ""
        for name, role in contributors(record):
            if medium == "Dataset":
                continue
            if "Book" in medium:
                bump(name, "Books")
            elif medium == "Conference Proceeding":
                bump(name, "Conference main" if role == "Main" else "Conference co-author")
            else:
                bump(name, "Journal main" if role == "Main" else "Journal co-author")
    ordered = sorted(stats, key=lambda name: (-sum(stats[name].values()), name))
    for row_number, name in enumerate(ordered, start=2):
        row = stats[name]
        row["Total journals"] = row["Journal main"] + row["Journal co-author"]
        row["Total conferences"] = row["Conference main"] + row["Conference co-author"]
        row["Overall total"] = row["Total journals"] + row["Total conferences"] + row["Books"]
        values = [name] + [row[title] for title in faculty_titles[1:]]
        for column, value in enumerate(values, start=1):
            cell = faculty_sheet.cell(row_number, column, value)
            cell.border = thin
    faculty_sheet.column_dimensions["A"].width = 42
    for column in range(2, len(faculty_titles) + 1):
        faculty_sheet.column_dimensions[get_column_letter(column)].width = 18
    path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(path)
    log(f"[publish] wrote {path} unique {len(unique)} department {len(department)}")


def publish_files() -> dict:
    raw = PUBLICATIONS.read_bytes()
    records = json.loads(raw.decode("utf-8"))
    years = sorted({int(record["Published Year"]) for record in records if str(record.get("Published Year") or "").isdigit()})
    write_workbook(
        MASTER_XLSX,
        records,
        "Department totals, 1 January 2001 through 24 November 2026",
    )
    july = [record for record in records if row_in_july_slice(record)]
    write_workbook(
        JULY_XLSX,
        july,
        "Department totals, 1 July 2026 through 24 November 2026",
    )
    unique = unique_records(records)
    department = [record for record in unique if has_main(record)]
    summary = {
        "rows": len(records),
        "unique_titles": len(unique),
        "department_total": len(department),
        "year_min": years[0] if years else None,
        "year_max": years[-1] if years else None,
        "july_rows": len(july),
        "july_department": len([record for record in unique_records(july) if has_main(record)]),
    }
    (OUT / "publish_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    log(json.dumps(summary))
    return summary


def self_check() -> None:
    assert person_matches("Dr. Sonali D. Patil", "Sonali Patil")
    assert person_matches("Prof. Dr. K. Rajeswari", "Kannan Rajeswari")
    assert person_matches("Mrs. B. Mahalakshmi", "B. Mahalakshmi")
    assert person_matches("Dr. Mubin Shoukat Tamboli", "Mubin Tamboli")
    assert not person_matches("Prof. Dr. K. Rajeswari", "S. Rajeswari")
    assert not person_matches("Dr. Sonali D. Patil", "Dipali Patil")
    assert not person_matches("Dr. Sonali D. Patil", "Patil")
    assert in_window(2001, 1, 1)
    assert in_window(2026, 11, 23)
    assert in_window(2026, 11, 24)
    assert in_window(2026, None, None)
    assert not in_window(2000, 12, 31)
    assert not in_window(2026, 11, 25)
    assert not in_window(2026, 12, 1)
    assert not in_window(None, None, None)
    assert openalex_date({"publication_date": "2014-01-01", "publication_year": 2014})[3] == "year"
    assert openalex_date({"publication_date": "2014-03-01", "publication_year": 2014})[1] == 3
    assert crossref_date({"issued": {"date-parts": [[2014]]}, "published-online": {"date-parts": [[2014, 5, 2]]}})[3] == "day"
    assert verify.is_pccoe("Pimpri Chinchwad College of Engineering")
    assert verify.is_pccoe("PCCOE Pune")
    assert not verify.is_pccoe("College of Engineering Pune")


def collect_all(config) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []

    def run(label: str, function) -> None:
        try:
            function(config)
        except Exception as exc:
            errors.append(f"{label}: {exc}")
            log(f"[{label}] failed: {exc}")
            traceback.print_exc()

    threads = [
        threading.Thread(target=run, args=("openalex", collect_openalex), name="openalex"),
        threading.Thread(target=run, args=("crossref", collect_crossref), name="crossref"),
        threading.Thread(target=run, args=("scholar", collect_scholar), name="scholar"),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    if errors:
        (OUT / "collect_errors.json").write_text(json.dumps(errors, indent=2), encoding="utf-8")
        log("[collect] finished with errors: " + "; ".join(errors))
    else:
        log("[collect] finished")


def _doi_path(record: dict) -> str:
    doi = (record.get("DOI") or "").lower()
    return doi.replace("https://doi.org/", "").replace("http://doi.org/", "").strip()


def _is_lnns(record: dict) -> bool:
    venue = (record.get("Venue / Source") or "").lower()
    return "lecture notes in networks and systems" in venue


def _is_wiley_chapter(record: dict) -> bool:
    doi = _doi_path(record)
    return doi.startswith("10.1002/") and ".ch" in doi


def _is_zenodo(record: dict) -> bool:
    venue = (record.get("Venue / Source") or "").lower()
    doi = _doi_path(record)
    return "zenodo" in venue or doi.startswith("10.5281/zenodo")


def refresh_journal_ranks(config) -> dict:
    """SCImago quartiles for journals still Not Ranked. Book chapters stay Not Ranked."""
    raw = PUBLICATIONS.read_bytes()
    newline = "\r\n" if b"\r\n" in raw[:200] else "\n"
    records = json.loads(raw.decode("utf-8"))
    catalog = load_scimago(config)
    tiers = {
        "Q1": "Tier 1A (Scopus Q1)",
        "Q2": "Tier 1B (Scopus Q2)",
        "Q3": "Tier 2A (Scopus Q3)",
        "Q4": "Tier 2A (Scopus Q4)",
    }
    journal_changes = []
    chapter_clears = []
    lnns_to_conference = 0
    wiley_chapters = 0
    zenodo_to_dataset = 0
    springer_chapters = 0
    still_unranked: dict[str, int] = {}
    for record in records:
        medium = record.get("Publication Medium Category") or ""
        title = record.get("Paper Title") or ""
        venue = record.get("Venue / Source") or ""
        if _is_zenodo(record):
            if medium != "Dataset":
                zenodo_to_dataset += 1
            record["Publication Medium Category"] = "Dataset"
            record["SJR Quartile"] = "Not Ranked"
            record["Scopus Indexing Status"] = "Dataset (Zenodo)"
            record["Academic Audit Tier"] = "Tier 3 (Dataset)"
            continue
        if _is_wiley_chapter(record):
            wiley_chapters += 1
            before = record.get("SJR Quartile")
            record["Publication Medium Category"] = "Book Chapter"
            record["SJR Quartile"] = "Not Ranked"
            if before in {"Q1", "Q2", "Q3", "Q4"}:
                chapter_clears.append({"title": title, "venue": venue, "from": before, "to": "Not Ranked", "why": "wiley chapter"})
                if "Scopus Q" in (record.get("Academic Audit Tier") or ""):
                    record["Academic Audit Tier"] = "Tier 3 (Book Chapter)"
            continue
        if _is_lnns(record):
            if medium != "Conference Proceeding":
                lnns_to_conference += 1
                record["Publication Medium Category"] = "Conference Proceeding"
            continue
        springer_chapter = medium == "Journal Article" and _doi_path(record).startswith("10.1007/978-")
        if medium == "Book Chapter" or springer_chapter:
            if springer_chapter:
                springer_chapters += 1
                record["Publication Medium Category"] = "Book Chapter"
            before = record.get("SJR Quartile")
            if before in {"Q1", "Q2", "Q3", "Q4"}:
                chapter_clears.append({"title": title, "venue": venue, "from": before, "to": "Not Ranked", "why": "book chapter"})
                if "Scopus Q" in (record.get("Academic Audit Tier") or ""):
                    record["Academic Audit Tier"] = "Tier 3 (Book Chapter)"
            record["SJR Quartile"] = "Not Ranked"
            continue
        if medium != "Journal Article" or record.get("SJR Quartile") != "Not Ranked":
            continue
        hit = catalog.lookup(venue, record.get("Canonical ISSN / eISSN") or "")
        if hit.method == "unmatched" or (hit.source_type or "").lower() not in {"journal", "trade journal"}:
            still_unranked[venue] = still_unranked.get(venue, 0) + 1
            continue
        quartile = hit.quartile if hit.quartile in {"Q1", "Q2", "Q3", "Q4"} else ""
        if not quartile:
            still_unranked[venue] = still_unranked.get(venue, 0) + 1
            continue
        record["SJR Quartile"] = quartile
        record["SJR Score"] = hit.sjr or "N/A"
        record["Source H-Index"] = hit.h_index or "N/A"
        if hit.issn:
            record["Canonical ISSN / eISSN"] = hit.issn
        record["Scopus Source ID"] = hit.source_id or "N/A"
        record["Scopus Coverage Years"] = hit.coverage or "Matched in the 2021 SCImago master"
        record["Scopus Indexing Status"] = "Scopus Indexed (Active)"
        record["Conference Series Legitimacy"] = "Matched in SCImago Journal Rank"
        record["Academic Audit Tier"] = tiers[quartile]
        record["Rank Authority"] = "scimago_2021"
        journal_changes.append({"title": title, "venue": venue, "from": "Not Ranked", "to": quartile, "why": "scimago"})
    payload = json.dumps(records, indent=2, ensure_ascii=False).replace("\n", newline)
    PUBLICATIONS.write_bytes(payload.encode("utf-8"))
    report = {
        "journal_quartile_changes": journal_changes,
        "book_chapter_quartile_clears": chapter_clears,
        "lnns_relabeled_conference": lnns_to_conference,
        "wiley_chapters": wiley_chapters,
        "zenodo_relabeled_dataset": zenodo_to_dataset,
        "springer_978_relabeled_chapter": springer_chapters,
        "still_unranked_venues": still_unranked,
        "scopus_sources": "not checked; www.scopus.com showed a Cloudflare verification page and the checkbox was not clicked",
    }
    (OUT / "rank_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    log(
        f"[rank] journals updated {len(journal_changes)}, book chapters cleared {len(chapter_clears)}, "
        f"still unranked venues {len(still_unranked)}"
    )
    return report


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    self_check()
    command = sys.argv[1] if len(sys.argv) > 1 else "all"
    config = load_config(CONFIG_PATH)
    if command == "collect":
        collect_all(config)
    elif command == "admit":
        admit(config)
    elif command == "publish":
        publish_files()
    elif command == "rank":
        refresh_journal_ranks(config)
    elif command == "all":
        collect_all(config)
        admit(config)
        publish_files()
    else:
        raise SystemExit("usage: catchup_through_2026.py [collect|admit|publish|rank|all]")


if __name__ == "__main__":
    main()
