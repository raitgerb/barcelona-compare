// Business registry data layer (B2B partner program, Phase 0).
//
// Single source of truth for claim state, keyed by Google Places ID — the same
// identifier the site's markdown frontmatter already carries (`placeId`).
//
// Every read/write of the `businesses` table goes through this module so that the
// claim flow (Phase 0), the owner dashboard (Phase 1) and the verified-badge render
// share one set of rules:
//
//   * a business can only be claimed while unclaimed, or by the same owner email
//   * verification exists only on top of a claim
//   * every state change appends a row to `registry_events`
//
// Schema: migrations/0001_business_registry.sql
// Docs:   docs/business-registry.md

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
  | 'server_misconfigured';

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
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'place_id, slug, name, category, claimed, verified, owner_email, tier, claimed_at, verified_at, source, notes, created_at, updated_at';

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

/**
 * Mark a claimed business as verified. Idempotent — verifying an already verified
 * business returns the current record instead of failing.
 */
export async function verifyBusiness(
  db: D1Database,
  placeId: string,
  actor = 'registry-api',
): Promise<BusinessRecord> {
  const now = nowIso();
  const result = await db
    .prepare(
      `UPDATE businesses
         SET verified = 1, verified_at = ?2, updated_at = ?2
       WHERE place_id = ?1 AND claimed = 1 AND verified = 0`,
    )
    .bind(placeId, now)
    .run();

  const record = await getBusiness(db, placeId);
  if (!record) throw new RegistryError('not_found', `unknown business ${placeId}`, 404);
  if (!result.meta?.changes) {
    if (!record.claimed) {
      throw new RegistryError('not_claimed', `business ${placeId} has no verified owner yet`, 409);
    }
    return record; // already verified
  }

  await logEvent(db, placeId, 'verify', actor, { verifiedAt: now });
  return (await getBusiness(db, placeId))!;
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
 * Revoke a claim: drops the owner email, verification and tier, but keeps the row
 * (and its event history) so the business is never silently re-imported as new.
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
  await db
    .prepare(
      `UPDATE businesses
         SET claimed = 0, verified = 0, owner_email = NULL, tier = 'free',
             claimed_at = NULL, verified_at = NULL, updated_at = ?2
       WHERE place_id = ?1`,
    )
    .bind(placeId, now)
    .run();

  await logEvent(db, placeId, 'revoke', actor, {
    previousOwnerEmail: before.ownerEmail,
    previousTier: before.tier,
    reason: reason ?? null,
  });
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
