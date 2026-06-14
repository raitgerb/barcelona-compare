#!/usr/bin/env python3
"""Google Places API data collector for Barcelona Compare.

Collects nail salons and massage businesses in Barcelona and outputs
them as markdown files for the Astro content collections.

Usage:
    python scripts/collect.py --api-key YOUR_KEY --category nails
    python scripts/collect.py --api-key YOUR_KEY --category massage
    python scripts/collect.py --api-key YOUR_KEY --category all

Requirements: requests (pip install requests)
"""

from typing import Optional

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

import requests

# Barcelona center coordinates
BARCELONA_CENTER = (41.3874, 2.1686)
BARCELONA_RADIUS = 5000  # 5km radius covers the city

NEIGHBORHOODS = [
    "Ciutat Vella", "Eixample", "Gràcia", "Sants-Montjuïc",
    "Les Corts", "Sarrià-Sant Gervasi", "Horta-Guinardó",
    "Nou Barris", "Sant Andreu", "Sant Martí",
]

CATEGORY_CONFIG = {
    "nails": {
        "search_terms": [
            "nail salon Barcelona",
            "manicura Barcelona",
            "uñas de gel Barcelona",
            "nail bar Barcelona",
        ],
        "type_filter": "beauty_salon",
    },
    "massage": {
        "search_terms": [
            "massage Barcelona",
            "masajes Barcelona",
            "spa Barcelona",
            "massage center Barcelona",
            "thai massage Barcelona",
        ],
        "type_filter": "spa",
    },
}

CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"

# ─── Google Places API helpers ────────────────────────────────────────────


