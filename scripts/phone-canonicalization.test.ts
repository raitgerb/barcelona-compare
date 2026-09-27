import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeSpanishPhone,
  PHONE_CANONICALIZATION_VERSION,
} from '../src/lib/phone.ts';

test('canonicalizes valid Spanish national numbers and formatting variants', () => {
  const cases: Array<[unknown, 'ES', string | null]> = [
    ['612 345 678', 'ES', '+34612345678'],
    ['(612) 345-678', 'ES', '+34612345678'],
    ['612.345.678', 'ES', '+34612345678'],
    ['+34 612 345 678', 'ES', '+34612345678'],
    ['+34 (612) 345-678', 'ES', '+34612345678'],
    ['934 567 890', 'ES', '+34934567890'],
    ['812 345 678', 'ES', '+34812345678'],
    ['712 345 678', 'ES', '+34712345678'],
  ];

  for (const [input, country, expected] of cases) {
    assert.equal(canonicalizeSpanishPhone(input, country), expected, String(input));
  }
});

test('fails closed for malformed, ambiguous, and other-country values', () => {
  const invalid: Array<[unknown, 'ES' | 'FR']> = [
    ['', 'ES'],
    ['612 345 67', 'ES'],
    ['612 345 6789', 'ES'],
    ['512 345 678', 'ES'],
    ['+34 512 345 678', 'ES'],
    ['0034 612 345 678', 'ES'],
    ['+33 612 345 678', 'ES'],
    ['+34 612 345 678 ext 2', 'ES'],
    ['612/345/678', 'ES'],
    ['612 345 678', 'FR'],
    [null, 'ES'],
    [612345678, 'ES'],
  ];

  for (const [input, country] of invalid) {
    assert.equal(canonicalizeSpanishPhone(input, country), null, String(input));
  }
});

test('is deterministic and exposes an explicit algorithm version', () => {
  assert.equal(PHONE_CANONICALIZATION_VERSION, 'es-e164-v1');
  const input = '+34 (612) 345-678';
  assert.equal(
    canonicalizeSpanishPhone(input, 'ES'),
    canonicalizeSpanishPhone(input, 'ES'),
  );
});
