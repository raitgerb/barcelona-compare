#!/usr/bin/env python3
"""Zero-network regression tests for the eligibility control."""
import importlib.util, json, subprocess, tempfile, unittest
from pathlib import Path
SPEC = importlib.util.spec_from_file_location('eligibility', Path(__file__).with_name('phone-eligibility.py'))
mod = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(mod)

def row(category, slug, phone, place='place'):
    return {'category': category, 'slug': slug, 'place_id': place, '_has_phone': bool(phone), '_canonical': mod.canonicalize(phone) if phone else None}

class EligibilityTests(unittest.TestCase):
    def test_each_disposition_and_same_cross_multi_collisions(self):
        shared = '+34 612 345 678'
        rows = [row('nails','unique','613 345 678','u'), row('nails','missing','', 'm'),
                row('nails','invalid','512 345 678','i'), row('nails','same-a',shared,'a'),
                row('nails','same-b',shared,'b'), row('massage','cross',shared,'c'),
                row('massage','multi-a','614 345 678','d'), row('massage','multi-b','614 345 678','e'),
                row('massage','multi-c','614 345 678','f')]
        manifest = mod.build_manifest(rows)
        self.assertEqual(manifest['counts'], {'eligible_unique_canonical': 1, 'ineligible_missing': 1, 'ineligible_invalid': 1, 'ineligible_shared_or_collision': 6})
        self.assertEqual(len({e['collision_group'] for e in manifest['entries'] if 'collision_group' in e}), 2)
        self.assertTrue(all('disposition' in e for e in manifest['entries']))

    def test_fail_closed_canonicalization(self):
        for value in ('612/345/678', '0034 612 345 678', '+33 612 345 678', '612 345 67', '512 345 678'):
            self.assertIsNone(mod.canonicalize(value))

    def test_manifest_complete_and_contains_no_phone_values(self):
        manifest = mod.build_manifest(mod.load_rows())
        self.assertEqual(manifest['total_listings'], 1500)
        self.assertEqual(sum(manifest['counts'].values()), 1500)
        rendered = json.dumps(manifest, ensure_ascii=False)
        self.assertNotRegex(rendered, r'\\+34\\s*\\d')
        self.assertTrue(all(set(e) <= {'category','slug','place_id','disposition','collision_group'} for e in manifest['entries']))

    def test_generated_artifact_is_byte_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / 'a.json', Path(directory) / 'b.json'
            subprocess.run(['python3', 'scripts/phone-eligibility.py', '--output', str(a)], check=True, capture_output=True, text=True)
            subprocess.run(['python3', 'scripts/phone-eligibility.py', '--output', str(b)], check=True, capture_output=True, text=True)
            self.assertEqual(a.read_bytes(), b.read_bytes())

if __name__ == '__main__': unittest.main()
