# Data pipeline: discovery → enrichment → photos

`scripts/broaden.py` finds new nail salons and massage businesses in Barcelona and turns
them into content pages. It runs in three phases, each of which can be run, stopped and
resumed on its own, and every Google Places call is counted against the free monthly
allowance before it is made (see `docs/places-api-free-tier-guardrails.md` for the
free-tier rules and the one-time console setup).

```bash
python3 scripts/broaden.py status                 # what is pending, what this month costs
python3 scripts/broaden.py discover               # Phase 1 — search, save candidates (free)
python3 scripts/broaden.py enrich --limit 100     # Phase 2 — Place Details + filter (free)
python3 scripts/broaden.py photos --limit 100     # Phase 3 — photos for kept businesses only
```

Every subcommand takes `--dry-run` (print the calls and the projected cost, spend nothing),
`--caps 'photo=20'` (lower a free-tier cap for this run only) and `--headroom N` (stop N
calls short of the allowance). `--limit`/`--batch` and `--offset` batch a phase by hand;
usually you do not need them, because progress is stored and the phase simply continues
where it stopped.

## What each phase does, and what it costs

| Phase | Work | Google SKU | Free each month | Stops at |
| --- | --- | --- | --- | --- |
| `discover` | 313 Text Searches (49 barrios × 2 categories × 3 keyword variants + 19 city-wide variants) + 286 Nearby Searches (13 × 11 grid cells × 2 categories) | Text Search (Pro), Nearby Search (Pro) | 5,000 + 5,000 | the free cap, then resumes next month |
| `enrich` | one Place Details call per candidate, then the keep/reject filter, then the content page | Place Details (Enterprise) | 1,000 | idem |
| `photos` | up to 5 photo downloads per **kept** business | Place Details Photos | 1,000, then $7/1,000 | idem |

Discovery sits in the Pro tier because `TEXT_SEARCH_MASK` asks only for identity, name,
address, type and location; details is Enterprise because a listing needs rating, hours,
phone and website. `enrich` is therefore the binding constraint on the whole pipeline: at
most 1,000 candidates a month, no matter how much search headroom there is.

**Order matters for cost.** Photos are the only SKU that gets expensive, and about 60 % of
discovered candidates are false positives (a hairdresser's "uñas" mention, a hotel with a
spa, a permanently closed shop). Enriching *and* photographing all ~875 candidates would be
up to 4,375 photo calls (~$24). Enriching first (free), dropping the false positives, and
only then photographing the survivors costs ~0 for the details and stays inside the 1,000
free photos for ~200–400 survivors. So: never run `photos` before `enrich`, and never move
the photo download back into the enrichment loop.

## Files

| Path | Role |
| --- | --- |
| `data/candidates.json` | The work list: every discovered place with its state. Git-ignored, machine-local. |
| `data/usage-ledger.json` | Calls per SKU per calendar month + a log of the last runs. Git-ignored. Read it with `python3 scripts/places_budget.py`. |
| `data/enriched/<category>/<placeId>.json` | Raw Place Details, one file per enriched candidate (kept *and* rejected). |
| `src/content/<category>/<slug>.md` | The listing page, written only for kept businesses. |
| `data/<category>/<slug>.json` | The raw details for a kept business (same convention as the older scripts). |
| `data/<category>/<slug>-<n>.jpg` | Photos for a kept business. |
| `scripts/places_budget.py` | The budget guard + ledger (free-tier caps live in `FREE_MONTHLY_CAPS`). |
| `scripts/place_filter.py` | The keep/reject heuristics, shared with `filter-broadened.py`. |
| `scripts/data-pipeline-smoke.py` | 57 assertions over the guard, the filter, slug allocation, the refilter path and the photo matcher. No network. |
| `scripts/fetch-reviews.py` | Optional post-enrichment step: pulls Google reviews + editorial summary into the frontmatter. One Place Details call per file, counted by the same guard. |

## Candidate states

```
new ──enrich──▶ enriched ──filter──▶ kept ──photos──▶ photographed
                              └────▶ rejected ◀──refilter──▶ kept
```

* `new` — discovered, no Place Details yet.
* `enriched` — details fetched (paid once) and stored; only re-filtering is left. A crash
  between the two steps lands here, and re-running costs nothing.
* `kept` / `rejected` — the filter's verdict, with the reason (`name_match`,
  `closed_permanently`, `excluded_keyword:hotel`, `no_category_keyword`, …).
* `photographed` — photos downloaded (or Google has none for the place).

