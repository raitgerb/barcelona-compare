#!/usr/bin/env python3
"""
Fetch Google reviews + editorial summary for all businesses via Places API (New).

Usage:
  python3 scripts/fetch-reviews.py --test          # 5 businesses, prints cost estimate
  python3 scripts/fetch-reviews.py --batch 200     # run 200, checkpoint after each
  python3 scripts/fetch-reviews.py --all           # everything missing reviews

Writes googleReviews + googleEditorialSummary into each content file's frontmatter.
Skips files that already have googleReviews. Checkpointed: safe to re-run.
"""
import json
import os
import re
import sys
import time
import glob
import urllib.error
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
FIELDMASK = "reviews,editorialSummary"
MAX_REVIEWS_STORED = 5
# Places API (New) Pro SKU: $0.032/call after 5k free/month (Essentials fields incl. reviews)
COST_PER_CALL_USD = 0.032
FREE_TIER_MONTHLY = 5000


def load_key():
    env_path = os.path.join(ROOT, ".env")
    with open(env_path) as f:
        for line in f:
            if line.startswith("GOOGLE_PLACES_API_KEY="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("GOOGLE_PLACES_API_KEY not found in .env")


def get_place_id(fm_text):
    m = re.search(r'^googlePlaceId:\s*"?([^"\n]+)"?', fm_text, re.M)
    return m.group(1).strip() if m else None


def fetch_reviews(api_key, place_id):
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("X-Goog-Api-Key", api_key)
    req.add_header("X-Goog-FieldMask", FIELDMASK)
    req.add_header("User-Agent", "barcelona-compare-enrichment/1.0")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        print(f"    HTTP {e.code} for {place_id}: {body}")
        return None
    except Exception as e:
        print(f"    error for {place_id}: {e}")
        return None


def clean_text(text):
    """Strip newlines that would break YAML flow scalars."""
    return text.replace("\r", " ").replace("\n", " ").strip()


def update_frontmatter(path, data):
    with open(path, encoding="utf-8") as f:
        content = f.read()

    reviews = data.get("reviews") or []
    if not reviews:
        return False  # nothing worth writing

    stored = []
    for r in reviews[:MAX_REVIEWS_STORED]:
        stored.append({
            "author": clean_text(r.get("authorAttribution", {}).get("displayName", "Google user")),
            "rating": r.get("rating", 0),
            "relativeTime": clean_text(r.get("relativePublishTimeDescription", "")),
            "originalText": clean_text(r.get("originalText", {}).get("text", "") or r.get("text", {}).get("text", "")),
            "originalLanguage": (r.get("originalText", {}) or {}).get("languageCode") or (r.get("text", {}) or {}).get("languageCode", ""),
        })

    lines = []
    lines.append("googleReviews:")
    for s in stored:
        esc = s["originalText"].replace('"', '\\"')
        lines.append(f'  - author: "{s["author"]}"')
        lines.append(f"    rating: {s['rating']}")
        lines.append(f'    relativeTime: "{s["relativeTime"]}"')
        lines.append(f'    languageCode: "{s["originalLanguage"]}"')
        lines.append(f'    text: "{esc}"')
    editorial = data.get("editorialSummary")
    if editorial and editorial.get("text"):
        esc_ed = clean_text(editorial["text"]).replace('"', '\\"')
        lines.append('googleEditorialSummary: "' + esc_ed + '"')

    block = "\n".join(lines) + "\n"

    # Insert before closing '---' of frontmatter
    end = content.index("\n---", 3)
    new_content = content[:end + 1] + block + content[end + 1:]

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
    return True


def main():
    args = sys.argv[1:]
    test_mode = "--test" in args
    batch = None
    if "--batch" in args:
        batch = int(args[args.index("--batch") + 1])
    run_all = "--all" in args

    api_key = load_key()

    # Collect candidate files (both categories), skip ones already enriched
    files = sorted(glob.glob(os.path.join(ROOT, "src/content/nails/*.md"))) + \
            sorted(glob.glob(os.path.join(ROOT, "src/content/massage/*.md")))
    todo = []
    for p in files:
        with open(p, encoding="utf-8") as f:
            text = f.read()
        if "googleReviews:" in text:
            continue
        if not get_place_id(text):
            continue
        todo.append(p)

    total_todo = len(todo)
    print(f"{len(files)} content files, {total_todo} still need review enrichment")

    if test_mode:
        todo = todo[:5]
        est_full = total_todo * COST_PER_CALL_USD
        print(f"TEST MODE: fetching {len(todo)}. Full run would be {total_todo} calls "
              f"≈ ${est_full:.2f} (first {FREE_TIER_MONTHLY:,}/month free per SKU).")

    if batch:
        todo = todo[:batch]

    ok = empty = fail = 0
    for i, path in enumerate(todo):
        name = os.path.basename(path)
        place_id = get_place_id(open(path, encoding="utf-8").read())
        if not place_id:
            continue
        data = fetch_reviews(api_key, place_id)
        if data is None:
            fail += 1
        elif data.get("reviews"):
            update_frontmatter(path, data)
            ok += 1
        else:
            empty += 1  # place exists but has no written reviews

        if test_mode:
            sample = data.get("reviews", []) if data else []
            print(f"  [{name[:40]}] {len(sample)} reviews, editorial={'yes' if data and data.get('editorialSummary') else 'no'}")
            if sample:
                r0 = sample[0]
                txt = (r0.get("originalText", {}) or {}).get("text", "") or (r0.get("text", {}) or {}).get("text", "")
                print(f"    sample ({r0.get('rating')}★): {txt[:120]}")

        if (i + 1) % 50 == 0:
            print(f"  ... {i+1}/{len(todo)} done (ok={ok} empty={empty} fail={fail})")

    print(f"Done. enriched={ok} no-reviews={empty} failed={fail}")


if __name__ == "__main__":
    main()
