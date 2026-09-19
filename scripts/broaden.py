#!/usr/bin/env python3
"""Barcelona Compare data pipeline — discovery → enrichment → photos.

Three phases, each runnable on its own, each resumable, all of them counting every
Google Places API call against the free monthly allowance (``scripts/places_budget.py``):

    discover   Phase 1 — search the city (Text Search + Nearby Search) and persist the
               raw candidates to ``data/candidates.json``. No enrichment, no money.
               Free SKUs: Text Search (1,000/mo), Nearby Search (1,000/mo).
    enrich     Phase 2 — Place Details for each candidate, then FILTER false positives
               (name heuristics + permanently closed) and write content for the survivors.
               Free SKU: Place Details (1,000/mo) — the binding constraint on the whole
               pipeline: 1,000 candidates a month, no more.
    photos     Phase 3 — photo media for *kept* businesses only.
               Free SKU: Place Details Photos (1,000/mo), then $7 per 1,000. The other
               phase that can cost money after the free allowance, which is why it runs
               last and only for businesses that survived the filter.
    status     Report: candidates by state, usage ledger, projected cost of the next run.

All four SKUs are at 1,000/month, not 5,000, because a request bills at the highest tier
any of its fields belongs to and our masks ask for rating / userRatingCount /
regularOpeningHours / websiteUri / nationalPhoneNumber — all Enterprise fields. Narrowing
a mask to Pro fields raises that SKU's allowance to 5,000; do it in the same change as the
cap in ``scripts/places_budget.py``.

Order matters for cost: enriching everything and then photographing everything means up to
5 photo calls per candidate, including the ~60% that are false positives. Filter first.

Every phase stops cleanly *before* it can cross the free tier, keeps its progress in
``data/candidates.json`` and ``data/usage-ledger.json``, and exits:

    0  finished what you asked for
    1  unexpected error
    2  free-tier budget reached — progress saved, rerun on/after the 1st of next month
    3  Google blocked the call (per-SKU console quota) — see docs/places-api-free-tier-guardrails.md

Usage:
    python3 scripts/broaden.py discover
    python3 scripts/broaden.py enrich --limit 100
    python3 scripts/broaden.py photos --limit 100
    python3 scripts/broaden.py status
    python3 scripts/broaden.py enrich --dry-run      # what would this cost?
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

from place_filter import pick_category  # noqa: E402
from photo_paths import photo_paths  # noqa: E402
from places_budget import (  # noqa: E402
    FREE_MONTHLY_CAPS,
    SKU_LABELS,
    BudgetExhausted,
    PlacesBudget,
    QuotaBlocked,
    next_month,
    parse_caps,
)

# ─── Config ───────────────────────────────────────────────────────────────

PROJECT_DIR = Path(__file__).resolve().parent.parent
CONTENT_DIR = PROJECT_DIR / "src" / "content"
DATA_DIR = PROJECT_DIR / "data"
CANDIDATES_PATH = DATA_DIR / "candidates.json"
ENRICHED_DIR = DATA_DIR / "enriched"

CATEGORIES = ["nails", "massage"]
MAX_PHOTOS_PER_BUSINESS = 5

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_BUDGET = 2
EXIT_PLATFORM_QUOTA = 3

BARCELONA_BOUNDS = {
    "north": 41.47, "south": 41.32,
    "east": 2.23, "west": 2.10,
}

# Barcelona neighborhoods (districts + well-known barrios)
NEIGHBORHOODS = [
    # Ciutat Vella
    "El Raval", "Barri Gòtic", "La Barceloneta", "Sant Pere", "El Born",
    # Eixample
    "Dreta de l'Eixample", "Antiga Esquerra de l'Eixample", "Nova Esquerra de l'Eixample",
    "Sant Antoni", "Sagrada Família", "Fort Pienc",
    # Sants-Montjuïc
    "Sants", "Hostafrancs", "La Bordeta", "Poble-sec", "Montjuïc",
    # Les Corts
    "Les Corts", "Pedralbes", "La Maternitat",
    # Sarrià-Sant Gervasi
    "Sarrià", "Sant Gervasi", "Galvany", "Tres Torres", "El Putxet",
    # Gràcia
    "Vila de Gràcia", "Vallcarca", "El Coll", "La Salut",
    # Horta-Guinardó
    "Horta", "El Carmel", "La Teixonera", "El Guinardó", "Montbau",
    # Nou Barris
    "Nou Barris", "Vilapicina", "Torre Baró", "La Guineueta", "Porta",
    # Sant Andreu
    "Sant Andreu", "La Sagrera", "El Congrés", "Bon Pastor",
    # Sant Martí
    "Poblenou", "El Clot", "El Camp de l'Arpa", "La Verneda", "Sant Martí de Provençals",
    "Diagonal Mar", "Vila Olímpica",
]

# Extended keyword variants
SEARCH_VARIANTS = {
    "nails": [
        # Spanish variants
        "manicura {area} Barcelona",
        "uñas {area} Barcelona",
        "uñas de gel {area} Barcelona",
        "salón de uñas {area} Barcelona",
        "esmaltado {area} Barcelona",
        "centro de uñas {area} Barcelona",
        # English/Catalan variants
        "nail salon {area} Barcelona",
        "nail bar {area} Barcelona",
        "nail art {area} Barcelona",
    ],
    "massage": [
        # Spanish variants
        "masajes {area} Barcelona",
        "masajista {area} Barcelona",
        "centro de masajes {area} Barcelona",
        "masajes terapéuticos {area} Barcelona",
        "masajes relajantes {area} Barcelona",
        "spa {area} Barcelona",
        "masajes tailandés {area} Barcelona",
        "quiromasaje {area} Barcelona",
        "reflexología {area} Barcelona",
        # English variants
        "massage {area} Barcelona",
        "thai massage {area} Barcelona",
        "sports massage {area} Barcelona",
        "deep tissue massage {area} Barcelona",
    ],
}

# City-wide variants used by the keyword strategy (no area substitution).
BROAD_QUERIES = {
    "nails": [
        "manicura y pedicura Barcelona",
        "uñas acrilicas Barcelona",
        "uñas semipermanentes Barcelona",
        "nail studio Barcelona",
        "manicurista Barcelona",
        "uñas decoradas Barcelona",
        "nail design Barcelona",
        "uñas esculpidas Barcelona",
        "salon de manicura Barcelona",
    ],
    "massage": [
        "masajes descontracturantes Barcelona",
        "drenaje linfatico Barcelona",
        "masajes deportivos Barcelona",
        "masaje shiatsu Barcelona",
        "masaje sueco Barcelona",
        "centro de bienestar Barcelona",
        "osteopatia Barcelona",
        "fisioterapia masajes Barcelona",
        "masajes orientales Barcelona",
        "masaje con piedras calientes Barcelona",
    ],
}

GRID_STEP = 0.012  # ~1.1km N-S, ~0.9km E-W
VARIANT_QUERIES_PER_AREA = 3  # most promising variants per area/category, as before
RATE_LIMIT_TEXT = 0.5
RATE_LIMIT_NEARBY = 0.3
RATE_LIMIT_DETAILS = 0.3
RATE_LIMIT_PHOTO = 1.0

TEXT_SEARCH_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.rating,"
    "places.userRatingCount,places.googleMapsUri,places.nationalPhoneNumber,"
    "places.websiteUri,places.regularOpeningHours,places.types,places.location"
)
DETAILS_MASK = (
    "id,displayName,formattedAddress,rating,userRatingCount,regularOpeningHours,"
    "priceLevel,types,nationalPhoneNumber,websiteUri,googleMapsUri,location,photos,"
    "businessStatus"
)

# ─── Small helpers ────────────────────────────────────────────────────────


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_api_key() -> str:
    env_path = PROJECT_DIR / ".env"
    with open(env_path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            key, sep, val = line.partition("=")
            if key == "GOOGLE_PLACES_API_KEY" and sep:
                return val
    raise RuntimeError("GOOGLE_PLACES_API_KEY not found in .env")


def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    return slug[:80]


def read_place_id(md_path: Path) -> Optional[str]:
    try:
        text = md_path.read_text()
    except OSError:
        return None
    for line in text.split("\n"):
        if line.startswith("googlePlaceId:"):
            return line.split('"')[1] if '"' in line else line.split(":", 1)[1].strip()
    return None


def infer_neighborhood(address: str) -> str:
    address_lower = (address or "").lower()
    mapping = {
        "gracia": "Gràcia", "gràcia": "Gràcia",
        "eixample": "Eixample",
        "born": "Ciutat Vella", "gotic": "Ciutat Vella", "gòtic": "Ciutat Vella",
        "barceloneta": "Ciutat Vella", "raval": "Ciutat Vella",
        "sant marti": "Sant Martí", "sant martí": "Sant Martí",
        "poblenou": "Sant Martí", "sants": "Sants-Montjuïc",
        "les corts": "Les Corts", "sarria": "Sarrià-Sant Gervasi", "sarrià": "Sarrià-Sant Gervasi",
        "sant gervasi": "Sarrià-Sant Gervasi",
        "horta": "Horta-Guinardó", "guinardo": "Horta-Guinardó", "guinardó": "Horta-Guinardó",
        "nou barris": "Nou Barris", "sant andreu": "Sant Andreu",
        "sagrada familia": "Eixample", "sagrada família": "Eixample",
        "sagrera": "Sant Andreu", "clot": "Sant Martí",
        "pedralbes": "Les Corts", "vallcarca": "Gràcia",
        "poble-sec": "Sants-Montjuïc", "poble sec": "Sants-Montjuïc",
        "hostafrancs": "Sants-Montjuïc", "carmel": "Horta-Guinardó",
        "vilapicina": "Nou Barris", "guineueta": "Nou Barris",
        "porta": "Nou Barris", "bon pastor": "Sant Andreu",
        "verneda": "Sant Martí", "vila olímpica": "Sant Martí",
        "diagonal mar": "Sant Martí", "sant antoni": "Eixample",
        "fort pienc": "Eixample", "maternitat": "Les Corts",
        "tres torres": "Sarrià-Sant Gervasi", "putxet": "Sarrià-Sant Gervasi",
        "galvany": "Sarrià-Sant Gervasi", "teixonera": "Horta-Guinardó",
        "montbau": "Horta-Guinardó", "torre baró": "Nou Barris",
        "congrés": "Sant Andreu", "camp de l'arpa": "Sant Martí",
        "provençals": "Sant Martí",
    }
    for keyword, neighborhood in mapping.items():
        if keyword in address_lower:
            return neighborhood
    return "Barcelona"


def parse_hours(opening: dict) -> dict:
    hours = {}
    periods = (opening or {}).get("periods", [])
    if not periods:
        return hours
    day_names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    for period in periods:
        open_data = period.get("open", {})
        close_data = period.get("close", {})
        day_num = open_data.get("day", -1)
        if 0 <= day_num <= 6:
            open_h = str(open_data.get("hour", 0)).zfill(2)
            open_m = str(open_data.get("minute", 0)).zfill(2)
            close_h = str(close_data.get("hour", 0)).zfill(2)
            close_m = str(close_data.get("minute", 0)).zfill(2)
            hours[day_names[day_num]] = f"{open_h}:{open_m}-{close_h}:{close_m}"
    return hours


def compute_price(place: dict, category: str) -> str:
    price_level = place.get("priceLevel", "")
    if price_level in ("PRICE_LEVEL_FREE", "PRICE_LEVEL_INEXPENSIVE"):
        return "€"
    if price_level == "PRICE_LEVEL_MODERATE":
        return "€€"
    if price_level in ("PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"):
        return "€€€"
    return "€€" if category == "nails" else "€€€"


def yaml_safe(s: str) -> str:
    return (s or "").replace('"', "'").replace("\n", " ").strip()


def place_to_markdown(place: dict, category: str) -> str:
    name = yaml_safe(place.get("displayName", {}).get("text", "Unknown"))
    address = yaml_safe(place.get("formattedAddress", "Barcelona"))
    neighborhood = infer_neighborhood(address)
    rating = place.get("rating")
    review_count = place.get("userRatingCount")
    phone = yaml_safe(place.get("nationalPhoneNumber", ""))
    website = yaml_safe(place.get("websiteUri", ""))
    place_id = place.get("id", "")
    price = compute_price(place, category)
    hours = parse_hours(place.get("regularOpeningHours", {}))

    lines = ["---"]
    lines.append(f'name: "{name}"')
    lines.append(f'neighborhood: "{neighborhood}"')
    lines.append(f'address: "{address}"')
    if phone:
        lines.append(f'phone: "{phone}"')
    if website:
        lines.append(f'website: "{website}"')
    lines.append(f'priceIndicator: "{price}"')
    if hours:
        lines.append("hours:")
        for day, time_range in hours.items():
            lines.append(f'  {day}: "{time_range}"')
    lines.append("languages:")
    lines.append('  - "Español"')
    if rating is not None:
        lines.append(f"googleRating: {rating}")
    if review_count is not None:
        lines.append(f"googleReviewCount: {review_count}")
    if place_id:
        lines.append(f'googlePlaceId: "{place_id}"')
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def display_name(place: dict) -> str:
    return (place or {}).get("displayName", {}).get("text", "?")


def safe_call(fn, *args, **kwargs):
    """Run one API call; a transient HTTP error warns and returns None.

    BudgetExhausted / QuotaBlocked are raised before/around the request and must stop the
    run, so they are deliberately *not* caught here.
    """
    try:
        return fn(*args, **kwargs)
    except requests.RequestException as exc:
        # Transient network failures (timeout, DNS, connection reset) must not kill a run
        # that has already spent paid-for calls: warn, skip this call, keep going.
        # HTTPError is a RequestException too, so this covers both.
        print(f"  ⚠ {exc}")
        return None


# ─── Candidate store ──────────────────────────────────────────────────────


def empty_store() -> dict:
    return {"version": 1, "updated_at": None, "candidates": {}}


def load_store(path: Path = CANDIDATES_PATH) -> dict:
    path = Path(path)
    if not path.exists():
        return empty_store()
    try:
        data = json.loads(path.read_text())
    except ValueError as exc:
        raise RuntimeError(f"{path} is not valid JSON ({exc}); refusing to overwrite it.")
    if "candidates" not in data:
        raise RuntimeError(f"{path} has an unexpected shape; refusing to overwrite it.")
    return data


def save_store(store: dict, path: Path = CANDIDATES_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    store["updated_at"] = now_iso()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(store, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def load_existing_ids() -> Set[str]:
    """Place IDs that already have a content page (i.e. already collected)."""
    ids: Set[str] = set()
    for category in CATEGORIES:
        cat_dir = CONTENT_DIR / category
        if not cat_dir.exists():
            continue
        for path in cat_dir.glob("*.md"):
            place_id = read_place_id(path)
            if place_id:
                ids.add(place_id)
    return ids


def candidate_photo_paths(category: str, slug: str) -> List[Path]:
    """Photo files that belong to this business (exact slug match, not a prefix glob)."""
    return photo_paths(DATA_DIR / category, slug)


def status_counts(store: dict) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for candidate in store["candidates"].values():
        counts[candidate.get("status", "?")] = counts.get(candidate.get("status", "?"), 0) + 1
    return counts


# ─── API client (every call is counted by the budget guard) ───────────────


class PlacesClient:
    """Thin Places API (New) wrapper; spends from the budget before each request."""

    BASE = "https://places.googleapis.com/v1"

    def __init__(self, api_key: str, budget: PlacesBudget, verbose: bool = True):
        self.api_key = api_key
        self.budget = budget
        self.verbose = verbose
        self._spent: Dict[str, int] = {}

    # internal helpers -----------------------------------------------------
    def _spend(self, sku: str) -> None:
        # Count before the request: a crash mid-call must still show up in the ledger.
        self.budget.spend(sku)
        self._spent[sku] = self._spent.get(sku, 0) + 1

    def spent(self) -> Dict[str, int]:
        return dict(self._spent)

    @staticmethod
    def _raise_for_status(resp: requests.Response, sku: str, context: str) -> None:
        if resp.status_code == 200:
            return
        body = ""
        try:
            body = resp.text[:400]
        except Exception:  # pragma: no cover - defensive
            pass
        quota_markers = ("quota", "RESOURCE_EXHAUSTED", "billing", "PERMISSION_DENIED")
        if resp.status_code in (429, 403) and any(m.lower() in body.lower() for m in quota_markers):
            raise QuotaBlocked(
                f"Google blocked the {SKU_LABELS.get(sku, sku)} call ({context}): "
                f"HTTP {resp.status_code} {body}"
            )
        resp.raise_for_status()

    # public API -----------------------------------------------------------
    def text_search(self, query: str) -> dict:
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": TEXT_SEARCH_MASK,
        }
        body = {
            "textQuery": query,
            "locationBias": {
                "circle": {
                    "center": {"latitude": 41.3874, "longitude": 2.1686},
                    "radius": 5000,
                }
            },
            "pageSize": 20,
        }
        self._spend("text_search")
        resp = requests.post(f"{self.BASE}/places:searchText", headers=headers, json=body, timeout=30)
        self._raise_for_status(resp, "text_search", query)
        return resp.json()

    def nearby_search(self, lat: float, lng: float, included_types: List[str]) -> dict:
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": TEXT_SEARCH_MASK,
        }
        body = {
            "includedTypes": included_types,
            "maxResultCount": 20,
            "locationRestriction": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": 1000,
                }
            },
        }
        self._spend("nearby_search")
        resp = requests.post(f"{self.BASE}/places:searchNearby", headers=headers, json=body, timeout=30)
        self._raise_for_status(resp, "nearby_search", f"grid({lat:.3f},{lng:.3f})")
        return resp.json()

    def details(self, place_id: str) -> dict:
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": DETAILS_MASK,
        }
        self._spend("details")
        resp = requests.get(f"{self.BASE}/places/{place_id}", headers=headers, timeout=30)
        self._raise_for_status(resp, "details", place_id)
        return resp.json()

    def photo_bytes(self, photo_ref: str, attempts: int = 3) -> Optional[bytes]:
        """Download one photo; each attempt is a billable Place Photos call."""
        url = f"{self.BASE}/{photo_ref}/media"
        headers = {"X-Goog-Api-Key": self.api_key}
        for attempt in range(attempts):
            self._spend("photo")
            try:
                resp = requests.get(
                    url, headers=headers, params={"maxWidthPx": 800}, timeout=30, allow_redirects=True
                )
            except requests.RequestException as exc:
                # Give up on this photo rather than retrying: photo calls are the scarce
                # free SKU, the business stays "kept" and the next run tops it up for free.
                print(f"    ⚠ photo download failed ({exc.__class__.__name__}: {exc}); "
                      f"skipping this photo, the next run retries it")
                return None
            if resp.status_code == 200 and len(resp.content) > 1000:
                return resp.content
            if resp.status_code == 429:
                time.sleep(2 ** attempt)
                continue
            self._raise_for_status(resp, "photo", photo_ref)
            break
        return None


# ─── Phase 1: discovery ───────────────────────────────────────────────────


class Discovery:
    """Collects candidate places without enriching them."""

    def __init__(self, existing_ids: Set[str], known_ids: Set[str]):
        self.existing_ids = existing_ids
        self.known_ids = known_ids
        self.candidates: Dict[str, dict] = {}
        self.seen: Set[str] = set()

    def consider(self, place: dict, category: str, source: dict) -> bool:
        """Record a search hit. Returns True when it is new to this run."""
        place_id = place.get("id")
        if not place_id or place_id in self.existing_ids or place_id in self.known_ids:
            return False
        if place_id in self.seen:
            record = self.candidates.get(place_id)
            if record is not None and category not in record["categories"]:
                record["categories"].append(category)
            if record is not None and source not in record["sources"]:
                record["sources"].append(source)
            return False
        self.seen.add(place_id)
        self.candidates[place_id] = {
            "placeId": place_id,
            "name": display_name(place),
            "categories": [category],
            "address": place.get("formattedAddress", ""),
            "rating": place.get("rating"),
            "reviewCount": place.get("userRatingCount"),
            "types": place.get("types", []),
            "location": place.get("location", {}),
            "sources": [source],
            "status": "new",
            "discoveredAt": now_iso(),
        }
        return True


def strategy_neighborhood_grid(client: PlacesClient, disc: Discovery, save) -> int:
    print("\n📍 PHASE 1a: neighborhood grid (Text Search)")
    print("=" * 60)
    for area in NEIGHBORHOODS:
        for category in CATEGORIES:
            for variant in SEARCH_VARIANTS[category][:VARIANT_QUERIES_PER_AREA]:
                query = variant.replace("{area}", area)
                result = safe_call(client.text_search, query)
                time.sleep(RATE_LIMIT_TEXT)
                if result is None:
                    continue
                found = 0
                for place in result.get("places", []):
                    if disc.consider(place, category, {"strategy": "neighborhood_grid", "query": query}):
                        found += 1
                        print(f"  NEW [{category}] {display_name(place)} ({area})")
                if found:
                    save()
    return len(disc.candidates)


def strategy_keyword_variants(client: PlacesClient, disc: Discovery, save) -> int:
    print("\n🔤 PHASE 1b: city-wide keyword variants (Text Search)")
    print("=" * 60)
    before = len(disc.candidates)
    for category in CATEGORIES:
        for query in BROAD_QUERIES[category]:
            result = safe_call(client.text_search, query)
            time.sleep(RATE_LIMIT_TEXT)
            if result is None:
                continue
            found = 0
            for place in result.get("places", []):
                if disc.consider(place, category, {"strategy": "keyword_variants", "query": query}):
                    found += 1
                    print(f"  NEW [{category}] {display_name(place)}")
            if found:
                save()
    return len(disc.candidates) - before


def strategy_grid_search(client: PlacesClient, disc: Discovery, save) -> int:
    print("\n🗺️  PHASE 1c: geographic grid (Nearby Search)")
    print("=" * 60)
    before = len(disc.candidates)
    lat = BARCELONA_BOUNDS["south"]
    while lat <= BARCELONA_BOUNDS["north"]:
        lng = BARCELONA_BOUNDS["west"]
        while lng <= BARCELONA_BOUNDS["east"]:
            for category, type_list in (("nails", ["beauty_salon"]), ("massage", ["spa", "massage"])):
                result = safe_call(client.nearby_search, lat, lng, type_list)
                time.sleep(RATE_LIMIT_NEARBY)
                if result is None:
                    continue
                found = 0
                for place in result.get("places", []):
                    if disc.consider(place, category, {"strategy": "grid", "cell": f"{lat:.3f},{lng:.3f}"}):
                        found += 1
                        print(f"  NEW [{category}] {display_name(place)}")
                if found:
                    save()
            lng += GRID_STEP
        lat += GRID_STEP
    return len(disc.candidates) - before


def planned_discovery_calls() -> Dict[str, int]:
    """Calls a full discovery pass would spend (used by --dry-run and status)."""
    text = len(NEIGHBORHOODS) * len(CATEGORIES) * VARIANT_QUERIES_PER_AREA
    text += sum(len(queries) for queries in BROAD_QUERIES.values())
    lats = int((BARCELONA_BOUNDS["north"] - BARCELONA_BOUNDS["south"]) / GRID_STEP) + 1
    lngs = int((BARCELONA_BOUNDS["east"] - BARCELONA_BOUNDS["west"]) / GRID_STEP) + 1
    nearby = lats * lngs * len(CATEGORIES)
    return {"text_search": text, "nearby_search": nearby}


def cmd_discover(args, budget: PlacesBudget) -> int:
    if args.dry_run:
        planned = planned_discovery_calls()
        print("DRY RUN — discovery would spend:")
        for sku, calls in planned.items():
            fits = min(calls, budget.remaining(sku))
            print(f"  {SKU_LABELS[sku]:<22} {calls:>5} calls requested, {fits:>5} fit in this month's free tier")
        return EXIT_OK

    client = PlacesClient(load_api_key(), budget)
    existing_ids = load_existing_ids()
    store = load_store()
    print(f"🔍 {len(existing_ids)} places already in content; "
          f"{len(store['candidates'])} already in {CANDIDATES_PATH.name}")
    disc = Discovery(existing_ids, set(store["candidates"]))

    def save() -> None:
        store["candidates"].update(disc.candidates)
        save_store(store)

    before = budget.month_totals()
    strategy_neighborhood_grid(client, disc, save)
    strategy_keyword_variants(client, disc, save)
    strategy_grid_search(client, disc, save)
    save()

    deltas = {sku: budget.used(sku) - before.get(sku, 0) for sku in FREE_MONTHLY_CAPS}
    budget.record_run("discover", deltas, note=f"{len(disc.candidates)} new candidates")
    print(f"\n✅ Discovery done: {len(disc.candidates)} new candidates "
          f"({len(store['candidates'])} in {CANDIDATES_PATH})")
    _print_spend(deltas)
    return EXIT_OK


# ─── Phase 2: enrichment + filter ─────────────────────────────────────────


def enriched_path(category: str, place_id: str) -> Path:
    return ENRICHED_DIR / category / f"{place_id}.json"


def assign_slug(candidate: dict, category: str) -> str:
    """Pick the content slug, reusing the candidate's own file on a re-run."""
    name = candidate.get("name") or candidate["placeId"]
    cat_dir = CONTENT_DIR / category
    cat_dir.mkdir(parents=True, exist_ok=True)
    base = candidate.get("slug") or slugify(name)
    slug = base
    attempt = 1
    while True:
        path = cat_dir / f"{slug}.md"
        if not path.exists():
            return slug
        if read_place_id(path) == candidate["placeId"]:
            return slug  # already ours (idempotent re-run)
        attempt += 1
        suffix = candidate["placeId"][-6:]
        if attempt == 2:
            slug = f"{base}-{suffix}"
        else:
            slug = f"{base}-{suffix}-{attempt - 1}"
        if attempt > 10:  # pragma: no cover - defensive
            raise RuntimeError(f"could not find a free slug for {candidate['placeId']}")


