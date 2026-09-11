// Owner-edited profile content + owner sessions (B2B Phase 1).
//
// Single source of truth for the tables in migrations/0003_owner_profile_edits.sql.
// The owner dashboard (`/gestion`, `/en/manage`), its API (`functions/api/owner/*`)
// and the edge injector (`functions/_middleware.ts`, which renders the published
// content into the static detail pages) all go through this module, so session
// rules, validation and the audit trail live in exactly one place.
//
// Identity model (no passwords — owners are not technical):
//   1. POST /api/owner/session        { business, email } -> 6-digit code, 15 min
//   2. POST /api/owner/session/verify { business, code }  -> session token, 30 days
//   3. PUT  /api/owner/profile/:placeId with `x-owner-session: <token>`
// Only businesses the registry already knows as claimed by that email can log in.
//
// Docs: docs/owner-profile-edits.md

export type Category = 'nails' | 'massage';

export interface ProfileService {
  name: string;
  price?: string;
}

export type ProfileHours = Record<string, string>;

export interface ProfileOverride {
  placeId: string;
  slug: string;
  category: Category;
  services: ProfileService[] | null;
  hours: ProfileHours | null;
  priceNote: string | null;
  hiddenPhotos: number[];
  addedPhotos: string[];
  published: boolean;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Public shape (the injector + the rebuild path read this). */
export interface PublicProfileOverride {
  placeId: string;
  slug: string;
  category: Category;
  services: ProfileService[] | null;
  hours: ProfileHours | null;
  priceNote: string | null;
  hiddenPhotos: number[];
  addedPhotos: string[];
  updatedAt: string;
}

export type ProfileErrorCode =
  | 'invalid_body'
  | 'invalid_services'
  | 'invalid_hours'
  | 'invalid_photos'
  | 'invalid_price_note'
  | 'invalid_code'
  | 'code_expired'
  | 'session_expired'
  | 'not_claimed'
  | 'email_mismatch'
  | 'too_many_requests'
  | 'not_found'
  | 'photo_unreachable';

export class ProfileError extends Error {
  constructor(
    readonly code: ProfileErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ProfileError';
  }
}

export const LIMITS = {
  /** Owner-supplied service rows. */
  maxServices: 25,
  serviceName: 80,
  servicePrice: 30,
  priceNote: 120,
  /** Owner-supplied photo URLs (the Google strip has 5 fixed slots). */
  maxAddedPhotos: 3,
  googlePhotoSlots: 5,
  /** 6-digit codes, 15 minutes; sessions, 30 days. */
  codeTtlMinutes: 15,
  codePerHour: 5,
  maxCodeAttempts: 5,
  sessionTtlDays: 30,
  /** Result rows returned by the public list endpoint. */
  listPageSize: 200,
} as const;

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** `HH:MM-HH:MM` (24h). The injector prints exactly what the owner typed. */
const TIME_RANGE_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,200}$/i;
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,120}$/;

export function nowIso(date: Date = new Date()): string {
  return date.toISOString();
}

export function hoursFromNow(minutes: number, from: Date = new Date()): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** sha256 hex digest, used for codes/tokens (the plaintext is never stored). */
export async function digest(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

/** Constant-time string comparison (both sides are fixed-length hex digests). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 6-digit code, uniformly distributed. */
function randomCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, '0');
}

/** 32-byte session token, hex. */
function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return hex(buf);
}

export function isCategory(value: unknown): value is Category {
  return value === 'nails' || value === 'massage';
}

/** Slugs are the site URL key: keep them to the shape the content collection uses. */
export function normalizeSlug(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ProfileError('invalid_body', 'slug must be a string');
  }
  const slug = value.trim();
  if (!SLUG_RE.test(slug)) throw new ProfileError('invalid_body', `invalid slug: ${slug}`);
  return slug;
}

