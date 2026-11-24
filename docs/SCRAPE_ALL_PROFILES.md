# Scrape all Computer Engineering profiles

The stored roster is `web/data/faculty.json`. It has 50 active Computer Engineering profiles. 46 of them have a Google Scholar link and 46 have a Scopus link. Skip a blank Scholar link and skip a blank Scopus link. Do not attach Scopus `57212192328`.

The live scripts stay in `scholarwatch/scripts/` and `scholarwatch/data/catchup/`. A job is already using that tree and may be writing `scholarwatch/data/catchup/` and `web/data/publications.json`. Leave those paths where they are. The copies in `web/scripts/` are the saved set. From `web/scripts/`, two directories up is the workspace root, so those copies still find the `scholarwatch` package, the roster, and the catch-up log. Do not start a second writer on the live publications file or the catch-up folder while that job is running.

## Google Scholar

Open each of the 46 stored Scholar profiles. Sort by year, descending, and read every page until the list ends. A block page stops that profile. Do not click Cloudflare. Do not type a password.

`web/scripts/edge_scholar_fetch.js` is the saved page walker (`sortby=pubdate`, 100 rows per page). `web/scripts/edge_clip_save.py` saves one clipboard capture for one profile page. `web/scripts/catchup_through_2026.py` is the saved publisher.

## Scopus

Open each of the 46 stored Scopus author profiles. List documents newest first. Copy every visible row.

Scopus Preview often shows about 10 recent titles plus a header count. Keep the visible titles and record the header count. Do not invent the hidden ones.

The live clipboard saver for a Scopus preview is `scholarwatch/scripts/_scopus_save.py`. It stays on disk for the running job. Its name is a scratch name, so it is not in this commit. It refuses Scopus `57212192328` and it stops when the page is a Cloudflare check.

## Claims and challenges

Do not click Edit profile or "Yes, this is me" on any colleague. That button files an author claim. It is allowed only on Mr. Abhishek Raut, Scopus `57679596100`.

Do not click Cloudflare. Do not type a password.

## What becomes a portal row

A new portal row is added only when OpenAlex or Crossref shows that faculty member's own affiliation contains `pimpri`, `chinchwad`, `chichwad`, or `pccoe`. A Scholar listing alone is not a row. A Scopus listing alone is not a row. A failed lookup is skipped.

## Labels that stay

Book chapters stay Not Ranked. LNNS `10.1007/978-` stays a conference. Zenodo stays a dataset.
