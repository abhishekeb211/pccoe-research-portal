"""Save one Edge clipboard capture into the catch-up scrape log.

Reads the Windows clipboard (a Scholar or Scopus page, or its view-source)
and appends parsed rows. Progress is written after every call so a block
can resume. This file is a local scrape aid and is not part of the portal.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "scholarwatch" / "src"
sys.path.insert(0, str(SRC))

from scholarwatch.sources.scholar import is_block_page, parse_profile_page  # noqa: E402

OUT = ROOT / "scholarwatch" / "data" / "catchup"
HTML = OUT / "edge_html"
PROGRESS = OUT / "edge_scrape_progress.json"
SCHOLAR_JSONL = OUT / "edge_scholar.jsonl"
SCOPUS_JSONL = OUT / "edge_scopus.jsonl"


def clipboard() -> str:
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise SystemExit(completed.stderr.strip() or "clipboard read failed")
    return completed.stdout or ""


def load_progress() -> dict:
    if PROGRESS.exists():
        return json.loads(PROGRESS.read_text(encoding="utf-8"))
    return {"scholar": {}, "scopus": {}}


def save_progress(progress: dict) -> None:
    PROGRESS.write_text(json.dumps(progress, indent=2, ensure_ascii=False), encoding="utf-8")


def append_jsonl(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def save_scholar(name: str, user: str, start: int) -> None:
    text = clipboard()
    HTML.mkdir(parents=True, exist_ok=True)
    (HTML / f"scholar_{user}_{start}.html").write_text(text, encoding="utf-8")
    blocked = is_block_page(text)
    rows = [] if blocked else parse_profile_page(text)
    packed = []
    for row in rows:
        packed.append({
            "source": "scholar",
            "faculty": name,
            "scholar_user": user,
            "cstart": start,
            "title": row.get("title") or "",
            "authors": row.get("authors") or "",
            "venue": row.get("venue") or "",
            "citations": row.get("citations") or "",
            "year": row.get("year") or "",
            "url": row.get("url") or "",
        })
    append_jsonl(SCHOLAR_JSONL, packed)
    progress = load_progress()
    slot = progress["scholar"].setdefault(name, {
        "user": user,
        "pages": [],
        "rows": 0,
        "status": "in_progress",
        "note": "",
    })
    slot["user"] = user
    slot["pages"].append({"cstart": start, "rows": len(rows), "blocked": blocked, "chars": len(text)})
    slot["rows"] = sum(page["rows"] for page in slot["pages"])
    if blocked:
        slot["status"] = "blocked"
        slot["note"] = f"blocked at cstart {start}"
    elif len(rows) < 100:
        slot["status"] = "complete"
        slot["note"] = "list ended"
    else:
        slot["status"] = "in_progress"
        slot["note"] = f"full page at cstart {start}; next page still required"
    save_progress(progress)
    print(json.dumps({
        "faculty": name,
        "cstart": start,
        "rows": len(rows),
        "blocked": blocked,
        "chars": len(text),
        "status": slot["status"],
        "total_rows": slot["rows"],
        "first": (packed[0]["year"], packed[0]["title"][:90]) if packed else None,
        "last": (packed[-1]["year"], packed[-1]["title"][:90]) if packed else None,
    }, ensure_ascii=False))


def main() -> None:
    kind = sys.argv[1]
    if kind == "scholar":
        _name, user, start = sys.argv[2], sys.argv[3], int(sys.argv[4])
        save_scholar(_name, user, start)
    else:
        raise SystemExit("usage: edge_clip_save.py scholar NAME USER START")


if __name__ == "__main__":
    main()
