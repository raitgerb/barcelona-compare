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

const eligiblePlace = 'ChIJeligible1';
const otherPlace = 'ChIJother1';
const manifest = {
  version: ELIGIBILITY_VERSION,
  policy: { eligible_only: ELIGIBLE_DISPOSITION, no_raw_phone_values: true },
  entries: [
    { category: 'nails', slug: 'eligible', place_id: eligiblePlace, disposition: ELIGIBLE_DISPOSITION },
    { category: 'nails', slug: 'missing', place_id: 'ChIJmissing1', disposition: 'ineligible_missing' as const },
    { category: 'nails', slug: 'invalid', place_id: 'ChIJinvalid1', disposition: 'ineligible_invalid' as const },
    { category: 'nails', slug: 'shared', place_id: 'ChIJshared1', disposition: 'ineligible_shared_or_collision' as const },
    { category: 'nails', slug: 'collision', place_id: otherPlace, disposition: 'ineligible_shared_or_collision' as const },
  ],
};

function rejects(code: string, fn: () => unknown) {
  assert.throws(fn, (error) => error instanceof IdentityAdmissionError && error.code === code);
}

test('admission accepts only an eligible canonical Place ID', () => {
  assert.deepEqual(admitPlace(manifest, {
    placeId: eligiblePlace, slug: 'not-the-manifest-slug', name: 'not the manifest name',
  }), {
    placeId: eligiblePlace, eligibilityVersion: ELIGIBILITY_VERSION,
    disposition: ELIGIBLE_DISPOSITION, source: 'google_places',
  });
});

test('admission rejects every non-eligible disposition and malformed or absent IDs', () => {
  for (const entry of manifest.entries.slice(1)) {
    rejects('ineligible', () => admitPlace(manifest, { placeId: entry.place_id! }));
  }
  rejects('not_found', () => admitPlace(manifest, { placeId: 'ChIJnotlisted1' }));
  rejects('invalid_place_id', () => admitPlace(manifest, { placeId: 'slug-is-not-a-place-id' }));
  rejects('not_found', () => admitPlace(manifest, { placeId: 'ChIJnotlisted1', slug: 'eligible', name: 'eligible' }));
});

test('manifest contract is version and policy gated without changing entries', () => {
  const before = structuredClone(manifest);
  rejects('manifest_version_mismatch', () => admitPlace({ ...manifest, version: 'old' }, { placeId: eligiblePlace }));
  rejects('manifest_policy_mismatch', () => admitPlace({ ...manifest, policy: { ...manifest.policy, no_raw_phone_values: false } }, { placeId: eligiblePlace }));
  assert.deepEqual(manifest, before);
});

test('contact snapshots are Place-ID scoped and expose only a digest', () => {
  const admission = admitPlace(manifest, { placeId: eligiblePlace });
  const snapshot = createContactSnapshot({
    snapshotId: 's1', placeId: eligiblePlace, phoneDigest: 'sha256:abc', admission,
    capturedAt: '2026-09-27T00:00:00Z',
  });
  assert.deepEqual(snapshot, {
    snapshotId: 's1', placeId: eligiblePlace, phoneDigest: 'sha256:abc', source: 'google_places',
    eligibilityVersion: ELIGIBILITY_VERSION, eligibilityDisposition: ELIGIBLE_DISPOSITION,
    capturedAt: '2026-09-27T00:00:00Z', revokedAt: null,
  });
  assert.equal('phone' in snapshot, false);
  assert.throws(() => createContactSnapshot({
    snapshotId: 's2', placeId: eligiblePlace, phoneDigest: 'sha256:def', admission,
    capturedAt: '2026-09-27T00:00:00Z', phone: '+34123456789',
  } as never), /raw phone/);
});

test('membership creation is idempotent per user and Place ID, not globally', () => {
  const first = createMembership([], { membershipId: 'm1', userId: 'u1', placeId: eligiblePlace, now: '2026-09-27T00:00:00Z' });
  const duplicate = createMembership(first.memberships, { membershipId: 'different', userId: 'u1', placeId: eligiblePlace, now: '2026-09-28T00:00:00Z' });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.deepEqual(duplicate.memberships, first.memberships);
  const other = createMembership(duplicate.memberships, { membershipId: 'm2', userId: 'u1', placeId: otherPlace, now: '2026-09-28T00:00:00Z' });
  const otherUser = createMembership(other.memberships, { membershipId: 'm3', userId: 'u2', placeId: eligiblePlace, now: '2026-09-28T00:00:00Z' });
  assert.equal(other.created, true);
  assert.equal(otherUser.created, true);
  assert.equal(JSON.stringify(otherUser).includes('"phone"'), false);
});