def write_listing(candidate: dict, category: str, detail: dict) -> str:
    """Write the content page + raw JSON for a kept business. Returns the slug."""
    slug = assign_slug(candidate, category)
    cat_dir = CONTENT_DIR / category
    (cat_dir / f"{slug}.md").write_text(place_to_markdown(detail, category))
    json_dir = DATA_DIR / category
    json_dir.mkdir(parents=True, exist_ok=True)
    (json_dir / f"{slug}.json").write_text(json.dumps(detail, indent=2, ensure_ascii=False))
    return slug


def find_listing(candidate: dict) -> Optional[Path]:
    """The listing page a previous run wrote for this place, if there is one."""
    slug = candidate.get("slug")
    if not slug:
        return None
    for category in CATEGORIES:
        path = CONTENT_DIR / category / f"{slug}.md"
        if path.exists() and read_place_id(path) == candidate["placeId"]:
            return path
    return None


def remove_listing(candidate: dict) -> bool:
    """Delete the listing page a previous run wrote, because the verdict flipped.

    Only the file whose frontmatter carries *this* place id is touched, so a
    slug sibling is never collateral damage. Photos stay on disk on purpose: they
    were already paid for, R2 only ever sees content files, and the verdict can
    flip back on the next refilter.
    """
    path = find_listing(candidate)
    if path is None:
        return False
    path.unlink()
    raw = DATA_DIR / path.parent.name / f"{path.stem}.json"
    if raw.exists():
        raw.unlink()
    return True