def places_text_search(api_key: str, query: str, page_token: Optional[str] = None) -> dict:
    """Call Google Places API Text Search (new)."""
    url = "https://places.googleapis.com/v1/places:searchText"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours,places.types,places.location",
    }

    body = {
        "textQuery": query,
        "locationBias": {
            "circle": {
                "center": {"latitude": BARCELONA_CENTER[0], "longitude": BARCELONA_CENTER[1]},
                "radius": BARCELONA_RADIUS,
            }
        },
    }

    if page_token:
        body["pageToken"] = page_token

    resp = requests.post(url, headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    return resp.json()


def places_photo(api_key: str, photo_reference: str, max_width: int = 800) -> Optional[bytes]:
    """Download a place photo."""
    url = f"https://places.googleapis.com/v1/{photo_reference}/media"
    params = {"maxWidthPx": max_width}
    headers = {"X-Goog-Api-Key": api_key}
    resp = requests.get(url, headers=headers, params=params, timeout=30, allow_redirects=True)
    if resp.status_code == 200:
        return resp.content
    return None


def places_details(api_key: str, place_id: str) -> dict:
    """Call Google Places API Place Details (new) for rich data."""
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,rating,userRatingCount,regularOpeningHours,priceLevel,types,nationalPhoneNumber,websiteUri,googleMapsUri,location",
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


# ─── Data processing ──────────────────────────────────────────────────────


def infer_neighborhood(address: str) -> str:
    """Try to infer neighborhood from address."""
    address_lower = address.lower()
    mapping = {
        "gracia": "Gràcia",
        "gràcia": "Gràcia",
        "eixample": "Eixample",
        "born": "Ciutat Vella",
        "gotic": "Ciutat Vella",
        "gòtic": "Ciutat Vella",
        "barceloneta": "Ciutat Vella",
        "raval": "Ciutat Vella",
        "sant marti": "Sant Martí",
        "sant martí": "Sant Martí",
        "poblenou": "Sant Martí",
        "sants": "Sants-Montjuïc",
        "les corts": "Les Corts",
        "sarria": "Sarrià-Sant Gervasi",
        "sarrià": "Sarrià-Sant Gervasi",
        "sant gervasi": "Sarrià-Sant Gervasi",
        "horta": "Horta-Guinardó",
        "guinardo": "Horta-Guinardó",
        "guinardó": "Horta-Guinardó",
        "nou barris": "Nou Barris",
        "sant andreu": "Sant Andreu",
    }
    for keyword, neighborhood in mapping.items():
        if keyword in address_lower:
            return neighborhood
    return "Barcelona"


def infer_price_indicator(name: str, types: list) -> Optional[str]:
    """Rudimentary price level inference. Most will be None — manual enrichment needed."""
    luxury_keywords = ["luxury", "premium", "spa", "boutique", "vip", "lujo", "exclusive"]
    name_lower = name.lower()
    if any(kw in name_lower for kw in luxury_keywords):
        return "€€€"
    return None


def slugify(name: str) -> str:
    """Create a URL-friendly slug from a business name."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    return slug[:80]


def place_to_markdown(place: dict, category: str) -> str:
    """Convert a Places API result to a markdown content file."""
    name = place.get("displayName", {}).get("text", "Unknown")
    address = place.get("formattedAddress", "Barcelona")
    neighborhood = infer_neighborhood(address)
    rating = place.get("rating")
    review_count = place.get("userRatingCount")
    phone = place.get("nationalPhoneNumber", "")
    website = place.get("websiteUri", "")
    place_id = place.get("id", "")
    price = infer_price_indicator(name, place.get("types", []))

    # Hours — Place Details uses day/hour/minute objects, not combined time strings
    hours = {}
    opening = place.get("regularOpeningHours", {})
    if opening.get("periods"):
        day_names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
        for period in opening["periods"]:
            open_data = period.get("open", {})
            close_data = period.get("close", {})
            day_num = open_data.get("day", -1)
            if 0 <= day_num <= 6:
                open_h = str(open_data.get("hour", 0)).zfill(2)
                open_m = str(open_data.get("minute", 0)).zfill(2)
                close_h = str(close_data.get("hour", 0)).zfill(2)
                close_m = str(close_data.get("minute", 0)).zfill(2)
                hours[day_names[day_num]] = f"{open_h}:{open_m}-{close_h}:{close_m}"

    # Price level from API
    price = None
    price_level = place.get("priceLevel", "")
    if price_level == "PRICE_LEVEL_FREE":
        price = "€"
    elif price_level == "PRICE_LEVEL_INEXPENSIVE":
        price = "€"
    elif price_level == "PRICE_LEVEL_MODERATE":
        price = "€€"
    elif price_level == "PRICE_LEVEL_EXPENSIVE":
        price = "€€€"
    elif price_level == "PRICE_LEVEL_VERY_EXPENSIVE":
        price = "€€€"
    if not price:
        price = infer_price_indicator(name, place.get("types", []))

    # Services (empty by default — manual enrichment)
    services = []

    # Massage types (empty — manual enrichment)
    massage_types = []

    # Languages (default Spanish — manual enrichment)
    languages = ["Español"]

    # Build frontmatter
    lines = ["---"]
    lines.append(f'name: "{name}"')
    lines.append(f'neighborhood: "{neighborhood}"')
    lines.append(f'address: "{address}"')
    if phone:
        lines.append(f'phone: "{phone}"')
    if website:
        lines.append(f'website: "{website}"')
    if price:
        lines.append(f'priceIndicator: "{price}"')
    if services:
        lines.append("services:")
        for s in services:
            lines.append(f'  - name: "{s["name"]}"')
            if s.get("price"):
                lines.append(f'    price: "{s["price"]}"')
    if hours:
        lines.append("hours:")
        for day, time_range in hours.items():
            lines.append(f'  {day}: "{time_range}"')
    lines.append("languages:")
    for lang in languages:
        lines.append(f'  - "{lang}"')
    if rating is not None:
        lines.append(f"googleRating: {rating}")
    if review_count is not None:
        lines.append(f"googleReviewCount: {review_count}")
    if place_id:
        lines.append(f'googlePlaceId: "{place_id}"')
    if massage_types:
        lines.append("massageTypes:")
        for mt in massage_types:
            lines.append(f'  - "{mt}"')
    lines.append("---")
    lines.append("")

    return "\n".join(lines)


# ─── Main collection logic ────────────────────────────────────────────────


def collect_category(api_key: str, category: str):
    """Collect all businesses for a category and save as markdown files."""
    config = CATEGORY_CONFIG[category]
    seen_ids: set[str] = set()
    all_places: list[dict] = []
    output_dir = CONTENT_DIR / category
    output_dir.mkdir(parents=True, exist_ok=True)

    for search_term in config["search_terms"]:
        print(f"  Searching: '{search_term}'...")
        page_token = None
        pages = 0

        while pages < 3:  # Max 3 pages per search term (60 results)
            try:
                result = places_text_search(api_key, search_term, page_token)
            except requests.HTTPError as e:
                print(f"    API error: {e}", file=sys.stderr)
                break

            places = result.get("places", [])
            for place in places:
                pid = place.get("id")
                if pid and pid not in seen_ids:
                    seen_ids.add(pid)
                    all_places.append(place)

            page_token = result.get("nextPageToken")
            if not page_token:
                break
            pages += 1
            time.sleep(2)  # Rate limit courtesy

    print(f"  Found {len(all_places)} unique places (filtered from multiple searches)")

    # Enrich each place with Place Details
    print(f"  Enriching with Place Details...")
    enriched = []
    for i, place in enumerate(all_places):
        pid = place.get("id")
        if not pid:
            continue
        try:
            detail = places_details(api_key, pid)
            enriched.append(detail)
        except requests.HTTPError:
            enriched.append(place)  # Fall back to search result
        if (i + 1) % 20 == 0:
            print(f"    {i + 1}/{len(all_places)} enriched...")
        time.sleep(0.3)  # Rate limit for Place Details calls

    print(f"  Successfully enriched {len(enriched)} places")

    # Write markdown files
    written = 0
    for place in enriched:
        name = place.get("displayName", {}).get("text", "Unknown")
        slug = slugify(name)
        # De-duplicate slugs
        if (output_dir / f"{slug}.md").exists():
            slug = f"{slug}-{place.get('id', '')[-6:]}"

        md_content = place_to_markdown(place, category)
        (output_dir / f"{slug}.md").write_text(md_content)
        written += 1

    print(f"  Wrote {written} markdown files to {output_dir}")
    return written


def main():
    parser = argparse.ArgumentParser(description="Collect Barcelona business data from Google Places API")
    parser.add_argument("--api-key", required=True, help="Google Places API key")
    parser.add_argument("--category", choices=["nails", "massage", "all"], default="all",
                        help="Category to collect (default: all)")
    args = parser.parse_args()

    categories = ["nails", "massage"] if args.category == "all" else [args.category]

    total = 0
    for cat in categories:
        print(f"\n📊 Collecting: {cat}")
        count = collect_category(args.api_key, cat)
        total += count

    print(f"\n✅ Done. {total} businesses collected across {len(categories)} categories.")
    print(f"   Run 'npm run build' to rebuild the site with the new data.")


if __name__ == "__main__":
    main()
