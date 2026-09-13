#!/usr/bin/env node
/**
 * End-to-end proof of badge freshness (B2B Phase 1).
 *
 * This is the acceptance test for `functions/_lib/rebuild.ts`: it claims and verifies
 * a **real** listed business with the operator token, waits for the production build
 * the deploy hook starts, and checks the badge actually appears in the live HTML —
 * then revokes and checks it disappears again after the second build.
 *
 * It touches production on purpose (that is the only place the deploy hook exists):
 *
 *   * it briefly claims + verifies one real business and always revokes/cleans up,
 *     so the registry ends where it started;
 *   * it starts two production builds (~2-4 min each, serialized with any other
 *     build). Run it by hand, not on every commit.
 *
 * Not covered here: the claim-flow's own trigger (`POST /api/claim/verify`), which is
 * exercised by scripts/claim-smoke.sh. This script drives the operator path.
 *
 * Usage:
 *   REGISTRY_ADMIN_TOKEN=<token> node scripts/badge-freshness-e2e.mjs
 *   ... --place ChIJ... --slug <slug> --site https://barcelonacompare.com
 *
 * Needs CLOUDFLARE_API_TOKEN in the environment (deployment polling + D1 cleanup).
 *
 * Docs: docs/business-registry.md
 */

import { execFileSync } from 'node:child_process';

const ACCOUNT = '135a01b78b043167860618dd0030c5f6';
const PROJECT = 'barcelona-compare';
const DB_NAME = 'barcelona-compare-registry';
const BUILD_TIMEOUT_MS = 15 * 60_000;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const SITE = arg('site', 'https://barcelonacompare.com').replace(/\/$/, '');
const PLACE_ID = arg('place', 'ChIJ7Q_RhUajpBIRkC7arx45x5c'); // LIN HUA KOREAN Nails
const SLUG = arg('slug', 'lin-hua-korean-nails');
const CATEGORY = arg('category', 'nails');
const OWNER_EMAIL = arg('email', 'badge-e2e@barcelonacompare.com');
const ADMIN_TOKEN = process.env.REGISTRY_ADMIN_TOKEN || arg('token', '');
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

const PAGES = [`/${CATEGORY}/${SLUG}/`, `/en/${CATEGORY}/${SLUG}/`];
const BADGE_MARKER = 'data-badge="verified"';

let pass = 0;
let fail = 0;
const ok = (label, extra = '') => {
  pass += 1;
  console.log(`  ok    ${label}${extra ? ` (${extra})` : ''}`);
};
const bad = (label, extra = '') => {
  fail += 1;
  console.log(`  FAIL  ${label}${extra ? ` (${extra})` : ''}`);
};
const check = (label, expected, actual) =>
  String(expected) === String(actual) ? ok(label) : bad(label, `expected [${expected}], got [${actual}]`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function registryOp(op, body = {}) {
  const response = await fetch(`${SITE}/api/registry/${PLACE_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-registry-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ op, ...body }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function rebuildHistory(limit = 5) {
  const response = await fetch(`${SITE}/api/rebuild?limit=${limit}`, {
    headers: { 'x-registry-admin-token': ADMIN_TOKEN },
  });
  return response.json();
}

async function cf(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${CF_TOKEN}` },
  });
  const json = await response.json();
  if (!json.success) throw new Error(`cloudflare api failed: ${JSON.stringify(json.errors)}`);
  return json.result;
}

