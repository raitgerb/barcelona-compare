#!/usr/bin/env python3
"""Upload new photos from data/ to Cloudflare R2.

Uploads photos modified today (or all with --all) to the R2 bucket, mirroring
the local filename to the object key (images/{cat}/{slug}-{idx}.jpg).

Also reports content businesses that have no local photos (name-collision cases
or photo-download failures) so they can be flagged.

Usage:
    python scripts/upload-photos-r2.py [--dry-run] [--all]
"""
import os
import subprocess
import sys
from datetime import datetime, date
from pathlib import Path

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


def upload_one(local: Path, key: str, token: str, dry_run: bool) -> bool:
    if dry_run:
        return True
    cmd = [
        "npx", "--yes", "wrangler", "r2", "object", "put",
        f"{BUCKET}/{key}",
        "--file", str(local),
        "--content-type", "image/jpeg",
        "--remote",
    ]
    env = {**os.environ, "CLOUDFLARE_API_TOKEN": token}
    try:
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return False
    return r.returncode == 0 and "Upload complete" in (r.stdout + r.stderr)


def main():
    dry_run = "--dry-run" in sys.argv
    upload_all = "--all" in sys.argv
    token = load_token()

    today_start = datetime.combine(date.today(), datetime.min.time()).timestamp()

    total = ok = 0
    for cat in ("nails", "massage"):
        data_cat = DATA_DIR / cat
        if not data_cat.exists():
            continue
        for p in sorted(data_cat.glob("*.jpg")):
            if not upload_all and p.stat().st_mtime < today_start:
                continue
            key = f"images/{cat}/{p.name}"
            total += 1
            if upload_one(p, key, token, dry_run):
                ok += 1
            else:
                print(f"  ✗ {key}")

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Uploaded {ok}/{total} photos to R2.")

    # Report content businesses with no local photos (collision / download failures)
    missing = []
    for cat in ("nails", "massage"):
        content_cat = CONTENT_DIR / cat
        data_cat = DATA_DIR / cat
        for md in sorted(content_cat.glob("*.md")):
            if not list(data_cat.glob(f"{md.stem}-*.jpg")):
                missing.append(f"{cat}/{md.stem}")
    if missing:
        print(f"\n⚠️ {len(missing)} businesses have NO local photos (collision or download failure):")
        for m in missing:
            print(f"   - {m}")


if __name__ == "__main__":
    main()
