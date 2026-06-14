#!/usr/bin/env python3
"""Re-download photos for businesses that have zero photos.

The original broaden.py run likely hit photo API rate limits during the
1,232-business batch, silently skipping downloads. This script:
- Finds all content files with zero corresponding photos
- Downloads up to 5 photos per business with aggressive rate limiting
- Retries on failure

Usage:
    python scripts/fix-missing-photos.py
"""

import json
import sys
import time
from pathlib import Path
from typing import Optional

import requests

CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"
DATA_DIR = Path(__file__).parent.parent / "data"

# Longer sleep between photos to avoid rate limits
PHOTO_DELAY = 1.0  # seconds between photo downloads
BUSINESS_DELAY = 2.0  # seconds between businesses


def load_api_key():
    env_path = Path(__file__).parent.parent / ".env"
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            key, sep, val = line.partition("=")
            if key == "GOOGLE_PLACES_API_KEY" and sep:
                return val
    raise RuntimeError("API key not found")


def get_place_photos(api_key: str, place_id: str) -> list[str]:
    """Get photo references for a place."""
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "photos",
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return [p.get("name", "") for p in data.get("photos", []) if p.get("name")]


def download_photo(api_key: str, photo_ref: str, max_retries: int = 3) -> Optional[bytes]:
    """Download photo with retries."""
    url = f"https://places.googleapis.com/v1/{photo_ref}/media"
    params = {"maxWidthPx": 800}
    headers = {"X-Goog-Api-Key": api_key}

    for attempt in range(max_retries):
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=30, allow_redirects=True)
            if resp.status_code == 200 and len(resp.content) > 1000:
                return resp.content
            elif resp.status_code == 429:
                wait = 2 ** attempt
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2)
                continue
    return None


def main():
    api_key = load_api_key()
    fixed = 0
    failed = 0

    for cat in ["nails", "massage"]:
        content_dir = CONTENT_DIR / cat
        data_dir = DATA_DIR / cat
        data_dir.mkdir(parents=True, exist_ok=True)

        for md_file in sorted(content_dir.glob("*.md")):
            base = md_file.stem
            existing_photos = list(data_dir.glob(f"{base}-*"))
            if existing_photos:
                continue  # Already has photos

            # Extract place ID
            content = md_file.read_text()
            place_id = ""
            name = ""
            for line in content.split("\n"):
                if line.startswith("googlePlaceId:"):
                    place_id = line.split('"')[1]
                if line.startswith("name:"):
                    name = line.split('"', 2)[1] if '"' in line else ""

            if not place_id:
                continue

            # Get photo list
            try:
                photo_refs = get_place_photos(api_key, place_id)
            except Exception as e:
                print(f"  ⚠ [{cat}] {name}: failed to get photos ({e})")
                failed += 1
                time.sleep(BUSINESS_DELAY)
                continue

            if not photo_refs:
                print(f"  [{cat}] {name}: no photos on Google")
                continue

            # Download photos
            downloaded = 0
            for j, ref in enumerate(photo_refs[:5]):
                img_data = download_photo(api_key, ref)
                if img_data:
                    # Detect PNG
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
                            pass
                    photo_path = data_dir / f"{base}-{j}.jpg"
                    photo_path.write_bytes(img_data)
                    downloaded += 1
                time.sleep(PHOTO_DELAY)

            if downloaded > 0:
                print(f"  ✓ [{cat}] {name}: {downloaded} photos")
                fixed += 1
            else:
                print(f"  ⚠ [{cat}] {name}: 0 photos downloaded")
                failed += 1

            time.sleep(BUSINESS_DELAY)

    print(f"\n✅ Fixed: {fixed} businesses")
    print(f"❌ Failed: {failed} businesses")


if __name__ == "__main__":
    main()
