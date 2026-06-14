#!/usr/bin/env python3
"""Broaden data collection for Barcelona Compare — three-pronged approach.

1. Neighborhood grid: barrio-level text searches
2. Keyword variants: additional search term diversity
3. Geographic grid: Nearby Search on a lat/lng tile grid

Deduplicates against existing content and collects new businesses with
full enrichment + photos.

Usage:
    python scripts/broaden.py
"""

from typing import Optional

import json
import os
import re
import sys
import time
from pathlib import Path

import requests

# ─── Config ───────────────────────────────────────────────────────────────

API_KEY = None
BARCELONA_BOUNDS = {
    "north": 41.47, "south": 41.32,
    "east": 2.23, "west": 2.10,
}
CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"
DATA_DIR = Path(__file__).parent.parent / "data"

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

# Grid tile size in degrees (~1km at this latitude)
GRID_STEP = 0.012  # ~1.1km N-S, ~0.9km E-W

# ─── API Helpers ──────────────────────────────────────────────────────────

def load_api_key():
    global API_KEY
    env_path = Path(__file__).parent.parent / ".env"
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            key, sep, val = line.partition("=")
            if key == "GOOGLE_PLACES_API_KEY" and sep:
                API_KEY = val
                return
    raise RuntimeError("GOOGLE_PLACES_API_KEY not found in .env")


