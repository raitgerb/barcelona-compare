/** Pure, fail-closed admission and state rules for the local Phase 1 layer. */

export const ELIGIBILITY_VERSION = 'phone-self-service-eligibility-v1' as const;
export const ELIGIBLE_DISPOSITION = 'eligible_unique_canonical' as const;

export type EligibilityDisposition = typeof ELIGIBLE_DISPOSITION | 'ineligible_missing' | 'ineligible_invalid' | 'ineligible_shared_or_collision';
export interface EligibilityEntry { category: string; slug: string; place_id: string | null; disposition: EligibilityDisposition; collision_group?: string; }
export interface EligibilityManifest { version: string; policy: { eligible_only: string; no_raw_phone_values: boolean }; entries: EligibilityEntry[]; }
export interface AdmissionInput { placeId: string; slug?: string; name?: string; }
export interface Admission { placeId: string; eligibilityVersion: typeof ELIGIBILITY_VERSION; disposition: typeof ELIGIBLE_DISPOSITION; source: 'google_places'; }
export interface ContactSnapshot { snapshotId: string; placeId: string; phoneDigest: string; source: 'google_places'; eligibilityVersion: typeof ELIGIBILITY_VERSION; eligibilityDisposition: typeof ELIGIBLE_DISPOSITION; capturedAt: string; revokedAt: string | null; }
export interface OwnerMembership { membershipId: string; userId: string; placeId: string; role: 'owner'; state: 'legacy_unverified' | 'verified' | 'revoked'; source: 'legacy_email' | 'phone_manifest'; createdAt: string; verifiedAt: string | null; revokedAt: string | null; }
export interface VerificationEvent { eventId: string; membershipId: string; userId: string; placeId: string; eventType: 'legacy_imported' | 'admitted' | 'verified' | 'revoked'; channel: 'legacy_email' | 'phone'; eligibilityVersion: typeof ELIGIBILITY_VERSION | null; occurredAt: string; }
export interface OwnerSession { sessionId: string; tokenDigest: string; userId: string; placeId: string; scope: 'owner_edit'; issuedAt: string; expiresAt: string; revokedAt: string | null; }

export type AdmissionRejection = 'invalid_place_id' | 'manifest_version_mismatch' | 'manifest_policy_mismatch' | 'not_found' | 'ineligible';
export class IdentityAdmissionError extends Error {
  readonly code: AdmissionRejection;
  constructor(code: AdmissionRejection) { super(`owner identity admission rejected: ${code}`); this.name = 'IdentityAdmissionError'; this.code = code; }
}

const acceptedAdmissions = new WeakSet<object>();

export function admitPlace(manifest: EligibilityManifest, input: AdmissionInput): Admission {
  if (!/^ChIJ[A-Za-z0-9_-]+$/.test(input.placeId)) throw new IdentityAdmissionError('invalid_place_id');
  if (manifest.version !== ELIGIBILITY_VERSION) throw new IdentityAdmissionError('manifest_version_mismatch');
  if (manifest.policy.eligible_only !== ELIGIBLE_DISPOSITION || manifest.policy.no_raw_phone_values !== true) throw new IdentityAdmissionError('manifest_policy_mismatch');
  const entry = manifest.entries.find(candidate => candidate.place_id === input.placeId);
  if (!entry) throw new IdentityAdmissionError('not_found');
  if (entry.disposition !== ELIGIBLE_DISPOSITION) throw new IdentityAdmissionError('ineligible');
  const admission = { placeId: input.placeId, eligibilityVersion: ELIGIBILITY_VERSION, disposition: ELIGIBLE_DISPOSITION, source: 'google_places' as const };
  acceptedAdmissions.add(admission);
  return admission;
}

function required(value: string, field: string): void { if (typeof value !== 'string' || value.length === 0) throw new Error(`owner identity invalid ${field}`); }
function rejectRawPhone(value: object): void { if (Object.keys(value).some(key => key === 'phone' || key === 'rawPhone' || key === 'phoneNumber')) throw new Error('owner identity raw phone values are forbidden'); }

export function createContactSnapshot(input: { snapshotId: string; placeId: string; phoneDigest: string; admission: Admission; capturedAt: string }): ContactSnapshot {
  rejectRawPhone(input); required(input.snapshotId, 'snapshotId'); required(input.phoneDigest, 'phoneDigest'); required(input.capturedAt, 'capturedAt');
  if (input.admission.source !== 'google_places' || input.admission.placeId !== input.placeId || input.admission.eligibilityVersion !== ELIGIBILITY_VERSION || input.admission.disposition !== ELIGIBLE_DISPOSITION) throw new Error('owner identity snapshot admission mismatch');
  return { snapshotId: input.snapshotId, placeId: input.placeId, phoneDigest: input.phoneDigest, source: 'google_places', eligibilityVersion: ELIGIBILITY_VERSION, eligibilityDisposition: ELIGIBLE_DISPOSITION, capturedAt: input.capturedAt, revokedAt: null };
}