export function isPlaceId(value: unknown): value is string {
  return typeof value === 'string' && PLACE_ID_RE.test(value.trim());
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateServices(value: unknown): ProfileService[] {
  if (!Array.isArray(value)) {
    throw new ProfileError('invalid_services', 'services must be an array');
  }
  if (value.length > LIMITS.maxServices) {
    throw new ProfileError('invalid_services', `at most ${LIMITS.maxServices} services`);
  }
  const out: ProfileService[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) {
      throw new ProfileError('invalid_services', 'each service must be { name, price }');
    }
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) throw new ProfileError('invalid_services', 'every service needs a name');
    if (name.length > LIMITS.serviceName) {
      throw new ProfileError('invalid_services', `service names are limited to ${LIMITS.serviceName} characters`);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // silently drop duplicates instead of failing the save
    seen.add(key);

    const priceRaw = item.price;
    let price: string | undefined;
    if (priceRaw !== undefined && priceRaw !== null && priceRaw !== '') {
      if (typeof priceRaw !== 'string') {
        throw new ProfileError('invalid_services', 'service price must be a string');
      }
      price = priceRaw.trim();
      if (price.length > LIMITS.servicePrice) {
        throw new ProfileError('invalid_services', `prices are limited to ${LIMITS.servicePrice} characters`);
      }
      if (!price) price = undefined;
    }
    out.push(price ? { name, price } : { name });
  }
  return out;
}

export function validateHours(value: unknown): ProfileHours {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProfileError('invalid_hours', 'hours must be an object keyed by weekday');
  }
  const input = value as Record<string, unknown>;
  const out: ProfileHours = {};
  for (const day of DAYS) {
    const raw = input[day];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') {
      throw new ProfileError('invalid_hours', `${day} must be a string like 10:00-20:00`);
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      out[day] = ''; // explicit "closed"
      continue;
    }
    const normalized = trimmed.replace(/\s*[-–—]\s*/, '-');
    if (!TIME_RANGE_RE.test(normalized)) {
      throw new ProfileError('invalid_hours', `${day} must look like 10:00-20:00`);
    }
    out[day] = normalized;
  }
  for (const key of Object.keys(input)) {
    if (!(DAYS as readonly string[]).includes(key)) {
      throw new ProfileError('invalid_hours', `unknown weekday: ${key}`);
    }
  }
  return out;
}

export function validatePhotoIndexes(value: unknown): number[] {
  if (!Array.isArray(value)) throw new ProfileError('invalid_photos', 'hiddenPhotos must be an array');
  const out = new Set<number>();
  for (const raw of value) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n >= LIMITS.googlePhotoSlots) {
      throw new ProfileError('invalid_photos', `photo indexes must be 0-${LIMITS.googlePhotoSlots - 1}`);
    }
    out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Owner photo URLs: https only, no credentials, an image extension or an
 * image/* content type. Hosts are checked with a HEAD request (see
 * `assertImageReachable`) so a published page never shows a broken photo.
 */
export function validatePhotoUrls(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ProfileError('invalid_photos', 'addedPhotos must be an array');
  if (value.length > LIMITS.maxAddedPhotos) {
    throw new ProfileError('invalid_photos', `at most ${LIMITS.maxAddedPhotos} photos`);
  }
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new ProfileError('invalid_photos', 'photo URLs must be strings');
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new ProfileError('invalid_photos', `not a valid URL: ${trimmed}`);
    }
    if (url.protocol !== 'https:') {
      throw new ProfileError('invalid_photos', 'photo URLs must use https');
    }
    if (url.username || url.password) {
      throw new ProfileError('invalid_photos', 'photo URLs must not embed credentials');
    }
    if (trimmed.length > 500) throw new ProfileError('invalid_photos', 'photo URL is too long');
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** Best-effort reachability check; a HEAD failure rejects the URL. */
export async function assertImageReachable(url: string): Promise<void> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      throw new ProfileError('photo_unreachable', `photo URL returned ${response.status}: ${url}`);
    }
    if (!type.startsWith('image/')) {
      throw new ProfileError('photo_unreachable', `photo URL is not an image (${type || 'unknown type'}): ${url}`);
    }
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError('photo_unreachable', `could not load photo URL: ${url}`);
  }
}

