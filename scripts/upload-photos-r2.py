#!/usr/bin/env python3
"""Upload photos for newly-collected businesses from data/ to Cloudflare R2.

Iterates over UNTRACKED content files (businesses not yet committed), finds their
photos in data/, and uploads each to R2 at images/{cat}/{slug}-{idx}.jpg.

Usage:
    python scripts/upload-photos-r2.py [--dry-run] [--all]
"""
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from photo_paths import photo_paths  # noqa: E402

ROOT = Path(__file__).parent.parent
CONTENT_DIR = ROOT / "src" / "content"
DATA_DIR = ROOT / "data"
BUCKET = "barcelona-compare-images"


def load_token():
    # Prefer the repo's dedicated R2 token from .env first — the ambient
    # CLOUDFLARE_API_TOKEN in the environment is a different token (DNS/Pages)
    # that lacks R2 permission and will make every upload fail with an auth error.
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().split("\n"):
            line = line.strip()
            if not line:
                continue
            k, sep, v = line.partition("=")
            if k == "CLOUDFLARE_R2_TOKEN" and sep:
                return v
    for name in ("CLOUDFLARE_R2_TOKEN", "CLOUDFLARE_API_TOKEN"):
        v = os.environ.get(name)
        if v:
            return v
    raise RuntimeError("No Cloudflare R2 token found (add CLOUDFLARE_R2_TOKEN to .env)")


def get_slugs(untracked_only):
    """Return set of (cat, slug) to upload photos for."""
    if not untracked_only:
        slugs = set()
        for cat in ("nails", "massage"):
            for md in (CONTENT_DIR / cat).glob("*.md"):
                slugs.add((cat, md.stem))
        return slugs
    proc = subprocess.run(
        ["git", "-c", "core.quotePath=false", "ls-files", "--others",
         "--exclude-standard", "src/content/*/*.md"],
        capture_output=True, text=True, cwd=ROOT,
    )
    slugs = set()
    for line in proc.stdout.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("/")
        if len(parts) >= 4:
            slugs.add((parts[2], parts[3][:-3]))  # strip .md
    return slugs


def upload_one(local, key, token, dry_run):
    if dry_run:
        return True
    cmd = ["npx", "--yes", "wrangler", "r2", "object", "put",
           f"{BUCKET}/{key}", "--file", str(local),
           "--content-type", "image/jpeg", "--remote"]
    env = {**os.environ, "CLOUDFLARE_API_TOKEN": token}
    try:
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return False
    return r.returncode == 0 and "Upload complete" in (r.stdout + r.stderr)


def main():
    import argparse
    import unicodedata
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--only", type=str, default=None,
                        help="Comma-separated slugs (upload only these)")
    args = parser.parse_args()

    token = load_token()
    if args.only:
        want = set(unicodedata.normalize("NFC", s.strip()) for s in args.only.split(",") if s.strip())
        slugs = set()
        for cat in ("nails", "massage"):
            for md in (CONTENT_DIR / cat).glob("*.md"):
                if unicodedata.normalize("NFC", md.stem) in want:
                    slugs.add((cat, md.stem))
    else:
        slugs = get_slugs(untracked_only=not args.all)

    total = ok = 0
    missing = []
    for cat, slug in sorted(slugs):
        data_cat = DATA_DIR / cat
        photos = [p for p in photo_paths(data_cat, slug) if p.suffix == ".jpg"]
        if not photos:
            missing.append(f"{cat}/{slug}")
            continue
        for p in photos:
            key = f"images/{cat}/{p.name}"
            total += 1
            if upload_one(p, key, token, args.dry_run):
                ok += 1
            else:
                print(f"  ✗ {key}")

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Uploaded {ok}/{total} photos to R2.")
    if missing:
        print(f"\n⚠️ {len(missing)} new businesses have NO local photos:")
        for m in missing:
            print(f"   - {m}")


if __name__ == "__main__":
    main()
