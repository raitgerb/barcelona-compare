#!/usr/bin/env python3
"""Generate placeholder listing data for Barcelona Compare local preview.

Creates 30 nail salon and 30 massage entries with realistic but fake data
so the site can be browsed locally before real data collection.
"""

import random
import re
from pathlib import Path

CONTENT_DIR = Path(__file__).parent.parent / "src" / "content"

# ─── Realistic data pools ─────────────────────────────────────────────────

NAIL_SALON_NAMES = [
    "Nail Art Barcelona", "The Nail Bar Gracia", "Manicura Express BCN",
    "Pink Nails Barcelona", "Gel & Go Eixample", "Luxury Nails BCN",
    "Born Nail Studio", "Uñas Perfectas", "Barcelona Nail Lounge",
    "The Nail Room", "Manicura by Laura", "Nail District Barcelona",
    "City Nails BCN", "Gloss Nail Studio", "Beauty Nails Barcelona",
    "Esmalte Studio", "Divine Nails BCN", "Nail & Beauty Lab",
    "Sants Nail Bar", "Vogue Nails Barcelona", "Diamond Nails BCN",
    "The Manicure Place", "French Kiss Nails", "Nail Therapy Barcelona",
    "Raval Nail Studio", "Gracia Nail Atelier", "Barceloneta Nails",
    "Zen Nails BCN", "Star Nails Barcelona", "Coral Nail Boutique",
    "Uñas de Arte BCN", "Nail Garden Barcelona", "The Polish Bar",
    "Manos Perfectas", "Nova Nail Studio",
]

MASSAGE_NAMES = [
    "Thai Zen Massage", "Barcelona Massage Center", "Spa Eixample",
    "Deep Relief Massage", "Masajes Barcelona Center", "Urban Spa BCN",
    "Thai Paradise Massage", "Body & Soul Massage", "The Massage Room BCN",
    "Zen Garden Spa", "Barcelona Wellness Center", "Shiatsu Barcelona",
    "Masajes Gracia", "The Healing Hands", "Spa & Massage BCN",
    "Oriental Massage Barcelona", "Pure Relax Massage", "Balance Spa BCN",
    "Massage Therapy Barcelona", "Harmony Wellness", "El Oasis Masajes",
    "Raval Massage Studio", "BCN Deep Tissue", "Lotus Spa Barcelona",
    "Siam Thai Massage", "Sports Massage BCN", "Aromatherapy Barcelona",
    "Born Wellness Center", "Calma Spa Barcelona", "The Massage Loft",
    "Masajes del Borne", "Thai Touch Barcelona", "Vitality Spa BCN",
    "Relax & Restore", "Serenity Massage BCN",
]

NEIGHBORHOODS = [
    "Eixample", "Gràcia", "Ciutat Vella", "Sants-Montjuïc", "Sant Martí",
    "Sarrià-Sant Gervasi", "Les Corts", "Horta-Guinardó", "Nou Barris", "Sant Andreu",
]

STREETS = {
    "Eixample": ["Carrer de Balmes", "Carrer de Pau Claris", "Carrer de València", "Gran Via de les Corts Catalanes", "Passeig de Gràcia"],
    "Gràcia": ["Carrer de Verdi", "Carrer Gran de Gràcia", "Carrer de Torrent de l'Olla", "Travessera de Gràcia", "Carrer de la Llibertat"],
    "Ciutat Vella": ["Carrer dels Escudellers", "Carrer de la Princesa", "Via Laietana", "Carrer del Rec", "Carrer de l'Argenteria"],
    "Sants-Montjuïc": ["Carrer de Sants", "Carrer de la Creu Coberta", "Carrer de Numància", "Gran Via de Carles III", "Passeig de la Zona Franca"],
    "Sant Martí": ["Rambla del Poblenou", "Carrer de Pallars", "Carrer de Pere IV", "Avinguda Diagonal", "Carrer de Llacuna"],
    "Sarrià-Sant Gervasi": ["Carrer Major de Sarrià", "Via Augusta", "Carrer de Muntaner", "Passeig de la Bonanova", "Carrer de Calvet"],
    "Les Corts": ["Carrer de Numància", "Avinguda Diagonal", "Carrer de Deu i Mata", "Carrer de Joan Güell", "Carrer de Sabino Arana"],
    "Horta-Guinardó": ["Carrer d'Horta", "Passeig Maragall", "Carrer de Lisboa", "Carrer de Tenerife", "Carrer de la Murtra"],
    "Nou Barris": ["Passeig de Valldaura", "Via Júlia", "Carrer de Pi i Molist", "Avinguda Meridiana", "Carrer de Felip II"],
    "Sant Andreu": ["Carrer Gran de Sant Andreu", "Passeig de Torras i Bages", "Carrer de Sant Adrià", "Carrer del Segre", "Carrer de les Monges"],
}

