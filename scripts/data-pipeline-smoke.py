#!/usr/bin/env python3
"""Self-test for the data pipeline guards — no API calls, no network, no repo writes.

Covers the things that actually cost money or corrupt data if they break:

  * the free-tier budget guard (per-SKU monthly counting, hard stop *before* overage,
    month roll-over, crash-safe persistence, override clamping, corrupt-ledger refusal)
  * the keep/reject filter (keyword match, exclusions, permanently closed)
  * slug allocation (collision suffix, idempotent re-run) and listing output

Run:  python3 scripts/data-pipeline-smoke.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import broaden  # noqa: E402
from place_filter import pick_category, should_keep, verdict  # noqa: E402
from photo_paths import photo_paths, photo_slug  # noqa: E402
from places_budget import (  # noqa: E402
    FREE_MONTHLY_CAPS,
    BudgetExhausted,
    PlacesBudget,
    next_month,
    parse_caps,
)

PASSED = []
FAILED = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(label)
        print(f"  ✓ {label}")
    else:
        FAILED.append(label)
        print(f"  ✗ {label} {detail}")


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="pipeline-smoke-"))

    # ── free-tier guard ───────────────────────────────────────────────────
    print("\nbudget guard")
    check("free caps are the published per-SKU allowances",
          FREE_MONTHLY_CAPS == {"text_search": 1000, "nearby_search": 1000,
                                "details": 1000, "photo": 1000},
          str(FREE_MONTHLY_CAPS))

    ledger = tmp / "usage-ledger.json"
    budget = PlacesBudget(ledger_path=ledger, month="2026-09")
    check("a missing ledger starts at zero", budget.used("details") == 0)
    check("summary reports the free allowance", budget.remaining("photo") == 1000)

    budget.spend("details")
    budget.spend("details")
    budget.spend("photo")
    on_disk = json.loads(ledger.read_text())
    check("every call is persisted immediately",
          on_disk["months"]["2026-09"]["details"] == 2 and on_disk["months"]["2026-09"]["photo"] == 1,
          json.dumps(on_disk["months"]))
    reloaded = PlacesBudget(ledger_path=ledger, month="2026-09")
    check("a new process reads the same counts",
          reloaded.used("details") == 2 and reloaded.used("photo") == 1)
    check("a new calendar month starts at zero",
          PlacesBudget(ledger_path=ledger, month="2026-10").used("details") == 0)

    capped = PlacesBudget(ledger_path=tmp / "cap.json", month="2026-09", caps={"details": 3})
    for _ in range(3):
        capped.spend("details")
    blocked = False
    try:
        capped.spend("details")
    except BudgetExhausted as exc:
        blocked = True
        check("the over-limit call names the resume month", exc.resume_month == "2026-10",
              exc.resume_month)
    check("the call that would exceed the free tier is refused", blocked)
    check("a refused call is not counted", capped.used("details") == 3)
    check("remaining is zero at the cap", capped.remaining("details") == 0)
    check("check() refuses without writing", not capped.can_spend("details"))

    raised = PlacesBudget(ledger_path=tmp / "raise.json", caps={"photo": 999999})
    check("--caps cannot raise a cap above the free tier", raised.effective_cap("photo") == 1000)
    headroom = PlacesBudget(ledger_path=tmp / "hr.json", caps={"photo": 10}, headroom=2)
    check("--headroom stops short of the allowance", headroom.effective_cap("photo") == 8)
    check("--caps parses a comma list", parse_caps("details=20,photo=5") == {"details": 20, "photo": 5})
    check("unknown SKUs in --caps are rejected",
          _raises(lambda: parse_caps("nonsense=5")))
    check("next month rolls the year over", next_month("2026-12") == "2027-01")

    bad = tmp / "bad.json"
    bad.write_text("{not json")
    check("a corrupt ledger is fatal rather than silently reset",
          _raises(lambda: PlacesBudget(ledger_path=bad)))

    paid = PlacesBudget(ledger_path=tmp / "paid.json", month="2026-09", caps={"photo": 3})
    for _ in range(3):
        paid.spend("photo")
    check("cost projection prices calls past the free allowance",
          abs(paid.paid_projection({"photo": 10}) - 0.07) < 1e-9,
          str(paid.paid_projection({"photo": 10})))
    check("cost projection is zero inside the free tier",
          PlacesBudget(ledger_path=tmp / "free.json").paid_projection({"details": 875}) == 0.0)

    # ── keep/reject filter ────────────────────────────────────────────────
    print("\nfilter")
    check("a nail salon is kept", should_keep("Nails & Beauty Barcelona", "nails"))
    check("a hair salon that mentions nails is dropped",
          not should_keep("Peluquería Nails Style", "nails"))
    check("a massage centre is kept", should_keep("Centre de Masatges Zen", "massage"))
    check("a hotel spa is dropped", not should_keep("Hotel Spa Palace", "massage"))
    check("an unrelated name is dropped", not should_keep("Barbería El Clot", "nails"))
    check("a permanently closed business is dropped",
          not should_keep("Nail Studio", "nails", "CLOSED_PERMANENTLY"))
    check("a temporarily closed business is kept",
          should_keep("Nail Studio", "nails", "CLOSED_TEMPORARILY"))
    check("the rejection reason is reported",
          verdict("Peluquería Nails Style", "nails")[1].startswith("excluded_keyword:"))
    check("an ambiguous place is assigned to the category its name matches",
          pick_category("Masajes Thai", ["nails", "massage"])[0] == "massage")
    check("an ambiguous place matching both keeps the first",
          pick_category("Nail Massage Studio", ["nails", "massage"])[0] == "nails")
    check("a place matching neither category is rejected",
          pick_category("Ferretería Sol", ["nails", "massage"])[0] == "")
    check("unknown categories raise", _raises(lambda: should_keep("x", "haircuts")))

    # ── slug allocation + listing output ──────────────────────────────────
    print("\nslug allocation / listing output")
    broaden.CONTENT_DIR = tmp / "content"
    broaden.DATA_DIR = tmp / "data"
    cat_dir = broaden.CONTENT_DIR / "nails"
    cat_dir.mkdir(parents=True)
    (cat_dir / "nail-house.md").write_text(
        '---\nname: "Nail House"\ngooglePlaceId: "ChIJotherplace0000"\n---\n'
    )
    taken = {"placeId": "ChIJabcdef123456", "name": "Nail House", "categories": ["nails"]}
    slug = broaden.assign_slug(taken, "nails")
    check("a slug collision gets a place-id suffix", slug == "nail-house-123456", slug)
    mine = {"placeId": "ChIJotherplace0000", "name": "Nail House", "categories": ["nails"]}
    check("a re-run reuses the candidate's own slug", broaden.assign_slug(mine, "nails") == "nail-house")

    detail = {
        "id": "ChIJabcdef123456",
        "displayName": {"text": "Nail House"},
        "formattedAddress": "Carrer de Sants 1, Barcelona",
        "rating": 4.6,
        "userRatingCount": 120,
        "businessStatus": "OPERATIONAL",
        "photos": [{"name": "places/ChIJabcdef123456/photos/abc"}],
    }
    written = broaden.write_listing(taken, "nails", detail)
    md = (cat_dir / f"{written}.md").read_text()
    check("the listing page is written",
          'googlePlaceId: "ChIJabcdef123456"' in md and 'name: "Nail House"' in md)
    check("the raw Place Details JSON is written",
          (broaden.DATA_DIR / "nails" / f"{written}.json").exists())
    check("the neighbourhood is inferred from the address",
          'neighborhood: "Sants-Montjuïc"' in md, md.splitlines()[2] if len(md.splitlines()) > 2 else "")

    # ── reporting ─────────────────────────────────────────────────────────
    print("\nreporting")
    store = {"version": 1, "candidates": {
        "a": {"status": "new"}, "b": {"status": "rejected"}, "c": {"status": "kept"},
        "d": {"status": "photographed"},
    }}
    check("status counts group by state",
          broaden.status_counts(store) == {"new": 1, "rejected": 1, "kept": 1, "photographed": 1},
          str(broaden.status_counts(store)))
    check("a discovery plan is expressed in billable calls",
          set(broaden.planned_discovery_calls()) == {"text_search", "nearby_search"})

    # ── refilter: changing the filter after the money is already spent ─────
    print("\nrefilter (a changed filter re-decides stored details for free)")
    enrich_dir = tmp / "enriched"
    broaden.ENRICHED_DIR = enrich_dir
    store_path = tmp / "candidates.json"
    store_path.write_text("{}")
    broaden.CANDIDATES_PATH = store_path
    broaden.load_api_key = lambda: "smoke-test-key"
    broaden.load_store = lambda: store
    broaden.save_store = lambda s, path=None: None

    def add_candidate(place_id, name, category, slug, mtime_marker):
        details = {
            "id": place_id,
            "displayName": {"text": name},
            "formattedAddress": "Carrer de Sants 1, Barcelona",
            "businessStatus": "OPERATIONAL",
            "rating": 4.5,
            "userRatingCount": 10,
        }
        d = broaden.ENRICHED_DIR / category
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{place_id}.json").write_text(json.dumps(details))
        page = broaden.CONTENT_DIR / category / f"{slug}.md"
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text(
            f'---\nname: "{name}"\ngooglePlaceId: "{place_id}"\n'
            f'googleReviews:\n  - author: "Someone"\n'
        )
        return {"placeId": place_id, "name": name, "categories": [category],
                "category": category, "slug": slug, "status": "kept",
                "reviewCount": 10, "photosAt": mtime_marker}

    store = {"version": 1, "candidates": {}}
    keep = add_candidate("ChIJkeep00000001", "Nails & Beauty Barcelona", "nails",
                         "nails-beauty-barcelona", "2026-09-01T00:00:00+00:00")
    adult = add_candidate("ChIJadult0000001", "Sauna Gay Condal", "massage",
                          "sauna-gay-condal", "2026-09-01T00:00:00+00:00")
    sibling = add_candidate("ChIJsibling000001", "Nails Beauty", "nails",
                            "nails-beauty", "2026-09-01T00:00:00+00:00")
    sibling_page = broaden.CONTENT_DIR / "nails" / "nails-beauty.md"
    store["candidates"] = {c["placeId"]: c for c in (keep, adult, sibling)}

    def enrich_args():
        return types.SimpleNamespace(dry_run=False, limit=None, offset=0,
                                     category=None, refilter=False)

    args = enrich_args()
    check("without --refilter nothing is re-decided",
          broaden.pending_candidates(store, args) == [])
    args.refilter = True
    check("--refilter re-decides every candidate that already has a verdict",
          len(broaden.pending_candidates(store, args)) == 3)

    refilter_budget = PlacesBudget(ledger_path=tmp / "refilter-ledger.json", month="2026-09")
    keep_before = (broaden.CONTENT_DIR / "nails" / "nails-beauty-barcelona.md").read_text()
    broaden.cmd_enrich(args, refilter_budget)
    check("a confirmed listing is left byte-for-byte alone (reviews survive a refilter)",
          (broaden.CONTENT_DIR / "nails" / "nails-beauty-barcelona.md").read_text() == keep_before)
    check("a listing the new filter rejects is removed",
          not (broaden.CONTENT_DIR / "massage" / "sauna-gay-condal.md").exists())
    check("its stored details survive, so the verdict can flip back for free",
          (enrich_dir / "massage" / "ChIJadult0000001.json").exists())
    check("a same-prefix sibling listing is never touched", sibling_page.exists())
    check("the flipped candidate is recorded as rejected in the store",
          store["candidates"]["ChIJadult0000001"]["status"] == "rejected")
    check("the flip records why", "excluded_keyword" in
          store["candidates"]["ChIJadult0000001"]["reason"])
    check("a refilter makes no API calls at all",
          refilter_budget.month_totals() == dict.fromkeys(FREE_MONTHLY_CAPS, 0),
          str(refilter_budget.month_totals()))

    check("an adult venue is left out of the directory",
          not should_keep("Sauna Gay Condal", "massage")
          and not should_keep("Gay Masajes Erotico", "massage"))
    check("a mainstream sauna and a tantra studio are still kept",
          should_keep("Sauna Bruc", "massage") and should_keep("Alma Tantra", "massage"))

    # ── resilience: one flaky response must not kill a paid-for run ───────
    print("\nresilience to transient network errors")
    import requests as _requests

    real_get = _requests.get
    try:
        def _boom(*_args, **_kwargs):
            raise _requests.exceptions.ReadTimeout("simulated flip")

        _requests.get = _boom
        net_budget = PlacesBudget(ledger_path=tmp / "net-ledger.json", month="2026-09")
        net_client = broaden.PlacesClient("smoke-key", net_budget)
        check("a timed-out photo download is skipped, not fatal",
              net_client.photo_bytes("places/x/photos/y") is None)
        check("the timed-out attempt is still counted against the free tier",
              net_budget.used("photo") == 1, str(net_budget.used("photo")))

        def _fail():
            raise _requests.exceptions.ConnectionError("simulated flip")

        check("a transient API error inside safe_call is skipped, not fatal",
              broaden.safe_call(_fail) is None)
    finally:
        _requests.get = real_get

    # ── photo file matching (prefix globs used to cross businesses over) ───
    print("\nphoto file matching")
    photos_dir = tmp / "photos"
    photos_dir.mkdir()
    for name in ("gt-nails-0.jpg", "gt-nails-1.jpg", "gt-nails-vietnamita-0.jpg",
                 "gt-nails-vietnamita-1.jpg", "gt-nails.json"):
        (photos_dir / name).write_text("x")
    owned = [p.name for p in photo_paths(photos_dir, "gt-nails")]
    check("a business only matches its own photos, not a longer sibling slug",
          owned == ["gt-nails-0.jpg", "gt-nails-1.jpg"], str(owned))
    check("the sibling's photos are untouched",
          len(photo_paths(photos_dir, "gt-nails-vietnamita")) == 2)
    check("a raw JSON file is never treated as a photo", photo_slug("gt-nails.json") is None)
    check("a non-numeric suffix is not a photo file", photo_slug("gt-nails-extra.jpg") is None)
    check("a hyphenated slug is parsed whole", photo_slug("spa-capilar-japonès---barcelona-3.jpg")
          == "spa-capilar-japonès---barcelona")

    print(f"\n{'=' * 60}\n{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("failures: " + ", ".join(FAILED))
    return 1 if FAILED else 0


def _raises(fn) -> bool:
    try:
        fn()
    except Exception:
        return True
    return False


if __name__ == "__main__":
    raise SystemExit(main())
