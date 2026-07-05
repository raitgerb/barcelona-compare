#!/usr/bin/env python3
"""Sync photos from data/ to public/images/ for all businesses in src/content/.

- Copies valid JPEG photos from data/{cat}/ to public/images/{cat}/
- Skips businesses that already have photos in public/images/
- Reports how many were synced vs already present vs missing entirely

Usage:
    python scripts/sync-photos.py           # dry run
    python scripts/sync-photos.py --commit  # actually copy
"""

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
CONTENT_DIR = ROOT / "src" / "content"
DATA_DIR = ROOT / "data"
PUBLIC_DIR = ROOT / "public" / "images"


def main():
    dry_run = "--commit" not in sys.argv
    mode = "DRY RUN" if dry_run else "COMMIT"

    synced = 0
    already_had = 0
    missing = 0
    photos_copied = 0

    for cat in ["nails", "massage"]:
        content_dir = CONTENT_DIR / cat
        data_dir = DATA_DIR / cat
        public_dir = PUBLIC_DIR / cat
        public_dir.mkdir(parents=True, exist_ok=True)

        slugs = {f.stem for f in content_dir.glob("*.md")}

        for slug in sorted(slugs):
            # Check if already has photos in public/images/
            existing_public = list(public_dir.glob(f"{slug}-*"))
            if existing_public:
                already_had += 1
                continue

            # Find photos in data/
            data_photos = sorted(data_dir.glob(f"{slug}-*.jpg"))
            if not data_photos:
                missing += 1
                continue

            # Copy them
            photo_count = len(data_photos)
            if not dry_run:
                for src in data_photos:
                    dst = public_dir / src.name
                    # Verify it's a real JPEG before copying
                    header = src.read_bytes()[:2]
                    if header != b'\xff\xd8':
                        print(f"  ⚠ Skipping non-JPEG: {src}")
                        photo_count -= 1
                        continue
                    shutil.copy2(src, dst)

            photos_copied += photo_count

            synced += 1

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Sync result:")
    print(f"  Already had photos: {already_had}")
    print(f"  Synced from data/:   {synced} ({photos_copied} photos)")
    print(f"  Missing entirely:    {missing}")
    print(f"  Total businesses:    {already_had + synced + missing}")

    if dry_run:
        print(f"\nRun with --commit to actually copy {photos_copied} photos.")


if __name__ == "__main__":
    main()
