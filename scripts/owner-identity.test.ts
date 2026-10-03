import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ELIGIBLE_DISPOSITION,
  ELIGIBILITY_VERSION,
  IdentityAdmissionError,
  admitPlace,
  canEdit,
  createContactSnapshot,
  createMembership,
  createScopedSession,
  legacyEmailMembership,
  recordVerificationEvent,
  revokeMembership,
  revokeSession,
} from '../functions/_lib/owner-identity.ts';

const manifest = {
  version: ELIGIBILITY_VERSION,
  policy: { eligible_only: ELIGIBLE_DISPOSITION, no_raw_phone_values: true },
  entries: [
    { category: 'nails', slug: 'eligible', place_id: 'ChIJeligible1', disposition: ELIGIBLE_DISPOSITION },
    { category: 'nails', slug: 'missing', place_id: 'ChIJmissing1', disposition: 'ineligible_missing' as const },
    { category: 'nails', slug: 'invalid', place_id: 'ChIJinvalid1', disposition: 'ineligible_invalid' as const },
    { category: 'nails', slug: 'shared', place_id: 'ChIJshared1', disposition: 'ineligible_shared_or_collision' as const },
  ],
};

function rejects(code: string, fn: () => unknown) {
  assert.throws(fn, (error) => error instanceof IdentityAdmissionError && error.code === code);
}

test('admission is Place-ID scoped and ignores slug/name', () => {
  assert.deepEqual(admitPlace(manifest, {
    placeId: 'ChIJeligible1', slug: 'wrong-slug', name: 'wrong name',
  }), {
    placeId: 'ChIJeligible1', eligibilityVersion: ELIGIBILITY_VERSION,
    disposition: ELIGIBLE_DISPOSITION, source: 'google_places',
  });
});

test('every ineligible disposition fails closed', () => {
  for (const placeId of ['ChIJmissing1', 'ChIJinvalid1', 'ChIJshared1']) rejects('ineligible', () => admitPlace(manifest, { placeId }));
  rejects('not_found', () => admitPlace(manifest, { placeId: 'ChIJnotlisted1' }));
  rejects('invalid_place_id', () => admitPlace(manifest, { placeId: 'slug-is-not-a-place-id' }));
});

test('manifest contract is version and policy gated', () => {
  rejects('manifest_version_mismatch', () => admitPlace({ ...manifest, version: 'old' }, { placeId: 'ChIJeligible1' }));
  rejects('manifest_policy_mismatch', () => admitPlace({ ...manifest, policy: { ...manifest.policy, no_raw_phone_values: false } }, { placeId: 'ChIJeligible1' }));
});

test('legacy email state never grants edit access', () => {
  const legacy = legacyEmailMembership('ChIJeligible1', 'u1', 'm1');
  assert.equal(legacy.state, 'legacy_unverified');
  assert.equal(canEdit(legacy, { state: 'active' }, {
    placeId: 'ChIJeligible1', scope: 'owner_edit', revokedAt: null,
    expiresAt: '2999-01-01T00:00:00.000Z',
  }, 'ChIJeligible1'), false);
});

test('verified sessions are scoped and revocable', () => {
  const session = { placeId: 'ChIJeligible1', scope: 'owner_edit' as const, revokedAt: null, expiresAt: '2999-01-01T00:00:00.000Z' };
  const verified = { state: 'verified' as const };
  assert.equal(canEdit(verified, { state: 'active' }, session, 'ChIJeligible1'), true);
  assert.equal(canEdit(verified, { state: 'active' }, session, 'ChIJother1'), false);
  assert.equal(canEdit(verified, { state: 'revoked' }, session, 'ChIJeligible1'), false);
  assert.equal(canEdit(verified, { state: 'active' }, { ...session, revokedAt: '2026-01-01T00:00:00Z' }, 'ChIJeligible1'), false);
});

test('membership creation is idempotent and emits no phone value', () => {
  const first = createMembership([], { membershipId: 'm1', userId: 'u1', placeId: 'ChIJeligible1', now: '2026-09-27T00:00:00Z' });
  assert.equal(first.created, true);
  const second = createMembership(first.memberships, { membershipId: 'different', userId: 'u1', placeId: 'ChIJeligible1', now: '2026-09-28T00:00:00Z' });
  assert.equal(second.created, false);
  assert.deepEqual(second.memberships, first.memberships);
  assert.equal(JSON.stringify(second).includes('"phone":'), false);
});

test('contact snapshots require admitted source/version and only retain a digest', () => {
  assert.deepEqual(createContactSnapshot({
    snapshotId: 's1', placeId: 'ChIJeligible1', phoneDigest: 'sha256:abc',
    admission: admitPlace(manifest, { placeId: 'ChIJeligible1' }), capturedAt: '2026-09-27T00:00:00Z',
  }), {
    snapshotId: 's1', placeId: 'ChIJeligible1', phoneDigest: 'sha256:abc', source: 'google_places',
    eligibilityVersion: ELIGIBILITY_VERSION, eligibilityDisposition: ELIGIBLE_DISPOSITION,
    capturedAt: '2026-09-27T00:00:00Z', revokedAt: null,
  });
});

test('events and sessions preserve Place ID isolation and revocation', () => {
  const membership = createMembership([], { membershipId: 'm1', userId: 'u1', placeId: 'ChIJeligible1', now: '2026-09-27T00:00:00Z' }).memberships[0];
  const event = recordVerificationEvent([], { eventId: 'e1', membership, eventType: 'admitted', channel: 'phone', occurredAt: '2026-09-27T00:00:00Z' });
  assert.equal(event.events[0].placeId, 'ChIJeligible1');
  const verified = { ...membership, state: 'verified' as const, verifiedAt: '2026-09-27T00:00:00Z' };
  const session = createScopedSession([], { sessionId: 's1', tokenDigest: 'sha256:token', membership: verified, issuedAt: '2026-09-27T00:00:00Z', expiresAt: '2026-09-28T00:00:00Z' });
  assert.equal(canEdit(verified, { state: 'active' }, session.sessions[0], 'ChIJeligible1', new Date('2026-09-27T12:00:00Z')), true);
  assert.equal(canEdit(verified, { state: 'active' }, session.sessions[0], 'ChIJother1', new Date('2026-09-27T12:00:00Z')), false);
  assert.equal(revokeSession(session.sessions, 's1', '2026-09-27T13:00:00Z')[0].revokedAt, '2026-09-27T13:00:00Z');
  assert.equal(revokeMembership([verified], 'm1', '2026-09-27T13:00:00Z')[0].state, 'revoked');
});
