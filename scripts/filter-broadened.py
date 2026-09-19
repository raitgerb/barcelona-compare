#!/usr/bin/env python3
"""Filter the broadened content — keep only actual nail/massage businesses.

After the broaden.py run caught 1,338 businesses (many false positives from
loose grid search types), this script removes non-relevant listings.

The keep/discard heuristics live in `scripts/place_filter.py` (shared with the
enrichment phase of `scripts/broaden.py`, so both agree on what a listing is).

Usage:
    python scripts/filter-broadened.py [--dry-run]
"""

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from place_filter import should_keep  # noqa: E402
from photo_paths import photo_paths, photo_slug  # noqa: E402

CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"
DATA_DIR = Path(__file__).parent.parent / "data"


# ─── Keep/discard heuristics ──────────────────────────────────────────────

# The keyword lists and the decision logic live in scripts/place_filter.py, shared with
# the enrichment phase of scripts/broaden.py. `should_keep(name, category)` is imported
# at the top of this file.


def filter_category(category: str, dry_run: bool = False) -> tuple[int, int]:
    """Filter one category. Returns (kept, removed)."""
    content_cat = CONTENT_DIR / category
    data_cat = DATA_DIR / category

    if not content_cat.exists():
        return 0, 0

    kept = 0
    removed = 0

    for md_file in sorted(content_cat.glob("*.md")):
        content = md_file.read_text()

        # Extract name from frontmatter: name: "Business Name"
        name = ""
        for line in content.split("\n"):
            if line.startswith("name:"):
                name = line.split('"', 2)[1] if '"' in line else ""
                break

        if not name:
            # Try from first heading
            for line in content.split("\n"):
                if line.startswith("# "):
                    name = line[2:].strip()
                    break

        if should_keep(name, category):
            kept += 1
        else:
            if dry_run:
                print(f"  REMOVE [{category}] {name}")
            else:
                # Remove markdown file
                md_file.unlink()
                # Remove photos
                slug = None
                for line in content.split("\n"):
                    if line.startswith("googlePlaceId:"):
                        # We can try to find photos by slug from filename
                        pass
                # Remove photos matching this file's slug (exact match — a prefix glob
                # would also delete a sibling business's photos, e.g. "gt-nails" vs
                # "gt-nails-vietnamita").
                base = md_file.stem
                for photo in photo_paths(data_cat, base):
                    photo.unlink()
                # Remove JSON
                json_file = data_cat / f"{base}.json"
                if json_file.exists():
                    json_file.unlink()
            removed += 1

    return kept, removed


def main():
    parser = argparse.ArgumentParser(description="Filter broadened content")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be removed")
    args = parser.parse_args()

    if args.dry_run:
        print("🔍 DRY RUN — showing what would be removed\n")

    for cat in ["nails", "massage"]:
        kept, removed = filter_category(cat, dry_run=args.dry_run)
        if args.dry_run:
            print(f"\n  {cat}: {kept} kept, {removed} would be removed")
        else:
            print(f"  {cat}: {kept} kept, {removed} removed")

    if not args.dry_run:
        # Clean up orphaned photos (no corresponding markdown)
        for cat in ["nails", "massage"]:
            content_cat = CONTENT_DIR / cat
            data_cat = DATA_DIR / cat
            if not data_cat.exists():
                continue
            valid_slugs = {f.stem for f in content_cat.glob("*.md")} if content_cat.exists() else set()
            orphan_count = 0
            for entry in data_cat.iterdir():
                if not entry.is_file():
                    continue
                # Only photo files count as orphans here. This used to iterate every file
                # and derive the slug by stripping the last "-part", which deleted raw
                # Place Details JSONs (e.g. "gt-nails.json" -> slug "gt" -> "not a listing"
                # -> unlink). Never let this loop touch anything but <slug>-<n>.jpg/png.
                base = photo_slug(entry.name)
                if base is not None and base not in valid_slugs:
                    entry.unlink()
                    orphan_count += 1
            if orphan_count:
                print(f"  {cat}: cleaned {orphan_count} orphaned photos")


if __name__ == "__main__":
    main()
