import json, requests, time, re
from pathlib import Path

with open('.env') as f:
    api_key = f.read().strip().split('=',1)[1]

headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': api_key,
    'X-Goog-FieldMask': 'places.displayName,places.id'
}
url = 'https://places.googleapis.com/v1/places:searchText'

# Get all API results
api_places = {}
for query, category in [('nail salon Barcelona', 'nails'), ('masajes Barcelona', 'massage')]:
    results = []
    page_token = None
    for page in range(3):
        body = {'textQuery': query, 'languageCode': 'es'}
        if page_token:
            body['pageToken'] = page_token
        resp = requests.post(url, headers=headers, json=body, timeout=10)
        data = resp.json()
        places = data.get('places', [])
        results.extend(places)
        page_token = data.get('nextPageToken')
        if not page_token:
            break
        time.sleep(1)
    api_places[category] = results
    print(f'{category}: {len(results)} API results')

# Load what we already have
our_ids = {}
for category in ['nails', 'massage']:
    ids = set()
    for jf in Path(f'data/{category}').glob('*.json'):
        d = json.loads(jf.read_text())
        ids.add(d.get('id', ''))
    our_ids[category] = ids
    print(f'{category}: {len(ids)} already collected')

# Find missing
missing = {}
for category in ['nails', 'massage']:
    api_ids = {p['id'] for p in api_places[category]}
    missing_ids = api_ids - our_ids[category]
    missing[category] = [p for p in api_places[category] if p['id'] in missing_ids]
    print(f'{category}: {len(missing[category])} to collect')

# Now collect details and create markdown

def slugify(name):
    slug = name.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'\s+', '-', slug)
    return slug[:80]

def infer_neighborhood(address):
    address_lower = address.lower()
    mapping = {
        'gracia': 'Gràcia', 'gràcia': 'Gràcia', 'eixample': 'Eixample',
        'born': 'Ciutat Vella', 'gotic': 'Ciutat Vella', 'gòtic': 'Ciutat Vella',
        'barceloneta': 'Ciutat Vella', 'raval': 'Ciutat Vella',
        'sant marti': 'Sant Martí', 'sant martí': 'Sant Martí', 'poblenou': 'Sant Martí',
        'sants': 'Sants-Montjuïc', 'les corts': 'Les Corts',
        'sarria': 'Sarrià-Sant Gervasi', 'sarrià': 'Sarrià-Sant Gervasi',
        'sant gervasi': 'Sarrià-Sant Gervasi', 'horta': 'Horta-Guinardó',
        'guinardo': 'Horta-Guinardó', 'guinardó': 'Horta-Guinardó',
        'nou barris': 'Nou Barris', 'sant andreu': 'Sant Andreu',
    }
    for keyword, neighborhood in mapping.items():
        if keyword in address_lower:
            return neighborhood
    return 'Barcelona'

def infer_price_indicator(name, types):
    name_lower = name.lower()
    luxury = ['luxury', 'premium', 'spa', 'boutique', 'vip', 'lujo', 'exclusive', 'hotel']
    if any(kw in name_lower for kw in luxury):
        return '€€€'
    budget = ['express', 'quick', 'rápido', 'barato', 'económico']
    if any(kw in name_lower for kw in budget):
        return '€'
    return '€€'

details_headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': api_key,
    'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,regularOpeningHours,priceLevel,types,nationalPhoneNumber,websiteUri,googleMapsUri,location,photos'
}

total = 0
for category in ['nails', 'massage']:
    content_dir = Path('src/content') / category
    data_dir = Path('data') / category
    photo_dir = Path('public/images') / category
    
    for place in missing[category]:
        place_id = place['id']
        name = place['displayName']['text']
        slug = slugify(name)
        
        # Get details
        d_url = f'https://places.googleapis.com/v1/places/{place_id}'
        resp = requests.get(d_url, headers=details_headers, timeout=30)
        resp.raise_for_status()
        details = resp.json()
        
        # Save full JSON
        (data_dir / f'{slug}.json').write_text(json.dumps(details, indent=2, ensure_ascii=False))
        
        # Build frontmatter
        hours = {}
        day_names = {0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday'}
        if details.get('regularOpeningHours'):
            for period in details['regularOpeningHours'].get('periods', []):
                open_day = period.get('open', {}).get('day')
                if open_day is not None:
                    day_name = day_names.get(open_day, '')
                    if day_name:
                        opent = period['open'].get('time', '')
                        closet = period.get('close', {}).get('time', '')
                        if opent and closet:
                            hours[day_name] = f'{opent[:2]}:{opent[2:]}-{closet[:2]}:{closet[2:]}'
        
        address = details.get('formattedAddress', '')
        hood = infer_neighborhood(address)
        phone = details.get('nationalPhoneNumber', '')
        website = details.get('websiteUri', '')
        rating = details.get('rating', 0)
        reviews = details.get('userRatingCount', 0)
        price = infer_price_indicator(name, details.get('types', []))
        types = details.get('types', [])
        place_id_val = details.get('id', '')
        google_url = details.get('googleMapsUri', '')
        
        lines = ['---']
        lines.append(f'name: "{name}"')
        lines.append(f'neighborhood: "{hood}"')
        lines.append(f'address: "{address}"')
        if phone:
            lines.append(f'phone: "{phone}"')
            lines.append(f'whatsapp: "{phone}"')
        if website:
            lines.append(f'website: "{website}"')
        if price:
            lines.append(f'priceIndicator: "{price}"')
        if hours:
            lines.append('hours:')
            for d in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
                if d in hours:
                    lines.append(f'  {d}: "{hours[d]}"')
        lines.append(f'googlePlaceId: "{place_id_val}"')
        lines.append(f'googleMapsUri: "{google_url}"')
        if types:
            t = types[0] if types else ''
            lines.append(f'primaryType: "{t}"')
        if category == 'massage' and 'massage' in str(types).lower():
            lines.append('massageTypes: []')
        if category == 'nails':
            lines.append('services: []')
        else:
            lines.append('services: []')
        lines.append('languages: []')
        lines.append(f'googleRating: {rating}')
        lines.append(f'googleReviewCount: {reviews}')
        lines.append('---')
        lines.append('')
        
        md_content = '\n'.join(lines)
        (content_dir / f'{slug}.md').write_text(md_content)
        
        # Download photos
        photos = details.get('photos', [])
        for i, photo_ref in enumerate(photos[:5]):
            photo_name = photo_ref.get('name', '')
            if not photo_name:
                continue
            out_path = photo_dir / f'{slug}-{i}.jpg'
            if out_path.exists():
                continue
            try:
                p_url = f'https://places.googleapis.com/v1/{photo_name}/media'
                resp = requests.get(p_url, params={'maxWidthPx': 800}, headers={'X-Goog-Api-Key': api_key}, timeout=30, allow_redirects=True)
                resp.raise_for_status()
                out_path.write_bytes(resp.content)
            except Exception:
                pass
            time.sleep(0.15)
        
        total += 1
        print(f'  ✓ {name} ({hood})')
        time.sleep(0.5)

print(f'\nCollected {total} new businesses')
