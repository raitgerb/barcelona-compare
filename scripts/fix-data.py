#!/usr/bin/env python3
"""
Fix price indicators and neighborhoods in the content markdown files.
- Compute priceIndicator (€/€€/€€€) from scraped service prices
- Map "Barcelona" neighborhood to actual neighborhood from address
"""

from __future__ import annotations
import glob
import re
import os
import sys

PROJECT = "/Users/agrippa/projects/barcelona-compare"

# Barcelona neighborhood name patterns to look for in addresses
NEIGHBORHOOD_MAP = {
    "Ciutat Vella": ["Ciutat Vella", "El Raval", "El Gòtic", "La Barceloneta", "Sant Pere"],
    "Eixample": ["Eixample", "L'Eixample", "Dreta de l'Eixample", "Esquerra de l'Eixample", "Sant Antoni", "Sagrada Família", "Fort Pienc"],
    "Gràcia": ["Gràcia", "Vila de Gràcia", "Camp d'en Grassot", "La Salut", "Vallcarca"],
    "Sants-Montjuïc": ["Sants", "Sants-Montjuïc", "Montjuïc", "Hostafrancs", "La Bordeta", "Poble Sec"],
    "Les Corts": ["Les Corts", "Pedralbes", "La Maternitat"],
    "Sarrià-Sant Gervasi": ["Sarrià", "Sant Gervasi", "Sarrià-Sant Gervasi", "Tres Torres", "Bonanova"],
    "Horta-Guinardó": ["Horta", "Guinardó", "El Carmel", "La Teixonera"],
    "Nou Barris": ["Nou Barris", "Vilapicina", "Torre Llobeta"],
    "Sant Andreu": ["Sant Andreu", "La Sagrera", "Congrés"],
    "Sant Martí": ["Sant Martí", "Poblenou", "El Clot", "Diagonal Mar", "Vila Olímpica"],
}


def extract_neighborhood_from_address(address: str) -> str | None:
    """Try to extract a neighborhood name from the street address."""
    if not address:
        return None
    for hood, patterns in NEIGHBORHOOD_MAP.items():
        for pattern in patterns:
            if pattern.lower() in address.lower():
                return hood
    return None


def compute_price_indicator(prices: list[float]) -> str:
    """Compute €/€€/€€€ from a list of numeric prices."""
    if not prices:
        return None
    avg = sum(prices) / len(prices)
    if avg < 25:
        return "€"
    elif avg < 50:
        return "€€"
    else:
        return "€€€"