export function validatePriceNote(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new ProfileError('invalid_price_note', 'priceNote must be a string');
  const note = value.trim();
  if (!note) return null;
  if (note.length > LIMITS.priceNote) {
    throw new ProfileError('invalid_price_note', `priceNote is limited to ${LIMITS.priceNote} characters`);
  }
  return note;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface OwnerSessionRow {
  id: string;
  place_id: string;
  email: string;
  kind: string;
  attempts: number;
  expires_at: string;
  created_at: string;
  used_at: string | null;
}

export interface IssuedCode {
  code: string;
  expiresAt: string;
}

/**
 * Issue a 6-digit login code for a claimed business. The caller has already
 * checked that `email` owns `placeId`; this only enforces the rate limit.
 */
export async function issueLoginCode(
  db: D1Database,
  placeId: string,
  email: string,
): Promise<IssuedCode> {
  const since = hoursFromNow(-60);
  const recent = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM owner_sessions
       WHERE place_id = ?1 AND kind = 'code' AND created_at >= ?2`,
    )
    .bind(placeId, since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= LIMITS.codePerHour) {
    throw new ProfileError(
      'too_many_requests',
      'too many codes requested for this business — try again in an hour',
      429,
    );
  }

  const code = randomCode();
  const id = await digest(`${code}:${placeId}`);
  const expiresAt = hoursFromNow(LIMITS.codeTtlMinutes);
  const createdAt = nowIso();

  await db.batch([
    // Supersede any earlier unused code for this business.
    db
      .prepare(
        `UPDATE owner_sessions SET used_at = ?2
         WHERE place_id = ?1 AND kind = 'code' AND used_at IS NULL`,
      )
      .bind(placeId, createdAt),
    db
      .prepare(
        `INSERT INTO owner_sessions (id, place_id, email, kind, expires_at, created_at)
         VALUES (?1, ?2, ?3, 'code', ?4, ?5)`,
      )
      .bind(id, placeId, email, expiresAt, createdAt),
  ]);

  return { code, expiresAt };
}

export interface OwnerSession {
  token: string;
  placeId: string;
  email: string;
  expiresAt: string;
}

/**
 * Exchange a 6-digit code for a session token. Wrong codes burn an attempt; the
 * code dies after 5 misses, so a 6-digit space cannot be brute-forced.
 */
export async function verifyLoginCode(
  db: D1Database,
  placeId: string,
  code: string,
): Promise<OwnerSession> {
  if (!/^\d{6}$/.test(code)) throw new ProfileError('invalid_code', 'the code is 6 digits', 401);

  const row = await db
    .prepare(
      `SELECT id, place_id, email, kind, attempts, expires_at, created_at, used_at
       FROM owner_sessions
       WHERE place_id = ?1 AND kind = 'code' AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(placeId)
    .first<OwnerSessionRow>();
  if (!row) throw new ProfileError('code_expired', 'no active code — request a new one', 401);

  if (row.expires_at <= nowIso()) {
    await db.prepare(`UPDATE owner_sessions SET used_at = ?2 WHERE id = ?1`).bind(row.id, nowIso()).run();
    throw new ProfileError('code_expired', 'the code has expired — request a new one', 401);
  }

  const expected = await digest(`${code}:${placeId}`);
  if (!safeEqual(expected, row.id)) {
    const attempts = row.attempts + 1;
    const dead = attempts >= LIMITS.maxCodeAttempts ? nowIso() : null;
    await db
      .prepare(`UPDATE owner_sessions SET attempts = ?2, used_at = COALESCE(?3, used_at) WHERE id = ?1`)
      .bind(row.id, attempts, dead)
      .run();
    throw new ProfileError('invalid_code', 'that code is not correct', 401);
  }

  const token = randomToken();
  const tokenId = await digest(`${token}:${placeId}`);
  const verifiedAt = nowIso();
  const expiresAt = hoursFromNow(LIMITS.sessionTtlDays * 24 * 60);

  await db.batch([
    db.prepare(`UPDATE owner_sessions SET used_at = ?2 WHERE id = ?1`).bind(row.id, verifiedAt),
    db
      .prepare(
        `INSERT INTO owner_sessions (id, place_id, email, kind, expires_at, created_at)
         VALUES (?1, ?2, ?3, 'session', ?4, ?5)`,
      )
      .bind(tokenId, placeId, row.email, expiresAt, verifiedAt),
  ]);

  return { token, placeId, email: row.email, expiresAt };
}

/** Validate an `x-owner-session` token. Returns null when it is not usable. */
export async function getOwnerSession(
  db: D1Database,
  placeId: string,
  token: string,
): Promise<{ email: string; expiresAt: string } | null> {
  if (!token || !placeId) return null;
  const id = await digest(`${token}:${placeId}`);
  const row = await db
    .prepare(
      `SELECT id, place_id, email, kind, attempts, expires_at, created_at, used_at
       FROM owner_sessions WHERE id = ?1 AND kind = 'session'`,
    )
    .bind(id)
    .first<OwnerSessionRow>();
  if (!row || row.place_id !== placeId) return null;
  if (row.expires_at <= nowIso()) return null;
  return { email: row.email, expiresAt: row.expires_at };
}

/** Drop a session (owner logs out). */
export async function revokeOwnerSession(db: D1Database, placeId: string, token: string): Promise<void> {
  const id = await digest(`${token}:${placeId}`);
  await db.prepare(`DELETE FROM owner_sessions WHERE id = ?1`).bind(id).run();
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

interface OverrideRow {
  place_id: string;
  slug: string;
  category: string;
  services: string | null;
  hours: string | null;
  price_note: string | null;
  hidden_photos: string;
  added_photos: string;
  published: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

const OVERRIDE_COLUMNS =
  'place_id, slug, category, services, hours, price_note, hidden_photos, added_photos, published, updated_by, created_at, updated_at';

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toOverride(row: OverrideRow): ProfileOverride {
  return {
    placeId: row.place_id,
    slug: row.slug,
    category: isCategory(row.category) ? row.category : 'nails',
    services: row.services === null ? null : parseJson<ProfileService[]>(row.services, []),
    hours: row.hours === null ? null : parseJson<ProfileHours>(row.hours, {}),
    priceNote: row.price_note,
    hiddenPhotos: parseJson<number[]>(row.hidden_photos, []),
    addedPhotos: parseJson<string[]>(row.added_photos, []),
    published: row.published === 1,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublicOverride(record: ProfileOverride): PublicProfileOverride {
  return {
    placeId: record.placeId,
    slug: record.slug,
    category: record.category,
    services: record.services,
    hours: record.hours,
    priceNote: record.priceNote,
    hiddenPhotos: record.hiddenPhotos,
    addedPhotos: record.addedPhotos,
    updatedAt: record.updatedAt,
  };
}

async function logEdit(
  db: D1Database,
  placeId: string,
  slug: string | null,
  actor: string,
  action: string,
  detail?: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profile_edit_events (place_id, slug, actor, action, detail)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(placeId, slug, actor, action, detail === undefined ? null : JSON.stringify(detail))
    .run();
}

/** The injector's hot path: one indexed lookup per detail-page view. */
export async function getPublishedOverrideBySlug(
  db: D1Database,
  slug: string,
): Promise<ProfileOverride | null> {
  const row = await db
    .prepare(`SELECT ${OVERRIDE_COLUMNS} FROM profile_overrides WHERE slug = ?1 AND published = 1`)
    .bind(slug)
    .first<OverrideRow>();
  return row ? toOverride(row) : null;
}

export async function getOverrideByPlaceId(db: D1Database, placeId: string): Promise<ProfileOverride | null> {
  const row = await db
    .prepare(`SELECT ${OVERRIDE_COLUMNS} FROM profile_overrides WHERE place_id = ?1`)
    .bind(placeId)
    .first<OverrideRow>();
  return row ? toOverride(row) : null;
}

export async function getOverrideBySlug(db: D1Database, slug: string): Promise<ProfileOverride | null> {
  return findBySlug(db, slug);
}

interface ClaimedRow {
  place_id: string;
  slug: string | null;
  name: string | null;
  category: string | null;
  owner_email: string | null;
}

const CLAIMED_SELECT = 'place_id, slug, name, category, owner_email';

/** A claimed business by registry key. */
async function claimedByPlaceId(db: D1Database, placeId: string): Promise<ClaimedRow | null> {
  return db
    .prepare(`SELECT ${CLAIMED_SELECT} FROM businesses WHERE place_id = ?1 AND claimed = 1`)
    .bind(placeId)
    .first<ClaimedRow>();
}

/** A claimed business by site slug. */
async function claimedBySlug(db: D1Database, slug: string): Promise<ClaimedRow | null> {
  return db
    .prepare(`SELECT ${CLAIMED_SELECT} FROM businesses WHERE slug = ?1 AND claimed = 1 ORDER BY claimed_at ASC`)
    .bind(slug)
    .first<ClaimedRow>();
}

/**
 * A claimed business by slug *and* owner email. Duplicate Google listings exist for
 * the same salon (and share a slug), so the email is what disambiguates a login.
 */
async function claimedBySlugAndEmail(
  db: D1Database,
  slug: string,
  email: string,
): Promise<ClaimedRow | null> {
  return db
    .prepare(
      `SELECT ${CLAIMED_SELECT} FROM businesses
       WHERE slug = ?1 AND claimed = 1 AND lower(owner_email) = lower(?2)
       ORDER BY claimed_at ASC`,
    )
    .bind(slug, email)
    .first<ClaimedRow>();
}

/**
 * Resolve the `business` field of the login form. Owners type whatever is in their
 * listing URL (`acuarela-nails`) but the registry key is a place id, and the two
 * shapes overlap — `acuarela-nails` satisfies any sane place-id pattern — so the
 * likely lookup runs first and the other one is always tried as a fallback.
 *
 * Pass `email` when the caller has it: it resolves the duplicate-slug case.
 */
export async function resolveClaimedBusiness(
  db: D1Database,
  business: string,
  email?: string,
): Promise<{
  placeId: string;
  slug: string | null;
  name: string | null;
  category: string | null;
  ownerEmail: string;
} | null> {
  const value = business.trim();
  if (!value) return null;

  const looksLikePlaceId = isPlaceId(value);
  let row: ClaimedRow | null = null;

  if (looksLikePlaceId) row = await claimedByPlaceId(db, value);
  if (!row && email) row = await claimedBySlugAndEmail(db, value, email);
  if (!row) row = looksLikePlaceId ? await claimedBySlug(db, value) : await claimedByPlaceId(db, value);
  if (!row || !row.owner_email) return null;

  return {
    placeId: row.place_id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    ownerEmail: row.owner_email,
  };
}

export interface ProfilePatch {
  services?: unknown;
  hours?: unknown;
  priceNote?: unknown;
  hiddenPhotos?: unknown;
  addedPhotos?: unknown;
}

/**
 * Create or replace the owner's profile content. Only keys present in `patch`
 * are touched, so the dashboard can save one section at a time; `services` /
 * `hours` sent as empty collections deliberately blank the section.
 */
export async function saveOverride(
  db: D1Database,
  input: {
    placeId: string;
    slug: string;
    category: Category;
    patch: ProfilePatch;
  },
): Promise<ProfileOverride> {
  const { placeId, patch } = input;
  const slug = normalizeSlug(input.slug);
  if (!isCategory(input.category)) {
    throw new ProfileError('invalid_body', 'category must be nails or massage');
  }

  const before = await getOverrideByPlaceId(db, placeId);
  const services =
    patch.services === undefined
      ? before?.services ?? null
      : validateServices(patch.services);
  const hours =
    patch.hours === undefined ? before?.hours ?? null : validateHours(patch.hours);
  const priceNote =
    patch.priceNote === undefined ? before?.priceNote ?? null : validatePriceNote(patch.priceNote);
  const hiddenPhotos =
    patch.hiddenPhotos === undefined
      ? before?.hiddenPhotos ?? []
      : validatePhotoIndexes(patch.hiddenPhotos);
  const addedPhotos =
    patch.addedPhotos === undefined
      ? before?.addedPhotos ?? []
      : validatePhotoUrls(patch.addedPhotos);

  for (const url of addedPhotos) {
    if (before?.addedPhotos.includes(url)) continue; // already verified once
    await assertImageReachable(url);
  }

  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO profile_overrides
         (place_id, slug, category, services, hours, price_note, hidden_photos, added_photos,
          published, updated_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 'owner', ?9, ?9)
       ON CONFLICT (place_id) DO UPDATE SET
         slug          = excluded.slug,
         category      = excluded.category,
         services      = excluded.services,
         hours         = excluded.hours,
         price_note    = excluded.price_note,
         hidden_photos = excluded.hidden_photos,
         added_photos  = excluded.added_photos,
         published     = 1,
         updated_by    = 'owner',
         updated_at    = excluded.updated_at`,
    )
    .bind(
      placeId,
      slug,
      input.category,
      services === null ? null : JSON.stringify(services),
      hours === null ? null : JSON.stringify(hours),
      priceNote,
      JSON.stringify(hiddenPhotos),
      JSON.stringify(addedPhotos),
      now,
    )
    .run();

  const record = (await getOverrideByPlaceId(db, placeId))!;
  await logEdit(db, placeId, slug, 'owner', before ? 'owner_save' : 'owner_create', {
    services: services?.length ?? null,
    hours: hours ? Object.values(hours).filter(Boolean).length : null,
    priceNote: priceNote ? true : null,
    hiddenPhotos,
    addedPhotos,
    published: true,
  });
  return record;
}

/** Owner-triggered reset: drop back to the Google-derived defaults. */
export async function resetOverride(db: D1Database, placeId: string): Promise<boolean> {
  const before = await getOverrideByPlaceId(db, placeId);
  if (!before) return false;
  await db.prepare(`DELETE FROM profile_overrides WHERE place_id = ?1`).bind(placeId).run();
  await logEdit(db, placeId, before.slug, 'owner', 'owner_reset', { previous: toPublicOverride(before) });
  return true;
}

export async function listPublishedOverrides(
  db: D1Database,
  options: { limit?: number; offset?: number } = {},
): Promise<{ total: number; records: ProfileOverride[] }> {
  const limit = Math.min(Math.max(options.limit ?? LIMITS.listPageSize, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = await db
    .prepare(
      `SELECT ${OVERRIDE_COLUMNS} FROM profile_overrides WHERE published = 1
       ORDER BY updated_at DESC, slug ASC LIMIT ?1 OFFSET ?2`,
    )
    .bind(limit, offset)
    .all<OverrideRow>();
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM profile_overrides WHERE published = 1`)
    .first<{ n: number }>();
  return { total: count?.n ?? 0, records: (rows.results ?? []).map(toOverride) };
}

/** Operator moderation: take an edit down or put it back up. */
export async function setOverridePublished(
  db: D1Database,
  key: string,
  published: boolean,
  actor = 'operator',
): Promise<ProfileOverride> {
  const record = (await getOverrideByPlaceId(db, key)) ?? (await findBySlug(db, key));
  if (!record) throw new ProfileError('not_found', `no profile edits for ${key}`, 404);
  const now = nowIso();
  await db
    .prepare(`UPDATE profile_overrides SET published = ?2, updated_by = ?3, updated_at = ?4 WHERE place_id = ?1`)
    .bind(record.placeId, published ? 1 : 0, actor, now)
    .run();
  await logEdit(db, record.placeId, record.slug, actor, published ? 'operator_publish' : 'operator_unpublish', null);
  return (await getOverrideByPlaceId(db, record.placeId))!;
}

/** Operator/test removal: deletes the row (the audit trail stays). */
export async function deleteOverride(db: D1Database, key: string, actor = 'operator'): Promise<boolean> {
  const record = (await getOverrideByPlaceId(db, key)) ?? (await findBySlug(db, key));
  if (!record) return false;
  await db.prepare(`DELETE FROM profile_overrides WHERE place_id = ?1`).bind(record.placeId).run();
  await logEdit(db, record.placeId, record.slug, actor, 'operator_delete', null);
  return true;
}

async function findBySlug(db: D1Database, slug: string): Promise<ProfileOverride | null> {
  const row = await db
    .prepare(`SELECT ${OVERRIDE_COLUMNS} FROM profile_overrides WHERE slug = ?1`)
    .bind(slug)
    .first<OverrideRow>();
  return row ? toOverride(row) : null;
}

export interface EditEvent {
  id: number;
  placeId: string;
  slug: string | null;
  actor: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

export async function listEditEvents(db: D1Database, placeId: string): Promise<EditEvent[]> {
  const rows = await db
    .prepare(
      `SELECT id, place_id, slug, actor, action, detail, created_at
       FROM profile_edit_events WHERE place_id = ?1 ORDER BY id ASC`,
    )
    .bind(placeId)
    .all<{
      id: number;
      place_id: string;
      slug: string | null;
      actor: string;
      action: string;
      detail: string | null;
      created_at: string;
    }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    placeId: row.place_id,
    slug: row.slug,
    actor: row.actor,
    action: row.action,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}