def pending_candidates(store: dict, args) -> List[dict]:
    if getattr(args, "refilter", False):
        # Re-decide everything that already has a verdict. The Place Details are
        # stored under data/enriched/, so this costs no API calls at all.
        wanted = ("new", "enriched", "kept", "rejected", "photographed")
    else:
        wanted = ("new", "enriched")
    candidates = [c for c in store["candidates"].values() if c.get("status") in wanted]
    if getattr(args, "category", None):
        candidates = [c for c in candidates if args.category in c.get("categories", [])]
    candidates.sort(key=lambda c: (-(c.get("reviewCount") or 0), c.get("name") or ""))
    offset = getattr(args, "offset", 0) or 0
    limit = getattr(args, "limit", None)
    candidates = candidates[offset:]
    if limit:
        candidates = candidates[:limit]
    return candidates


def photo_targets(store: dict, args) -> List[dict]:
    candidates = [
        c for c in store["candidates"].values()
        if c.get("status") == "kept"
        and len(candidate_photo_paths(c.get("category", ""), c.get("slug", ""))) < MAX_PHOTOS_PER_BUSINESS
    ]
    if getattr(args, "category", None):
        candidates = [c for c in candidates if c.get("category") == args.category]
    candidates.sort(key=lambda c: -(c.get("reviewCount") or 0))
    offset = getattr(args, "offset", 0) or 0
    limit = getattr(args, "limit", None)
    candidates = candidates[offset:]
    if limit:
        candidates = candidates[:limit]
    return candidates


