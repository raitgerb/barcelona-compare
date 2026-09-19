#!/usr/bin/env python3
"""Exact photo-file matching for a business slug.

Photos live at ``data/<category>/<slug>-<index>.jpg`` (and occasionally ``.png``).
Matching them with a prefix glob — ``data_dir.glob(f"{slug}-*")`` — is wrong: it also
matches **other** businesses whose slug starts with the same text. Real example from the
collected data: ``gt-nails`` swallows ``gt-nails-vietnamita-0.jpg``, so "does this business
have photos?" answers yes for a business that has none, and the destructive callers
(delete / rename / upload) touch a sibling's files. Use these helpers instead.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Optional

PHOTO_NAME_RE = re.compile(r"^(?P<slug>.+)-(?P<index>\d+)\.(?P<ext>jpg|png)$")


def photo_slug(filename: str) -> Optional[str]:
    """The slug a photo file belongs to, or None if the name is not a photo file."""
    match = PHOTO_NAME_RE.match(Path(filename).name)
    return match.group("slug") if match else None


def is_photo_of(path: Path, slug: str) -> bool:
    return photo_slug(path.name) == slug


def photo_paths(data_dir: Path, slug: str) -> List[Path]:
    """Every photo file that belongs to *this* slug, sorted by name."""
    data_dir = Path(data_dir)
    if not slug or not data_dir.is_dir():
        return []
    return sorted(p for p in data_dir.iterdir() if p.is_file() and is_photo_of(p, slug))