`rejected` candidates keep their `data/enriched/…json`, so changing the filter later
re-decides them for free: `python3 scripts/broaden.py enrich --refilter` runs the filter again
over every decided candidate, rewrites the verdict, **removes** a listing whose verdict flips
to reject (only the page carrying that place id — a slug sibling is never touched) and writes
a listing for a rejection that now passes. It makes **zero API calls**, leaves a confirmed
page byte-for-byte alone (so reviews, owner edits and services are not clobbered) and keeps
the photos on disk, including for a page it just removed, because they were already paid for
and the verdict can flip back.

`kept` candidates whose photo download failed stay `kept` and are retried; a business for
which Google has no photo at all becomes `photographed` with `"photos": 0` so it is not
retried forever.

## The budget guard

`scripts/places_budget.py` holds the per-SKU free allowances and is the only place that
counts calls:

* the count is taken **before** the request, so a crash mid-call cannot under-count;
* the ledger is rewritten atomically after **every** call, so `kill -9` loses nothing;
* a call that would cross the allowance raises `BudgetExhausted` → the run prints the resume
  month, keeps its progress and exits `2`;
* a new calendar month starts at zero automatically (the ledger keeps one bucket per month);
* a corrupt/unreadable ledger is **fatal** rather than silently re-zeroed: without it we
  cannot know how much of the allowance is spent, and guessing is how a bill happens;
* `--caps` can only *lower* a cap, never raise it above Google's free allowance.

`Text Search` and `Nearby Search` share nothing with `Place Details` or photos: each SKU has
its own allowance, so burning 5,000 Text Searches does not reduce the details or photo
budget. A full discovery pass (599 calls) sits well inside its two allowances, but a details
pass for ~875 candidates does **not** fit inside the 1,000 Place Details allowance — so
filter candidates down before enriching, or accept that the pass spreads over two months.

## Which category does a place get?

A place found by both searches carries both categories. At enrich time the filter picks the
first category whose keywords the *name* actually matches (`Masajes Thai` → massage, even if
it was first found by the nail grid), so a legitimate business is not thrown away because
the grid guessed the wrong category. A name that matches neither is rejected.

## After the photo phase

Reviews and photo upload are two independent follow-ups. Reviews first (they are free while
the Place Details allowance lasts — one call per new file):

```bash
python3 scripts/fetch-reviews.py --all           # guard-counted; stops at the free allowance
```

The site resolves photos through `src/data/photo-manifest.json` + R2, so new photos are not
visible until they are uploaded — and the manifest must be rebuilt *after* the upload, or
pages will point at R2 objects that do not exist yet:

```bash
python3 scripts/upload-photos-r2.py               # needs CLOUDFLARE_R2_TOKEN + --remote
python3 scripts/generate-photo-manifest.py        # rebuild the manifest
npm run build                                     # ~40 s, ~2.6k pages
```

`npm run build` also picks up the new content pages, so run it before pushing to `main`
(which is the production deploy).

## What the filter deliberately leaves out

`scripts/place_filter.py` is name-based and lives in one place, so a policy change is one
line plus a free `enrich --refilter`. Besides hair salons, gyms, hotels, laser clinics and
shops it drops **adult venues** (`erotic`, `sauna gay`, `gay sauna`, `sex club`, `escort`):
this is a mainstream directory whose pages carry ads and partner listings, so the default is
to leave them out. Delete that block and refilter to put them back — no API calls are
involved either way.

## Verifying the machinery

```bash
python3 scripts/data-pipeline-smoke.py   # 57 assertions, no API calls
python3 scripts/broaden.py status        # ledger + candidate states
python3 scripts/broaden.py enrich --dry-run   # what the next enrich run would cost
python3 scripts/broaden.py enrich --refilter  # re-apply a changed filter, free
```

A cheap live end-to-end check (spends a handful of free calls):

```bash
python3 scripts/broaden.py --caps 'details=3,photo=2' discover   # or reuse existing candidates
python3 scripts/broaden.py --caps 'details=3' enrich --limit 3
python3 scripts/broaden.py status
```

## Notes / gotchas

* Discovery is a **re-runnable probe**, not a one-shot: re-running it discovers nothing new
  for places already in `src/content` or already in `data/candidates.json`, costs only the
  free search SKUs, and refreshes nothing else. It is safe after a partial run.
* The old combined script used to enrich *and* photograph in one loop and had no idea how
  many calls it had spent; `filter-broadened.py` still exists as the cleanup tool for
  content written by those older runs, and now shares the keyword heuristics with the
  pipeline (`scripts/place_filter.py`).
* `data/` is git-ignored, so `candidates.json` and the ledger are local to this machine.
  They are working state, not project data — do not commit them.
