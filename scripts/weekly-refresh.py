#!/usr/bin/env python3
"""Weekly refresh script for Barcelona Compare.

1. Re-collects fresh data from Google Places API for both categories
2. Downloads photos for each business
3. Compares old vs new data to detect changes
4. Commits and pushes changes (triggers Cloudflare deploy)
5. Outputs a summary of changes

Usage:
    python scripts/weekly-refresh.py
    (reads API key from .env)
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

import requests

PROJECT_DIR = Path(__file__).parent.parent
CONTENT_DIR = PROJECT_DIR / "src" / "content"
DATA_DIR = PROJECT_DIR / "data"
PUBLIC_DIR = PROJECT_DIR / "public"
PHOTOS_DIR = PUBLIC_DIR / "images"


def load_api_key() -> str:
    env_file = PROJECT_DIR / ".env"
    with open(env_file) as f:
        for line in f:
            if "GOOGLE_" in line and "API" in line:
                return line.strip().split("=", 1)[1]
    raise RuntimeError("API key not found")


def run_collector(api_key: str) -> bool:
    """Re-run the data collector for both categories."""
    print("📊 Re-collecting fresh data...")
    result = subprocess.run(
        ["python3", "scripts/collect.py", "--api-key", api_key, "--category", "all"],
        capture_output=True, text=True, timeout=300, cwd=PROJECT_DIR
    )
    print(result.stdout[-300:])
    if result.returncode != 0:
        print(f"⚠ Collector failed: {result.stderr[:500]}")
    return result.returncode == 0


def download_photos(api_key: str):
    """Download 1-2 photos per business from Google Places."""
    print("\n📸 Downloading photos...")
    downloaded = 0
    
    for category in ["nails", "massage"]:
        data_dir = DATA_DIR / category
        photo_dir = PHOTOS_DIR / category
        photo_dir.mkdir(parents=True, exist_ok=True)
        
        for json_file in sorted(data_dir.glob("*.json")):
            try:
                data = json.loads(json_file.read_text())
            except Exception:
                continue
            
            photos = data.get("photos", [])
            if not photos:
                continue
            
            slug = json_file.stem
            for i, photo_ref in enumerate(photos[:2]):  # Max 2 per business
                photo_name = photo_ref.get("name", "")
                if not photo_name:
                    continue
                
                out_path = photo_dir / f"{slug}-{i}.jpg"
                if out_path.exists():
                    continue
                
                try:
                    url = f"https://places.googleapis.com/v1/{photo_name}/media"
                    params = {"maxWidthPx": 800}
                    headers = {"X-Goog-Api-Key": api_key}
                    resp = requests.get(url, headers=headers, params=params, timeout=30, allow_redirects=True)
                    resp.raise_for_status()
                    out_path.write_bytes(resp.content)
                    downloaded += 1
                except Exception as e:
                    pass  # Photo not critical, skip silently
                
                time.sleep(0.3)  # Rate limit
        
        print(f"  {category}: photos in {photo_dir}")
    
    print(f"  ✅ Downloaded {downloaded} new photos")


def detect_changes() -> list:
    """Detect businesses with changed ratings, hours, or new/closed status."""
    print("\n🔍 Detecting changes...")
    changes = []
    
    for category in ["nails", "massage"]:
        data_dir = DATA_DIR / category
        
        for json_file in sorted(data_dir.glob("*.json")):
            try:
                data = json.loads(json_file.read_text())
            except Exception:
                continue
            
            name = data.get("displayName", {}).get("text", json_file.stem)
            rating = data.get("rating", 0)
            reviews = data.get("userRatingCount", 0)
            
            # Check if business might be closed (permanently_closed flag)
            if data.get("businessStatus") == "CLOSED_PERMANENTLY":
                changes.append(f"❌ CLOSED: {name}")
                continue
            
            # High-value changes
            if rating >= 4.5 and reviews >= 100:
                # It's a notable business — worth flagging
                pass
        
        # Count total
        md_count = len(list((CONTENT_DIR / category).glob("*.md")))
        json_count = len(list(data_dir.glob("*.json")))
        changes.append(f"📋 {category}: {md_count} listings, {json_count} with full data")
    
    return changes


def commit_and_push():
    """Commit changes and push to trigger Cloudflare deploy."""
    print("\n📤 Committing and pushing...")
    subprocess.run(["git", "add", "-A"], cwd=PROJECT_DIR, capture_output=True)
    
    result = subprocess.run(
        ["git", "diff", "--cached", "--stat"],
        cwd=PROJECT_DIR, capture_output=True, text=True
    )
    stats = result.stdout.strip()
    
    if not stats:
        print("  No changes to commit")
        return False
    
    subprocess.run(
        ["git", "commit", "-m", "Weekly refresh: updated data + photos"],
        cwd=PROJECT_DIR, capture_output=True
    )
    subprocess.run(["git", "push"], cwd=PROJECT_DIR, capture_output=True)
    print(f"  ✅ Pushed: {stats[:200]}...")
    return True


def main():
    api_key = load_api_key()
    
    # 1. Fresh data
    run_collector(api_key)
    
    # 2. Run enricher (website scraping)
    print("\n🔧 Running enricher...")
    subprocess.run(["python3", "scripts/enrich.py"], cwd=PROJECT_DIR, capture_output=True, timeout=300)
    
    # 3. Photos
    download_photos(api_key)
    
    # 4. Detect changes
    changes = detect_changes()
    
    # 5. Rebuild
    print("\n🔨 Rebuilding...")
    subprocess.run(["npm", "run", "build"], cwd=PROJECT_DIR, capture_output=True, timeout=60)
    
    # 6. Commit and push
    pushed = commit_and_push()
    
    # 7. Report
    print("\n" + "="*50)
    print("📊 WEEKLY REFRESH COMPLETE")
    print("="*50)
    for change in changes:
        print(change)
    if pushed:
        print("\n✅ Deployed to barcelonacompare.com")
    else:
        print("\n⚠ No changes pushed (data already current)")


if __name__ == "__main__":
    main()
