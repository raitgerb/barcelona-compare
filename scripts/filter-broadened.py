#!/usr/bin/env python3
"""Filter the broadened content — keep only actual nail/massage businesses.

After the broaden.py run caught 1,338 businesses (many false positives from
loose grid search types), this script removes non-relevant listings.

Usage:
    python scripts/filter-broadened.py [--dry-run]
"""

import argparse
import shutil
from pathlib import Path

CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"
DATA_DIR = Path(__file__).parent.parent / "data"

# ─── Keep/discard heuristics ──────────────────────────────────────────────

# If a business name contains these keywords AND doesn't contain any exclusion
# keywords, keep it.

NAIL_KEEP_KEYWORDS = [
    "nail", "uñas", "ungles", "manicur", "uña", "esmalt",
    "pedicur", "nail", "nails",
]

NAIL_EXCLUDE_KEYWORDS = [
    # Hair salons / barbers (primary business is hair, nails are secondary)
    "perruquer", "peluquer", "barber", "cabello", "pelos",
    "hair", "stylist", "coiff", "coiffure", "barbería",
    "perruqueria", "peluqueria",
    # Gyms / fitness
    "gym", "fitness", "crossfit", "gimnàs", "gimnasio",
    # Supplement / retail stores
    "suplementos", "supplement", "herbolari", "herborister",
    # Warehouses / storage
    "almacen", "deposito", "depósito", "warehouse",
    # Tattoo / piercing
    "tattoo", "tatuaje", "piercing",
    # Laser clinics
    "laser", "láser",
]

MASSAGE_KEEP_KEYWORDS = [
    "massage", "masaj", "quiromas", "fisioterap",
    "osteopat", "reflexolog", "shiatsu", "bienestar",
    "terap", "relax", "spa", "hammam", "sauna",
    "drenaje", "linfatic", "linfàtic",
]

MASSAGE_EXCLUDE_KEYWORDS = [
    # Supplement / retail stores
    "suplementos", "supplement", "herbolari", "herborister",
    # Warehouses / storage
    "almacen", "deposito", "depósito", "warehouse",
    # Tattoo / piercing
    "tattoo", "tatuaje", "piercing",
    # Laser clinics (generally aesthetic, not massage)
    "laser", "láser",
    # Dentists / vets
    "dental", "dentista", "veterinar", "veterinari",
    # Gyms (sometimes offer massage but are gyms first)
    "gym", "fitness", "crossfit", "gimnàs", "gimnasio",
    # Hair (misclassified)
    "perruquer", "peluquer", "barber", "cabello",
    # Car wash / auto
    "auto", "car wash", "lavado", "rent a car",
    # Hotels (spa in hotel)
    "hotel",
    # Opticians / glasses
    "optic", "òptic", "ulleres", "gafas",
]


def name_contains_any(name: str, keywords: list[str]) -> bool:
    name_lower = name.lower()
    return any(kw in name_lower for kw in keywords)


def should_keep(name: str, category: str) -> bool:
    """Decide whether this business should be kept."""
    if category == "nails":
        if not name_contains_any(name, NAIL_KEEP_KEYWORDS):
            return False
        if name_contains_any(name, NAIL_EXCLUDE_KEYWORDS):
            return False
        return True
    else:
        if not name_contains_any(name, MASSAGE_KEEP_KEYWORDS):
            return False
        if name_contains_any(name, MASSAGE_EXCLUDE_KEYWORDS):
            return False
        return True


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
                # Remove photos matching this file's slug
                base = md_file.stem
                for photo in data_cat.glob(f"{base}-*"):
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
            for photo in data_cat.glob("*"):
                # Extract base slug from photo filename (e.g., "some-name-0.jpg" -> "some-name")
                photo_stem = photo.stem
                # Remove trailing -N number
                base = "-".join(photo_stem.split("-")[:-1]) if "-" in photo_stem else photo_stem
                if base not in valid_slugs:
                    photo.unlink()
                    orphan_count += 1
            if orphan_count:
                print(f"  {cat}: cleaned {orphan_count} orphaned photos")


if __name__ == "__main__":
    main()
