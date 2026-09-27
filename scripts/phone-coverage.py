#!/usr/bin/env python3
"""Report stored phone coverage without network access or API credentials."""
from pathlib import Path
import re

EMPTY = {'', '""', "''", 'null', '~'}
PHONE_LINE = re.compile(r'^phone:\s*(.*)$', re.MULTILINE)


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


if __name__ == '__main__':
    rows = [count('nails'), count('massage')]
    total = sum(row[0] for row in rows)
    phone = sum(row[1] for row in rows)
    report('nails', *rows[0])
    report('massage', *rows[1])
    report('all', total, phone)
    print('source=committed markdown frontmatter; validity and freshness are not measured')