def process_file(filepath: str, category: str) -> bool:
    """Process a single markdown file. Returns True if changed."""
    with open(filepath, "r") as f:
        content = f.read()

    original = content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return False

    fm = parts[1]
    body = parts[2]

    # Extract current values
    name_match = re.search(r"name:\s*(.+)", fm)
    pi_match = re.search(r"priceIndicator:\s*(.+)", fm)
    hood_match = re.search(r"neighborhood:\s*(.+)", fm)
    addr_match = re.search(r"address:\s*(.+)", fm)

    name = name_match.group(1).strip().strip('"').strip("'") if name_match else "?"
    current_price = pi_match.group(1).strip().strip('"').strip("'") if pi_match else None
    current_hood = hood_match.group(1).strip().strip('"').strip("'") if hood_match else None
    address = addr_match.group(1).strip().strip('"').strip("'") if addr_match else None

    # Extract service prices
    prices = []
    service_matches = re.findall(
        r"-\s+name:\s*(.+?)\n\s+price:\s*(.+?)(?:\n|$)", fm
    )
    for _sname, price_str in service_matches:
        price_match = re.search(r"(\d+[.,]?\d*)", price_str)
        if price_match:
            try:
                prices.append(float(price_match.group(1).replace(",", ".")))
            except ValueError:
                pass

    # --- Fix price indicator ---
    new_price = current_price
    if not current_price and prices:
        new_price = compute_price_indicator(prices)
    elif not current_price:
        # Try Google Places price_level from JSON data
        slug = os.path.splitext(os.path.basename(filepath))[0]
        json_path = os.path.join(PROJECT, "data", category, f"{slug}.json")
        if os.path.exists(json_path):
            try:
                import json
                with open(json_path) as jf:
                    jdata = json.load(jf)
                price_level = jdata.get("priceLevel")
                if price_level:
                    mapping = {
                        "PRICE_LEVEL_INEXPENSIVE": "€",
                        "PRICE_LEVEL_MODERATE": "€€",
                        "PRICE_LEVEL_EXPENSIVE": "€€€",
                        "PRICE_LEVEL_VERY_EXPENSIVE": "€€€",
                    }
                    new_price = mapping.get(price_level)
            except Exception:
                pass

    # --- Fix neighborhood ---
    new_hood = current_hood
    if current_hood == "Barcelona" and address:
        extracted = extract_neighborhood_from_address(address)
        if extracted:
            new_hood = extracted

    # Apply changes
    changed = False
    new_fm = fm

    if new_price and new_price != current_price:
        if current_price:
            new_fm = re.sub(
                r"priceIndicator:\s*.+",
                f'priceIndicator: "{new_price}"',
                new_fm,
            )
        else:
            # Insert after neighborhood line (or address line)
            if hood_match:
                hood_line = hood_match.group(0)
                new_fm = new_fm.replace(
                    hood_line, f"{hood_line}\npriceIndicator: \"{new_price}\""
                )
            elif addr_match:
                addr_line = addr_match.group(0)
                new_fm = new_fm.replace(
                    addr_line, f"{addr_line}\npriceIndicator: \"{new_price}\""
                )
            else:
                # Insert after name line
                name_line = name_match.group(0)
                new_fm = new_fm.replace(
                    name_line, f"{name_line}\npriceIndicator: \"{new_price}\""
                )
        changed = True
        print(f"  ✓ priceIndicator: {current_price or 'MISSING'} → {new_price}")

    if new_hood and new_hood != current_hood:
        new_fm = new_fm.replace(
            f'neighborhood: "{current_hood}"',
            f'neighborhood: "{new_hood}"',
        )
        changed = True
        print(f"  ✓ neighborhood: {current_hood} → {new_hood}")

    if changed:
        new_content = f"---{new_fm}---{body}"
        with open(filepath, "w") as f:
            f.write(new_content)
        return True
    return False


def main():
    for category in ["nails", "massage"]:
        dir_path = os.path.join(PROJECT, "src", "content", category)
        files = sorted(glob.glob(os.path.join(dir_path, "*.md")))
        changed = 0
        print(f"\n{'='*60}")
        print(f"Processing {category} ({len(files)} files)")
        print("=" * 60)
        for fpath in files:
            basename = os.path.basename(fpath)
            if process_file(fpath, category):
                changed += 1
        print(f"\n→ {changed}/{len(files)} files updated")

    # Print summary stats
    print("\n" + "=" * 60)
    print("SUMMARY AFTER FIXES")
    print("=" * 60)
    for category in ["nails", "massage"]:
        dir_path = os.path.join(PROJECT, "src", "content", category)
        prices = {}
        hoods = {}
        for fpath in sorted(glob.glob(os.path.join(dir_path, "*.md"))):
            with open(fpath) as f:
                content = f.read()
            pi = re.search(r"priceIndicator:\s*\"?([^\"\n]+)\"?", content)
            hood = re.search(r"neighborhood:\s*\"?([^\"\n]+)\"?", content)
            p = pi.group(1).strip() if pi else "MISSING"
            h = hood.group(1).strip() if hood else "MISSING"
            prices[p] = prices.get(p, 0) + 1
            hoods[h] = hoods.get(h, 0) + 1
        print(f"\n{category.upper()} — Price indicators:")
        for k, v in sorted(prices.items()):
            print(f"  {k}: {v}")
        print(f"{category.upper()} — Neighborhoods:")
        for k, v in sorted(hoods.items(), key=lambda x: -x[1]):
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