NAIL_SERVICES_POOL = [
    ("Manicura clásica", "15-18€"),
    ("Manicura semipermanente", "22-28€"),
    ("Manicura gel", "25-35€"),
    ("Uñas acrílicas", "30-40€"),
    ("Uñas de porcelana", "35-45€"),
    ("Nail art / Diseño", "5-15€"),
    ("Pedicura clásica", "18-25€"),
    ("Pedicura gel", "25-35€"),
    ("Pedicura spa", "28-38€"),
    ("Retirada y cambio", "10-15€"),
    ("Manicura francesa", "20-25€"),
    ("Refuerzo de uñas", "15-20€"),
]

MASSAGE_SERVICES_POOL = [
    ("Masaje relajante (60 min)", "45-55€"),
    ("Masaje descontracturante (60 min)", "50-60€"),
    ("Masaje tailandés (60 min)", "55-70€"),
    ("Masaje tailandés (90 min)", "75-90€"),
    ("Masaje deportivo (60 min)", "50-65€"),
    ("Masaje con piedras calientes (60 min)", "55-65€"),
    ("Masaje de tejido profundo (60 min)", "55-70€"),
    ("Masaje con aromaterapia (60 min)", "50-60€"),
    ("Reflexología podal (45 min)", "35-45€"),
    ("Masaje shiatsu (60 min)", "50-60€"),
    ("Masaje en pareja (60 min)", "90-120€"),
    ("Masaje prenatal (60 min)", "55-65€"),
]

MASSAGE_TYPE_POOL = [
    "swedish", "deep-tissue", "thai", "sports", "hot-stone",
    "prenatal", "aromatherapy", "reflexology", "shiatsu", "couples",
]

LANGUAGE_COMBOS = [
    ["Español"],
    ["Español", "English"],
    ["Español", "English", "Català"],
    ["Español", "Català"],
    ["Español", "English", "Português"],
    ["Español", "English", "Français", "Italiano"],
    ["Español", "English", "Thai"],
    ["Español", "English", "Russian"],
    ["Español", "English", "Català", "Français"],
]

HOURS_PATTERNS = [
    # Standard beauty hours
    {"monday": "10:00-20:00", "tuesday": "10:00-20:00", "wednesday": "10:00-20:00",
     "thursday": "10:00-20:00", "friday": "10:00-20:00", "saturday": "10:00-15:00"},
    # Extended hours
    {"monday": "09:00-21:00", "tuesday": "09:00-21:00", "wednesday": "09:00-21:00",
     "thursday": "09:00-21:00", "friday": "09:00-21:00", "saturday": "09:00-20:00",
     "sunday": "10:00-17:00"},
    # Later start
    {"monday": "11:00-20:00", "tuesday": "11:00-20:00", "wednesday": "11:00-20:00",
     "thursday": "11:00-20:00", "friday": "11:00-20:00", "saturday": "10:00-14:00"},
    # Closed Monday
    {"tuesday": "10:00-20:00", "wednesday": "10:00-20:00", "thursday": "10:00-20:00",
     "friday": "10:00-20:00", "saturday": "10:00-18:00", "sunday": "11:00-17:00"},
    # Short hours
    {"monday": "10:00-18:00", "tuesday": "10:00-18:00", "wednesday": "10:00-18:00",
     "thursday": "10:00-18:00", "friday": "10:00-18:00"},
]


def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    return slug[:80]


