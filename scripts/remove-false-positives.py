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
import unicodedata
from pathlib import Path

CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"
DATA_DIR = Path(__file__).parent.parent / "data"


def norm(s: str) -> str:
    """Lowercase + strip accents so ASCII needles match accented names."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


# (category, accent-stripped name substring)
DENYLIST = [
    ("nails", "vinumplay"),               # wine shop
    ("nails", "jaciment"),                # archaeological site
    ("nails", "onda hair"),               # hair salon
    ("nails", "la brush"),                # hair/lash salon
    ("nails", "nail art beauty spa hair"),# hybrid hair salon
    ("nails", "onda beauty center"),      # laser clinic
    ("nails", "born massage"),            # misclassified massage&beauty
    ("massage", "club natacio"),          # swimming club
    ("massage", "maritim by claror"),     # gym
    ("massage", "miin korean"),           # cosmetics shop
    ("massage", "xinesa"),                # herbal shop
    ("massage", "koan beauty lab"),       # k-beauty/cosmetics
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
    for cat, needle in DENYLIST:
        cat_dir = CONTENT_DIR / cat
        if not cat_dir.exists():
            continue
        for md_file in cat_dir.glob("*.md"):
            name = read_name(md_file)
            if needle in norm(name):
                removed.append((cat, md_file, name))
                if args.dry_run:
                    print(f"  REMOVE [{cat}] {name}")
                else:
                    base = md_file.stem
                    md_file.unlink()
                    for photo in (DATA_DIR / cat).glob(f"{base}-*"):
                        photo.unlink()
                    jf = DATA_DIR / cat / f"{base}.json"
                    if jf.exists():
                        jf.unlink()

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Removed {len(removed)} businesses.")


if __name__ == "__main__":
    main()
