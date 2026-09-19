#!/usr/bin/env python3
"""Keep/discard heuristics for Barcelona Compare listings.

One source of truth, used by two callers:

* ``scripts/broaden.py enrich``  — decides which freshly enriched (paid-for) Place Details
  results become listings, *before* any photo call is spent on them.
* ``scripts/filter-broadened.py`` — the historical cleanup script for content that was
  already written by an older run.

A candidate is kept when its name matches a category keyword and no exclusion keyword;
a business Google reports as ``CLOSED_PERMANENTLY`` is always rejected (the details call
is already paid for, so this costs nothing extra).
"""

from __future__ import annotations

from typing import List, Tuple

NAIL_KEEP_KEYWORDS: List[str] = [
    "nail", "uñas", "ungles", "manicur", "uña", "esmalt",
    "pedicur", "nails",
]

NAIL_EXCLUDE_KEYWORDS: List[str] = [
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

MASSAGE_KEEP_KEYWORDS: List[str] = [
    "massage", "masaj", "massatg", "masatg", "quiromas", "fisioterap",
    "osteopat", "osteo", "reflexolog", "shiatsu", "bienestar", "wellness",
    "terap", "relax", "spa", "hammam", "sauna",
    "drenaje", "linfatic", "linfàtic", "lymph", "bodywork",
    "tantr", "acupuntur",
]

MASSAGE_EXCLUDE_KEYWORDS: List[str] = [
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
    # Adult venues. Not a moral judgement — this is a mainstream directory whose
    # pages carry ads and partner listings, so the default is to leave them out.
    # Reversing it is one line: delete this block and rerun `enrich --refilter`
    # (re-filtering stored details costs no API calls).
    "erotic", "erótico", "sauna gay", "gay sauna", "sex club", "escort",
]

KEEP_KEYWORDS = {"nails": NAIL_KEEP_KEYWORDS, "massage": MASSAGE_KEEP_KEYWORDS}
EXCLUDE_KEYWORDS = {"nails": NAIL_EXCLUDE_KEYWORDS, "massage": MASSAGE_EXCLUDE_KEYWORDS}


def _match(name: str, keywords: List[str]) -> List[str]:
    lowered = name.lower()
    return [kw for kw in keywords if kw in lowered]


def verdict(name: str, category: str, business_status: str = "") -> Tuple[bool, str]:
    """Return ``(keep, reason)`` for one business name/category.

    ``business_status`` is Google's ``businessStatus`` field, e.g. ``OPERATIONAL``,
    ``CLOSED_TEMPORARILY`` or ``CLOSED_PERMANENTLY``.
    """
    if (business_status or "").upper() == "CLOSED_PERMANENTLY":
        return False, "closed_permanently"
    if category not in KEEP_KEYWORDS:
        raise ValueError(f"unknown category {category!r}; expected 'nails' or 'massage'")
    name = name or ""
    if not _match(name, KEEP_KEYWORDS[category]):
        return False, "no_category_keyword"
    excluded = _match(name, EXCLUDE_KEYWORDS[category])
    if excluded:
        return False, "excluded_keyword:" + ",".join(excluded[:3])
    return True, "name_match"


def should_keep(name: str, category: str, business_status: str = "") -> bool:
    return verdict(name, category, business_status)[0]


def pick_category(name: str, categories: List[str], business_status: str = "") -> Tuple[str, str]:
    """Choose the category a candidate belongs to, or ``("", reason)`` if none fits.

    A place found by both the nail and the massage searches is kept for the first
    category whose keywords its name actually matches.
    """
    reasons = []
    for category in categories:
        keep, reason = verdict(name, category, business_status)
        if keep:
            return category, reason
        reasons.append(f"{category}:{reason}")
    return "", "|".join(reasons) or "no_category"
