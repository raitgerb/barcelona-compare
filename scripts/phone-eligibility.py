#!/usr/bin/env python3
"""Build the versioned, zero-network phone self-service eligibility manifest."""
from __future__ import annotations
import argparse, ast, hashlib, json, re
from collections import defaultdict
from pathlib import Path

VERSION = 'phone-self-service-eligibility-v1'
AUDIT_HEAD = '8a0715863f44d31348b0d9d7e56fcce2841aa6f6'
PHONE_LINE = re.compile(r'^phone:\s*(.*)$', re.MULTILINE)
FIELD_LINE = re.compile(r'^(name|slug|googlePlaceId):\s*(.*)$', re.MULTILINE)
EMPTY = {'', '""', "''", 'null', '~'}
FORMATTING_ONLY = re.compile(r'^[\d\s().+-]+$')
NATIONAL = re.compile(r'^[6789]\d{8}$')
DISPOSITIONS = ('eligible_unique_canonical', 'ineligible_missing', 'ineligible_invalid', 'ineligible_shared_or_collision')

def scalar(raw):
    raw = raw.strip()
    if raw in EMPTY: return ''
    try: value = ast.literal_eval(raw)
    except (SyntaxError, ValueError): value = raw
    return value if isinstance(value, str) else ''

def canonicalize(value):
    value = value.strip()
    if not value or not FORMATTING_ONLY.fullmatch(value): return None
    international = value.startswith('+')
    digits = re.sub(r'[\s().-]', '', value)
    if not re.fullmatch(r'\+?\d+', digits): return None
    if international:
        if not digits.startswith('+34'): return None
        national = digits[3:]
        return f'+34{national}' if NATIONAL.fullmatch(national) else None
    return None if digits.startswith('+') or not NATIONAL.fullmatch(digits) else f'+34{digits}'

def load_rows(root=Path('.')):
    rows = []
    for category in ('nails', 'massage'):
        for path in sorted((root / 'src/content' / category).glob('*.md')):
            text = path.read_text(encoding='utf-8')
            fields = {key: scalar(raw) for key, raw in FIELD_LINE.findall(text)}
            match = PHONE_LINE.search(text)
            phone = scalar(match.group(1)) if match else ''
            rows.append({'category': category, 'slug': fields.get('slug') or path.stem,
                         'place_id': fields.get('googlePlaceId') or None,
                         '_canonical': canonicalize(phone) if phone else None,
                         '_has_phone': bool(phone)})
    return rows

def collision_groups(rows):
    grouped = defaultdict(list)
    for row in rows:
        if row['_canonical']: grouped[row['_canonical']].append(row)
    return {number: group for number, group in grouped.items() if len(group) > 1}

def build_manifest(rows):
    collisions = collision_groups(rows)
    collision_ids = {}
    for number, group in sorted(collisions.items()):
        members = sorted((row['category'], row['slug'], row['place_id'] or '') for row in group)
        collision_ids[number] = 'collision-' + hashlib.sha256(json.dumps(members, separators=(',', ':')).encode()).hexdigest()[:12]
    entries = []
    for row in sorted(rows, key=lambda item: (item['category'], item['slug'])):
        if not row['_has_phone']: disposition = 'ineligible_missing'
        elif not row['_canonical']: disposition = 'ineligible_invalid'
        elif row['_canonical'] in collisions: disposition = 'ineligible_shared_or_collision'
        else: disposition = 'eligible_unique_canonical'
        entry = {'category': row['category'], 'slug': row['slug'], 'place_id': row['place_id'], 'disposition': disposition}
        if row['_canonical'] in collision_ids: entry['collision_group'] = collision_ids[row['_canonical']]
        entries.append(entry)
    counts = {name: sum(entry['disposition'] == name for entry in entries) for name in DISPOSITIONS}
    return {'version': VERSION, 'canonicalization_version': 'es-e164-v1', 'audit_baseline': AUDIT_HEAD,
            'policy': {'eligible_only': 'eligible_unique_canonical', 'no_raw_phone_values': True,
                       'excluded': ['missing', 'invalid_or_ambiguous', 'shared_or_collision']},
            'counts': counts, 'total_listings': len(entries), 'entries': entries}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='data/phone-self-service-eligibility-v1.json')
    args = parser.parse_args()
    manifest = build_manifest(load_rows())
    if manifest['total_listings'] != 1500: raise SystemExit(f"expected 1500 listings, got {manifest['total_listings']}")
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'total_listings': manifest['total_listings'], 'counts': manifest['counts']}, sort_keys=True))

if __name__ == '__main__': main()