def cmd_enrich(args, budget: PlacesBudget) -> int:
    store = load_store()
    pending = pending_candidates(store, args)

    if args.dry_run:
        return _dry_run_enrich(store, pending, budget, args)

    if not pending:
        print("Nothing to enrich — every candidate is already decided. "
              "Run `broaden.py status` for the breakdown.")
        return EXIT_OK

    client = PlacesClient(load_api_key(), budget)
    before = budget.month_totals()
    to_fetch = [c for c in pending if c.get("status") == "new"]
    mode = "re-filtering" if getattr(args, "refilter", False) else "enriching"
    print(f"📊 PHASE 2: {mode} {len(pending)} candidates "
          f"({len(to_fetch)} need a Place Details call, {len(pending) - len(to_fetch)} only re-filtering)")

    kept = rejected = failed = removed = unchanged = 0
    for index, candidate in enumerate(pending, 1):
        category = candidate.get("category") or candidate["categories"][0]
        stored = enriched_path(category, candidate["placeId"])

        if candidate.get("status") == "enriched" and stored.exists():
            detail = json.loads(stored.read_text())
        elif stored.exists():
            detail = json.loads(stored.read_text())
            candidate["detailsAt"] = candidate.get("detailsAt") or now_iso()
        else:
            detail = safe_call(client.details, candidate["placeId"])
            time.sleep(RATE_LIMIT_DETAILS)
            if detail is None:
                # Leave it as "new" so the next run retries instead of losing the candidate.
                failed += 1
                save_store(store)
                continue
            # Store the details under every category the candidate matched, so a re-filter
            # can pick the right one without a second paid call.
            for cat in candidate["categories"]:
                path = enriched_path(cat, candidate["placeId"])
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(detail, indent=2, ensure_ascii=False))
            candidate["detailsAt"] = now_iso()

        if display_name(detail) != "?":
            candidate["name"] = display_name(detail)
        business_status = detail.get("businessStatus", "")
        chosen, reason = pick_category(
            candidate["name"], candidate["categories"], business_status
        )
        if chosen:
            existing = find_listing(candidate) if getattr(args, "refilter", False) else None
            if existing is not None and existing.parent.name == chosen:
                # Verdict unchanged: leave the page byte-for-byte alone. Other tools add
                # to these files (reviews, owner edits, services) and a rewrite would
                # silently throw that away.
                slug = candidate["slug"]
                unchanged += 1
            else:
                if existing is not None:
                    remove_listing(candidate)  # the category changed: move the page
                slug = write_listing(candidate, chosen, detail)
            # Keep the "already photographed" marker when a refilter re-confirms a
            # business that a previous photo run already handled.
            status = "photographed" if candidate.get("status") == "photographed" else "kept"
            candidate.update({"status": status, "category": chosen, "slug": slug,
                              "reason": reason, "decidedAt": now_iso()})
            kept += 1
            print(f"  [{index}/{len(pending)}] ✓ KEEP [{chosen}] {candidate['name']} -> {slug}.md")
        else:
            if remove_listing(candidate):
                removed += 1
                print(f"  [{index}/{len(pending)}] ⌫ removed the listing for {candidate['name']} "
                      f"({reason})")
            candidate.update({"status": "rejected", "reason": reason, "decidedAt": now_iso()})
            rejected += 1
            print(f"  [{index}/{len(pending)}] ✗ drop {candidate['name']} ({reason}) "
                  f"{business_status.lower() if business_status else ''}".rstrip())
        save_store(store)  # crash-safe: never lose a paid-for enrichment

    deltas = {sku: budget.used(sku) - before.get(sku, 0) for sku in FREE_MONTHLY_CAPS}
    note = f"{kept} kept, {rejected} rejected, {failed} failed"
    if removed:
        note += f", {removed} listing(s) removed by the new verdict"
    if unchanged:
        note += f", {unchanged} listing(s) left untouched"
    budget.record_run("enrich", deltas, note=note)
    tail = f", {failed} failed (retry next run)" if failed else ""
    gone = f", {removed} existing listing(s) removed" if removed else ""
    same = f", {unchanged} left untouched" if unchanged else ""
    print(f"\n✅ Enrichment done: {kept} kept, {rejected} rejected{gone}{same}{tail}")
    _print_spend(deltas)
    print(f"   Photo phase would now spend up to {kept * MAX_PHOTOS_PER_BUSINESS} photo calls for these "
          f"{kept} businesses (vs {len(pending) * MAX_PHOTOS_PER_BUSINESS} if photos ran before the filter).")
    return EXIT_OK