export function createMembership(memberships: readonly OwnerMembership[], input: { membershipId: string; userId: string; placeId: string; now: string; admission: Admission }): { memberships: OwnerMembership[]; membership: OwnerMembership; created: boolean } {
  required(input.membershipId, 'membershipId'); required(input.userId, 'userId'); required(input.placeId, 'placeId'); required(input.now, 'now');
  if (!acceptedAdmissions.has(input.admission) || input.admission.source !== 'google_places' || input.admission.placeId !== input.placeId || input.admission.eligibilityVersion !== ELIGIBILITY_VERSION || input.admission.disposition !== ELIGIBLE_DISPOSITION) throw new Error('owner identity membership admission mismatch');
  const existing = memberships.find(m => m.userId === input.userId && m.placeId === input.placeId && m.role === 'owner');
  if (existing) return { memberships: [...memberships], membership: existing, created: false };
  const membership: OwnerMembership = { membershipId: input.membershipId, userId: input.userId, placeId: input.placeId, role: 'owner', state: 'verified', source: 'phone_manifest', createdAt: input.now, verifiedAt: input.now, revokedAt: null };
  return { memberships: [...memberships, membership], membership, created: true };
}

export function recordVerificationEvent(events: readonly VerificationEvent[], input: { eventId: string; membership: OwnerMembership; eventType: VerificationEvent['eventType']; channel: VerificationEvent['channel']; occurredAt: string }): { events: VerificationEvent[]; event: VerificationEvent } {
  required(input.eventId, 'eventId'); required(input.occurredAt, 'occurredAt');
  if (events.some(event => event.eventId === input.eventId)) throw new Error('owner identity duplicate event');
  if (input.channel === 'legacy_email' && input.eventType !== 'legacy_imported') throw new Error('legacy event type mismatch');
  if (input.channel === 'phone' && input.eventType === 'legacy_imported') throw new Error('phone event type mismatch');
  const event: VerificationEvent = { eventId: input.eventId, membershipId: input.membership.membershipId, userId: input.membership.userId, placeId: input.membership.placeId, eventType: input.eventType, channel: input.channel, eligibilityVersion: input.channel === 'phone' ? ELIGIBILITY_VERSION : null, occurredAt: input.occurredAt };
  return { events: [...events, event], event };
}

export function createScopedSession(sessions: readonly OwnerSession[], input: { sessionId: string; tokenDigest: string; membership: OwnerMembership; issuedAt: string; expiresAt: string }): { sessions: OwnerSession[]; session: OwnerSession } {
  required(input.sessionId, 'sessionId'); required(input.tokenDigest, 'tokenDigest'); required(input.issuedAt, 'issuedAt'); required(input.expiresAt, 'expiresAt');
  if (input.membership.state !== 'verified' || input.membership.revokedAt !== null) throw new Error('owner identity session requires verified membership');
  if (new Date(input.expiresAt).getTime() <= new Date(input.issuedAt).getTime()) throw new Error('owner identity session expiry invalid');
  if (sessions.some(session => session.sessionId === input.sessionId || session.tokenDigest === input.tokenDigest)) throw new Error('owner identity duplicate session');
  const session: OwnerSession = { sessionId: input.sessionId, tokenDigest: input.tokenDigest, userId: input.membership.userId, placeId: input.membership.placeId, scope: 'owner_edit', issuedAt: input.issuedAt, expiresAt: input.expiresAt, revokedAt: null };
  return { sessions: [...sessions, session], session };
}

export function revokeMembership(memberships: readonly OwnerMembership[], membershipId: string, revokedAt: string): OwnerMembership[] { required(membershipId, 'membershipId'); required(revokedAt, 'revokedAt'); return memberships.map(membership => membership.membershipId === membershipId ? { ...membership, state: 'revoked' as const, revokedAt } : membership); }
export function revokeSession(sessions: readonly OwnerSession[], sessionId: string, revokedAt: string): OwnerSession[] { required(sessionId, 'sessionId'); required(revokedAt, 'revokedAt'); return sessions.map(session => session.sessionId === sessionId ? { ...session, revokedAt } : session); }

export function canEdit(membership: { state: 'legacy_unverified' | 'verified' | 'revoked'; placeId?: string }, user: { state: 'active' | 'revoked' }, session: { placeId: string; scope: 'owner_edit'; revokedAt: string | null; expiresAt: string }, placeId: string, now = new Date()): boolean {
  return membership.state === 'verified' && user.state === 'active' && (membership.placeId === undefined || membership.placeId === placeId) && session.scope === 'owner_edit' && session.placeId === placeId && session.revokedAt === null && new Date(session.expiresAt).getTime() > now.getTime();
}

export function legacyEmailMembership(placeId: string, userId: string, membershipId: string) { return { placeId, userId, membershipId, role: 'owner' as const, state: 'legacy_unverified' as const, source: 'legacy_email' as const }; }