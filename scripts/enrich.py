#!/usr/bin/env python3
"""Enrich Barcelona Compare listings with full Google Places data + website scraping.

For each existing listing:
1. Fetch full Place Details JSON → saves to data/{category}/{slug}.json
2. Scrape business website → extract services, prices, languages
3. Update the markdown file with enriched data

Usage:
    python scripts/enrich.py
    (reads API key from .env file)
"""

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
import yaml  # for reading frontmatter

PROJECT_DIR = Path(__file__).parent.parent
CONTENT_DIR = PROJECT_DIR / "src" / "content"
DATA_DIR = PROJECT_DIR / "data"


def load_api_key() -> str:
    env_file = PROJECT_DIR / ".env"
    with open(env_file) as f:
        for line in f:
            if line.startswith("GOOGLE_PLACES_API_KEY="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("GOOGLE_PLACES_API_KEY not found in .env")


def places_details(api_key: str, place_id: str) -> dict:
    """Full Place Details call — all available fields."""
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "*",  # ALL fields
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


def read_markdown_frontmatter(filepath: Path) -> dict:
    """Parse YAML frontmatter from a markdown file using regex for robustness."""
    content = filepath.read_text()
    if not content.startswith("---"):
        return {}
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}
    
    # Try PyYAML first
    try:
        return yaml.safe_load(parts[1]) or {}
    except Exception:
        pass
    
    # Fallback: regex-based parser for simple key: value frontmatter
    result = {}
    current_key = None
    current_list = None
    
    for line in parts[1].split("\n"):
        # Skip empty lines and comments
        if not line.strip() or line.strip().startswith("#"):
            continue
        
        # List item
        if line.startswith("  - "):
            value = line.strip()[4:]
            # Remove quotes
            value = value.strip('"').strip("'")
            if current_list is not None:
                current_list.append(value)
            continue
        
        # Nested dict item (e.g., "  - name: ...")
        if line.startswith("    ") and current_list is not None:
            stripped = line.strip()
            if ":" in stripped:
                k, v = stripped.split(":", 1)
                v = v.strip().strip('"').strip("'")
                # Add to the last dict in the list if it exists, otherwise create one
                if current_list and isinstance(current_list[-1], dict):
                    current_list[-1][k.strip()] = v
                else:
                    current_list.append({k.strip(): v})
            continue
        
        # Key: value or Key: (starts a list/dict)
        current_list = None
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            
            if not value:
                # Start of a list or dict
                current_list = []
                result[key] = current_list
            else:
                # Simple scalar
                value = value.strip('"').strip("'")
                # Try numeric
                try:
                    if "." in value:
                        result[key] = float(value)
                    else:
                        result[key] = int(value)
                except ValueError:
                    if value.lower() == "true":
                        result[key] = True
                    elif value.lower() == "false":
                        result[key] = False
                    else:
                        result[key] = value
    
    return result


def write_markdown(filepath: Path, frontmatter: dict):
    """Write a markdown file with YAML frontmatter."""
    lines = ["---"]
    for key, value in frontmatter.items():
        if isinstance(value, list):
            lines.append(f"{key}:")
            for item in value:
                if isinstance(item, dict):
                    lines.append(f"  - name: \"{item['name']}\"")
                    if item.get("price"):
                        lines.append(f"    price: \"{item['price']}\"")
                else:
                    lines.append(f'  - "{item}"')
        elif isinstance(value, dict):
            lines.append(f"{key}:")
            for k, v in sorted(value.items()):
                lines.append(f'  {k}: "{v}"')
        elif isinstance(value, bool):
            lines.append(f"{key}: {str(value).lower()}")
        elif isinstance(value, (int, float)):
            lines.append(f"{key}: {value}")
        elif value is not None:
            lines.append(f'{key}: "{value}"')
    lines.append("---")
    lines.append("")
    filepath.write_text("\n".join(lines))


