/** Pure, fail-closed admission and state rules for the local Phase 1 layer.
 *
 * This module deliberately accepts the eligibility manifest as an injected value:
 * callers cannot authorize a place from slug, name, or a phone string.
 */

export const ELIGIBILITY_VERSION = 'phone-self-service-eligibility-v1' as const;
export const ELIGIBLE_DISPOSITION = 'eligible_unique_canonical' as const;

export type EligibilityDisposition =
  | typeof ELIGIBLE_DISPOSITION
  | 'ineligible_missing'
  | 'ineligible_invalid'
  | 'ineligible_shared_or_collision';

export interface EligibilityEntry {
  category: string;
  slug: string;
  place_id: string | null;
  disposition: EligibilityDisposition;
  collision_group?: string;
}

export interface EligibilityManifest {
  version: string;
  policy: { eligible_only: string; no_raw_phone_values: boolean };
  entries: EligibilityEntry[];
}

export interface AdmissionInput {
  placeId: string;
  /** These fields are intentionally ignored for authorization. */
  slug?: string;
  name?: string;
}

export interface Admission {
  placeId: string;
  eligibilityVersion: typeof ELIGIBILITY_VERSION;
  disposition: typeof ELIGIBLE_DISPOSITION;
  source: 'google_places';
}

export type AdmissionRejection =
  | 'invalid_place_id'
  | 'manifest_version_mismatch'
  | 'manifest_policy_mismatch'
  | 'not_found'
  | 'ineligible';

export class IdentityAdmissionError extends Error {
  readonly code: AdmissionRejection;

  constructor(code: AdmissionRejection) {
    super(`owner identity admission rejected: ${code}`);
    this.name = 'IdentityAdmissionError';
    this.code = code;
  }
}

export function admitPlace(
  manifest: EligibilityManifest,
  input: AdmissionInput,
): Admission {
  if (!/^ChIJ[A-Za-z0-9_-]+$/.test(input.placeId)) {
    throw new IdentityAdmissionError('invalid_place_id');
  }
  if (manifest.version !== ELIGIBILITY_VERSION) {
    throw new IdentityAdmissionError('manifest_version_mismatch');
  }
  if (manifest.policy.eligible_only !== ELIGIBLE_DISPOSITION ||
      manifest.policy.no_raw_phone_values !== true) {
    throw new IdentityAdmissionError('manifest_policy_mismatch');
  }
  const entry = manifest.entries.find((candidate) => candidate.place_id === input.placeId);
  if (!entry) throw new IdentityAdmissionError('not_found');
  if (entry.disposition !== ELIGIBLE_DISPOSITION) {
    throw new IdentityAdmissionError('ineligible');
  }
  return {
    placeId: input.placeId,
    eligibilityVersion: ELIGIBILITY_VERSION,
    disposition: ELIGIBLE_DISPOSITION,
    source: 'google_places',
  };
}

export function canEdit(
  membership: { state: 'legacy_unverified' | 'verified' | 'revoked' },
  user: { state: 'active' | 'revoked' },
  session: { placeId: string; scope: 'owner_edit'; revokedAt: string | null; expiresAt: string },
  placeId: string,
  now = new Date(),
): boolean {
  return membership.state === 'verified' && user.state === 'active' &&
    session.scope === 'owner_edit' && session.placeId === placeId &&
    session.revokedAt === null && new Date(session.expiresAt).getTime() > now.getTime();
}

export function legacyEmailMembership(placeId: string, userId: string, membershipId: string) {
  return {
    placeId, userId, membershipId, role: 'owner' as const,
    state: 'legacy_unverified' as const, source: 'legacy_email' as const,
  };
}
