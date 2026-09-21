#!/usr/bin/env node
'use strict';
/**
 * Ownership lifecycle regression suite — fully offline, real SQLite, real handlers.
 *
 * What it protects (independent review of 2026-09-20, findings B1-B5 and the
 * rollout/migration blockers, /tmp/bc-ownership-independent-review.md):
 *
 *   B1  a publication from a revoked or unapproved claimant must not be public
 *   B2  an ownership approval must bind to the claimant/generation the operator
 *       reviewed, and the state change plus its audit row must be atomic
 *   B3  an owner write that is already in flight must not publish after a revoke
 *   B4  credentials issued before the approval gate must not reactivate
 *   B5  a named approver is required, and is never inferred from the calling actor
 *   +   the migration's schema invariant must make the old writer fail closed
 *   +   the populated migration / restore path must be rehearsed, not assumed
 *
 * How it runs: the current TypeScript sources are transpiled in memory and executed
 * against a D1-shaped adapter over node:sqlite, with the repository's real migration
 * SQL applied in order. `global.fetch` rejects by default, so any test that reached
 * the network would fail loudly; the photo-reachability test installs a controlled
 * fetch and counts its calls. Nothing is deployed, no Cloudflare/Google call is made,
 * no repository file is written (file-backed databases live in a temp dir).
 *
 * Honest limits: interleavings are produced by a deterministic hook at real SQL
 * statement boundaries on ONE connection. That models "the revoke commits before this
 * statement executes"; it is not a reproduction of a live Cloudflare race, and the
 * one-connection model makes each test's nested lifecycle calls share a transaction
 * (savepoint-nested), which real D1 would run as separate transactions.
 *
 * Usage:
 *   node scripts/ownership-lifecycle-test.cjs                # test this checkout
 *   BC_TEST_ROOT=/tmp/pre-fix/tree node scripts/ownership-lifecycle-test.cjs
 *     (pointed at a pre-correction tree, the B1-B5 checks must FAIL — that is the
 *      discrimination check, not a bug in the suite)
 *
 * Exit code 0 = every assertion passed.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(process.env.BC_TEST_ROOT || path.join(__dirname, '..'));
const ts = require('typescript');

const PLACE = 'ChIJlifecycleFixture01';
const SLUG = 'fixture-salon-one';
const LEGACY_EMAIL = 'legacy-fixture@example.invalid';
const OPERATOR_TOKEN = 'fixture-admin-token';
const APPROVED_AT = '2026-09-19T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
function section(title) {
  console.log('\n# ' + title);
}
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('  ok   ' + name);
  } else {
    failures.push(name + (detail ? ' :: ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' :: ' + detail : ''));
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------------------
// TypeScript loader (in-memory only)
// ---------------------------------------------------------------------------
const mods = {};
function load(p) {
  const resolved = path.resolve(p);
  const withExt = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
  if (mods[withExt]) return mods[withExt].exports;
  const module_ = { exports: {} };
  mods[withExt] = module_;
  const source = ts.transpileModule(fs.readFileSync(withExt, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})', { filename: withExt })(
    (q) => (q.startsWith('.') ? load(path.resolve(path.dirname(withExt), q)) : require(q)),
    module_,
    module_.exports,
  );
  return module_.exports;
}

const funcs = path.join(ROOT, 'functions');
const reg = load(path.join(funcs, '_lib/registry.ts'));
const prof = load(path.join(funcs, '_lib/profile.ts'));
const ownerProfileRoute = load(path.join(funcs, 'api/owner/profile/[placeId].ts'));
const ownerSessionRoute = load(path.join(funcs, 'api/owner/session.ts'));
const ownerSessionVerifyRoute = load(path.join(funcs, 'api/owner/session/verify.ts'));
const registryRoute = load(path.join(funcs, 'api/registry/[placeId].ts'));
const overridesRoute = load(path.join(funcs, 'api/profile-overrides/[key].ts'));

// ---------------------------------------------------------------------------
// D1 adapter over node:sqlite
// ---------------------------------------------------------------------------
let NETWORK_CALLS = 0;
function forbidNetwork() {
  global.fetch = async (url) => {
    NETWORK_CALLS += 1;
    throw new Error(`NETWORK FORBIDDEN IN THIS SUITE: ${url}`);
  };
}
forbidNetwork();

class D1Shim {
  constructor(file = ':memory:') {
    this.sql = new DatabaseSync(file);
    this.hook = null;
    this.depth = 0;
    this.savepoints = 0;
  }
  prepare(sql) {
    const self = this;
    let args = [];
    function toNamed() {
      return Object.fromEntries(args.map((value, i) => ['p' + (i + 1), value]));
    }
    function compiled() {
      return self.sql.prepare(sql.replace(/\?(\d+)/g, ':p$1'));
    }
    function invoke(method) {
      const stmt = compiled();
      const params = toNamed();
      if (method === 'get') return Object.keys(params).length ? stmt.get(params) : stmt.get();
      if (method === 'all') return Object.keys(params).length ? stmt.all(params) : stmt.all();
      return Object.keys(params).length ? stmt.run(params) : stmt.run();
    }
    const handle = {
      bind(...values) {
        args = values;
        return handle;
      },
      async first() {
        return invoke('get') ?? null;
      },
      async all() {
        return { results: invoke('all') };
      },
      async run() {
        // The hook fires at the real statement boundary, i.e. after any earlier
        // statement of the same transaction has already been applied.
        if (self.hook) await self.hook(sql);
        const result = invoke('run');
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
    return handle;
  }
  exec(sql) {
    this.sql.exec(sql);
  }
  async batch(statements) {
    const nested = this.depth > 0;
    const name = `savepoint_${++this.savepoints}`;
    this.sql.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN');
    this.depth += 1;
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      this.sql.exec(nested ? `RELEASE ${name}` : 'COMMIT');
      this.depth -= 1;
      return out;
    } catch (error) {
      if (nested) {
        this.sql.exec(`ROLLBACK TO ${name}`);
        this.sql.exec(`RELEASE ${name}`);
      } else {
        this.sql.exec('ROLLBACK');
      }
      this.depth -= 1;
      throw error;
    }
  }
  close() {
    this.sql.close();
  }
  // test-only helpers -------------------------------------------------------
  // Tolerant on purpose: pointed at a pre-correction tree these must turn missing
  // schema into a failed assertion rather than aborting the whole run, so the
  // discrimination check reports every broken invariant.
  rows(sql, ...params) {
    try {
      return this.sql.prepare(sql).all(...params);
    } catch {
      return [];
    }
  }
  row(sql, ...params) {
    try {
      return this.sql.prepare(sql).get(...params) ?? null;
    } catch {
      return null;
    }
  }
  count(sql, ...params) {
    const row = this.row(sql, ...params);
    return row === null ? -1 : Number(row.n ?? -1);
  }
}

function migrationNames() {
  return fs
    .readdirSync(path.join(ROOT, 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
}
function applyMigrations(db, filter = () => true) {
  for (const name of migrationNames()) {
    if (!filter(name)) continue;
    db.exec(fs.readFileSync(path.join(ROOT, 'migrations', name), 'utf8'));
  }
}
/** Every migration except the ownership gate (0006/0007) — the pre-gate world. */
function legacyDb(file = ':memory:') {
  const db = new D1Shim(file);
  applyMigrations(db, (name) => !name.startsWith('0006') && !name.startsWith('0007'));
  return db;
}
/** The post-correction world. */
function currentDb(file = ':memory:') {
  const db = new D1Shim(file);
  applyMigrations(db);
  return db;
}
function withOwnershipGate(db) {
  applyMigrations(db, (name) => name.startsWith('0006') || name.startsWith('0007'));
  return db;
}

