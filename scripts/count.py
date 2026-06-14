import json, requests, time
from pathlib import Path

with open('.env') as f:
    api_key = f.read().strip().split('=',1)[1]

headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': api_key,
    'X-Goog-FieldMask': 'places.displayName,places.id'
}
url = 'https://places.googleapis.com/v1/places:searchText'

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
    
    # Load our IDs
    our_ids = set()
    for jf in Path(f'data/{category}').glob('*.json'):
        d = json.loads(jf.read_text())
        our_ids.add(d.get('id', ''))
    
    api_ids = {p.get('id', '') for p in results}
    overlap = our_ids & api_ids
    
    print(f'{category}:')
    print(f'  API returns: {len(results)} results (across {page+1} pages)')
    print(f'  We have: {len(our_ids)} collected')
    print(f'  Overlap: {len(overlap)} are in both')
    print(f'  We have but not in this search: {len(our_ids - api_ids)}')
    print(f'  In API but we don\'t have: {len(api_ids - our_ids)}')
    print()
