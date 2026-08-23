#!/usr/bin/env python3
"""Generate src/data/photo-manifest.json — which businesses have synced photos.

Scans data/{nails,massage}/*.jpg files (local sync copies of the R2 bucket)
and emits {"category/slug": ["0.jpg", ...]} used at build time to render
placeholder cards for photo-less listings and sort them last.
"""
import json
import os
import re
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "src", "data", "photo-manifest.json")

manifest = defaultdict(list)
for category in ("nails", "massage"):
    d = os.path.join(DATA, category)
    if not os.path.isdir(d):
        continue
    for fname in sorted(os.listdir(d)):
        m = re.match(r"^(.*)-(\d)\.jpg$", fname)
        if not m:
            continue
        slug = m.group(1)
        manifest[f"{category}/{slug}"].append(m.group(2))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(dict(manifest), f, sort_keys=True)

print(f"{len(manifest)} businesses with photos -> {os.path.relpath(OUT, ROOT)}")