// ---------------------------------------------------------------------------
// Fixtures + request helpers
// ---------------------------------------------------------------------------
function insertLegacyBusiness(db, { email = LEGACY_EMAIL, verified = 1 } = {}) {
  db.sql
    .prepare(
      `INSERT INTO businesses (place_id, slug, claimed, verified, owner_email, claimed_at, verified_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(PLACE, SLUG, verified, email, APPROVED_AT, verified ? APPROVED_AT : null);
}
function insertLegacyPublication(db, { note = 'UNAPPROVED LEGACY CONTENT' } = {}) {
  db.sql
    .prepare(
      `INSERT INTO profile_overrides
         (place_id, slug, category, services, hours, price_note, whatsapp, hidden_photos,
          added_photos, published, updated_by, created_at, updated_at)
       VALUES (?, ?, 'nails', NULL, NULL, ?, NULL, '[]', '[]', 1, 'owner', ?, ?)`,
    )
    .run(PLACE, SLUG, note, APPROVED_AT, APPROVED_AT);
}
function sessionIdFor(token, placeId = PLACE) {
  return crypto.createHash('sha256').update(`${token}:${placeId}`).digest('hex');
}
/** A credential as the pre-gate code version would have minted it. */
function insertLegacyCredential(db, token, { kind = 'session' } = {}) {
  db.sql
    .prepare(
      `INSERT INTO owner_sessions (id, place_id, email, kind, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionIdFor(token),
      PLACE,
      LEGACY_EMAIL,
      kind,
      '2027-01-01T00:00:00.000Z',
      APPROVED_AT,
    );
}
function env(db) {
  return {
    DB: db,
    REGISTRY_ADMIN_TOKEN: OPERATOR_TOKEN,
    PUBLIC_SITE_URL: 'http://127.0.0.1:8821',
    CLAIM_CODE_SECRET: 'suite-only-secret-at-least-32-characters-long',
  };
}
function ctx(db, method, body = {}, { token = '', admin = '', url = `https://local.invalid/api/owner/profile/${PLACE}` } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-owner-session'] = token;
  if (admin) headers['x-registry-admin-token'] = admin;
  return {
    env: env(db),
    params: { placeId: PLACE, key: SLUG },
    request: new Request(url, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }),
    waitUntil() {},
  };
}
async function attempt(fn) {
  try {
    const value = await fn();
    return { status: value && value.status, code: null, value };
  } catch (error) {
    return { status: error.status ?? null, code: error.code ?? null, message: error.message, error };
  }
}
async function routeStatus(responsePromise) {
  return (await responsePromise).status;
}
/** Claim → approve → log in, all through the real code, and return the token. */
async function establishApprovedOwner(db, email = LEGACY_EMAIL, expectedGeneration = 0) {
  await reg.claimBusiness(db, { placeId: PLACE, slug: SLUG, ownerEmail: email, name: 'Fixture' });
  await reg.approveOwnership(db, PLACE, {
    approvedBy: 'fixture-reviewer',
    evidence: 'fixture independent evidence',
    expectedOwnerEmail: email,
    expectedClaimGeneration: expectedGeneration,
    actor: 'fixture-operator',
  });
  const code = await prof.issueLoginCode(db, PLACE, email);
  const session = await prof.verifyLoginCode(db, PLACE, code.code);
  return session.token;
}

