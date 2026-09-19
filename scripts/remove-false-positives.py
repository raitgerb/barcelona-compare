#!/usr/bin/env python3
"""Remove clearly-irrelevant listings collected by the geographic grid search.

The grid search (Nearby Search with loose types like `beauty_salon`, `spa`) pulls
in businesses that are NOT nail salons or massage places: wine shops, gyms,
swimming clubs, cosmetics stores, herbal shops, hair salons, laser clinics,
archaeological sites.

Unlike filter-broadened.py (which removes anything without a keyword in the name
and risks deleting legit businesses with generic names), this script removes a
CURATED DENYLIST of obvious non-matches by name substring. Everything else is kept.

Usage:
    python scripts/remove-false-positives.py [--dry-run]
"""
import argparse
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from photo_paths import photo_paths  # noqa: E402

CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"
DATA_DIR = Path(__file__).parent.parent / "data"


def norm(s: str) -> str:
    """Lowercase + strip accents so ASCII needles match accented names."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


# (category, accent-stripped name substring)
DENYLIST = [
    # Medical / hospital / clinic / pharmacy
    ("nails", "hospital"),
    ("nails", "farmacia"),
    ("nails", "maternitat"),
    ("nails", "ginecolog"),
    ("nails", "clinica"),
    ("nails", "centre medic"),
    ("nails", "medicina estetica"),
    ("massage", "clinica"),
    ("massage", "centre medic"),
    ("massage", "medicina estetica"),
    ("massage", "tcmsalud"),
    # Sports / gym / padel / pool / plaza
    ("massage", "club esportiu"),
    ("massage", "club metropolitan"),
    ("massage", "health performance"),
    ("massage", "esports associats"),
    ("massage", "sumana yoga"),
    ("nails", "dir tres"),
    ("nails", "padel"),
    ("nails", "piscina"),
    ("nails", "placa marti"),
    # Food / wine / retail / cosmetics
    ("nails", "mixfood"),
    ("nails", "vinumplay"),
    ("nails", "viandagift"),
    ("nails", "shinycandle"),
    ("nails", "seoul korean cosmetics"),
    ("nails", "miin korean"),
    ("massage", "koan beauty lab"),
    # Escorts
    ("massage", "escort"),
    # Hair / barber
    ("nails", "estilistas"),
    ("nails", "peluqueria"),
    ("nails", "perruqueria"),
    ("nails", "barberia"),
    ("nails", "barber"),
    # Hotel (spa-in-hotel)
    ("massage", "hotel"),
    # Bars / restaurants / addresses / junk
    ("nails", "la extremena"),
    ("nails", "las meninas"),
    ("nails", "pantera barcelona"),
    ("nails", "carrer de sants 384"),
    ("nails", "bsszt"),
    ("massage", "sant cugat"),
    # Batch-1 false positives (re-collected by the grid search)
    ("nails", "jaciment"),
    ("nails", "onda hair"),
    ("nails", "la brush"),
    ("nails", "nail art beauty spa hair"),
    ("nails", "onda beauty center"),
    ("nails", "born massage"),
    ("massage", "club natacio"),
    ("massage", "maritim by claror"),
    ("massage", "xinesa"),
]


def read_name(md_path: Path) -> str:
    for line in md_path.read_text(encoding="utf-8").split("\n"):
        if line.startswith("name:"):
            return line.split('"', 2)[1] if '"' in line else ""
    return ""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    removed = []
    seen = set()
    for cat, needle in DENYLIST:
        cat_dir = CONTENT_DIR / cat
        if not cat_dir.exists():
            continue
        for md_file in cat_dir.glob("*.md"):
            name = read_name(md_file)
            if needle in norm(name):
                key = (cat, md_file.stem)
                if key in seen:
                    continue
                seen.add(key)
                removed.append((cat, md_file, name))
                if args.dry_run:
                    print(f"  REMOVE [{cat}] {name}")
                else:
                    base = md_file.stem
                    md_file.unlink()
                    for photo in photo_paths(DATA_DIR / cat, base):
                        photo.unlink()
                    jf = DATA_DIR / cat / f"{base}.json"
                    if jf.exists():
                        jf.unlink()

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Removed {len(removed)} businesses.")


if __name__ == "__main__":
    main()