def generate_nail_listing(name: str, index: int) -> str:
    neighborhood = random.choice(NEIGHBORHOODS)
    street = random.choice(STREETS[neighborhood])
    number = random.randint(1, 300)
    address = f"{street} {number}, 080{random.randint(1, 40):02d} Barcelona"

    phone_prefix = random.choice(["931", "932", "933", "934", "935"])
    phone = f"+34 {phone_prefix} {random.randint(100, 999)} {random.randint(100, 999)}"

    has_whatsapp = random.random() < 0.7
    has_website = random.random() < 0.6

    price = random.choice(["€", "€€", "€€", "€€€"])

    num_services = random.randint(3, 6)
    services = random.sample(NAIL_SERVICES_POOL, num_services)

    has_hours = random.random() < 0.85
    hours = random.choice(HOURS_PATTERNS) if has_hours else {}

    languages = random.choice(LANGUAGE_COMBOS)

    rating = round(random.uniform(3.8, 5.0), 1)
    review_count = random.randint(15, 500)
    featured = rating >= 4.6 and review_count >= 100

    lines = ["---"]
    lines.append(f'name: "{name}"')
    lines.append(f'neighborhood: "{neighborhood}"')
    lines.append(f'address: "{address}"')
    lines.append(f'phone: "{phone}"')
    if has_whatsapp:
        lines.append(f'whatsapp: "{phone}"')
    if has_website:
        slug = slugify(name)
        lines.append(f'website: "https://www.{slug.replace("-", "")}.com"')
    lines.append(f'priceIndicator: "{price}"')
    lines.append("services:")
    for svc_name, svc_price in services:
        lines.append(f'  - name: "{svc_name}"')
        lines.append(f'    price: "{svc_price}"')
    if hours:
        lines.append("hours:")
        for day, time_range in sorted(hours.items()):
            lines.append(f'  {day}: "{time_range}"')
    lines.append("languages:")
    for lang in languages:
        lines.append(f'  - "{lang}"')
    lines.append(f"googleRating: {rating}")
    lines.append(f"googleReviewCount: {review_count}")
    if featured:
        lines.append("featured: true")
    lines.append("---")
    lines.append("")

    return "\n".join(lines)


def generate_massage_listing(name: str, index: int) -> str:
    neighborhood = random.choice(NEIGHBORHOODS)
    street = random.choice(STREETS[neighborhood])
    number = random.randint(1, 300)
    address = f"{street} {number}, 080{random.randint(1, 40):02d} Barcelona"

    phone_prefix = random.choice(["931", "932", "933", "934", "935"])
    phone = f"+34 {phone_prefix} {random.randint(100, 999)} {random.randint(100, 999)}"

    has_whatsapp = random.random() < 0.8
    has_website = random.random() < 0.7

    price = random.choice(["€€", "€€", "€€€", "€€€"])

    num_services = random.randint(3, 6)
    services = random.sample(MASSAGE_SERVICES_POOL, num_services)

    num_types = random.randint(1, 4)
    massage_types = random.sample(MASSAGE_TYPE_POOL, num_types)

    has_hours = random.random() < 0.85
    hours = random.choice(HOURS_PATTERNS) if has_hours else {}

    languages = random.choice(LANGUAGE_COMBOS)

    rating = round(random.uniform(3.8, 5.0), 1)
    review_count = random.randint(20, 600)
    featured = rating >= 4.6 and review_count >= 100

    lines = ["---"]
    lines.append(f'name: "{name}"')
    lines.append(f'neighborhood: "{neighborhood}"')
    lines.append(f'address: "{address}"')
    lines.append(f'phone: "{phone}"')
    if has_whatsapp:
        lines.append(f'whatsapp: "{phone}"')
    if has_website:
        slug = slugify(name)
        lines.append(f'website: "https://www.{slug.replace("-", "").replace(" ", "")}.com"')
    lines.append(f'priceIndicator: "{price}"')
    lines.append("massageTypes:")
    for mt in massage_types:
        lines.append(f'  - "{mt}"')
    lines.append("services:")
    for svc_name, svc_price in services:
        lines.append(f'  - name: "{svc_name}"')
        lines.append(f'    price: "{svc_price}"')
    if hours:
        lines.append("hours:")
        for day, time_range in sorted(hours.items()):
            lines.append(f'  {day}: "{time_range}"')
    lines.append("languages:")
    for lang in languages:
        lines.append(f'  - "{lang}"')
    lines.append(f"googleRating: {rating}")
    lines.append(f"googleReviewCount: {review_count}")
    if featured:
        lines.append("featured: true")
    lines.append("---")
    lines.append("")

    return "\n".join(lines)


def main():
    random.seed(42)  # Reproducible

    nails_dir = CONTENT_DIR / "nails"
    massage_dir = CONTENT_DIR / "massage"

    # Remove existing placeholder files
    for f in nails_dir.glob("*.md"):
        f.unlink()
    for f in massage_dir.glob("*.md"):
        f.unlink()

    # Generate nail salons
    for i, name in enumerate(NAIL_SALON_NAMES):
        slug = slugify(name)
        md = generate_nail_listing(name, i)
        (nails_dir / f"{slug}.md").write_text(md)

    # Generate massage places
    for i, name in enumerate(MASSAGE_NAMES):
        slug = slugify(name)
        md = generate_massage_listing(name, i)
        (massage_dir / f"{slug}.md").write_text(md)

    print(f"✅ Generated {len(NAIL_SALON_NAMES)} nail salon listings")
    print(f"✅ Generated {len(MASSAGE_NAMES)} massage listings")
    print(f"   Run 'npm run dev' and browse http://localhost:4321")


if __name__ == "__main__":
    main()
