#!/usr/bin/env python3
"""Zero-network regression tests for the phone coverage audit/report."""
from __future__ import annotations

import contextlib
import importlib.util
import io
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location('phone_coverage', Path(__file__).with_name('phone-coverage.py'))
assert SPEC and SPEC.loader
coverage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(coverage)


def number(*parts: str) -> str:
    """Keep test contacts assembled, rather than committing raw phone values."""
    return ''.join(parts)


def row(category: str, slug: str, place_id: str, canonical: str | None, name: str) -> dict[str, str | None]:
    return {
        'category': category,
        'slug': slug,
        'name': name,
        'place_id': place_id,
        'phone': canonical,
        'canonical': canonical,
    }


class PhoneCoverageRegressionTests(unittest.TestCase):
    def test_discovered_invalid_and_ambiguous_classes_fail_closed(self) -> None:
        # Mirrors the six stored-data classes found in the audit: missing,
        # malformed separators, wrong length, invalid prefix, unsupported
        # international country, and unsupported international notation.
        cases = (
            ('missing', ''),
            ('malformed separators', number('612', '/', '345', '/', '678')),
            ('wrong length', number('612', '345', '67')),
            ('invalid prefix', number('512', '345', '678')),
            ('wrong country', number('+33', ' 612', '345', '678')),
            ('unsupported international notation', number('0034', ' 612', '345', '678')),
        )
        for label, value in cases:
            with self.subTest(label=label):
                self.assertIsNone(coverage.canonicalize(value))

    def test_collision_groups_identify_listings_and_bound_dispositions(self) -> None:
        shared = number('+34', '612', '345', '678')
        rows = [
            row('nails', 'shared-a', 'place-a', shared, 'Shared Contact Nails'),
            row('nails', 'shared-b', 'place-b', shared, 'Shared Contact Spa Nails'),
            row('massage', 'cross-category', 'place-c', shared, 'Different Massage'),
            row('nails', 'unique', 'place-d', number('+34', '613', '345', '678'), 'Unique Nails'),
        ]
        collisions = coverage.collision_groups(rows)
        self.assertEqual(len(collisions), 1)
        group = next(iter(collisions.values()))
        self.assertEqual([item['slug'] for item in group], ['shared-a', 'shared-b', 'cross-category'])
        self.assertEqual(coverage.collision_disposition(group), 'data-quality conflict: manual review')
        self.assertEqual(coverage.collision_disposition(group[:2]), 'plausible shared/chain/contact')

    def test_report_suppresses_raw_contacts_but_keeps_identifiers(self) -> None:
        contact = number('+34', '614', '345', '678')
        rows = [
            row('nails', 'listed-a', 'place-a', contact, 'Listed Nails Barcelona'),
            row('nails', 'listed-b', 'place-b', contact, 'Listed Nails BCN'),
        ]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            coverage.quality_report(rows)
        rendered = output.getvalue()
        self.assertIn('listed-a', rendered)
        self.assertIn('place-b', rendered)
        self.assertIn('disposition=', rendered)
        self.assertNotIn(contact, rendered)


if __name__ == '__main__':
    unittest.main()