def places_text_search(query: str) -> dict:
    """Call Google Places API Text Search (new)."""
    url = "https://places.googleapis.com/v1/places:searchText"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours,places.types,places.location",
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
    resp = requests.post(url, headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    return resp.json()


def places_nearby_search(lat: float, lng: float, included_types: list[str]) -> dict:
    """Call Google Places API Nearby Search (new)."""
    url = "https://places.googleapis.com/v1/places:searchNearby"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours,places.types,places.location",
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
    resp = requests.post(url, headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    return resp.json()


def places_details(place_id: str) -> dict:
    """Call Google Places API Place Details."""
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,rating,userRatingCount,regularOpeningHours,priceLevel,types,nationalPhoneNumber,websiteUri,googleMapsUri,location,photos",
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


def download_photo(photo_ref: str) -> Optional[bytes]:
    """Download photo, following redirects."""
    url = f"https://places.googleapis.com/v1/{photo_ref}/media"
    params = {"maxWidthPx": 800}
    headers = {"X-Goog-Api-Key": API_KEY}
    resp = requests.get(url, headers=headers, params=params, timeout=30, allow_redirects=True)
    if resp.status_code == 200 and len(resp.content) > 1000:
        return resp.content
    return None

# ─── Data Helpers ─────────────────────────────────────────────────────────

def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    return slug[:80]


def infer_neighborhood(address: str) -> str:
    address_lower = address.lower()
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
    """Parse opening hours from Place Details response."""
    hours = {}
    periods = opening.get("periods", [])
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
    """Compute price indicator from API + defaults."""
    price_level = place.get("priceLevel", "")
    if price_level in ("PRICE_LEVEL_FREE", "PRICE_LEVEL_INEXPENSIVE"):
        return "€"
    elif price_level == "PRICE_LEVEL_MODERATE":
        return "€€"
    elif price_level in ("PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"):
        return "€€€"
    # Default per category
    return "€€" if category == "nails" else "€€€"


def place_to_markdown(place: dict, category: str) -> str:
    """Convert enriched Place Details to Astro content markdown."""
    name = place.get("displayName", {}).get("text", "Unknown")
    address = place.get("formattedAddress", "Barcelona")
    neighborhood = infer_neighborhood(address)
    rating = place.get("rating")
    review_count = place.get("userRatingCount")
    phone = place.get("nationalPhoneNumber", "")
    website = place.get("websiteUri", "")
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

# ─── Collection Strategies ────────────────────────────────────────────────

def load_existing_ids() -> set[str]:
    """Load all existing place IDs from content files."""
    ids = set()
    for cat in ["nails", "massage"]:
        cat_dir = CONTENT_DIR / cat
        if not cat_dir.exists():
            continue
        for f in cat_dir.glob("*.md"):
            for line in f.read_text().split("\n"):
                if line.startswith("googlePlaceId:"):
                    ids.add(line.split('"')[1])
                    break
    return ids


def strategy_neighborhood_grid(existing_ids: set[str]):
    """Strategy 1: Search by neighborhood name."""
    print("\n📍 STRATEGY 1: Neighborhood Grid Search")
    print("=" * 60)

    new_places = {}  # place_id -> (place, category)

    for area in NEIGHBORHOODS:
        for cat in ["nails", "massage"]:
            variants = SEARCH_VARIANTS[cat]
            # Take 3 most promising variants per area to control query volume
            for variant in variants[:3]:
                query = variant.replace("{area}", area)
                try:
                    result = places_text_search(query)
                except requests.HTTPError as e:
                    print(f"  ⚠ {query}: {e}")
                    continue

                places = result.get("places", [])
                for place in places:
                    pid = place.get("id")
                    if pid and pid not in existing_ids and pid not in new_places:
                        new_places[pid] = (place, cat)
                        print(f"  NEW [{cat}] {place.get('displayName', {}).get('text', '?')} ({area})")

                time.sleep(0.5)  # Rate limit

    print(f"  Found {len(new_places)} new candidates from neighborhood grid")
    return new_places


def strategy_keyword_variants(existing_ids: set[str], already_new: set[str]):
    """Strategy 2: Additional keyword variants without neighborhood."""
    print("\n🔤 STRATEGY 2: Keyword Variant Seeding")
    print("=" * 60)

    new_places = {}

    # Broad city-level variants not in the main collect script
    broad_queries = {
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

    for cat in ["nails", "massage"]:
        for query in broad_queries[cat]:
            try:
                result = places_text_search(query)
            except requests.HTTPError as e:
                print(f"  ⚠ {query}: {e}")
                continue

            places = result.get("places", [])
            for place in places:
                pid = place.get("id")
                if pid and pid not in existing_ids and pid not in already_new and pid not in new_places:
                    new_places[pid] = (place, cat)
                    print(f"  NEW [{cat}] {place.get('displayName', {}).get('text', '?')}")

            time.sleep(0.5)

    print(f"  Found {len(new_places)} new candidates from keyword variants")
    return new_places


def strategy_grid_search(existing_ids: set[str], already_new: set[str]):
    """Strategy 3: Geographic grid with Nearby Search."""
    print("\n🗺️  STRATEGY 3: Geographic Grid Search")
    print("=" * 60)

    new_places = {}

    # Generate grid points
    lat = BARCELONA_BOUNDS["south"]
    while lat <= BARCELONA_BOUNDS["north"]:
        lng = BARCELONA_BOUNDS["west"]
        while lng <= BARCELONA_BOUNDS["east"]:
            for cat, type_list in [("nails", ["beauty_salon"]), ("massage", ["spa", "massage"])]:
                try:
                    result = places_nearby_search(lat, lng, type_list)
                except requests.HTTPError as e:
                    print(f"  ⚠ grid({lat:.3f},{lng:.3f}) [{cat}]: {e}")
                    lng += GRID_STEP
                    continue

                places = result.get("places", [])
                for place in places:
                    pid = place.get("id")
                    if pid and pid not in existing_ids and pid not in already_new and pid not in new_places:
                        # Verify it's actually the right category
                        ptypes = place.get("types", [])
                        if cat == "nails" and "beauty_salon" in ptypes:
                            new_places[pid] = (place, cat)
                        elif cat == "massage" and ("spa" in ptypes or "massage" in ptypes):
                            new_places[pid] = (place, cat)
                        # Also accept anything with relevant name
                        name = place.get("displayName", {}).get("text", "").lower()
                        if cat == "nails" and any(k in name for k in ["nail", "uñas", "manicur", "uña"]):
                            if pid not in new_places:
                                new_places[pid] = (place, cat)
                        elif cat == "massage" and any(k in name for k in ["massag", "masaj", "spa", "masat"]):
                            if pid not in new_places:
                                new_places[pid] = (place, cat)

                time.sleep(0.3)

            lng += GRID_STEP
        lat += GRID_STEP

    # Print summary with business names
    for pid, (place, cat) in new_places.items():
        name = place.get("displayName", {}).get("text", "?")
        print(f"  NEW [{cat}] {name}")

    print(f"  Found {len(new_places)} new candidates from grid search")
    return new_places


def enrich_and_collect(new_places: dict):
    """Enrich new places with Place Details and download photos."""
    print(f"\n📊 ENRICHMENT: {len(new_places)} new businesses to collect")
    print("=" * 60)

    for i, (pid, (place, cat)) in enumerate(new_places.items()):
        name = place.get("displayName", {}).get("text", "Unknown")
        print(f"\n  [{i+1}/{len(new_places)}] {name} ({cat})")

        # Get full details
        try:
            detail = places_details(pid)
        except requests.HTTPError as e:
            print(f"    ⚠ Details failed: {e}")
            detail = place
        time.sleep(0.3)

        # Download photos
        photos = detail.get("photos", [])
        slug = slugify(name)
        photo_dir = DATA_DIR / cat
        photo_dir.mkdir(parents=True, exist_ok=True)
        photos_downloaded = 0
        for j, photo in enumerate(photos[:5]):
            photo_ref = photo.get("name", "")
            if not photo_ref:
                continue
            try:
                img_data = download_photo(photo_ref)
                if img_data:
                    # Detect PNG and convert to JPEG
                    if img_data[:4] == b'\x89PNG':
                        try:
                            import io
                            from PIL import Image
                            img = Image.open(io.BytesIO(img_data))
                            img = img.convert("RGB")
                            buf = io.BytesIO()
                            img.save(buf, format="JPEG", quality=90)
                            img_data = buf.getvalue()
                        except ImportError:
                            pass  # Keep as PNG if PIL not available
                    ext = "jpg"
                    photo_path = photo_dir / f"{slug}-{j}.{ext}"
                    photo_path.write_bytes(img_data)
                    photos_downloaded += 1
            except Exception as e:
                print(f"    ⚠ Photo {j} failed: {e}")
            time.sleep(0.2)

        print(f"    ✓ {photos_downloaded} photos downloaded")

        # Write markdown
        cat_dir = CONTENT_DIR / cat
        cat_dir.mkdir(parents=True, exist_ok=True)
        md_path = cat_dir / f"{slug}.md"
        if md_path.exists():
            md_path = cat_dir / f"{slug}-{pid[-6:]}.md"
        md_content = place_to_markdown(detail, cat)
        md_path.write_text(md_content)

        # Save raw API JSON
        json_dir = DATA_DIR / cat
        json_dir.mkdir(parents=True, exist_ok=True)
        json_path = json_dir / f"{slug}.json"
        json_path.write_text(json.dumps(detail, indent=2, ensure_ascii=False))

    print(f"\n  ✅ Enrichment complete. {len(new_places)} businesses collected.")


# ─── Main ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    load_api_key()

    print("🔍 Loading existing place IDs...")
    existing_ids = load_existing_ids()
    print(f"   {len(existing_ids)} existing businesses in content")
    print(f"   Nails: {len([f for f in (CONTENT_DIR/'nails').glob('*.md')])} files")
    print(f"   Massage: {len([f for f in (CONTENT_DIR/'massage').glob('*.md')])} files")

    all_new = {}

    # Run strategies
    n1 = strategy_neighborhood_grid(existing_ids)
    all_new.update(n1)
    print(f"\n   Cumulative new: {len(all_new)}")

    n2 = strategy_keyword_variants(existing_ids, set(all_new.keys()))
    all_new.update(n2)
    print(f"\n   Cumulative new: {len(all_new)}")

    n3 = strategy_grid_search(existing_ids, set(all_new.keys()))
    all_new.update(n3)
    print(f"\n   Cumulative new: {len(all_new)}")

    if not all_new:
        print("\n🎉 No new businesses found. Coverage looks complete!")
        sys.exit(0)

    print(f"\n📊 FINAL: {len(all_new)} new businesses to collect across all strategies")
    print(f"   Existing: {len(existing_ids)} | New: {len(all_new)} | Total after: {len(existing_ids) + len(all_new)}")

    enrich_and_collect(all_new)

    print(f"\n✅ Done! Run 'npm run build' to rebuild, then commit and push to deploy.")
