#!/usr/bin/env python3
"""Classify businesses by service intent → writes `serviceTags` into frontmatter.

Signals: business name (strong), service[] entries (strong), Google review
texts (weak). Tags are intentionally generous — route files gate on minimum
business counts, so thin tags simply don't produce pages.

Usage:
    python scripts/classify-services.py            # apply
    python scripts/classify-services.py --dry-run  # report only

Idempotent: replaces any existing serviceTags block.
"""

import glob
import re
import sys
import collections
from pathlib import Path

CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"

# (tag, pattern, reviews_count) — reviews_count: does review evidence alone qualify?
MASSAGE_RULES = [
    # specialty terms: specific enough that review mentions are meaningful
    ("tailandes",    r"thai|tailand", True),
    ("deportivo",    r"deportiv|\bsports?\b", True),
    ("reflexologia", r"reflexolog|podal", True),
    # couples rooms are advertised, not reviewed — name/service listings only
    ("pareja",       r"en pareja|para parejas?|masajes? de pareja", False),
    # quiromasaje/descontracturante is the *specialty* term; generic "relax"
    # would swallow the whole category, so reviews don't qualify
    ("quiromasaje",  r"quiromasaje|descontractur", False),
]

NAILS_RULES = [
    # standard menu services customers reliably mention by name
    ("pedicura",      r"pedicur|podolog", True),
    ("gel-acrilicas", r"\bgel\b|acr[ií]lic|semipermanen|kapping|esculpid", True),
    ("nail-art",      r"nail ?art|dise[nñ]o de u[nñ]as|decoraci[oó]n de u[nñ]as", True),
]


def split_frontmatter(text: str):
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        return None, text
    return m.group(1), m.group(2)


def classify(cat: str, fm: str, body_reviews: str) -> list[str]:
    """Return sorted tag list for one business."""
    name_m = re.search(r'^name:\s*"?(.+?)"?\s*$', fm, re.M)
    name = (name_m.group(1) if name_m else "").lower()
    svc_m = re.search(r"^services:\n((?:\s+-.*\n?)+)", fm, re.M)
    services_blob = svc_m.group(1).lower() if svc_m else ""
    haystack_name = f"{name} {services_blob}"
    haystack_all = f"{haystack_name} {body_reviews}".lower()

    rules = MASSAGE_RULES if cat == "massage" else NAILS_RULES
    tags = []
    for tag, pattern, reviews_qualify in rules:
        rx = re.compile(pattern, re.I)
        if rx.search(haystack_name):
            tags.append(tag)
        elif reviews_qualify and rx.search(body_reviews):
            # weak signal: standard services customers mention by name in reviews
            tags.append(tag)

    # massage: spa/wellness from name OR reviews mentioning spa/hammam heavily
    if cat == "massage":
        if re.search(r"\bspa\b|hammam|ba[nñ]os [aá]rabes", haystack_name) or \
           len(re.findall(r"\bspa\b", body_reviews, re.I)) >= 2:
            tags.append("spa-bienestar")

    return sorted(set(tags))


def main():
    dry = "--dry-run" in sys.argv
    stats = collections.Counter()
    changed = 0
    for cat in ["nails", "massage"]:
        for f in sorted(glob.glob(str(CONTENT_DIR / cat / "*.md"))):
            p = Path(f)
            text = p.read_text(encoding="utf-8")
            fm, body = split_frontmatter(text)
            if fm is None:
                print(f"⚠ no frontmatter: {p.name}")
                continue
            reviews = body.split("googleReviews:", 1)[-1] if "googleReviews:" in text else ""
            # reviews live inside frontmatter in these files; fall back to whole fm tail
            if not reviews.strip():
                reviews = fm.split("googleReviews:", 1)[-1]
            tags = classify(cat, fm, reviews)
            stats[(cat, tuple(tags))] += 1
            if not tags:
                continue
            block = "serviceTags:\n" + "".join(f"  - {t}\n" for t in tags)
            new_fm = re.sub(r"serviceTags:\n(?:  - .*\n?)+", "", fm)
            new_fm = new_fm.rstrip("\n") + "\n" + block.rstrip("\n") + "\n"
            new_text = f"---\n{new_fm}---\n{body}"
            if new_text != text and not dry:
                p.write_text(new_text, encoding="utf-8")
                changed += 1
    print("=== tag distribution ===")
    per_tag = collections.Counter()
    for (cat, tags), n in stats.items():
        for t in tags:
            per_tag[(cat, t)] += n
        if not tags:
            per_tag[(cat, "(none)")] += n
    for (cat, t), n in sorted(per_tag.items()):
        print(f"  {cat:8s} {t:18s} {n}")
    print(f"files changed: {changed}{' (dry run)' if dry else ''}")


if __name__ == "__main__":
    main()