test('verification events retain membership identity and enforce channel/version semantics', () => {
  const membership = createMembership([], { membershipId: 'm1', userId: 'u1', placeId: eligiblePlace, now: '2026-09-27T00:00:00Z' }).membership;
  const recorded = recordVerificationEvent([], { eventId: 'e1', membership, eventType: 'verified', channel: 'phone', occurredAt: '2026-09-27T01:00:00Z' });
  assert.deepEqual(recorded.event, {
    eventId: 'e1', membershipId: 'm1', userId: 'u1', placeId: eligiblePlace,
    eventType: 'verified', channel: 'phone', eligibilityVersion: ELIGIBILITY_VERSION,
    occurredAt: '2026-09-27T01:00:00Z',
  });
  assert.throws(() => recordVerificationEvent(recorded.events, { eventId: 'e1', membership, eventType: 'verified', channel: 'phone', occurredAt: 'now' }), /duplicate event/);
  assert.throws(() => recordVerificationEvent(recorded.events, { eventId: 'legacy', membership, eventType: 'legacy_imported', channel: 'phone', occurredAt: 'now' }), /phone event/);
  assert.throws(() => recordVerificationEvent(recorded.events, { eventId: 'wrong', membership, eventType: 'verified', channel: 'legacy_email', occurredAt: 'now' }), /legacy event/);
});

test('revocation invalidates sessions and membership edit authorization', () => {
  const membership = createMembership([], { membershipId: 'm1', userId: 'u1', placeId: eligiblePlace, now: '2026-09-27T00:00:00Z' }).membership;
  const sessionResult = createScopedSession([], { sessionId: 's1', tokenDigest: 'sha256:token', membership, issuedAt: '2026-09-27T00:00:00Z', expiresAt: '2026-09-28T00:00:00Z' });
  assert.equal(canEdit(membership, { state: 'active' }, sessionResult.session, eligiblePlace, new Date('2026-09-27T12:00:00Z')), true);
  const revokedSession = revokeSession(sessionResult.sessions, 's1', '2026-09-27T13:00:00Z')[0];
  assert.equal(canEdit(membership, { state: 'active' }, revokedSession, eligiblePlace), false);
  const revokedMembership = revokeMembership([membership], 'm1', '2026-09-27T13:00:00Z')[0];
  assert.equal(revokedMembership.state, 'revoked');
  assert.equal(canEdit(revokedMembership, { state: 'active' }, sessionResult.session, eligiblePlace), false);
  assert.equal(canEdit(membership, { state: 'revoked' }, sessionResult.session, eligiblePlace), false);
});

test('legacy email memberships stay unverified and cannot create edit access', () => {
  const legacy = legacyEmailMembership(eligiblePlace, 'u1', 'legacy-1');
  assert.equal(legacy.state, 'legacy_unverified');
  assert.equal(legacy.source, 'legacy_email');
  assert.equal(canEdit(legacy, { state: 'active' }, {
    placeId: eligiblePlace, scope: 'owner_edit', revokedAt: null,
    expiresAt: '2999-01-01T00:00:00.000Z',
  }, eligiblePlace), false);
  assert.throws(() => createScopedSession([], {
    sessionId: 'legacy-session', tokenDigest: 'sha256:legacy', membership: legacy as never,
    issuedAt: '2026-09-27T00:00:00Z', expiresAt: '2026-09-28T00:00:00Z',
  }), /verified membership/);
});

test('identity rules do not invoke network providers or remote D1', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('network call'); }) as typeof fetch;
  try {
    assert.equal(admitPlace(manifest, { placeId: eligiblePlace }).placeId, eligiblePlace);
    assert.equal(createMembership([], { membershipId: 'm1', userId: 'u1', placeId: eligiblePlace, now: 'now' }).created, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});