// ---------------------------------------------------------------------------
(async () => {
  console.log(`ownership lifecycle suite — root ${ROOT}`);
  console.log(`migrations: ${migrationNames().join(', ')}`);

  // -------------------------------------------------------------------------
  section('A. a fresh mailbox claim only opens a review (unchanged control)');
  {
    const db = currentDb();
    const claim = load(path.join(funcs, '_lib/claim.ts'));
    const biz = { placeId: PLACE, slug: SLUG, name: 'Fixture', category: 'nails' };
    const envA = env(db);
    await claim.startClaim(envA, biz, { email: LEGACY_EMAIL, ip: null });
    const raw = db.row('SELECT code_pending FROM claim_requests');
    const result = await claim.verifyClaim(envA, biz, { email: LEGACY_EMAIL, code: raw.code_pending });
    eq('claim state is pending_approval', result.state, 'pending_approval');
    eq('claim does not verify ownership', result.business.verified, false);
    const login = await attempt(() =>
      ownerSessionRoute.onRequestPost(ctx(db, 'POST', { business: SLUG, email: LEGACY_EMAIL }, {
        url: 'https://local.invalid/api/owner/session',
      })),
    );
    eq('owner login while pending is refused', login.value?.status, 403);
    eq('no owner session was minted', db.count("SELECT COUNT(*) n FROM owner_sessions WHERE kind = 'session'"), 0);
    const events = (await reg.listEvents(db, PLACE)).map((e) => e.event);
    eq('audit trail holds the claim only', events.join(','), 'claim');
  }

  // -------------------------------------------------------------------------
  section('B. B1 — publications and credentials are quarantined by the migration');
  {
    const db = legacyDb();
    insertLegacyBusiness(db);
    insertLegacyPublication(db);
    insertLegacyCredential(db, 'legacy-session-token-value', { kind: 'session' });
    insertLegacyCredential(db, 'legacy-code-row-value', { kind: 'code' });

    const preRollout = await attempt(() => prof.getPublishedOverrideBySlug(db, SLUG));
    check(
      'the corrected code cannot run on a pre-0007 schema (migrate before deploying code)',
      Boolean(preRollout.error),
      preRollout.message,
    );
    eq('pre-migration publication is stored as published', (db.row('SELECT published FROM profile_overrides WHERE place_id = ?', PLACE) ?? {}).published, 1);

    withOwnershipGate(db);

    eq('after migration the legacy publication disappears from the public read', await prof.getPublishedOverrideBySlug(db, SLUG), null);
    eq('public list exposes nothing', (await prof.listPublishedOverrides(db)).total, 0);
    const row = db.row('SELECT published, claim_generation, updated_by FROM profile_overrides WHERE place_id = ?', PLACE) ?? {};
    eq('the row itself is unpublished', row.published, 0);
    eq('the row is unbound from any approval generation', row.claim_generation, null);
    eq('the migration is recorded as the actor', row.updated_by, 'migration-0007');
    eq('quarantine log holds the publication', db.count("SELECT COUNT(*) n FROM ownership_quarantine_log WHERE kind = 'publication'"), 1);
    eq('quarantine log holds the login code', db.count("SELECT COUNT(*) n FROM ownership_quarantine_log WHERE kind = 'login_code'"), 1);
    eq('quarantine log holds the session', db.count("SELECT COUNT(*) n FROM ownership_quarantine_log WHERE kind = 'session'"), 1);
    eq('every pre-existing credential is marked generation -1', db.count("SELECT COUNT(*) n FROM owner_sessions WHERE approval_generation = -1"), 2);
    check('the quarantine is auditable', db.count("SELECT COUNT(*) n FROM registry_events WHERE event = 'ownership_review_required'") >= 1);
    const publicRead = await routeStatus(overridesRoute.onRequestGet(ctx(db, 'GET', {}, { url: `https://local.invalid/api/profile-overrides/${SLUG}` })));
    eq('public single-read route refuses quarantined content', publicRead, 404);
    const legacyToken = 'legacy-session-token-value';
    const legacyGet = await routeStatus(ownerProfileRoute.onRequestGet(ctx(db, 'GET', {}, { token: legacyToken })));
    eq('operator read still finds the quarantined row', (await (await overridesRoute.onRequestGet(ctx(db, 'GET', {}, { admin: OPERATOR_TOKEN, url: `https://local.invalid/api/profile-overrides/${SLUG}` }))).json()).ok, true);
    eq('legacy credential cannot read the private editor while pending', legacyGet, 403);
  }

  // -------------------------------------------------------------------------
  section('B2. B1 — an approved owner can publish, and a revoke withdraws it');
  {
    const db = legacyDb();
    insertLegacyBusiness(db);
    insertLegacyPublication(db);
    withOwnershipGate(db);
    const token = await establishApprovedOwner(db);

    const put = await routeStatus(
      ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { priceNote: 'OWNER PUBLISHED CONTENT' }, { token })),
    );
    eq('approved owner can save (positive control)', put, 200);
    const published = await prof.getPublishedOverrideBySlug(db, SLUG);
    eq('the new content is public', published?.priceNote, 'OWNER PUBLISHED CONTENT');
    eq('public list shows the approved content', (await prof.listPublishedOverrides(db)).total, 1);

    await reg.revokeBusiness(db, PLACE, 'fixture-operator', 'fixture revoke');
    eq('revoke withdraws the publication from the public read', await prof.getPublishedOverrideBySlug(db, SLUG), null);
    eq('revoke empties the public list', (await prof.listPublishedOverrides(db)).total, 0);
    const afterRow = db.row('SELECT published, claim_generation FROM profile_overrides WHERE place_id = ?', PLACE) ?? {};
    eq('the stored row is unpublished after revoke', afterRow.published, 0);
    eq('the stored row is unbound after revoke', afterRow.claim_generation, null);
    check('the revoke is recorded in the edit trail', db.count("SELECT COUNT(*) n FROM profile_edit_events WHERE action = 'ownership_unpublished'") >= 1);
    const publicAfter = await routeStatus(overridesRoute.onRequestGet(ctx(db, 'GET', {}, { url: `https://local.invalid/api/profile-overrides/${SLUG}` })));
    eq('public single-read route refuses revoked content', publicAfter, 404);
    const adminStillSees = await (await overridesRoute.onRequestGet(ctx(db, 'GET', {}, { admin: OPERATOR_TOKEN, url: `https://local.invalid/api/profile-overrides/${SLUG}` }))).json();
    eq('operator read still exposes the withdrawn row for moderation', adminStillSees.override.priceNote, 'OWNER PUBLISHED CONTENT');

    const republish = await attempt(() => prof.setOverridePublished(db, SLUG, true, 'operator-api'));
    eq('operator cannot re-publish content for a listing with no approved owner', republish.status, 409);
    eq('the row stays unpublished', (db.row('SELECT published FROM profile_overrides WHERE place_id = ?', PLACE) ?? {}).published, 0);
  }

  // -------------------------------------------------------------------------
  section('C. B2 — the approval binds to the reviewed claimant and is atomic');
  {
    const db = currentDb();
    await reg.claimBusiness(db, { placeId: PLACE, slug: SLUG, ownerEmail: 'a@example.invalid', name: 'Fixture' });
    const before = await reg.getBusiness(db, PLACE);
    eq('a claim starts at generation 0', before.approvalGeneration, 0);

    // The operator reviewed claimant A at generation 0; a revoke + reclaim by B lands
    // immediately before the approval statement executes.
    let fired = false;
    db.hook = async (sql) => {
      if (!fired && sql.includes('SET verified = 1')) {
        fired = true;
        db.hook = null;
        await reg.revokeBusiness(db, PLACE, 'fixture-operator', 'interleaved revoke');
        await reg.claimBusiness(db, { placeId: PLACE, slug: SLUG, ownerEmail: 'b@example.invalid' });
      }
    };
    const stale = await attempt(() =>
      reg.approveOwnership(db, PLACE, {
        approvedBy: 'fixture-reviewer',
        evidence: 'independent evidence for claimant A',
        expectedOwnerEmail: 'a@example.invalid',
        expectedClaimGeneration: 0,
        actor: 'fixture-operator',
      }),
    );
    eq('a stale approval is refused', stale.status, 409);
    eq('the refusal is an approval conflict', stale.code, 'approval_conflict');
    const after = await reg.getBusiness(db, PLACE);
    eq('the replacement claimant is still the owner', after.ownerEmail, 'b@example.invalid');
    eq('the replacement claimant was not verified', after.verified, false);
    eq('no provenance was recorded', after.ownershipApprovedBy, null);
    eq('no approval generation was granted', after.approvalGeneration, 1);
    const events = db.rows('SELECT event, detail FROM registry_events WHERE place_id = ? ORDER BY id', PLACE);
    eq('no ownership_approved event was left behind', events.filter((e) => e.event === 'ownership_approved').length, 0);
    check('the audit trail records the interleaved lifecycle in order', events.map((e) => e.event).join(',') === 'claim,revoke,claim', events.map((e) => e.event).join(','));

    const correct = await attempt(() =>
      reg.approveOwnership(db, PLACE, {
        approvedBy: 'fixture-reviewer',
        evidence: 'independent evidence for claimant B',
        expectedOwnerEmail: 'b@example.invalid',
        expectedClaimGeneration: 1,
        actor: 'fixture-operator',
      }),
    );
    eq('the correct expectation approves (positive control)', correct.status, undefined);
    const approved = await reg.getBusiness(db, PLACE);
    eq('the approved owner is the one the operator reviewed', approved.ownerEmail, 'b@example.invalid');
    eq('the approval is recorded', approved.verified, true);
    eq('the approver is recorded', approved.ownershipApprovedBy, 'fixture-reviewer');
    eq('the generation advanced', approved.approvalGeneration, 2);
    const approvalEvent = JSON.parse(
      (db.row("SELECT detail FROM registry_events WHERE event = 'ownership_approved' ORDER BY id DESC LIMIT 1") ?? {
        detail: '{}',
      }).detail ?? '{}',
    );
    eq('the audit event names the reviewed claimant', approvalEvent.ownerEmail, 'b@example.invalid');
    eq('the audit event names the reviewed generation', approvalEvent.claimGenerationReviewed, 1);
    eq('the audit event records the server-controlled credential class as the actor', approvalEvent.actor, 'shared-operator-token');
    eq('the caller-supplied name is kept separately and labelled operator-asserted', approvalEvent.actorAssertedBy, 'fixture-operator');
    eq('the asserted name is never presented as a credential', approvalEvent.actorAssertedSource, 'operator-asserted-request-body');
    check('the audit detail does not claim an authenticated individual', approvalEvent.credentialSource === 'server-verified-request-credential');

    // wrong claimant, right generation
    const wrongClaimant = await attempt(() =>
      reg.approveOwnership(db, PLACE, {
        approvedBy: 'fixture-reviewer',
        evidence: 'evidence for somebody else',
        expectedOwnerEmail: 'a@example.invalid',
        expectedClaimGeneration: 2,
        actor: 'fixture-operator',
      }),
    );
    eq('approving a different claimant than the one claimed is refused', wrongClaimant.status, 409);
  }

  // -------------------------------------------------------------------------
  section('C2. B2 — an audit failure cannot leave an approval behind');
  {
    const db = currentDb();
    await reg.claimBusiness(db, { placeId: PLACE, slug: SLUG, ownerEmail: 'a@example.invalid' });
    db.exec("CREATE TRIGGER suite_audit_abort BEFORE INSERT ON registry_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    const broken = await attempt(() =>
      reg.approveOwnership(db, PLACE, {
        approvedBy: 'fixture-reviewer',
        evidence: 'independent evidence',
        expectedOwnerEmail: 'a@example.invalid',
        expectedClaimGeneration: 0,
        actor: 'fixture-operator',
      }),
    );
    check('the approval fails when its audit row cannot be written', broken.error instanceof Error, broken.message);
    eq('the transition was rolled back with the audit', (await reg.getBusiness(db, PLACE)).verified, false);
    eq('no generation was granted', (await reg.getBusiness(db, PLACE)).approvalGeneration, 0);
    eq('no approval event exists', db.count("SELECT COUNT(*) n FROM registry_events WHERE event = 'ownership_approved'"), 0);
    db.exec('DROP TRIGGER suite_audit_abort');
    const fixed = await attempt(() =>
      reg.approveOwnership(db, PLACE, {
        approvedBy: 'fixture-reviewer',
        evidence: 'independent evidence',
        expectedOwnerEmail: 'a@example.invalid',
        expectedClaimGeneration: 0,
        actor: 'fixture-operator',
      }),
    );
    eq('the same approval succeeds once the audit is available (positive control)', fixed.status, undefined);
    eq('the approval is recorded after the control', (await reg.getBusiness(db, PLACE)).verified, true);
  }

  // -------------------------------------------------------------------------
  section('D. B3 — an in-flight owner write cannot publish after a revoke');
  {
    const db = currentDb();
    const token = await establishApprovedOwner(db, 'a@example.invalid');
    eq('the owner can save before the revoke (positive control)', await routeStatus(ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { priceNote: 'BEFORE REVOKE' }, { token }))), 200);
    eq('that content is public', (await prof.getPublishedOverrideBySlug(db, SLUG))?.priceNote, 'BEFORE REVOKE');

    let fired = false;
    db.hook = async (sql) => {
      if (!fired && sql.includes('INSERT INTO profile_overrides')) {
        fired = true;
        db.hook = null;
        await reg.revokeBusiness(db, PLACE, 'fixture-operator', 'interleaved revoke');
      }
    };
    const race = await routeStatus(
      ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { priceNote: 'WRITTEN AFTER REVOCATION' }, { token })),
    );
    eq('the write that raced the revoke is refused', race, 403);
    eq('nothing was published by the racing write', await prof.getPublishedOverrideBySlug(db, SLUG), null);
    eq('no stored content carries the revoked write', db.count("SELECT COUNT(*) n FROM profile_overrides WHERE price_note = 'WRITTEN AFTER REVOCATION'"), 0);
    eq('the business is no longer claimed', (await reg.getBusiness(db, PLACE)).claimed, false);
  }

  // -------------------------------------------------------------------------
  section('D2. B3 — an in-flight reset cannot delete after a revoke');
  {
    const db = currentDb();
    const token = await establishApprovedOwner(db, 'a@example.invalid');
    await routeStatus(ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { priceNote: 'SAVED CONTENT' }, { token })));
    let fired = false;
    db.hook = async (sql) => {
      if (!fired && sql.includes('DELETE FROM profile_overrides')) {
        fired = true;
        db.hook = null;
        await reg.revokeBusiness(db, PLACE, 'fixture-operator', 'interleaved revoke');
      }
    };
    const race = await routeStatus(ownerProfileRoute.onRequestDelete(ctx(db, 'DELETE', {}, { token })));
    eq('the reset that raced the revoke is refused', race, 403);
    eq('the row still exists', db.count('SELECT COUNT(*) n FROM profile_overrides WHERE place_id = ?', PLACE), 1);
    eq('the row is still unpublished', (db.row('SELECT published FROM profile_overrides WHERE place_id = ?', PLACE) ?? {}).published, 0);

    const db2 = currentDb();
    const token2 = await establishApprovedOwner(db2, 'a@example.invalid');
    await routeStatus(ownerProfileRoute.onRequestPut(ctx(db2, 'PUT', { priceNote: 'SAVED CONTENT' }, { token: token2 })));
    eq('an approved owner can still reset their content (positive control)', await routeStatus(ownerProfileRoute.onRequestDelete(ctx(db2, 'DELETE', {}, { token: token2 }))), 200);
    eq('the reset removed the row', db2.count('SELECT COUNT(*) n FROM profile_overrides WHERE place_id = ?', PLACE), 0);
  }

  // -------------------------------------------------------------------------
  section('E. B4 — pre-gate credentials never reactivate');
  {
    const db = legacyDb();
    insertLegacyBusiness(db);
    insertLegacyCredential(db, 'legacy-session-token-value', { kind: 'session' });
    // A code row as the old code version minted it: sha256('<code>:<place id>').
    insertLegacyCredential(db, '222222', { kind: 'code' });
    withOwnershipGate(db);
    const legacyToken = 'legacy-session-token-value';
    const exchangeLegacyCode = () =>
      ownerSessionVerifyRoute.onRequestPost(
        ctx(db, 'POST', { business: SLUG, code: '222222' }, { url: 'https://local.invalid/api/owner/session/verify' }),
      );

    eq('legacy token is refused while pending', await routeStatus(ownerProfileRoute.onRequestGet(ctx(db, 'GET', {}, { token: legacyToken }))), 403);
    eq('a pre-gate code is refused while pending', await routeStatus(exchangeLegacyCode()), 403);

    await reg.approveOwnership(db, PLACE, {
      approvedBy: 'fixture-reviewer',
      evidence: 'fixture independent evidence',
      expectedOwnerEmail: LEGACY_EMAIL,
      expectedClaimGeneration: 0,
      actor: 'fixture-operator',
    });
    const approved = await reg.getBusiness(db, PLACE);
    eq('the re-approval grants a new generation', approved.approvalGeneration, 1);
    eq('the legacy session token is still refused after re-approval', await routeStatus(ownerProfileRoute.onRequestGet(ctx(db, 'GET', {}, { token: legacyToken }))), 403);
    const legacyPut = await routeStatus(ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { priceNote: 'LEGACY TOKEN WRITE' }, { token: legacyToken })));
    eq('the legacy token cannot write after re-approval', legacyPut, 403);
    eq('nothing was written', db.count("SELECT COUNT(*) n FROM profile_overrides WHERE price_note = 'LEGACY TOKEN WRITE'"), 0);
    const legacyExchange = await routeStatus(exchangeLegacyCode());
    eq('a pre-gate code cannot be exchanged after re-approval', legacyExchange, 403);
    eq('the refused exchange minted no new session', db.count("SELECT COUNT(*) n FROM owner_sessions WHERE kind = 'session' AND approval_generation <> -1"), 0);

    const code = await prof.issueLoginCode(db, PLACE, LEGACY_EMAIL);
    const session = await prof.verifyLoginCode(db, PLACE, code.code);
    eq('a fresh login works after approval (positive control)', await routeStatus(ownerProfileRoute.onRequestGet(ctx(db, 'GET', {}, { token: session.token }))), 200);

    await reg.revokeBusiness(db, PLACE, 'fixture-operator', 'same-email revoke');
    await reg.claimBusiness(db, { placeId: PLACE, slug: SLUG, ownerEmail: LEGACY_EMAIL });
    await reg.approveOwnership(db, PLACE, {
      approvedBy: 'fixture-reviewer',
      evidence: 'second review, same mailbox',
      expectedOwnerEmail: LEGACY_EMAIL,
      expectedClaimGeneration: 2,
      actor: 'fixture-operator',
    });
    // The revoke deletes live sessions, so the old token dies twice over (401); the
    // stronger check is the pre-gate code row, which survives both revokes and must
    // still be refused after the same mailbox is approved again.
    check(
      'a session from the previous approval cannot access the editor',
      [401, 403].includes(await routeStatus(ownerProfileRoute.onRequestGet(ctx(db, 'GET', {}, { token: session.token })))),
    );
    const sameEmailExchange = await routeStatus(exchangeLegacyCode());
    // The revoke deletes every owner_sessions row for the place, so the pre-gate code
    // is gone by then and the refusal arrives as "no active code" (401) rather than as
    // a generation conflict (403). Either way it is not redeemable; the discriminating
    // check for the generation mechanism itself is the 403 above.
    check(
      'a pre-gate code is still refused after revoke + same-email re-approval',
      [401, 403].includes(sameEmailExchange),
      String(sameEmailExchange),
    );
    eq('no publication survived the whole lifecycle', (await prof.listPublishedOverrides(db)).total, 0);
  }

  // -------------------------------------------------------------------------
  section('F. B5 — a named approver is mandatory and never inferred');
  {
    const db = currentDb();
    await reg.claimBusiness(db, { placeId: PLACE, slug: SLUG, ownerEmail: 'a@example.invalid' });
    const adminCtx = (body) =>
      ctx(db, 'PUT', { ...body, rebuild: false }, { admin: OPERATOR_TOKEN, url: `https://local.invalid/api/registry/${PLACE}` });
    const verifyBody = {
      op: 'verify',
      evidence: 'fixture evidence',
      expectedOwnerEmail: 'a@example.invalid',
      expectedClaimGeneration: 0,
    };

    const noApprover = await attempt(() => registryRoute.onRequestPut(adminCtx(verifyBody)));
    eq('verify without approvedBy is refused', noApprover.value?.status, 400);
    const blankApprover = await attempt(() => registryRoute.onRequestPut(adminCtx({ ...verifyBody, approvedBy: '   ' })));
    eq('verify with a blank approvedBy is refused', blankApprover.value?.status, 400);
    const noEvidence = await attempt(() => registryRoute.onRequestPut(adminCtx({ ...verifyBody, approvedBy: 'fixture-reviewer', evidence: '' })));
    eq('verify without evidence is still refused', noEvidence.value?.status, 400);
    const noExpectation = await attempt(() =>
      registryRoute.onRequestPut(adminCtx({ op: 'verify', evidence: 'fixture evidence', approvedBy: 'fixture-reviewer' })),
    );
    eq('verify without the expected claimant is refused', noExpectation.value?.status, 400);
    const noGeneration = await attempt(() =>
      registryRoute.onRequestPut(
        adminCtx({ op: 'verify', evidence: 'fixture evidence', approvedBy: 'fixture-reviewer', expectedOwnerEmail: 'a@example.invalid' }),
      ),
    );
    eq('verify without the expected generation is refused', noGeneration.value?.status, 400);
    eq('nothing was verified by the refused attempts', (await reg.getBusiness(db, PLACE)).verified, false);

    const wrongClaimant = await attempt(() =>
      registryRoute.onRequestPut(adminCtx({ ...verifyBody, approvedBy: 'fixture-reviewer', expectedOwnerEmail: 'b@example.invalid' })),
    );
    eq('verify for a claimant that is not the one claimed is refused', wrongClaimant.value?.status, 409);

    const ok = await registryRoute.onRequestPut(adminCtx({ ...verifyBody, approvedBy: 'fixture-reviewer' }));
    eq('a complete decision is accepted (positive control)', ok.status, 200);
    const body = await ok.json();
    eq('the recorded approver is the supplied name, not the caller', body.business.ownershipApprovedBy, 'fixture-reviewer');
    const event = JSON.parse(
      (db.row("SELECT detail FROM registry_events WHERE event = 'ownership_approved' ORDER BY id DESC LIMIT 1") ?? {
        detail: '{}',
      }).detail ?? '{}',
    );
    eq('the server-controlled credential class is the recorded actor', event.actor, 'registry-admin-token');
    eq('no individual is asserted when the body names nobody', event.actorAssertedBy, null);
    eq('the credential identifier is recorded from the server side', event.credentialIdentifier, 'X-Registry-Admin-Token');
    eq('the approver source is recorded as operator-supplied', event.approvedBySource, 'operator-supplied');
  }

  // -------------------------------------------------------------------------
  section('G. mixed-version rollout — the legacy writer fails closed');
  {
    const db = currentDb();
    await reg.claimBusiness(db, { placeId: PLACE, slug: SLUG, ownerEmail: 'a@example.invalid' });
    const legacyUpdate = await attempt(async () =>
      db.sql.prepare("UPDATE businesses SET verified = 1, verified_at = ? WHERE place_id = ?").run(APPROVED_AT, PLACE),
    );
    check('a provenance-free verify is refused by the schema', Boolean(legacyUpdate.error), legacyUpdate.message);
    eq('the business is not verified', (await reg.getBusiness(db, PLACE)).verified, false);
    eq('the owner route stays closed', await routeStatus(ownerProfileRoute.onRequestGet(ctx(db, 'GET', {}, { token: 'anything' }))), 401);

    const legacyInsert = await attempt(async () =>
      db.sql
        .prepare(
          `INSERT INTO businesses (place_id, slug, claimed, verified, owner_email, claimed_at, verified_at)
           VALUES ('ChIJlifecycleFixture02', 'fixture-salon-two', 1, 1, 'x@example.invalid', ?, ?)`,
        )
        .run(APPROVED_AT, APPROVED_AT),
    );
    check('a provenance-free insert is refused by the schema', Boolean(legacyInsert.error), legacyInsert.message);

    const db2 = currentDb();
    await reg.claimBusiness(db2, { placeId: PLACE, slug: SLUG, ownerEmail: 'a@example.invalid' });
    await reg.approveOwnership(db2, PLACE, {
      approvedBy: 'fixture-reviewer',
      evidence: 'fixture evidence',
      expectedOwnerEmail: 'a@example.invalid',
      expectedClaimGeneration: 0,
      actor: 'fixture-operator',
    });
    const drop = await attempt(async () =>
      db2.sql.prepare('UPDATE businesses SET ownership_approved_by = NULL WHERE place_id = ?').run(PLACE),
    );
    check('provenance cannot be stripped while the row stays verified', Boolean(drop.error), drop.message);
    eq('the approver is still recorded', (await reg.getBusiness(db2, PLACE)).ownershipApprovedBy, 'fixture-reviewer');
  }

  // -------------------------------------------------------------------------
  section('H. populated migration + restore rehearsal (synthetic data, file-backed)');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-ownership-rehearsal-'));
    const live = path.join(dir, 'registry.sqlite');
    const snapshot = path.join(dir, 'registry-before.sqlite');

    const pre = legacyDb(live);
    insertLegacyBusiness(pre);
    insertLegacyPublication(pre);
    insertLegacyCredential(pre, 'rehearsal-session-token', { kind: 'session' });
    insertLegacyCredential(pre, 'rehearsal-code-row', { kind: 'code' });
    pre.sql
      .prepare(
        `INSERT INTO businesses (place_id, slug, claimed, verified, owner_email, claimed_at, verified_at)
         VALUES ('ChIJlifecycleFixture02', 'fixture-salon-two', 1, 0, 'pending@example.invalid', ?, NULL)`,
      )
      .run(APPROVED_AT);
    pre.sql
      .prepare("INSERT INTO businesses (place_id, slug, claimed, verified, owner_email) VALUES ('ChIJlifecycleFixture03', 'fixture-salon-three', 0, 0, NULL)")
      .run();
    const preRows = pre.count('SELECT COUNT(*) n FROM businesses');
    eq('populated rehearsal DB has synthetic rows', preRows, 3);
    pre.close();

    fs.copyFileSync(live, snapshot);
    const snapshotHash = crypto.createHash('sha256').update(fs.readFileSync(snapshot)).digest('hex');

    // 1. migrate the populated database
    const migrated = new D1Shim(live);
    withOwnershipGate(migrated);
    eq('the legacy verified row was downgraded', migrated.count('SELECT COUNT(*) n FROM businesses WHERE verified = 1'), 0);
    eq('the pending claim was preserved', migrated.count("SELECT COUNT(*) n FROM businesses WHERE claimed = 1 AND verified = 0"), 2);
    eq('the publication was quarantined', migrated.count('SELECT COUNT(*) n FROM profile_overrides WHERE published = 1'), 0);
    eq('the quarantine log records every withdrawn artefact', migrated.count('SELECT COUNT(*) n FROM ownership_quarantine_log'), 3);
    eq('every credential is quarantined', migrated.count('SELECT COUNT(*) n FROM owner_sessions WHERE approval_generation = -1'), 2);
    eq('migration 0006 recorded its downgrade', migrated.count("SELECT COUNT(*) n FROM registry_events WHERE event = 'ownership_review_required' AND actor = 'migration-0006'"), 1);
    check('migration 0007 recorded the quarantine', migrated.count("SELECT COUNT(*) n FROM registry_events WHERE actor = 'migration-0007'") >= 1);
    migrated.close();

    // 2. restore the pre-migration snapshot and prove the state came back
    fs.copyFileSync(snapshot, live);
    const restored = new D1Shim(live);
    eq('restore returns the pre-migration verified row', restored.count('SELECT COUNT(*) n FROM businesses WHERE verified = 1'), 1);
    eq('restore returns the published content', restored.count('SELECT COUNT(*) n FROM profile_overrides WHERE published = 1'), 1);
    eq('restore returns the credentials', restored.count('SELECT COUNT(*) n FROM owner_sessions'), 2);
    eq('restore leaves no quarantine table behind', restored.count("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = 'ownership_quarantine_log'"), 0);
    restored.close();
    eq(
      'the restore source file is byte-identical to the snapshot (hash)',
      crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex'),
      snapshotHash,
    );

    // 3. re-run the migration on the restored database: a retry must be safe
    const retried = new D1Shim(live);
    let retryError = null;
    try {
      withOwnershipGate(retried);
    } catch (error) {
      retryError = error.message;
    }
    check('re-running the migration after a restore succeeds', retryError === null, String(retryError));
    eq('the retried migration reaches the same end state', retried.count('SELECT COUNT(*) n FROM businesses WHERE verified = 1'), 0);
    eq('the retry quarantines the same artefacts', retried.count('SELECT COUNT(*) n FROM ownership_quarantine_log'), 3);
    eq('the retry does not duplicate quarantine rows', retried.count('SELECT COUNT(*) n FROM ownership_quarantine_log WHERE kind = ?', 'publication'), 1);
    retried.close();

    // 4. the migrated database still refuses the legacy writer
    const postMigration = new D1Shim(live);
    const blocked = await attempt(async () =>
      postMigration.sql.prepare('UPDATE businesses SET verified = 1 WHERE place_id = ?').run('ChIJlifecycleFixture02'),
    );
    check('the migrated database refuses the old code path', Boolean(blocked.error), blocked.message);
    postMigration.close();

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // -------------------------------------------------------------------------
  section('I. photo reachability without any live HTTP dependency');
  {
    const db = currentDb();
    const token = await establishApprovedOwner(db, 'a@example.invalid');
    const before = NETWORK_CALLS;
    const insecure = await attempt(async () => prof.validatePhotoUrls(['http://insecure.example.invalid/a.jpg']));
    eq('a non-https photo URL is refused', insecure.code, 'invalid_photos');
    eq('the refusal needed no network call', NETWORK_CALLS, before);

    let calls = 0;
    const controlled = (init) => {
      global.fetch = async (url, options) => {
        calls += 1;
        return new Response('fixture', { status: init === 'ok' ? 200 : init, headers: { 'content-type': init === 'ok' ? 'image/jpeg' : 'text/html' } });
      };
    };
    controlled('ok');
    const accepted = await attempt(async () =>
      ownerProfileRoute.onRequestPut(
        ctx(db, 'PUT', { addedPhotos: ['https://photos.example.invalid/fixture.jpg'] }, { token }),
      ),
    );
    eq('an image URL is accepted through the real save path (controlled fetch)', accepted.status, 200);
    eq('the acceptance check used exactly the controlled transport', calls, 1);
    controlled(404);
    const rejected = await attempt(async () => prof.assertImageReachable('https://photos.example.invalid/missing.jpg'));
    eq('a 404 photo is refused', rejected.code, 'photo_unreachable');
    controlled(404);
    const notAnImage = await attempt(async () => prof.assertImageReachable('https://photos.example.invalid/page.html'));
    eq('a non-image response is refused', notAnImage.code, 'photo_unreachable');
    forbidNetwork();
    eq('the suite made no live HTTP call (the transport was a controlled stub)', NETWORK_CALLS, before);
    eq('the controlled transport served exactly the three photo checks', calls, 3);
  }

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Round 3 retained regressions (R1 inheritance, R2 provenance, R3 truthful actor).
  // Each case has its own negative control; the positive controls prove the harness
  // can observe the allowed path, so the refusals are discriminating.
  section('J3. round 3 — R1 partial-save inheritance, R2 provenance, R3 actor provenance');
  {
    const db = legacyDb();
    insertLegacyBusiness(db); insertLegacyPublication(db);
    withOwnershipGate(db);
    await reg.revokeBusiness(db, PLACE, 'round3-operator', 'replace the predecessor');
    const token = await establishApprovedOwner(db, 'replacement@example.invalid', 1);
    eq('R1: the predecessor content is quarantined before the replacement saves', await prof.getPublishedOverrideBySlug(db, SLUG), null);
    const put = await ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { hours: {} }, { token }));
    eq('R1: the replacement owner partial save succeeds (positive control)', put.status, 200);
    const visible = await prof.getPublishedOverrideBySlug(db, SLUG);
    check('R1: a partial save does not republish the predecessor price note', visible?.priceNote !== 'UNAPPROVED LEGACY CONTENT', JSON.stringify(visible));
    eq('R1: the omitted field is a safe default, not an inherited value', visible?.priceNote ?? null, null);
    eq('R1: the saved content belongs to the new approval generation', visible?.claimGeneration, 2);
    check('R1: the superseded content is retained as evidence', db.count("SELECT COUNT(*) n FROM ownership_quarantine_log WHERE kind = 'publication'") >= 2);
    eq('R1: the non-inheritance is recorded in the edit trail', db.count("SELECT COUNT(*) n FROM profile_edit_events WHERE action = 'ownership_predecessor_content_not_inherited'"), 1);
    const put2 = await ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { priceNote: 'NEW OWNER CONTENT' }, { token }));
    eq('R1: the approved owner can save their own value', put2.status, 200);
    const put3 = await ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { hours: {} }, { token }));
    eq('R1: a later partial save by the same owner succeeds', put3.status, 200);
    const kept = await prof.getPublishedOverrideBySlug(db, SLUG);
    eq('R1: same-generation content IS carried forward (positive control)', kept?.priceNote, 'NEW OWNER CONTENT');
  }
  {
    const db = legacyDb();
    insertLegacyBusiness(db); insertLegacyPublication(db);
    withOwnershipGate(db);
    const token = await establishApprovedOwner(db, LEGACY_EMAIL, 0);
    const put = await ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { hours: {} }, { token }));
    eq('R1: a migrated same-mailbox owner partial save succeeds', put.status, 200);
    const visible = await prof.getPublishedOverrideBySlug(db, SLUG);
    check('R1: same-mailbox migration does not carry legacy content into the new generation', visible?.priceNote !== 'UNAPPROVED LEGACY CONTENT', JSON.stringify(visible));
  }
  {
    const db = currentDb();
    const token = await establishApprovedOwner(db, 'a@example.invalid');
    const clearedEvidence = await attempt(async () => db.sql.prepare('UPDATE businesses SET ownership_evidence = NULL WHERE place_id = ?').run(PLACE));
    check('R2: clearing evidence while verified is refused by the schema', Boolean(clearedEvidence.error), clearedEvidence.message);
    const blankedApprover = await attempt(async () => db.sql.prepare("UPDATE businesses SET ownership_approved_by = '   ' WHERE place_id = ?").run(PLACE));
    check('R2: blanking the approver while verified is refused by the schema', Boolean(blankedApprover.error), blankedApprover.message);
    const missingEvidence = await attempt(async () => db.sql.prepare("INSERT INTO businesses(place_id,slug,claimed,verified,owner_email,claimed_at,ownership_approved_by) VALUES(?,?,1,1,?,'2026-09-19T00:00:00.000Z','named-person')").run('round3-no-evidence', 'round3-no-evidence', 'a@example.invalid'));
    check('R2: a verified INSERT with an approver but no evidence is refused', Boolean(missingEvidence.error), missingEvidence.message);
    const blankInsert = await attempt(async () => db.sql.prepare("INSERT INTO businesses(place_id,slug,claimed,verified,owner_email,claimed_at,ownership_approved_by,ownership_evidence) VALUES(?,?,1,1,?,'2026-09-19T00:00:00.000Z','   ','evidence on file')").run('round3-blank-approver', 'round3-blank-approver', 'a@example.invalid'));
    check('R2: a verified INSERT with a blank approver is refused', Boolean(blankInsert.error), blankInsert.message);
    const complete = await attempt(async () => db.sql.prepare("INSERT INTO businesses(place_id,slug,claimed,verified,owner_email,claimed_at,ownership_approved_by,ownership_evidence) VALUES(?,?,1,1,?,'2026-09-19T00:00:00.000Z','named-person','signed agreement on file')").run('round3-complete', 'round3-complete', 'a@example.invalid'));
    eq('R2: a complete verified INSERT is accepted (positive control)', complete.error, undefined);
    const still = db.row('SELECT ownership_approved_by, ownership_evidence FROM businesses WHERE place_id = ?', PLACE) ?? {};
    eq('R2: the refused writes left provenance intact', still.ownership_evidence, 'fixture independent evidence');

    // Seed a genuinely visible publication *before* invalidation. The earlier version of
    // this block asserted `leaked.error ? leaked.error : null` against a DB that had no
    // publication at all, so it passed whether or not the read leaked — and it would have
    // passed for a leaked row too. Read the returned value, from a state that is known good.
    const seeded = await ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { priceNote: 'VALID VISIBLE CONTENT' }, { token }));
    eq('R2: the positive-control publication is accepted', seeded.status, 200);
    const visibleBefore = await prof.getPublishedOverrideBySlug(db, SLUG);
    eq('R2: the positive-control publication is visible before invalidation (non-vacuous seed)', visibleBefore?.priceNote, 'VALID VISIBLE CONTENT');

    await db.sql.prepare('DROP TRIGGER trg_businesses_verified_requires_provenance_update').run();
    for (const field of ['ownership_evidence', 'ownership_approved_by']) {
      for (const value of [null, '   ']) {
        const label = `${field}=${JSON.stringify(value)}`;
        // The invariant is lifted here on purpose: this mixed-version row is exactly what
        // the SQL triggers cannot produce, so runtime authorization is the last defense.
        db.sql
          .prepare("UPDATE businesses SET ownership_approved_by = 'fixture-reviewer', ownership_evidence = 'fixture independent evidence' WHERE place_id = ?")
          .run(PLACE);
        const forced = await attempt(async () => db.sql.prepare(`UPDATE businesses SET ${field} = ? WHERE place_id = ?`).run(value, PLACE));
        eq(`R2: the ${label} state can only be constructed with the invariant lifted (control)`, forced.error, undefined);
        eq(`R2: the forced-invalid row really holds ${label}`, db.row(`SELECT ${field} AS value FROM businesses WHERE place_id = ?`, PLACE).value, value);
        eq(`R2: the shared predicate refuses ${label}`, reg.isOwnershipApproved(await reg.getBusiness(db, PLACE)), false);
        const leakedValue = await prof.getPublishedOverrideBySlug(db, SLUG);
        eq(`R2: the public read returns no value for ${label}`, leakedValue, null);
        eq(`R2: the private owner GET is refused for ${label}`, (await ownerProfileRoute.onRequestGet(ctx(db, 'GET', {}, { token }))).status, 403);
        eq(`R2: an owner write is refused for ${label}`, (await ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { priceNote: 'NO PROVENANCE' }, { token }))).status, 403);
        eq(`R2: the refused write left the stored content alone for ${label}`, db.row('SELECT price_note FROM profile_overrides WHERE place_id = ?', PLACE).price_note, 'VALID VISIBLE CONTENT');
      }
    }
    db.sql
      .prepare("UPDATE businesses SET ownership_approved_by = 'fixture-reviewer', ownership_evidence = 'fixture independent evidence' WHERE place_id = ?")
      .run(PLACE);
    eq('R2: restoring both provenance fields restores the same publication (time-of-check control)', (await prof.getPublishedOverrideBySlug(db, SLUG))?.priceNote, 'VALID VISIBLE CONTENT');
  }
  section('J4. round 4 — ordinary editor projection and round-trip');
  {
    const db = legacyDb();
    insertLegacyBusiness(db);
    insertLegacyPublication(db);
    withOwnershipGate(db);
    await reg.revokeBusiness(db, PLACE, 'review-operator', 'replace old claimant');
    const token = await establishApprovedOwner(db, 'replacement@example.invalid', 1);
    const get = await ownerProfileRoute.onRequestGet(ctx(db, 'GET', {}, { token }));
    eq('R4: the replacement owner can read the editor', get.status, 200);
    const payload = await get.json();
    eq('R4: the ordinary editor GET does not prefill quarantined predecessor values', payload.override, null);
    eq('R4: the payload states why the form is blank', payload.overrideState.reason, 'unbound-generation');
    eq('R4: the payload reports the stored state truthfully (published)', payload.overrideState.published, false);
    eq('R4: the payload reports the stored state truthfully (generation)', payload.overrideState.claimGeneration, null);
    eq('R4: the payload reports the current approval generation', payload.overrideState.approvalGeneration, 2);
    check('R4: the quarantined predecessor is still retained as evidence', db.count("SELECT COUNT(*) n FROM ownership_quarantine_log WHERE kind = 'publication'") >= 1, 'quarantine log');

    // Model OwnerEditor.astro: every form field is submitted, including untouched ones
    // that were previously prefilled with the predecessor's content.
    const o = payload.override;
    const put = await ownerProfileRoute.onRequestPut(ctx(db, 'PUT', {
      services: o?.services ?? [], hours: {}, priceNote: o?.priceNote ?? '', whatsapp: o?.whatsapp ?? '',
      hiddenPhotos: o?.hiddenPhotos ?? [], addedPhotos: o?.addedPhotos ?? [],
    }, { token }));
    eq('R4: the ordinary editor save succeeds', put.status, 200);
    const visible = await prof.getPublishedOverrideBySlug(db, SLUG);
    check('R4: the ordinary editor round-trip does not adopt the predecessor price', visible?.priceNote !== 'UNAPPROVED LEGACY CONTENT', JSON.stringify(visible));
    eq('R4: the round-trip publishes under the current approval generation', visible?.claimGeneration, payload.overrideState.approvalGeneration);

    // Valid same-generation control: the owner's own published content IS prefilled and an
    // all-field round-trip of it keeps it. The guard must withhold predecessors, not content.
    const own = await ownerProfileRoute.onRequestPut(ctx(db, 'PUT', { priceNote: 'CURRENT OWNER CONTENT' }, { token }));
    eq('R4: the owner can save their own content', own.status, 200);
    const currentPayload = await (await ownerProfileRoute.onRequestGet(ctx(db, 'GET', {}, { token }))).json();
    eq('R4: same-generation published content IS prefilled (positive control)', currentPayload.override?.priceNote, 'CURRENT OWNER CONTENT');
    eq('R4: the positive control is projected as current', currentPayload.overrideState.reason, 'current');
    const o2 = currentPayload.override;
    const put2 = await ownerProfileRoute.onRequestPut(ctx(db, 'PUT', {
      services: o2?.services ?? [], hours: {}, priceNote: o2?.priceNote ?? '', whatsapp: o2?.whatsapp ?? '',
      hiddenPhotos: o2?.hiddenPhotos ?? [], addedPhotos: o2?.addedPhotos ?? [],
    }, { token }));
    eq("R4: the all-field round-trip of the owner's own content succeeds", put2.status, 200);
    eq("R4: the all-field round-trip preserves the owner's own value", (await prof.getPublishedOverrideBySlug(db, SLUG))?.priceNote, 'CURRENT OWNER CONTENT');
  }
  {
    const db = currentDb();
    await reg.claimBusiness(db, { placeId: PLACE, slug: SLUG, ownerEmail: 'a@example.invalid' });
    const response = await registryRoute.onRequestPut(ctx(db, 'PUT', { op: 'verify', approvedBy: 'named-reviewer', evidence: 'fixture evidence', expectedOwnerEmail: 'a@example.invalid', expectedClaimGeneration: 0, actor: 'spoofed-individual', rebuild: false }, { admin: OPERATOR_TOKEN }));
    eq('R3: a complete operator decision still succeeds (positive control)', response.status, 200);
    const event = JSON.parse((db.row("SELECT detail FROM registry_events WHERE event = 'ownership_approved'") ?? { detail: '{}' }).detail);
    eq('R3: the audit actor is the server-controlled credential class', event.actor, 'registry-admin-token');
    check('R3: a body-supplied name is never recorded as the authenticated actor', event.actor !== 'spoofed-individual');
    eq('R3: the body-supplied name is recorded, labelled operator-asserted', event.actorAssertedBy, 'spoofed-individual');
    eq('R3: the asserted name is not presented as authenticated', event.actorAssertedSource, 'operator-asserted-request-body');
    eq('R3: the named approver is still recorded as operator-supplied', event.approvedBySource, 'operator-supplied');
  }

  section('W. independent full ECMAScript whitespace regression');
  {
    const pv = load(path.join(funcs, '_lib/provenance.ts'));
    const native = [];
    for(let cp=0;cp<=0x10ffff;cp++) if(String.fromCodePoint(cp).trim()==='') native.push(cp);
    eq('W literal equals exhaustive native Unicode trim set', JSON.stringify(pv.ECMASCRIPT_WHITESPACE_CODEPOINTS), JSON.stringify(native));
    const migration = fs.readFileSync(path.join(ROOT,'migrations/0007_ownership_lifecycle.sql'),'utf8');
    const literals = [...migration.matchAll(/char\(([\d, ]+)\)/g)].map(m=>m[1].split(',').map(Number));
    eq('W four migration literals', literals.length,4);
    literals.forEach((a,i)=>eq('W migration helper literal parity '+i,JSON.stringify(a),JSON.stringify(native)));
    const probe = new DatabaseSync(':memory:');
    const sql = probe.prepare(`SELECT ${pv.sqlNonBlankProvenance('?1')} AS ok`);
    const blanks = ['', ...native.map(cp=>String.fromCodePoint(cp)), native.map(cp=>String.fromCodePoint(cp)).join('')];
    const valid = ['signed evidence', '\u200b','\u180e','\u0085','\u2060', '\t signed \ufeff', '\u00a0\u200b\u2029'];
    for(const value of [...blanks,...valid,null]) {
      const want = typeof value==='string' && value.trim()!=='';
      eq('W JS parity '+JSON.stringify(value),pv.isNonBlankProvenance(value),want);
      eq('W SQL parity '+JSON.stringify(value),Boolean(sql.get(value).ok),want);
    }
    probe.close();
    for(const field of ['ownership_evidence','ownership_approved_by']) {
      const db = currentDb();
      const token = await establishApprovedOwner(db);
      eq('W seed '+field,(await ownerProfileRoute.onRequestPut(ctx(db,'PUT',{priceNote:'VALID CONTENT'},{token}))).status,200);
      eq('W seed visible '+field,(await prof.getPublishedOverrideBySlug(db,SLUG))?.priceNote,'VALID CONTENT');
      const restore = ()=>db.sql.prepare("UPDATE businesses SET ownership_evidence='fixture independent evidence', ownership_approved_by='fixture-reviewer' WHERE place_id=?").run(PLACE);
      for(const value of blanks) {
        const label=field+' '+JSON.stringify(value);
        const rejected=await attempt(async()=>db.sql.prepare(`UPDATE businesses SET ${field}=? WHERE place_id=?`).run(value,PLACE));
        check('W schema refuses '+label,Boolean(rejected.error));
        eq('W schema retains provenance '+label,db.row(`SELECT ${field} v FROM businesses WHERE place_id=?`,PLACE).v,field==='ownership_evidence'?'fixture independent evidence':'fixture-reviewer');
        eq('W schema retains publication '+label,(await prof.getPublishedOverrideBySlug(db,SLUG))?.priceNote,'VALID CONTENT');
        restore();
        const values={ownership_evidence:'valid',ownership_approved_by:'valid',[field]:value};
        const ins=await attempt(async()=>db.sql.prepare("INSERT INTO businesses(place_id,slug,claimed,verified,claimed_at,owner_email,ownership_evidence,ownership_approved_by) VALUES(?,?,1,1,'2026-09-19',?,?,?)").run('insert-control','insert-control',LEGACY_EMAIL,values.ownership_evidence,values.ownership_approved_by));
        check('W schema INSERT refuses '+label,Boolean(ins.error));
        db.sql.prepare("DELETE FROM businesses WHERE place_id='insert-control'").run();
      }
      for(const value of valid) {
        const values={ownership_evidence:'valid',ownership_approved_by:'valid',[field]:value};
        const ins=await attempt(async()=>db.sql.prepare("INSERT INTO businesses(place_id,slug,claimed,verified,claimed_at,owner_email,ownership_evidence,ownership_approved_by) VALUES(?,?,1,1,'2026-09-19',?,?,?)").run('insert-control','insert-control',LEGACY_EMAIL,values.ownership_evidence,values.ownership_approved_by));
        eq('W valid INSERT accepted '+field+JSON.stringify(value),ins.error,undefined);
        db.sql.prepare("DELETE FROM businesses WHERE place_id='insert-control'").run();
        db.sql.prepare(`UPDATE businesses SET ${field}=? WHERE place_id=?`).run(value,PLACE);
        eq('W nonblank public '+field+JSON.stringify(value),(await prof.getPublishedOverrideBySlug(db,SLUG))?.priceNote,'VALID CONTENT');
        eq('W nonblank private '+field+JSON.stringify(value),(await ownerProfileRoute.onRequestGet(ctx(db,'GET',{}, {token}))).status,200);
        restore();
      }
      db.exec('DROP TRIGGER trg_businesses_verified_requires_provenance_update');
      for(const value of [...blanks,null]) {
        const label=field+' '+JSON.stringify(value);
        restore();
        db.sql.prepare(`UPDATE businesses SET ${field}=? WHERE place_id=?`).run(value,PLACE);
        eq('W forced value exists '+label,db.row(`SELECT ${field} v FROM businesses WHERE place_id=?`,PLACE).v,value);
        eq('W predicate refuses '+label,reg.isOwnershipApproved(await reg.getBusiness(db,PLACE)),false);
        eq('W public refuses '+label,await prof.getPublishedOverrideBySlug(db,SLUG),null);
        eq('W public list refuses '+label,(await prof.listPublishedOverrides(db)).total,0);
        eq('W private refuses '+label,(await ownerProfileRoute.onRequestGet(ctx(db,'GET',{}, {token}))).status,403);
        eq('W write refuses '+label,(await ownerProfileRoute.onRequestPut(ctx(db,'PUT',{priceNote:'BAD'},{token}))).status,403);
        eq('W delete refuses '+label,(await ownerProfileRoute.onRequestDelete(ctx(db,'DELETE',{}, {token}))).status,403);
        eq('W content preserved '+label,db.row('SELECT price_note FROM profile_overrides WHERE place_id=?',PLACE).price_note,'VALID CONTENT');
      }
      restore();
      eq('W restoration public '+field,(await prof.getPublishedOverrideBySlug(db,SLUG))?.priceNote,'VALID CONTENT');
      db.close();
      const pending=currentDb();
      await reg.claimBusiness(pending,{placeId:PLACE,slug:SLUG,ownerEmail:LEGACY_EMAIL});
      for(const value of blanks) {
        const input={approvedBy:'valid',evidence:'valid',expectedOwnerEmail:LEGACY_EMAIL,expectedClaimGeneration:0,[field==='ownership_evidence'?'evidence':'approvedBy']:value};
        const result=await attempt(()=>reg.approveOwnership(pending,PLACE,input));
        eq('W approval input refuses '+field+JSON.stringify(value),result.status,400);
        eq('W rejected input leaves pending '+field+JSON.stringify(value),(await reg.getBusiness(pending,PLACE)).verified,false);
      }
      pending.close();
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`ownership lifecycle suite: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const failure of failures) console.log('  - ' + failure);
  }
  console.log('='.repeat(60));
  process.exitCode = failures.length ? 1 : 0;
})().catch((error) => {
  console.error('suite aborted:', error);
  process.exitCode = 2;
});
