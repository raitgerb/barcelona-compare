#!/usr/bin/env python3
"""
Fetch ONLY editorialSummary for businesses missing it, via Places API (New).

Usage:
  python3 scripts/fetch-editorial.py --test          # 5 businesses, prints cost estimate
  python3 scripts/fetch-editorial.py --all           # everything missing editorialSummary

Writes googleEditorialSummary into frontmatter (appends after existing content).
Skips files that already have it. Checkpointed: safe to re-run.
"""
import json
import os
import re
import sys
import glob
import urllib.error
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
FIELDMASK = "editorialSummary"
# Same Essentials Pro SKU as the reviews pull
COST_PER_CALL_USD = 0.032


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


def fetch_editorial(api_key, place_id):
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("X-Goog-Api-Key", api_key)
    req.add_header("X-Goog-FieldMask", FIELDMASK)
    req.add_header("User-Agent", "barcelona-compare-enrichment/1.0")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"    HTTP {e.code} for {place_id}: {e.read().decode()[:200]}")
        return None
    except Exception as e:
        print(f"    error for {place_id}: {e}")
        return None


def clean_text(text):
    return text.replace("\r", " ").replace("\n", " ").strip()


def update_frontmatter(path, summary):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    esc = clean_text(summary).replace('"', '\\"')
    block = 'googleEditorialSummary: "' + esc + '"\n'
    end = content.index("\n---", 3)
    new_content = content[:end + 1] + block + content[end + 1:]
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)


def main():
    args = sys.argv[1:]
    test_mode = "--test" in args
    run_all = "--all" in args

    api_key = load_key()

    files = sorted(glob.glob(os.path.join(ROOT, "src/content/nails/*.md"))) + \
            sorted(glob.glob(os.path.join(ROOT, "src/content/massage/*.md")))
    todo = []
    for p in files:
        with open(p, encoding="utf-8") as f:
            text = f.read()
        if "googleEditorialSummary:" in text:
            continue
        if not get_place_id(text):
            continue
        todo.append(p)

    total_todo = len(todo)
    print(f"{len(files)} content files, {total_todo} still need editorialSummary")

    if test_mode:
        est = total_todo * COST_PER_CALL_USD
        print(f"Full run would be {total_todo} calls ≈ ${est:.2f} "
              f"(first 5,000/month free per SKU).")
        todo = todo[:5]

    if not run_all and not test_mode:
        print("Pass --test or --all.")
        sys.exit(0)

    ok = empty = fail = 0
    for i, path in enumerate(todo):
        place_id = get_place_id(open(path, encoding="utf-8").read())
        data = fetch_editorial(api_key, place_id)
        if data is None:
            fail += 1
        elif data.get("editorialSummary") and data["editorialSummary"].get("text"):
            update_frontmatter(path, data["editorialSummary"]["text"])
            ok += 1
        else:
            empty += 1

        if test_mode:
            name = os.path.basename(path)
            sample = (data or {}).get("editorialSummary", {}).get("text", "")
            print(f"  [{name[:40]}] {sample[:100]!r}")

        if (i + 1) % 50 == 0:
            print(f"  ... {i+1}/{len(todo)} done (ok={ok} empty={empty} fail={fail})", flush=True)

    print(f"Done. enriched={ok} no-summary={empty} failed={fail}")


if __name__ == "__main__":
    main()