def _dry_run_enrich(store: dict, pending: List[dict], budget: PlacesBudget, args) -> int:
    to_fetch = [c for c in pending if c.get("status") == "new"]
    # Name-only preview of the filter for candidates we have no details for yet.
    preview_keep = 0
    for candidate in pending:
        stored = enriched_path(candidate.get("category") or candidate["categories"][0], candidate["placeId"])
        business_status = ""
        if stored.exists():
            business_status = json.loads(stored.read_text()).get("businessStatus", "")
        chosen, _ = pick_category(candidate.get("name", ""), candidate["categories"], business_status)
        preview_keep += 1 if chosen else 0
    planned = {"details": min(len(to_fetch), budget.remaining("details"))}
    print(f"DRY RUN — {len(pending)} candidates pending "
          f"({len(to_fetch)} need Place Details, rest only re-filter)")
    print(f"  Place Details calls planned : {len(to_fetch)} "
          f"(free tier has {budget.remaining('details'):,} left this month)")
    if len(to_fetch) > budget.remaining("details"):
        print(f"  ⚠ the free tier allows only {budget.remaining('details'):,} of them now — "
              f"the rest resume {next_month(budget.month)}")
    print(f"  estimated keeps (name filter) : {preview_keep}")
    print(f"  photo calls that would follow : up to {preview_keep * MAX_PHOTOS_PER_BUSINESS} "
          f"(free photos left: {budget.remaining('photo'):,})")
    print(f"  projected spend this run      : ${budget.paid_projection(planned):.2f}")
    return EXIT_OK


