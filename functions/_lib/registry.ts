// Business registry data layer (B2B partner program, Phase 0).
//
// Single source of truth for claim state, keyed by Google Places ID — the same
// identifier the site's markdown frontmatter already carries (`placeId`).
//
// Every read/write of the `businesses` table goes through this module so that the
// claim flow (Phase 0), the owner dashboard (Phase 1) and the verified-badge render
// share one set of rules:
//
//   * `claimed`   = the claimant proved **mailbox possession** (a code sent to that
//                   address came back). It is NOT evidence of ownership.
//   * `verified`  = ownership was **independently approved by a human**, recorded
//                   with who approved it and on what evidence. Only this grants the
//                   public verified badge and owner edit/publish access.
//   * a business can only be claimed while unclaimed, or by the same owner email
//   * verification exists only on top of a claim
//   * every state change appends a row to `registry_events`
//
// A mailbox a stranger happens to control must never move a business from `claimed`
// to `verified`: see `approveOwnership()` for the only path that does, and
// docs/claim-flow.md for the review procedure.
//
// Schema: migrations/0001_business_registry.sql, migrations/0006_ownership_approval.sql
// Docs:   docs/business-registry.md

import { isNonBlankProvenance } from './provenance';

export type Tier = 'free' | 'pro';
export type ClaimStatus = 'all' | 'claimed' | 'verified';

