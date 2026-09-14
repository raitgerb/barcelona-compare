#!/usr/bin/env python3
"""Score the business photos and rewrite the manifest so the best image leads.

Tier 1 of smart photo selection: deterministic, no ML, no paid service, no
Google API calls. It operates on photos we already hold (local `public/images/`
plus the public R2 bucket), so it costs nothing to run and changes nothing
about what we store — only the ORDER in which we show it.

Metrics (see `score()` for the weights):

  sharpness   variance of the 3x3 Laplacian — the standard blur proxy
  exposure    mean luminance + fraction of clipped highlights/shadows
  resolution  smallest side (a 250px image cannot be a hero)
  aspect      extreme panoramas/towers crop badly in the card layout
  colour      Hasler-Süsstrunk colourfulness — catches menus, logos, documents
  duplicates  dHash distance within a business (Google often returns one shot twice)

Writes:
  src/data/photo-manifest.json   same keys, same file indices, reordered best-first
  data/photo-scores.json         full audit trail (per-photo metrics + flags)

Usage:
  python3 scripts/score-photos.py                 # all businesses
  python3 scripts/score-photos.py --limit 50      # first 50 (smoke test)
  python3 scripts/score-photos.py --dry-run       # score, write nothing
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "src", "data", "photo-manifest.json")
LOCAL_IMAGES = os.path.join(ROOT, "public", "images")
AUDIT = os.path.join(ROOT, "data", "photo-scores.json")
CACHE = os.path.join(ROOT, ".photo-cache")
R2_BASE = os.environ.get(
    "R2_IMAGE_BASE_URL",
    "https://pub-37760591f0394eafb9519ca1c4db5865.r2.dev",
)

# A photo scoring below this is worth flagging for a human; below BAD it should
# not lead a listing.
FLAG_BELOW = 70.0
BAD_BELOW = 55.0
# How much better a challenger must be before it displaces the current lead.
LEAD_SWAP_MARGIN = 8.0


def fetch(url: str, dest: str) -> bool:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # Slugs contain accented characters (estética, iñaki, linfático…). urllib does
    # NOT percent-encode those, and the request then fails while curl succeeds —
    # which silently skipped ~400 photos. Encode the path, keep the scheme/host.
    safe_url = urllib.parse.quote(url, safe=":/?&=%@+~")
    try:
        req = urllib.request.Request(safe_url, headers={"User-Agent": "bc-photo-score/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        if len(data) < 200:
            return False
        with open(dest, "wb") as fh:
            fh.write(data)
        return True
    except (urllib.error.URLError, OSError, ValueError):
        return False


def laplacian_variance(gray: np.ndarray) -> float:
    a = gray.astype(np.float64)
    lap = (
        -4.0 * a[1:-1, 1:-1]
        + a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:]
    )
    return float(lap.var())


def colourfulness(rgb: np.ndarray) -> float:
    r, g, b = (rgb[..., i].astype(np.float64) for i in range(3))
    rg = r - g
    yb = 0.5 * (r + g) - b
    return float(
        np.sqrt(rg.std() ** 2 + yb.std() ** 2)
        + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)
    )


def dhash(img: Image.Image, size: int = 8) -> np.ndarray:
    g = img.convert("L").resize((size + 1, size), Image.LANCZOS)
    a = np.asarray(g, dtype=np.int16)
    return (a[:, 1:] > a[:, :-1]).flatten()


def hamming(a: np.ndarray, b: np.ndarray) -> int:
    return int(np.count_nonzero(a != b))


def measure(path: str) -> dict | None:
    try:
        img = Image.open(path)
        img.load()
    except Exception:
        return None

    w, h = img.size
    rgb = np.asarray(img.convert("RGB"))
    gray = np.asarray(img.convert("L"))
    short_side = min(w, h)

    return {
        "w": w,
        "h": h,
        "short_side": short_side,
        "ratio": round(max(w, h) / max(1, short_side), 2),
        "sharpness": round(laplacian_variance(gray), 1),
        "mean_lum": round(float(gray.mean()), 1),
        "clip_hi": round(float((gray >= 250).mean()), 4),
        "clip_lo": round(float((gray <= 5).mean()), 4),
        "colour": round(colourfulness(rgb), 1),
        "_hash": dhash(img),
    }


def score(m: dict, is_duplicate: bool) -> float:
    """0-100 composite. Deliberately simple, and every term is inspectable."""
    s = 100.0

    if m["sharpness"] < 80:
        s -= 35
    elif m["sharpness"] < 200:
        s -= 12

    if m["mean_lum"] < 60:
        s -= 25
    elif m["mean_lum"] < 90:
        s -= 8
    elif m["mean_lum"] > 215:
        s -= 20

    s -= min(25, m["clip_hi"] * 220)
    s -= min(15, m["clip_lo"] * 180)

    if m["short_side"] < 320:
        s -= 40
    elif m["short_side"] < 600:
        s -= 15

    if m["ratio"] > 2.2 or m["ratio"] < 0.45:
        s -= 15

    if m["colour"] < 18:
        s -= 20
    elif m["colour"] < 28:
        s -= 8

    if is_duplicate:
        s -= 30

    return round(max(0.0, s), 1)


def flags(m: dict, is_duplicate: bool) -> list[str]:
    out = []
    if is_duplicate:
        out.append("duplicate")
    if m["sharpness"] < 80:
        out.append("blurry")
    if m["mean_lum"] < 60:
        out.append("dark")
    elif m["mean_lum"] > 215:
        out.append("blown")
    if m["clip_hi"] > 0.05:
        out.append("clipped-highlights")
    if m["colour"] < 18:
        out.append("flat-colour")
    if m["short_side"] < 320:
        out.append("tiny")
    elif m["short_side"] < 600:
        out.append("small")
    if m["ratio"] > 2.2 or m["ratio"] < 0.45:
        out.append("extreme-aspect")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only the first N businesses")
    ap.add_argument("--dry-run", action="store_true", help="write nothing")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    manifest = json.load(open(MANIFEST))
    keys = list(manifest.keys())
    if args.limit:
        keys = keys[: args.limit]

    os.makedirs(CACHE, exist_ok=True)
    new_manifest = dict(manifest)
    audit: dict[str, dict] = {}
    stats = {"businesses": 0, "photos": 0, "fetched": 0, "missing": 0, "reordered": 0, "flagged": 0}

    for n, key in enumerate(keys, 1):
        cat, slug = key.split("/", 1)
        indices = [str(i) for i in manifest[key]]
        entries = []

        for idx in indices:
            local = os.path.join(LOCAL_IMAGES, cat, f"{slug}-{idx}.jpg")
            path = local
            if not os.path.exists(local):
                path = os.path.join(CACHE, cat, f"{slug}-{idx}.jpg")
                if not os.path.exists(path):
                    if fetch(f"{R2_BASE}/images/{cat}/{slug}-{idx}.jpg", path):
                        stats["fetched"] += 1
                    else:
                        stats["missing"] += 1
                        entries.append({"idx": idx, "score": None, "unavailable": True})
                        continue

            m = measure(path)
            if m is None:
                stats["missing"] += 1
                entries.append({"idx": idx, "score": None, "unavailable": True})
                continue
            m["idx"] = idx
            entries.append(m)

        usable = [e for e in entries if e.get("score") is not None or "_hash" in e]

        # duplicates inside the same business, keeping the highest-scoring copy first
        for i, a in enumerate(usable):
            a["duplicate_of"] = None
            for j, b in enumerate(usable):
                if i != j and hamming(a["_hash"], b["_hash"]) <= 6:
                    a["duplicate_of"] = b["idx"]
                    break

        for e in usable:
            e["score"] = score(e, e["duplicate_of"] is not None)
            e["flags"] = flags(e, e["duplicate_of"] is not None)
            if e["score"] < FLAG_BELOW:
                stats["flagged"] += 1

        ordered = sorted(usable, key=lambda e: -e["score"])
        # unavailable photos keep their original position at the end
        final = [e["idx"] for e in ordered] + [e["idx"] for e in entries if e.get("unavailable")]

        # Hysteresis: only displace the current lead when the challenger is
        # meaningfully better. Reordering for a fraction of a point is pure
        # churn, and every unforced change is a chance to promote a sharp photo
        # of a flyer into the hero slot (tier 1 cannot tell a flyer from a
        # salon — that is what CLIP tier 2 is for).
        lead_changed = False
        current_lead = indices[0]
        scored = {e["idx"]: e for e in usable}
        unavailable = {e["idx"] for e in entries if e.get("unavailable")}
        final = list(indices)

        if unavailable:
            # We could not see the whole set. Leave this business exactly as it
            # was rather than guess: an unmeasured photo must never be demoted.
            final = list(indices)
        elif ordered:
            best = ordered[0]["idx"]
            cur = scored.get(current_lead)
            if cur is None:
                lead = best
            elif best != current_lead and ordered[0]["score"] - cur["score"] >= LEAD_SWAP_MARGIN:
                lead = best
            else:
                # not clearly better — keep the existing lead
                lead = current_lead
            final = [lead] + [e["idx"] for e in ordered if e["idx"] != lead]

        # honest definition: the lead slot no longer holds the photo it held before
        lead_changed = bool(final) and final[0] != indices[0]

        if final != indices:
            stats["reordered"] += 1
        new_manifest[key] = final

        audit[key] = {
            "original_order": indices,
            "new_order": final,
            "lead_changed": bool(final and final[0] != indices[0]),
            "photos": [
                {k: v for k, v in e.items() if k != "_hash"} for e in entries
            ],
        }

        stats["businesses"] += 1
        stats["photos"] += len(usable)
        if not args.quiet and n % 100 == 0:
            print(f"  {n}/{len(keys)} businesses…", file=sys.stderr)

    changed_leads = sum(1 for v in audit.values() if v["lead_changed"])
    print(json.dumps({
        "businesses": stats["businesses"],
        "photos_scored": stats["photos"],
        "photos_fetched_from_r2": stats["fetched"],
        "photos_unavailable": stats["missing"],
        "businesses_reordered": stats["reordered"],
        "lead_photo_changed": changed_leads,
        "photos_flagged": stats["flagged"],
    }, indent=2))

    if args.dry_run:
        print("dry run — nothing written")
        return 0

    with open(MANIFEST, "w") as fh:
        json.dump(new_manifest, fh, indent=2)
        fh.write("\n")
    os.makedirs(os.path.dirname(AUDIT), exist_ok=True)
    with open(AUDIT, "w") as fh:
        json.dump(audit, fh, indent=2)
        fh.write("\n")
    print(f"\nwrote {MANIFEST}\nwrote {AUDIT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