# ─── Phase 3: photos (kept businesses only) ───────────────────────────────


def cmd_photos(args, budget: PlacesBudget) -> int:
    store = load_store()
    targets = photo_targets(store, args)

    if args.dry_run:
        print(f"DRY RUN — {len(targets)} kept businesses still need photos; "
              f"up to {len(targets) * MAX_PHOTOS_PER_BUSINESS} photo calls "
              f"(free tier has {budget.remaining('photo'):,} left this month, then $7/1,000).")
        return EXIT_OK

    if not targets:
        print("Nothing to do — every kept business already has photos.")
        return EXIT_OK

    client = PlacesClient(load_api_key(), budget)
    before = budget.month_totals()
    print(f"🖼  PHASE 3: photos for {len(targets)} kept businesses "
          f"(free photo calls left this month: {budget.remaining('photo'):,})")

    done = empty_slugs = 0
    for index, candidate in enumerate(targets, 1):
        category = candidate["category"]
        slug = candidate["slug"]
        stored = enriched_path(category, candidate["placeId"])
        if not stored.exists():
            print(f"  [{index}/{len(targets)}] ⚠ no stored details for {slug}; skipping")
            continue
        detail = json.loads(stored.read_text())
        refs = [p.get("name") for p in detail.get("photos", []) if p.get("name")]
        if not refs:
            candidate.update({"status": "photographed", "photos": 0,
                              "reason": "no_photos_available", "photosAt": now_iso()})
            empty_slugs += 1
            print(f"  [{index}/{len(targets)}] · {slug}: Google has no photo for this place")
            save_store(store)
            continue

        photo_dir = DATA_DIR / category
        photo_dir.mkdir(parents=True, exist_ok=True)
        wanted = len(refs[:MAX_PHOTOS_PER_BUSINESS])
        written = 0
        try:
            for photo_index, ref in enumerate(refs[:MAX_PHOTOS_PER_BUSINESS]):
                target = photo_dir / f"{slug}-{photo_index}.jpg"
                if target.exists():
                    continue  # already fetched (a previous, budget-capped run)
                data = client.photo_bytes(ref)
                if data and data[:4] == b"\x89PNG":
                    data = _png_to_jpeg(data)
                if data:
                    target.write_bytes(data)
                    written += 1
                time.sleep(RATE_LIMIT_PHOTO)
        except BudgetExhausted:
            # Record what landed so far and stay "kept": the next month's run tops it up.
            candidate.update({"photos": len(candidate_photo_paths(category, slug)),
                              "photosAt": now_iso()})
            save_store(store)
            raise

        total = len(candidate_photo_paths(category, slug))
        candidate.update({"photos": total, "photosAt": now_iso()})
        if total >= wanted:
            candidate["status"] = "photographed"
            candidate.pop("reason", None)
            done += 1
        # Fewer photos than Google offers: stay "kept" so a later run retries the gaps.
        save_store(store)
        print(f"  [{index}/{len(targets)}] ✓ {slug}: {written} new photos ({total}/{wanted})")

    deltas = {sku: budget.used(sku) - before.get(sku, 0) for sku in FREE_MONTHLY_CAPS}
    budget.record_run("photos", deltas, note=f"{done} photographed, {empty_slugs} without photos")
    print(f"\n✅ Photo phase done: {done} photographed, {empty_slugs} had no photos available")
    _print_spend(deltas)
    print("   Next: python3 scripts/generate-photo-manifest.py, then upload to R2 "
          "(scripts/upload-photos-r2.py), then npm run build.")
    return EXIT_OK