export interface BusinessRecord {
  placeId: string;
  slug: string | null;
  name: string | null;
  category: string | null;
  claimed: boolean;
  verified: boolean;
  ownerEmail: string | null;
  tier: Tier;
  claimedAt: string | null;
  verifiedAt: string | null;
  /** Who performed the independent ownership check (migration 0006). */
  ownershipApprovedBy: string | null;
  /** What independent source established ownership (migration 0006). */
  ownershipEvidence: string | null;
  /**
   * Epoch of the current approved ownership (migration 0007). Incremented by every
   * approval and every revoke. Published content and owner credentials are bound to
   * it, so a revoke invalidates both without depending on a flag being rewritten.
   */
  approvalGeneration: number;
  source: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Registry fields safe to expose publicly (no owner email, no internal notes). */
export interface PublicBusinessRecord {
  placeId: string;
  slug: string | null;
  name: string | null;
  category: string | null;
  claimed: boolean;
  verified: boolean;
  tier: Tier;
  claimedAt: string | null;
  verifiedAt: string | null;
  updatedAt: string;
}

export type RegistryErrorCode =
  | 'not_found'
  | 'already_claimed'
  | 'not_claimed'
  | 'invalid_email'
  | 'invalid_tier'
  | 'invalid_body'
  // Claim flow (migrations/0004, functions/_lib/claim.ts)
  | 'invalid_code'
  | 'code_expired'
  | 'too_many_attempts'
  | 'rate_limited'
  | 'catalog_unavailable'
  | 'server_misconfigured'
  // Ownership approval (migration 0006): provenance is mandatory.
  | 'approval_provenance_missing'
  // Ownership approval (migration 0007): the operator decision no longer matches
  // the claim being approved (stale approval, or the claimant was replaced).
  | 'approval_conflict';

export class RegistryError extends Error {
  constructor(
    readonly code: RegistryErrorCode,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

interface BusinessRow {
  place_id: string;
  slug: string | null;
  name: string | null;
  category: string | null;
  claimed: number;
  verified: number;
  owner_email: string | null;
  tier: string;
  claimed_at: string | null;
  verified_at: string | null;
  ownership_approved_by: string | null;
  ownership_evidence: string | null;
  approval_generation: number;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'place_id, slug, name, category, claimed, verified, owner_email, tier, claimed_at, verified_at, ' +
  'ownership_approved_by, ownership_evidence, approval_generation, source, notes, created_at, updated_at';

export function isTier(value: unknown): value is Tier {
  return value === 'free' || value === 'pro';
}

/** Canonical owner email: trimmed, lowercased. Throws on obviously invalid input. */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new RegistryError('invalid_email', 'ownerEmail must be a string');
  }
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
    throw new RegistryError('invalid_email', `invalid owner email: ${JSON.stringify(value)}`);
  }
  return email;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function toRecord(row: BusinessRow): BusinessRecord {
  return {
    placeId: row.place_id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    claimed: row.claimed === 1,
    verified: row.verified === 1,
    ownerEmail: row.owner_email,
    tier: isTier(row.tier) ? row.tier : 'free',
    claimedAt: row.claimed_at,
    verifiedAt: row.verified_at,
    ownershipApprovedBy: row.ownership_approved_by,
    ownershipEvidence: row.ownership_evidence,
    approvalGeneration: Number(row.approval_generation ?? 0),
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublic(record: BusinessRecord): PublicBusinessRecord {
  return {
    placeId: record.placeId,
    slug: record.slug,
    name: record.name,
    category: record.category,
    claimed: record.claimed,
    verified: record.verified,
    tier: record.tier,
    claimedAt: record.claimedAt,
    verifiedAt: record.verifiedAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * The one definition of "this business has an approved owner" for authorization
 * decisions. `verified` alone is not enough: migration 0007's triggers make
 * `verified = 1` without provenance impossible for new writers, and this check
 * additionally refuses a row whose provenance was never recorded (mixed-version
 * rollout), so owner routes and public reads fail closed on the same predicate.
 */
export function isOwnershipApproved(
  record: Pick<
    BusinessRecord,
    | 'claimed'
    | 'verified'
    | 'ownershipApprovedBy'
    | 'ownershipEvidence'
    | 'approvalGeneration'
  > | null,
): boolean {
  // One predicate for every runtime authorization decision: claimed AND verified AND
  // BOTH provenance fields non-blank AND a real generation. `ownershipEvidence` is
  // part of it on purpose — the SQL triggers refuse an evidence-free verified row, so
  // a row that has one can only come from a writer that predates the invariant (a
  // mixed-version writer). Trusting `verified` alone there would hand a private editor
  // session the stored content and edit history of an unverifiable claim.
  return Boolean(
    record &&
      record.claimed &&
      record.verified &&
      // `isNonBlankProvenance` *is* `String.prototype.trim() !== ''` (see _lib/provenance.ts),
      // so this predicate is unchanged for every value — it is the same definition the
      // schema triggers and the SQL read guards now use, instead of three lookalikes.
      isNonBlankProvenance(record.ownershipApprovedBy) &&
      isNonBlankProvenance(record.ownershipEvidence) &&
      Number.isInteger(record.approvalGeneration),
  );
}

async function logEvent(
  db: D1Database,
  placeId: string,
  event: string,
  actor: string,
  detail?: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO registry_events (place_id, event, actor, detail)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(placeId, event, actor, detail === undefined ? null : JSON.stringify(detail))
    .run();
}

/** Read one registry row. Returns null when the place has never been touched. */
export async function getBusiness(db: D1Database, placeId: string): Promise<BusinessRecord | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM businesses WHERE place_id = ?1`)
    .bind(placeId)
    .first<BusinessRow>();
  return row ? toRecord(row) : null;
}

export interface ListOptions {
  status?: ClaimStatus;
  limit?: number;
  offset?: number;
}

/**
 * List registry rows, newest activity first.
 * `status=claimed` (default) only returns claimed businesses, `verified` the
 * claimed+verified ones, `all` everything the registry knows about.
 */
export async function listBusinesses(
  db: D1Database,
  options: ListOptions = {},
): Promise<{ total: number; records: BusinessRecord[] }> {
  const status = options.status ?? 'claimed';
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  const where =
    status === 'verified'
      ? 'WHERE claimed = 1 AND verified = 1'
      : status === 'claimed'
        ? 'WHERE claimed = 1'
        : '';

  const rows = await db
    .prepare(
      `SELECT ${COLUMNS} FROM businesses ${where}
       ORDER BY updated_at DESC, place_id ASC
       LIMIT ?1 OFFSET ?2`,
    )
    .bind(limit, offset)
    .all<BusinessRow>();
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM businesses ${where}`)
    .first<{ n: number }>();

  return { total: count?.n ?? 0, records: (rows.results ?? []).map(toRecord) };
}

export interface ClaimInput {
  placeId: string;
  ownerEmail: string;
  slug?: string | null;
  name?: string | null;
  category?: string | null;
  source?: string;
  actor?: string;
}

/**
 * Attach an owner email to a business (claim step, before verification).
 *
 * Idempotent for the same email: re-claiming keeps the original `claimed_at`, tier
 * and verification. Claiming a business that already belongs to somebody else is
 * refused with `already_claimed` — that guard is what stops claim hijacking.
 */
export async function claimBusiness(db: D1Database, input: ClaimInput): Promise<BusinessRecord> {
  const placeId = input.placeId.trim();
  if (!placeId) throw new RegistryError('invalid_body', 'placeId is required');
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const actor = input.actor ?? 'registry-api';
  const source = input.source ?? 'claim';
  const now = nowIso();

  const before = await getBusiness(db, placeId);
  const result = await db
    .prepare(
      `INSERT INTO businesses
         (place_id, slug, name, category, claimed, verified, owner_email, tier, claimed_at, source, updated_at)
       VALUES (?1, ?2, ?3, ?4, 1, 0, ?5, 'free', ?6, ?7, ?6)
       ON CONFLICT (place_id) DO UPDATE SET
         claimed     = 1,
         owner_email = excluded.owner_email,
         claimed_at  = COALESCE(businesses.claimed_at, excluded.claimed_at),
         verified    = CASE WHEN businesses.claimed = 1 THEN businesses.verified ELSE 0 END,
         verified_at = CASE WHEN businesses.claimed = 1 THEN businesses.verified_at ELSE NULL END,
         tier        = CASE WHEN businesses.claimed = 1 THEN businesses.tier ELSE 'free' END,
         slug        = COALESCE(excluded.slug, businesses.slug),
         name        = COALESCE(excluded.name, businesses.name),
         category    = COALESCE(excluded.category, businesses.category),
         source      = excluded.source,
         updated_at  = excluded.updated_at
       WHERE businesses.claimed = 0
          OR lower(businesses.owner_email) = lower(excluded.owner_email)`,
    )
    .bind(
      placeId,
      input.slug ?? null,
      input.name ?? null,
      input.category ?? null,
      ownerEmail,
      now,
      source,
    )
    .run();

  if (!result.meta?.changes) {
    throw new RegistryError(
      'already_claimed',
      `business ${placeId} is already claimed by a different owner`,
      409,
    );
  }

  // Re-claiming the same business with the same email is a no-op: keep the audit
  // trail signal-only instead of logging every idempotent retry.
  if (!before || !before.claimed || before.ownerEmail !== ownerEmail) {
    await logEvent(db, placeId, 'claim', actor, { ownerEmail, source });
  }
  return (await getBusiness(db, placeId))!;
}

export interface OwnershipApproval {
  /**
   * The human who performed the independent check. Mandatory: it is never defaulted
   * from the calling actor, because "someone with the operator token pressed the
   * button" is not the same claim as "this named person reviewed the evidence".
   */
  approvedBy: string;
  /** What independent source established ownership — a real value is mandatory. */
  evidence: string;
  /**
   * The claimant whose evidence the operator reviewed. The approval only applies if
   * the business is still claimed by exactly this mailbox when the transition
   * commits, so a stale decision cannot approve a replacement claimant.
   */
  expectedOwnerEmail: string;
  /**
   * The claim generation the operator reviewed (`businesses.approval_generation`
   * when the decision was made). A decision that arrives after a revoke/reclaim
   * carries the old epoch and is rejected instead of approving whoever is there now.
   */
  expectedClaimGeneration: number;
  /**
   * The identity *asserted by the caller* in the request body. It is recorded as
   * operator-asserted provenance and is NEVER presented as an authenticated
   * individual: the shared operator token authenticates the credential, not the
   * person who typed the name. See `credentialClass` for the server-controlled
   * classification that actually authorizes the write.
   */
  actor?: string;
  /**
   * SERVER-CONTROLLED classification of the credential that authorized this call
   * (for example `registry-admin-token`), supplied by the calling route from the
   * verified credential — never from the request body. This is what the audit
   * `actor` column records.
   */
  credentialClass?: string;
  /**
   * Optional server-controlled identifier of the credential itself (e.g. the header
   * name or a key id). Recorded verbatim for audit; never body-supplied.
   */
  credentialIdentifier?: string;
}

/**
 * Approve ownership of a claimed business — the ONLY transition that sets `verified`.
 *
 * Mailbox possession (`claimed`) is not ownership: a stranger who controls the
 * address can pass the email step. This function therefore requires a named
 * approver, the independent evidence used, AND the exact claimant/generation the
 * operator reviewed. The state transition is a compare-and-set on that claimant and
 * that generation, and it commits in one transaction together with its audit row:
 * a stale or conflicting approval leaves `verified = 0` and logs no approval event.
 *
 * Throws `not_claimed` (409) when there is no email-verified claim at all,
 * `approval_provenance_missing` (400) when the approver, the evidence, the expected
 * claimant or the expected generation is absent, and `approval_conflict` (409) when
 * the claim changed after the operator reviewed it.
 */
export async function approveOwnership(
  db: D1Database,
  placeId: string,
  approval: OwnershipApproval,
): Promise<BusinessRecord> {
  const id = placeId.trim();
  if (!id) throw new RegistryError('invalid_body', 'placeId is required');

  const approvedBy = typeof approval.approvedBy === 'string' ? approval.approvedBy.trim() : '';
  const evidence = typeof approval.evidence === 'string' ? approval.evidence.trim() : '';
  if (!approvedBy || !evidence) {
    throw new RegistryError(
      'approval_provenance_missing',
      'ownership approval needs approvedBy and evidence: an email-verified claim is not proof of ownership',
      400,
    );
  }

  let expectedOwnerEmail: string;
  try {
    expectedOwnerEmail = normalizeEmail(approval.expectedOwnerEmail);
  } catch {
    throw new RegistryError(
      'approval_provenance_missing',
      'ownership approval needs expectedOwnerEmail: the claimant whose evidence was reviewed',
      400,
    );
  }
  const expectedGeneration = approval.expectedClaimGeneration;
  if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
    throw new RegistryError(
      'approval_provenance_missing',
      'ownership approval needs expectedClaimGeneration: the claim generation the operator reviewed',
      400,
    );
  }

  // R3 (round 3). The audit `actor` is the SERVER-CONTROLLED credential class/identifier
  // that authorized the call — not a person's name taken from the request body. The
  // body-supplied value is retained separately and labelled as operator-asserted.
  // A shared operator token proves operator authority; it does not prove identity.
  const credentialClass = approval.credentialClass ?? 'shared-operator-token';
  const credentialIdentifier = approval.credentialIdentifier ?? credentialClass;
  const actor = credentialClass;
  const assertedActor = (approval.actor ?? '').trim() || null;
  const now = nowIso();

  // One transaction: the CAS transition and its audit row commit or fail together.
  // The audit INSERT is gated on `changes() = 1`, i.e. on the transition having
  // actually matched, so a rejected approval can never leave an "ownership_approved"
  // event behind — and an audit failure rolls the transition back.
  const detail = JSON.stringify({
    approvedBy,
    approvedBySource: 'operator-supplied',
    actor,
    credentialClass,
    credentialIdentifier,
    credentialSource: 'server-verified-request-credential',
    // The person named in the request body, if any: operator-asserted, not authenticated.
    actorAssertedBy: assertedActor,
    actorAssertedSource: 'operator-asserted-request-body',
    evidence,
    ownerEmail: expectedOwnerEmail,
    claimGenerationReviewed: expectedGeneration,
    approvalGenerationAfter: expectedGeneration + 1,
  });

  const results = await db.batch([
    db
      .prepare(
        `UPDATE businesses
            SET verified = 1,
                verified_at = COALESCE(verified_at, ?5),
                ownership_approved_by = ?3,
                ownership_evidence = ?4,
                approval_generation = approval_generation + 1,
                updated_at = ?5
          WHERE place_id = ?1
            AND claimed = 1
            AND lower(owner_email) = lower(?2)
            AND approval_generation = ?6`,
      )
      .bind(id, expectedOwnerEmail, approvedBy, evidence, now, expectedGeneration),
    db
      .prepare(
        `INSERT INTO registry_events (place_id, event, actor, detail)
         SELECT ?1, 'ownership_approved', ?2, ?3 WHERE changes() = 1`,
      )
      .bind(id, actor, detail),
  ]);

  const changed = Number(results?.[0]?.meta?.changes ?? 0);
  if (changed !== 1) {
    const current = await getBusiness(db, id);
    if (!current) throw new RegistryError('not_found', `unknown business ${id}`, 404);
    if (!current.claimed) {
      throw new RegistryError(
        'not_claimed',
        `business ${id} has no email-verified claim to approve yet`,
        409,
      );
    }
    throw new RegistryError(
      'approval_conflict',
      `approval rejected: business ${id} is claimed by ${current.ownerEmail ?? 'nobody'} at claim ` +
        `generation ${current.approvalGeneration}, not by ${expectedOwnerEmail} at generation ` +
        `${expectedGeneration} — re-check the claimant and submit a fresh decision`,
      409,
    );
  }

  return (await getBusiness(db, id))!;
}

/** Set the partner tier. Idempotent. */
export async function setTier(
  db: D1Database,
  placeId: string,
  tier: Tier,
  actor = 'registry-api',
): Promise<BusinessRecord> {
  if (!isTier(tier)) throw new RegistryError('invalid_tier', `unknown tier: ${String(tier)}`);
  const now = nowIso();
  const result = await db
    .prepare(
      `UPDATE businesses SET tier = ?2, updated_at = ?3
       WHERE place_id = ?1 AND tier <> ?2`,
    )
    .bind(placeId, tier, now)
    .run();

  const record = await getBusiness(db, placeId);
  if (!record) throw new RegistryError('not_found', `unknown business ${placeId}`, 404);
  if (!result.meta?.changes) return record; // already on this tier

  await logEvent(db, placeId, 'tier_change', actor, { tier });
  return (await getBusiness(db, placeId))!;
}

/**
 * Revoke a claim: drops the owner email, verification, ownership provenance and
 * tier, but keeps the row (and its event history) so the business is never
 * silently re-imported as new.
 *
 * This is a lifecycle transition, so it must withdraw everything the claim granted,
 * in one transaction:
 *   * `approval_generation` is incremented, which invalidates every credential and
 *     every publication bound to the previous epoch (see migration 0007). The old
 *     owner cannot publish after the revoke even if the request was already in
 *     flight, and their content cannot be served publicly.
 *   * published owner content is unpublished and unbound (belt and braces with the
 *     public read guard, which also fails closed on the generation mismatch).
 *   * owner sessions/codes are recorded in `ownership_quarantine_log` (evidence of
 *     what was withdrawn, not authority to use it) and then deleted.
 */
export async function revokeBusiness(
  db: D1Database,
  placeId: string,
  actor = 'registry-api',
  reason?: string,
): Promise<BusinessRecord> {
  const before = await getBusiness(db, placeId);
  if (!before) throw new RegistryError('not_found', `unknown business ${placeId}`, 404);

  const now = nowIso();
  const transitioned = Boolean(
    before.claimed || before.verified || before.tier !== 'free' || before.ownerEmail,
  );
  const detail = JSON.stringify({
    previousOwnerEmail: before.ownerEmail,
    previousTier: before.tier,
    previousOwnershipApprovedBy: before.ownershipApprovedBy,
    previousApprovalGeneration: before.approvalGeneration,
    publicationQuarantined: true,
    note: 'per-row counts are recorded in ownership_quarantine_log and profile_edit_events',
    reason: reason ?? null,
  });

  await db.batch([
    // Evidence of the credentials being withdrawn (the delete follows in this batch).
    db
      .prepare(
        `INSERT INTO ownership_quarantine_log (place_id, kind, generation, owner_email, detail)
         SELECT place_id,
                CASE kind WHEN 'code' THEN 'login_code' ELSE 'session' END,
                -1,
                email,
                ?2
           FROM owner_sessions
          WHERE place_id = ?1`,
      )
      .bind(placeId, JSON.stringify({ reason: reason ?? null, cause: 'revoked', actor })),
    db
      .prepare(
        `UPDATE businesses
            SET claimed = 0, verified = 0, owner_email = NULL, tier = 'free',
                claimed_at = NULL, verified_at = NULL,
                ownership_approved_by = NULL, ownership_evidence = NULL,
                approval_generation = approval_generation + 1,
                updated_at = ?2
          WHERE place_id = ?1`,
      )
      .bind(placeId, now),
    db
      .prepare(
        `UPDATE profile_overrides
            SET published = 0, claim_generation = NULL, updated_by = ?2, updated_at = ?2
          WHERE place_id = ?1 AND (published = 1 OR claim_generation IS NOT NULL)`,
      )
      .bind(placeId, `revoke:${actor}`),
    db
      .prepare(
        `INSERT INTO profile_edit_events (place_id, slug, actor, action, detail)
         SELECT ?1, slug, ?2, 'ownership_unpublished', ?3
           FROM profile_overrides WHERE place_id = ?1 AND updated_by = ?2`,
      )
      .bind(placeId, `revoke:${actor}`, JSON.stringify({ reason: 'claim revoked' })),
    db.prepare('DELETE FROM owner_sessions WHERE place_id = ?1').bind(placeId),
    db
      .prepare(
        `INSERT INTO registry_events (place_id, event, actor, detail)
         SELECT ?1, 'revoke', ?2, ?3 WHERE ?4 = 1`,
      )
      .bind(placeId, actor, detail, transitioned ? 1 : 0),
  ]);

  return (await getBusiness(db, placeId))!;
}

export interface RegistryEvent {
  id: number;
  placeId: string;
  event: string;
  actor: string;
  detail: string | null;
  createdAt: string;
}

/** Audit trail for one business, oldest first. */
export async function listEvents(db: D1Database, placeId: string): Promise<RegistryEvent[]> {
  const rows = await db
    .prepare(
      `SELECT id, place_id, event, actor, detail, created_at
       FROM registry_events WHERE place_id = ?1 ORDER BY id ASC`,
    )
    .bind(placeId)
    .all<{
      id: number;
      place_id: string;
      event: string;
      actor: string;
      detail: string | null;
      created_at: string;
    }>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    placeId: row.place_id,
    event: row.event,
    actor: row.actor,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}
