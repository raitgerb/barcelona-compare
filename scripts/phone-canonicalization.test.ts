import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeSpanishPhone, PHONE_CANONICALIZATION_VERSION } from '../src/lib/phone.ts';

test('canonicalizes valid ES formats', () => {
  assert.equal(canonicalizeSpanishPhone('612 345 678', 'ES'), '+34612345678');
  assert.equal(canonicalizeSpanishPhone('+34 (612) 345-678', 'ES'), '+34612345678');
  assert.equal(canonicalizeSpanishPhone('934 567 890', 'ES'), '+34934567890');
});

test('rejects missing, ambiguous, malformed, and other-country values', () => {
  for (const value of ['', '612/345/678', '612 345 67', '512 345 678', '0034 612 345 678', '+33 612 345 678']) {
    assert.equal(canonicalizeSpanishPhone(value, 'ES'), null, value);
  }
  assert.equal(canonicalizeSpanishPhone('612 345 678', 'FR'), null);
  assert.equal(canonicalizeSpanishPhone(612345678, 'ES'), null);
});

test('algorithm is explicitly versioned', () => assert.equal(PHONE_CANONICALIZATION_VERSION, 'es-e164-v1'));