def scrape_website(url: str) -> dict:
    """Scrape a business website for services, prices, and languages.
    
    Returns: {"services": [...], "languages": [...]}
    Services format: [{"name": "Manicura clásica", "price": "18€"}, ...]
    """
    result = {"services": [], "languages": []}
    
    try:
        resp = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) BarcelonaCompare/1.0"
        })
        resp.raise_for_status()
        text = resp.text.lower()
        visible_text = re.sub(r"<[^>]+>", " ", text)
        visible_text = re.sub(r"\s+", " ", visible_text)
    except Exception:
        return result

    # ── Language detection ──
    detected_langs = ["Español"]
    
    # Check for lang attributes and common patterns
    if "english" in visible_text or "english spoken" in visible_text or "we speak english" in visible_text:
        detected_langs.append("English")
    if "català" in visible_text or "catalan" in text or 'lang="ca"' in text or "català" in text:
        detected_langs.append("Català")
    if "français" in visible_text or "french" in visible_text or "frances" in visible_text:
        detected_langs.append("Français")
    if "italiano" in visible_text or "italian" in visible_text:
        detected_langs.append("Italiano")
    if "português" in visible_text or "portugues" in visible_text:
        detected_langs.append("Português")
    if "русский" in visible_text or "russian" in visible_text:
        detected_langs.append("Russian")
        
    result["languages"] = detected_langs

    # ── Service detection (nail salons) ──
    nail_patterns = [
        (r"manicur[aá]\s*(cl[aá]sica|tradicional|b[aá]sica)?", "Manicura clásica", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"manicur[aá]\s*semi\s*permanente|semi\s*permanente", "Manicura semipermanente", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"manicur[aá]\s*(?:de\s*)?gel|uñas\s*(?:de\s*)?gel", "Manicura gel", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"uñas\s*acr[ií]licas|acr[ií]licas", "Uñas acrílicas", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"pedicur[aá]\s*(cl[aá]sica|tradicional|b[aá]sica)?", "Pedicura clásica", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"pedicur[aá]\s*(?:de\s*)?gel", "Pedicura gel", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"nail\s*art|diseño\s*(?:de\s*)?uñas|decoraci[oó]n", "Nail art / Diseño", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"manicur[aá]\s*francesa|francesa", "Manicura francesa", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"retirad[ao]|cambio|remover", "Retirada y cambio", r"(\d+[\.,]?\d*\s*[€\$])"),
    ]
    
    # ── Service detection (massage) ──
    massage_patterns = [
        (r"masaje\s*relajante|relajante|relaxing\s*massage", "Masaje relajante", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"masaje\s*descontracturante|descontracturante|deep\s*tissue|tejido\s*profundo", "Masaje descontracturante", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"masaje\s*tailand[eé]s|tailand[eé]s|thai\s*massage", "Masaje tailandés", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"masaje\s*deportivo|sports?\s*massage", "Masaje deportivo", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"piedras\s*calientes|hot\s*stone", "Masaje con piedras calientes", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"aromaterapia|aromatherapy", "Aromaterapia", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"reflexolog[ií]a|reflexology", "Reflexología podal", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"shiatsu", "Masaje shiatsu", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"masaje\s*en\s*pareja|couples?\s*massage|pareja", "Masaje en pareja", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"masaje\s*prenatal|prenatal|pregnancy", "Masaje prenatal", r"(\d+[\.,]?\d*\s*[€\$])"),
        (r"masaje\s*balin[eé]s|balin[eé]s", "Masaje balinés", r"(\d+[\.,]?\d*\s*[€\$])"),
    ]

    # Try nail patterns first; if we find any, skip massage patterns
    found_services = set()
    
    for pattern, name, price_pattern in nail_patterns + massage_patterns:
        matches = re.finditer(pattern, visible_text, re.IGNORECASE)
        for match in matches:
            service_name = name
            if service_name in found_services:
                continue
            found_services.add(service_name)
            
            # Try to find a price near the match
            price = None
            context_start = max(0, match.start() - 200)
            context_end = min(len(visible_text), match.end() + 100)
            context = visible_text[context_start:context_end]
            price_match = re.search(r"(\d+[\.,]?\d*)\s*[€\$]", context)
            if price_match:
                price = f"{price_match.group(1)}€"
            
            result["services"].append({"name": service_name, "price": price} if price else {"name": service_name})

    # Deduplicate
    seen = set()
    unique_services = []
    for s in result["services"]:
        if s["name"] not in seen:
            seen.add(s["name"])
            unique_services.append(s)
    result["services"] = unique_services

    return result


def enrich_all():
    api_key = load_api_key()
    
    for category in ["nails", "massage"]:
        content_dir = CONTENT_DIR / category
        data_dir = DATA_DIR / category
        data_dir.mkdir(parents=True, exist_ok=True)
        
        md_files = sorted(content_dir.glob("*.md"))
        print(f"\n📊 Enriching {category} ({len(md_files)} businesses)...")
        
        enriched_count = 0
        for i, md_file in enumerate(md_files):
            fm = read_markdown_frontmatter(md_file)
            place_id = fm.get("googlePlaceId", "")
            slug = md_file.stem
            
            if not place_id:
                continue
            
            # Step 1: Fetch and save full Place Details JSON
            json_path = data_dir / f"{slug}.json"
            if not json_path.exists():
                try:
                    detail = places_details(api_key, place_id)
                    json_path.write_text(json.dumps(detail, indent=2, ensure_ascii=False))
                    time.sleep(0.3)  # Rate limit
                except Exception as e:
                    print(f"  ⚠ {slug}: Place Details failed — {e}")
                    continue
            else:
                detail = json.loads(json_path.read_text())

            # Also try to find place_id from API response if missing from frontmatter
            if not place_id:
                place_id = detail.get("id", "")
                if place_id:
                    fm["googlePlaceId"] = place_id
            
            # Step 2: Scrape website if available
            website = fm.get("website", "")
            if website and (not fm.get("services") or len(fm.get("services", [])) == 0):
                print(f"  🌐 Scraping {slug}...")
                scraped = scrape_website(website)
                
                if scraped["services"]:
                    fm["services"] = scraped["services"]
                    enriched_count += 1
                    print(f"    → Found {len(scraped['services'])} services")
                
                if len(scraped.get("languages", [])) > 1:
                    fm["languages"] = scraped["languages"]
                    print(f"    → Languages: {scraped['languages']}")
                
                time.sleep(1)  # Be nice to websites
            
            # Step 3: Update markdown
            write_markdown(md_file, fm)
            
            if (i + 1) % 20 == 0:
                print(f"  {i + 1}/{len(md_files)} processed...")
        
        print(f"  ✅ {category}: {enriched_count} enriched with scraped data")
    
    print("\n🎉 Done! Run 'npm run build' to rebuild.")


if __name__ == "__main__":
    enrich_all()
