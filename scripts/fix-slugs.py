#!/usr/bin/env python3
"""Fix duplicate slugs — replace random Place ID suffixes with neighborhood names.

'hello-nails-cr8qdc' → 'hello-nails-sarria-sant-gervasi'
"""

import re
import shutil
from pathlib import Path

CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"
DATA_DIR = Path(__file__).parent.parent / "data"

# Slugify helper
def slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"\s+", "-", s)
    return s[:80]

def main():
    renamed = 0

    for cat in ["nails", "massage"]:
        content_cat = CONTENT_DIR / cat
        data_cat = DATA_DIR / cat

        # Build slug → neighborhood map
        slug_neighborhood = {}
        for f in content_cat.glob("*.md"):
            content = f.read_text()
            base_slug = f.stem
            neighborhood = "barcelona"
            for line in content.split("\n"):
                if line.startswith("neighborhood:"):
                    neighborhood = line.split('"')[1] if '"' in line else "barcelona"
                    break
            # Track base slug (strip random suffix) → best neighborhood
            clean = re.sub(r"-[a-zA-Z0-9_-]{6}$", "", base_slug)
            slug_neighborhood[base_slug] = (clean, neighborhood)

        # Find files with Place-ID-style suffixes (6 alphanumeric chars after last dash)
        pid_suffix = re.compile(r"-[A-Za-z0-9_-]{6}$")

        for f in sorted(content_cat.glob("*.md")):
            old_slug = f.stem
            if not pid_suffix.search(old_slug):
                continue

            # Extract neighborhood
            content = f.read_text()
            neighborhood = "barcelona"
            for line in content.split("\n"):
                if line.startswith("neighborhood:"):
                    neighborhood = line.split('"')[1] if '"' in line else "barcelona"
                    break

            # Generate new slug: base-neighborhood
            clean = re.sub(r"-[A-Za-z0-9_-]{6}$", "", old_slug)
            hood_slug = slugify(neighborhood)
            new_slug = f"{clean}-{hood_slug}"

            # Check if new slug already exists
            if (content_cat / f"{new_slug}.md").exists():
                # Append street name fragment
                addr = ""
                for line in content.split("\n"):
                    if line.startswith("address:"):
                        addr = line.split('"')[1] if '"' in line else ""
                        break
                street = addr.split(",")[0].strip() if addr else "barcelona"
                street_slug = slugify(street)[:30]
                new_slug = f"{clean}-{street_slug}"

                # Still exists? Add number
                counter = 2
                base = new_slug
                while (content_cat / f"{new_slug}.md").exists():
                    new_slug = f"{base}-{counter}"
                    counter += 1

            if new_slug == old_slug:
                continue

            # Rename markdown
            old_path = content_cat / f"{old_slug}.md"
            new_path = content_cat / f"{new_slug}.md"
            old_path.rename(new_path)

            # Rename photos
            for photo in data_cat.glob(f"{old_slug}-*"):
                new_photo_name = photo.name.replace(old_slug, new_slug, 1)
                photo.rename(data_cat / new_photo_name)

            # Rename JSON
            json_old = data_cat / f"{old_slug}.json"
            if json_old.exists():
                json_old.rename(data_cat / f"{new_slug}.json")

            renamed += 1

            # Extract name for display
            name = ""
            for line in content.split("\n"):
                if line.startswith("name:"):
                    name = line.split('"')[1] if '"' in line else ""
                    break
            print(f"  [{cat}] {old_slug} → {new_slug}")

    print(f"\nRenamed {renamed} files")

if __name__ == "__main__":
    main()