def _png_to_jpeg(data: bytes) -> bytes:
    try:
        import io

        from PIL import Image

        image = Image.open(io.BytesIO(data)).convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=90)
        return buffer.getvalue()
    except ImportError:  # pragma: no cover - Pillow is installed in this repo
        return data


# ─── status ───────────────────────────────────────────────────────────────


def cmd_status(args, budget: PlacesBudget) -> int:
    store = load_store()
    counts = status_counts(store)
    print(f"candidates: {CANDIDATES_PATH}")
    print(f"  total          {len(store['candidates']):>6,}")
    for status in ("new", "enriched", "kept", "rejected", "photographed"):
        print(f"  {status:<14} {counts.get(status, 0):>6,}")
    other = {k: v for k, v in counts.items() if k not in
             ("new", "enriched", "kept", "rejected", "photographed")}
    for status, count in other.items():
        print(f"  {status:<14} {count:>6,}")

    kept = [c for c in store["candidates"].values() if c.get("status") == "kept"]
    print(f"\npending work")
    print(f"  details calls to fetch (status 'new')      : {counts.get('new', 0):,}")
    print(f"  photo calls needed for kept businesses     : up to {len(kept) * MAX_PHOTOS_PER_BUSINESS:,} "
          f"(free photo calls left: {budget.remaining('photo'):,})")
    planned_call = planned_discovery_calls()
    print(f"  a full re-discovery would spend             : "
          f"{planned_call['text_search']:,} text + {planned_call['nearby_search']:,} nearby (free SKUs)")
    print("\n" + "\n".join(budget.summary_lines()))
    return EXIT_OK


