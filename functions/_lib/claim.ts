// Email-verified claim flow (B2B Phase 0) — the logic behind
// `POST /api/claim/start` and `POST /api/claim/verify`.
//
// The rule that shapes everything here: **a code request never touches
// `businesses`**. Only a correct code does, and it does so through
// `claimBusiness()` + `verifyBusiness()` from ./registry.ts, so the claim-hijack
// guard and the audit trail stay in one place. A stranger who requests a code for
// somebody else's salon therefore changes nothing.
//
// Security properties:
//   * the 6-digit code is compared as HMAC-SHA256(secret, code:place:email), so the
//     DB alone never reveals a live code (and the plain text is dropped as soon as
//     the message is delivered);
//   * codes expire (15 min), are single-use, and allow at most 5 wrong attempts;
//   * three windows throttle abuse: 60 s between sends per (business, email),
//     5 sends/hour per email, 20 sends/hour per hashed IP;
//   * no raw IP is stored — only HMAC of it, used for the throttle.
//
// Schema: migrations/0004_claim_verification.sql · Docs: docs/claim-flow.md

import {
  RegistryError,
  claimBusiness,
  getBusiness,
  normalizeEmail,
  toPublic,
  verifyBusiness,
  type BusinessRecord,
  type PublicBusinessRecord,
} from './registry';
import { envString, mailTransport, sendClaimCode, type MailTransport } from './claim-mail';

export const CODE_TTL_MINUTES = 15;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_SENDS_PER_HOUR = 5;
export const MAX_ATTEMPTS_PER_CODE = 5;
export const MAX_STARTS_PER_IP_PER_HOUR = 20;

const PRUNE_AFTER_DAYS = 7;

/** The business fields the claim flow needs: from the build's catalog, never the request body. */
export interface ClaimBusiness {
  placeId: string;
  slug: string;
  name: string;
  category: string;
}

export interface ClaimStartInput {
  email: string;
  ip?: string | null;
  locale?: string;
}

export interface ClaimStartResult {
  state: 'code_sent' | 'already_verified';
  business: { placeId: string; slug: string; name: string };
  email: string;
  /** `resend` = mailed from the edge; `none` = no transport configured, operator handover. */
  delivery?: MailTransport;
  expiresAt?: string;
  resendInSeconds?: number;
  sends?: number;
}

export interface ClaimVerifyResult {
  business: PublicBusinessRecord;
  /** Site path of the claimed listing, for the "view your listing" link. */
  listingUrl: string;
}

export interface PendingDelivery {
  id: string;
  placeId: string;
  slug: string | null;
  businessName: string | null;
  email: string;
  code: string;
  locale: string;
  attempts: number;
  sends: number;
  createdAt: string;
  expiresAt: string;
}