const deployments = () =>
  cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}/deployments?per_page=15`);

function hookDeploymentsSince(sinceIso) {
  return deployments().then((rows) =>
    rows
      .filter((d) => (d.deployment_trigger || {}).type === 'deploy_hook')
      .filter((d) => (d.created_on || '') > sinceIso)
      .sort((a, b) => (a.created_on < b.created_on ? -1 : 1)),
  );
}

function stageStatus(deployment) {
  const stages = Object.fromEntries((deployment.stages || []).map((s) => [s.name, s.status]));
  return stages.deploy ?? stages.build ?? 'unknown';
}

/** Wait for the deploy-hook build started after `sinceIso` to go live. */
async function waitForHookBuild(sinceIso, label) {
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const builds = await hookDeploymentsSince(sinceIso);
    if (builds.length) {
      const build = builds[builds.length - 1];
      const stages = Object.fromEntries((build.stages || []).map((s) => [s.name, s.status]));
      if (stages.deploy === 'success') {
        ok(`${label}: deploy hook started a production build`, build.id);
        return { build, url: build.url };
      }
      if (Object.values(stages).includes('failure') || Object.values(stages).includes('canceled')) {
        bad(`${label}: hook build failed`, JSON.stringify(stages));
        return { build, url: build.url, failed: true };
      }
    }
    await sleep(15_000);
  }
  bad(`${label}: no deploy-hook build went live within ${BUILD_TIMEOUT_MS / 60000} min`);
  return null;
}

/**
 * Poll the live pages until they show (or stop showing) the badge.
 *
 * The window is generous on purpose. `deploy: success` in the Pages API means the
 * build finished, not that the edge already serves it: right after a deploy the
 * previous deployment keeps answering for a couple of minutes, so a short window
 * reports a false negative on a healthy deploy. 36 x 10s = 6 minutes.
 */
async function waitForBadge(label, expected, attempts = 36) {
  let last = '';
  for (let i = 0; i < attempts; i += 1) {
    const found = [];
    for (const path of PAGES) {
      const response = await fetch(`${SITE}${path}`, { headers: { 'cache-control': 'no-cache' } });
      const html = await response.text();
      if (html.includes(BADGE_MARKER)) found.push(path);
    }
    last = found.length ? `badge on ${found.join(', ')}` : 'no badge';
    if (expected ? found.length === PAGES.length : found.length === 0) {
      ok(`${label}: ${last}`);
      return true;
    }
    await sleep(10_000);
  }
  bad(`${label}: ${last}`);
  return false;
}

async function cleanup() {
  try {
    execFileSync(
      'npx',
      [
        '--yes',
        'wrangler',
        'd1',
        'execute',
        DB_NAME,
        '--remote',
        '--yes',
        '--command',
        `DELETE FROM registry_events WHERE place_id = '${PLACE_ID}'; ` +
          `DELETE FROM businesses WHERE place_id = '${PLACE_ID}';`,
      ],
      { stdio: 'inherit', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } },
    );
    ok('test rows removed from the registry (businesses + registry_events)');
  } catch (error) {
    bad('could not delete the test rows', String(error.message).slice(0, 120));
  }
  const response = await fetch(`${SITE}/api/registry/${PLACE_ID}`);
  check('the business is no longer in the registry', 404, response.status);
}

async function main() {
  if (!ADMIN_TOKEN) throw new Error('REGISTRY_ADMIN_TOKEN (or --token) is required');
  if (!CF_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required');

  console.log(`== badge freshness end-to-end (${SITE}), place ${PLACE_ID} (${SLUG})`);

  // ---------------------------------------------------------------- baseline
  const before = await waitForBadge('baseline', false, 1);
  if (!before) console.log('  note  a badge was already rendered for this business before the test');

  await registryOp('revoke', { reason: 'badge e2e setup', rebuild: false });
  const claim = await registryOp('claim', { ownerEmail: OWNER_EMAIL, slug: SLUG, category: CATEGORY });
  check('claim -> 200', 200, claim.status);
  check('claim leaves the business unverified', false, claim.body?.business?.verified);

  // ------------------------------------------------------------- verify -> badge
  const verifyStartedAt = new Date().toISOString();
  const verify = await registryOp('verify');
  check('verify -> 200', 200, verify.status);
  check('verify marks the business verified', true, verify.body?.business?.verified);

  const verifyBuild = await waitForHookBuild(verifyStartedAt, 'verify');
  if (verifyBuild && !verifyBuild.failed) {
    await waitForBadge('after the verify rebuild', true);
  }

  const history = await rebuildHistory(3);
  const latest = history.rebuilds?.[0];
  check('rebuild audit trail records reason=verify', 'verify', latest?.reason);
  check('rebuild audit trail records status=triggered', 'triggered', latest?.status);
  ok('rebuild audit trail detail', String(latest?.detail).slice(0, 90));

  // ------------------------------------------------------------ revoke -> gone
  const revokeStartedAt = new Date().toISOString();
  const revoke = await registryOp('revoke', { reason: 'badge e2e' });
  check('revoke -> 200', 200, revoke.status);
  check('revoke clears verified', false, revoke.body?.business?.verified);

  const revokeBuild = await waitForHookBuild(revokeStartedAt, 'revoke');
  if (revokeBuild && !revokeBuild.failed) {
    await waitForBadge('after the revocation rebuild', false);
  }

  const after = await rebuildHistory(3);
  check('rebuild audit trail records reason=revoke', 'revoke', after.rebuilds?.[0]?.reason);
  check('rebuild audit trail records status=triggered', 'triggered', after.rebuilds?.[0]?.status);

  // ------------------------------------------------------- loop safety (live)
  const hookBuilds = await hookDeploymentsSince(verifyStartedAt);
  check('exactly two builds were started (verify + revoke, no rebuild loop)', 2, hookBuilds.length);

  await cleanup();

  console.log();
  console.log(`badge freshness e2e: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error('e2e aborted:', error.message);
  try {
    await registryOp('revoke', { reason: 'badge e2e abort' });
    await cleanup();
  } catch {
    console.error('cleanup also failed — check the registry row manually');
  }
  process.exitCode = 1;
});