def _print_spend(deltas: Dict[str, int]) -> None:
    spent = ", ".join(f"{SKU_LABELS[sku]}: {n}" for sku, n in deltas.items() if n) or "no calls"
    print(f"   calls this run: {spent}")


# ─── CLI ──────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Barcelona Compare data pipeline (discovery → enrichment → photos).",
        epilog="Every phase stops before it can exceed the free monthly Google Places tier.",
    )
    parser.add_argument("--caps", default=None,
                        help="lower a free-tier cap for this run only, e.g. 'details=20,photo=5' "
                             "(cannot raise a cap above the free allowance)")
    parser.add_argument("--headroom", type=int, default=0,
                        help="stop N calls short of the free allowance (default 0)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover = subparsers.add_parser("discover", help="Phase 1: search and save candidates")
    discover.add_argument("--dry-run", action="store_true", help="show the cost, spend nothing")

    enrich = subparsers.add_parser("enrich", help="Phase 2: Place Details + filter + write listings")
    enrich.add_argument("--limit", "--batch", dest="limit", type=int, default=None,
                        help="process at most N candidates (alias: --batch)")
    enrich.add_argument("--offset", type=int, default=0, help="skip the first N pending candidates")
    enrich.add_argument("--category", choices=CATEGORIES, default=None)
    enrich.add_argument("--refilter", action="store_true",
                        help="re-decide candidates that already have a verdict, using the stored "
                             "Place Details (free: no API calls). Listings that no longer pass "
                             "the filter are removed.")
    enrich.add_argument("--dry-run", action="store_true", help="show the cost, spend nothing")

    photos = subparsers.add_parser("photos", help="Phase 3: photos for kept businesses only")
    photos.add_argument("--limit", "--batch", dest="limit", type=int, default=None,
                        help="process at most N businesses (alias: --batch)")
    photos.add_argument("--offset", type=int, default=0)
    photos.add_argument("--category", choices=CATEGORIES, default=None)
    photos.add_argument("--dry-run", action="store_true", help="show the cost, spend nothing")

    subparsers.add_parser("status", help="report candidates + this month's API usage")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    budget = PlacesBudget(caps=parse_caps(args.caps), headroom=args.headroom)
    handlers = {
        "discover": cmd_discover,
        "enrich": cmd_enrich,
        "photos": cmd_photos,
        "status": cmd_status,
    }
    try:
        return handlers[args.command](args, budget)
    except BudgetExhausted as exc:
        print(f"\n⛔ {exc}")
        print("   Progress is saved in data/candidates.json — rerun the same command "
              f"on/after {exc.resume_month}.")
        return EXIT_BUDGET
    except QuotaBlocked as exc:
        print(f"\n⛔ {exc}")
        print("   Google blocked the call at the project level. Raise the per-SKU quota in the "
              "Google Cloud console (docs/places-api-free-tier-guardrails.md) or wait for the "
              "quota window to reset. Progress is saved.")
        return EXIT_PLATFORM_QUOTA
    except requests.HTTPError as exc:
        print(f"\n☠ API error: {exc}")
        return EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
