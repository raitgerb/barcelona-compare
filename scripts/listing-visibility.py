#!/usr/bin/env python3
"""Toggle public visibility for one BarcelonaCompare catalogue listing."""
from __future__ import annotations

import argparse
from pathlib import Path
import re


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("category", choices=("nails", "massage"))
    parser.add_argument("slug", help="listing filename without .md")
    parser.add_argument("state", choices=("offline", "online"))
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="project root (defaults to this repository)",
    )
    args = parser.parse_args()

    path = args.root / "src" / "content" / args.category / f"{args.slug}.md"
    if not path.is_file():
        parser.error(f"listing not found: {path}")

    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        parser.error(f"listing has no YAML frontmatter: {path}")
    end = text.find("\n---\n", 4)
    if end < 0:
        parser.error(f"listing frontmatter is not closed: {path}")

    frontmatter = text[4:end]
    value = "true" if args.state == "offline" else "false"
    pattern = re.compile(r"^offline:\s*(?:true|false)\s*$", re.MULTILINE)
    if pattern.search(frontmatter):
        frontmatter = pattern.sub(f"offline: {value}", frontmatter, count=1)
    else:
        frontmatter = f"{frontmatter}\noffline: {value}"

    body = text[end + len("\n---\n"):]
    path.write_text(f"---\n{frontmatter}\n---\n{body}", encoding="utf-8")
    print(f"{args.state}: {args.category}/{args.slug}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