interface ClaimRow {
  id: string;
  place_id: string;
  business_name: string | null;
  slug: string | null;
  email: string;
  code_hash: string;
  code_pending: string | null;
  locale: string;
  attempts: number;
  sends: number;
  created_at: string;
  last_sent_at: string;
  expires_at: string;
  delivered_at: string | null;
  delivery: string | null;
  consumed_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function hmac(env: Env, purpose: string, value: string): Promise<string> {
  const secret = envString(env, 'CLAIM_CODE_SECRET');
  if (secret.length < 16) {
    // Fail closed: without a secret the codes would be guessable from a DB dump.
    throw new RegistryError(
      'server_misconfigured',
      'CLAIM_CODE_SECRET is missing or too short (min 16 chars)',
      500,
    );
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}:${value}`));
  return toHex(new Uint8Array(signature));
}

function hashCode(env: Env, code: string, placeId: string, email: string): Promise<string> {
  return hmac(env, 'claim-code', `${code}:${placeId}:${email}`);
}

function hashIp(env: Env, ip: string): Promise<string> {
  return hmac(env, 'claim-ip', ip);
}

/** Uniform 6-digit code (rejection sampling — `% 1e6` alone would bias the low range). */
export function generateCode(): string {
  const buffer = new Uint32Array(1);
  const limit = 4_294_000_000; // largest multiple of 1e6 below 2^32
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  }
  return String(value % 1_000_000).padStart(6, '0');
}

/** Constant-time comparison of two equal-length hex digests. */
function digestsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function countSince(db: D1Database, where: string, value: string, sinceIso: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM claim_requests WHERE ${where} = ?1 AND created_at > ?2`)
    .bind(value, sinceIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function rateLimited(message: string): never {
  throw new RegistryError('rate_limited', message, 429);
}

/**
 * Issue a verification code for a business and email it when a transport is
 * configured. Idempotent for an already verified owner (no second code), and it
 * refuses to move a business that belongs to somebody else.
 */
export async function startClaim(
  env: Env,
  business: ClaimBusiness,
  input: ClaimStartInput,
): Promise<ClaimStartResult> {
  const db = env.DB;
  const email = normalizeEmail(input.email);
  const placeId = business.placeId;
  const locale = input.locale === 'en' ? 'en' : 'es';
  const publicBusiness = { placeId, slug: business.slug, name: business.name };

  const existing = await getBusiness(db, placeId);
  if (existing?.claimed && existing.ownerEmail !== email) {
    throw new RegistryError(
      'already_claimed',
      `${placeId} is already claimed by a different owner`,
      409,
    );
  }
  if (existing?.verified && existing.ownerEmail === email) {
    return { state: 'already_verified', business: publicBusiness, email };
  }
  if (!existing?.claimed && existing?.ownerEmail && existing.ownerEmail !== email) {
    // Defensive: the DB CHECK constraints make this unreachable.
    throw new RegistryError('already_claimed', `${placeId} is already claimed`, 409);
  }

  // --- throttles -------------------------------------------------------------
  const previous = await db
    .prepare(
      `SELECT created_at, sends FROM claim_requests
       WHERE place_id = ?1 AND email = ?2 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(placeId, email)
    .first<{ created_at: string; sends: number }>();
  if (previous) {
    const elapsedSeconds = (Date.now() - Date.parse(previous.created_at)) / 1000;
    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsedSeconds);
      rateLimited(`a code was just sent to ${email}; try again in ${wait}s`);
    }
    if ((previous.sends ?? 0) >= MAX_SENDS_PER_HOUR) {
      rateLimited(`too many codes requested for ${email}; try again in an hour`);
    }
  }

  const hourAgo = minutesAgoIso(60);
  if ((await countSince(db, 'email', email, hourAgo)) >= MAX_SENDS_PER_HOUR) {
    rateLimited(`too many codes requested for ${email}; try again in an hour`);
  }
  const ipHash = input.ip ? await hashIp(env, input.ip) : null;
  if (ipHash && (await countSince(db, 'ip_hash', ipHash, hourAgo)) >= MAX_STARTS_PER_IP_PER_HOUR) {
    rateLimited('too many claim codes requested from this connection; try again in an hour');
  }

  // --- issue -----------------------------------------------------------------
  const code = generateCode();
  const codeHash = await hashCode(env, code, placeId, email);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
  const sends = (previous?.sends ?? 0) + 1;
  const id = crypto.randomUUID();

  // A new code replaces any pending one for the same (business, email): only the
  // most recent code can ever be accepted.
  await db
    .prepare('DELETE FROM claim_requests WHERE place_id = ?1 AND email = ?2 AND consumed_at IS NULL')
    .bind(placeId, email)
    .run();
  await db
    .prepare(
      `INSERT INTO claim_requests
         (id, place_id, business_name, slug, email, code_hash, code_pending, locale,
          attempts, sends, ip_hash, created_at, last_sent_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, ?11, ?12)`,
    )
    .bind(
      id,
      placeId,
      business.name,
      business.slug,
      email,
      codeHash,
      code,
      locale,
      sends,
      ipHash,
      createdAt,
      expiresAt,
    )
    .run();
  await pruneOldRequests(db);

  // --- deliver ---------------------------------------------------------------
  const delivery = mailTransport(env);
  if (delivery !== 'none') {
    const result = await sendClaimCode(env, {
      to: email,
      code,
      businessName: business.name,
      expiresInMinutes: CODE_TTL_MINUTES,
      lang: locale,
    });
    if (result.delivered) {
      await markDelivered(db, id, result.transport);
      return {
        state: 'code_sent',
        business: publicBusiness,
        email,
        delivery: result.transport,
        expiresAt,
        resendInSeconds: RESEND_COOLDOWN_SECONDS,
        sends,
      };
    }
  }

  // No transport (or a failing one): keep the code for the operator outbox so the
  // verification can still be completed by hand.
  return {
    state: 'code_sent',
    business: publicBusiness,
    email,
    delivery: 'none',
    expiresAt,
    resendInSeconds: RESEND_COOLDOWN_SECONDS,
    sends,
  };
}

/**
 * Check a code and, only on success, claim + verify the business.
 * Throws `RegistryError` with `invalid_code` (400), `code_expired` (410),
 * `too_many_attempts` (429) or `already_claimed` (409).
 */
export async function verifyClaim(
  env: Env,
  business: ClaimBusiness,
  input: { email: string; code: string },
): Promise<ClaimVerifyResult> {
  const db = env.DB;
  const email = normalizeEmail(input.email);
  const placeId = business.placeId;
  const code = input.code.trim();

  if (!/^\d{6}$/.test(code)) {
    throw new RegistryError('invalid_code', 'the verification code is 6 digits');
  }

  const row = await db
    .prepare(
      `SELECT ${COLUMNS} FROM claim_requests
       WHERE place_id = ?1 AND email = ?2 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(placeId, email)
    .first<ClaimRow>();

  if (!row) {
    throw new RegistryError(
      'invalid_code',
      'no verification code is pending for this business and email — request a new one',
    );
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    throw new RegistryError('code_expired', 'this code has expired — request a new one', 410);
  }
  if (row.attempts >= MAX_ATTEMPTS_PER_CODE) {
    throw new RegistryError(
      'too_many_attempts',
      'too many wrong codes for this request — request a new one',
      429,
    );
  }

  const attempt = await db
    .prepare('UPDATE claim_requests SET attempts = attempts + 1 WHERE id = ?1 AND consumed_at IS NULL')
    .bind(row.id)
    .run();
  if (!attempt.meta?.changes) {
    throw new RegistryError('invalid_code', 'this code was already used — request a new one');
  }

  const expected = await hashCode(env, code, placeId, email);
  if (!digestsEqual(expected, row.code_hash)) {
    const left = MAX_ATTEMPTS_PER_CODE - (row.attempts + 1);
    throw new RegistryError(
      'invalid_code',
      left > 0
        ? `that code is not correct (${left} attempt${left === 1 ? '' : 's'} left)`
        : 'that code is not correct — request a new one',
    );
  }

  // Single-use: whoever wins this UPDATE is the only caller that may claim.
  const consumed = await db
    .prepare(
      `UPDATE claim_requests SET consumed_at = ?2, code_pending = NULL
       WHERE id = ?1 AND consumed_at IS NULL`,
    )
    .bind(row.id, nowIso())
    .run();
  if (!consumed.meta?.changes) {
    throw new RegistryError('invalid_code', 'this code was already used — request a new one');
  }

  const record: BusinessRecord = await claimBusiness(db, {
    placeId,
    ownerEmail: email,
    slug: business.slug,
    name: business.name,
    category: business.category,
    source: 'claim',
    actor: 'claim-flow',
  });
  const verified = await verifyBusiness(db, placeId, 'claim-flow');

  return {
    business: toPublic(verified ?? record),
    listingUrl: listingPath(business),
  };
}

const COLUMNS =
  'id, place_id, business_name, slug, email, code_hash, code_pending, locale, attempts, sends, ' +
  'created_at, last_sent_at, expires_at, delivered_at, delivery, consumed_at';

export function listingPath(business: { slug: string; category: string }): string {
  const prefix = business.category === 'massage' ? '/massage' : '/nails';
  return `${prefix}/${business.slug}/`;
}

/**
 * Codes we hold for delivery: requested, not expired, not yet consumed, and not
 * delivered by the edge. With a transport configured this list stays empty.
 */
export async function listPendingDeliveries(db: D1Database, limit = 50): Promise<PendingDelivery[]> {
  const rows = await db
    .prepare(
      `SELECT ${COLUMNS} FROM claim_requests
       WHERE delivered_at IS NULL AND consumed_at IS NULL AND code_pending IS NOT NULL
         AND expires_at > ?1
       ORDER BY created_at ASC LIMIT ?2`,
    )
    .bind(nowIso(), Math.min(Math.max(limit, 1), 200))
    .all<ClaimRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    placeId: row.place_id,
    slug: row.slug,
    businessName: row.business_name,
    email: row.email,
    code: row.code_pending ?? '',
    locale: row.locale,
    attempts: row.attempts,
    sends: row.sends,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

/** Record that a code left our hands (edge transport or operator handover). */
export async function markDelivered(
  db: D1Database,
  id: string,
  provider: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE claim_requests
         SET delivered_at = COALESCE(delivered_at, ?2),
             delivery     = COALESCE(delivery, ?3),
             code_pending = NULL
       WHERE id = ?1`,
    )
    .bind(id, nowIso(), provider)
    .run();
  return Boolean(result.meta?.changes);
}

/** Drop consumed/expired code rows. They are credentials, not records — the durable
 *  history of a claim lives in `registry_events`. */
async function pruneOldRequests(db: D1Database): Promise<void> {
  const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 86_400_000).toISOString();
  await db
    .prepare('DELETE FROM claim_requests WHERE created_at < ?1')
    .bind(cutoff)
    .run();
}
