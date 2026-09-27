#!/usr/bin/env python3
"""Report stored phone coverage without network access or API credentials."""
from __future__ import annotations

from pathlib import Path
import ast
import re
from collections import defaultdict

EMPTY = {'', '""', "''", 'null', '~'}
PHONE_LINE = re.compile(r'^phone:\s*(.*)$', re.MULTILINE)
FIELD_LINE = re.compile(r'^(name|slug|googlePlaceId):\s*(.*)$', re.MULTILINE)
FORMATTING_ONLY = re.compile(r'^[\d\s().+-]+$')
SPANISH_NATIONAL_NUMBER = re.compile(r'^[6789]\d{8}$')


def value(raw: str) -> str:
    raw = raw.strip()
    if raw in EMPTY:
        return ''
    try:
        parsed = ast.literal_eval(raw)
    except (SyntaxError, ValueError):
        parsed = raw
    return parsed if isinstance(parsed, str) else ''


def canonicalize(value_: str) -> str | None:
    """Keep this report's implementation equivalent to src/lib/phone.ts."""
    input_ = value_.strip()
    if not input_ or not FORMATTING_ONLY.fullmatch(input_):
        return None
    international = input_.startswith('+')
    digits = re.sub(r'[\s().-]', '', input_)
    if not re.fullmatch(r'\+?\d+', digits):
        return None
    if international:
        if not digits.startswith('+34'):
            return None
        national = digits[3:]
        return f'+34{national}' if SPANISH_NATIONAL_NUMBER.fullmatch(national) else None
    if digits.startswith('+') or not SPANISH_NATIONAL_NUMBER.fullmatch(digits):
        return None
    return f'+34{digits}'


def listing(path: Path, category: str) -> dict[str, str | None]:
    text = path.read_text(encoding='utf-8')
    fields = {key: value(raw) for key, raw in FIELD_LINE.findall(text)}
    phone_match = PHONE_LINE.search(text)
    phone = value(phone_match.group(1)) if phone_match else ''
    return {
        'category': category,
        'slug': fields.get('slug') or path.stem,
        'name': fields.get('name') or path.stem,
        'place_id': fields.get('googlePlaceId') or None,
        'phone': phone,
        'canonical': canonicalize(phone) if phone else None,
    }


def listings() -> list[dict[str, str | None]]:
    rows = []
    for category in ('nails', 'massage'):
        rows.extend(listing(path, category) for path in sorted((Path('src/content') / category).glob('*.md')))
    return rows


def plausible_shared_contact(group: list[dict[str, str | None]]) -> bool:
    if len({row['category'] for row in group}) > 1:
        return False
    token_sets = []
    for row in group:
        tokens = set(re.findall(r'[a-z0-9]+', str(row['name']).casefold()))
        token_sets.append(tokens - {'barcelona', 'bcn', 'nails', 'massage', 'spa', 'beauty', 'salon'})
    return any(len(token_sets[0] & tokens) >= 2 for tokens in token_sets[1:])


def collision_groups(rows: list[dict[str, str | None]]) -> dict[str, list[dict[str, str | None]]]:
    groups = defaultdict(list)
    for row in rows:
        if row['canonical']:
            groups[row['canonical']].append(row)
    return {number: group for number, group in groups.items() if len(group) > 1}


def collision_disposition(group: list[dict[str, str | None]]) -> str:
    if plausible_shared_contact(group):
        return 'plausible shared/chain/contact'
    return 'data-quality conflict: manual review'


def count(category: str) -> tuple[int, int]:
    paths = sorted((Path('src/content') / category).glob('*.md'))
    present = 0
    for path in paths:
        match = PHONE_LINE.search(path.read_text(encoding='utf-8'))
        if match and match.group(1).strip() not in EMPTY:
            present += 1
    return len(paths), present


def report(category: str, total: int, phone: int) -> None:
    missing = total - phone
    percentage = phone / total * 100 if total else 0
    print(f'{category}: total={total} phone={phone} missing={missing} coverage={percentage:.2f}%')


def quality_report(rows: list[dict[str, str | None]]) -> None:
    print('quality:')
    for category in ('nails', 'massage', 'all'):
        selected = rows if category == 'all' else [row for row in rows if row['category'] == category]
        non_empty = sum(bool(row['phone']) for row in selected)
        canonical = sum(bool(row['canonical']) for row in selected)
        invalid = sum(bool(row['phone']) and not row['canonical'] for row in selected)
        missing = len(selected) - non_empty
        print(f'{category}: total={len(selected)} non_empty={non_empty} canonicalizable={canonical} invalid_or_ambiguous={invalid} missing={missing}')

    collisions = collision_groups(rows)
    print(f'collisions: groups={len(collisions)} listings={sum(len(group) for group in collisions.values())}')
    for number, group in sorted(collisions.items()):
        del number  # Never print raw phone values in command output.
        places = ', '.join(str(row['place_id'] or 'missing-place-id') for row in group)
        slugs = ', '.join(str(row['slug']) for row in group)
        categories = ', '.join(str(row['category']) for row in group)
        disposition = collision_disposition(group)
        print(f'collision: place_ids=[{places}] slugs=[{slugs}] categories=[{categories}] disposition={disposition}')


if __name__ == '__main__':
    rows = [count('nails'), count('massage')]
    total = sum(row[0] for row in rows)
    phone = sum(row[1] for row in rows)
    report('nails', *rows[0])
    report('massage', *rows[1])
    report('all', total, phone)
    quality_report(listings())
    print('source=committed markdown frontmatter; reachability, ownership, and freshness are not measured')
