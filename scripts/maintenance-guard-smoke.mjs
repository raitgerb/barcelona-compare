// Maintenance-guard regression suite (ownership release, stage 1).
//
// Runs the REAL shipped modules — functions/_lib/maintenance-guard.ts and the
// real functions/_middleware.ts entrypoint — under Node's TypeScript stripping.
// No network is performed: every request is dispatched only into the middleware
// with a stub `next()` that records whether any handler/asset code ran.
//
//   pass  : the repo under test (GUARD_ROOT, default: this checkout)
//   fail  : run the same suite against a checkout whose _middleware.ts has the
//           guard removed — every blocking assertion must then fail. That
//           negative control is what makes this evidence discriminating.
//
// Usage:
//   node --import ./scripts/guard-register.mjs scripts/maintenance-guard-smoke.mjs
//   GUARD_ROOT=/tmp/bc-guard-negative node --import .../guard-register.mjs ...
//
// Exit code 0 = all expectations met, 1 = at least one expectation missed.

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(process.env.GUARD_ROOT || process.cwd());
const results = { pass: 0, fail: 0 };
const failures = [];

function check(name, ok, detail) {
  if (ok) results.pass += 1;
  else {
    results.fail += 1;
    if (failures.length < 25) failures.push(`${name} :: ${detail}`);
  }
}

function load(rel) {
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}

// ---------------------------------------------------------------- test matrix

const GUARDED_PATHS = [
  '/api/claim/start',
  '/api/claim/verify',
  '/api/claim/outbox',
  '/api/claim/outbox/abc123',
  '/api/owner/session',
  '/api/owner/session/verify',
  '/api/owner/profile/ChIJabc',
  '/api/profile-overrides',
  '/api/profile-overrides/ChIJabc',
  '/api/rebuild',
];

const MUTATION_GUARDED_PATHS = ['/api/registry', '/api/registry/ChIJabc'];

/** Every method the guard must refuse on a fully-guarded route. */
const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Read spellings of a path that must all normalise to the same guarded route. */
function spellings(p) {
  const encoded = p.replace(/\/api\//, '/api/%2F').replace('claim', '%63laim');
  return [
    p,
    `${p}/`,
    `${p}//`,
    p.replace(/\/api\//, '/api//'),
    p.toUpperCase(),
    encoded,
    `${p}?retry=1`,
    p.replace('/api/', '/api/./'),
  ];
}

const ALLOWED_PATHS = [
  '/',
  '/nails/some-salon',
  '/massage/some-spa',
  '/en/nails/some-salon',
  '/robots.txt',
  '/sitemap-index.xml',
  '/_astro/app.abc123.css',
  '/favicon.ico',
  '/gestion',
  '/api/track',
  '/api/analytics',
  '/api/analytics/ChIJabc',
  '/api/rebuild-requests', // not a route: must not be swallowed by prefix guesses
  '/api/claimants', // must not match /api/claim by naive prefix
  '/api/owners', // must not match /api/owner by naive prefix
];

async function main() {
  const guard = await load('functions/_lib/maintenance-guard.ts');

  // -- module-level predicate: guarded routes, every method, every spelling ----
  for (const p of GUARDED_PATHS) {
    for (const variant of spellings(p)) {
      for (const method of ALL_METHODS) {
        const got = guard.isGuardedRequest(new URL(variant, 'https://x.test').pathname, method);
        check(`guarded ${method} ${variant}`, got === true, `isGuardedRequest=${got}`);
      }
    }
  }
  for (const p of MUTATION_GUARDED_PATHS) {
    for (const variant of spellings(p)) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        check(`guarded mutation ${method} ${variant}`, guard.isGuardedRequest(variant, method) === true, 'not guarded');
      }
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        check(
          `allowed read ${method} ${variant}`,
          guard.isGuardedRequest(variant, method) === false,
          'read-only registry fetch must stay available for the build badge pipeline',
        );
      }
    }
  }

  // -- module-level predicate: unrelated routes must NOT be blocked ------------
  for (const p of ALLOWED_PATHS) {
    for (const method of ['GET', 'POST']) {
      check(`allowed ${method} ${p}`, guard.isGuardedRequest(p, method) === false, 'over-blocked');
    }
  }

  // -- runtime: the real middleware entrypoint --------------------------------
  let middleware;
  try {
    middleware = await load('functions/_middleware.ts');
  } catch (error) {
    check('load functions/_middleware.ts', false, String(error && error.message));
    report();
    process.exit(1);
  }

  const MAINTENANCE_ACTIVE = guard.MAINTENANCE_GUARD_ACTIVE === true;

  /** Dispatch one request through the real middleware; record side effects. */
  async function dispatch(pathname, method) {
    const calls = { next: 0, db: 0 };
    const env = {
      get DB() {
        calls.db += 1;
        throw new Error('test stub: D1 must not be touched by the guard');
      },
      R2_IMAGE_BASE_URL: 'https://images.example.test',
    };
    const request = new Request(`https://barcelonacompare.com${pathname}`, { method });
    const response = await middleware.onRequest({
      request,
      env,
      next: async () => {
        calls.next += 1;
        return new Response('<html>base listing content</html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
    });
    return { response, calls };
  }

  if (MAINTENANCE_ACTIVE) {
    const runtimeTargets = [
      ...GUARDED_PATHS.map((p) => [p, ALL_METHODS]),
      ...MUTATION_GUARDED_PATHS.map((p) => [p, ['POST', 'PUT', 'PATCH', 'DELETE']]),
    ];
    for (const [p, methods] of runtimeTargets) {
      for (const method of methods) {
        const { response, calls } = await dispatch(p, method);
        const label = `runtime ${method} ${p}`;
        check(`${label} status 503`, response.status === 503, `status=${response.status}`);
        check(`${label} no-store`, /no-store/.test(response.headers.get('cache-control') || ''), 'missing no-store');
        check(`${label} retry-after`, !!response.headers.get('retry-after'), 'missing Retry-After');
        check(`${label} json body`, /json/.test(response.headers.get('content-type') || ''), 'not json');
        check(`${label} handler not reached`, calls.next === 0, 'next() ran — handler/asset code executed');
        const body = await response.json().catch(() => null);
        check(`${label} body has no credentials`, !!body && body.error === 'maintenance' && !JSON.stringify(body).match(/token|secret|code/i), JSON.stringify(body));
      }
    }
    // read-only registry fetch must survive the guard (build/badge pipeline)
    for (const p of MUTATION_GUARDED_PATHS) {
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const { response, calls } = await dispatch(p, method);
        check(`runtime registry read ${method} ${p} passes`, response.status === 200 && calls.next >= 1, `status=${response.status} next=${calls.next}`);
      }
    }
    // trailing slash + encoded + uppercase spellings through the entrypoint
    for (const [p, method] of [
      ['/api/claim/start/', 'POST'],
      ['/api/claim//start?x=1', 'POST'],
      ['/api/OWNER/session', 'POST'],
      ['/api/%63laim/verify', 'POST'],
      ['/api/profile-overrides/ChIJabc/', 'DELETE'],
      ['/api/registry/ChIJabc', 'PUT'],
    ]) {
      const { response, calls } = await dispatch(p, method);
      check(`runtime spelling ${method} ${p}`, response.status === 503 && calls.next === 0, `status=${response.status} next=${calls.next}`);
    }
  }

  // unrelated routes keep serving (and never touch the guard's 503 path)
  for (const p of ALLOWED_PATHS) {
    for (const method of p.startsWith('/api/') ? ['GET', 'OPTIONS'] : ['GET']) {
      const { response, calls } = await dispatch(p, method);
      check(`runtime allowed ${method} ${p}`, response.status === 200 && calls.next >= 1, `status=${response.status} next=${calls.next}`);
    }
  }

  // listing base content is served and owner injection does NOT run
  for (const p of ['/nails/some-salon', '/massage/some-spa', '/en/nails/some-salon']) {
    const { response, calls } = await dispatch(p, 'GET');
    const html = await response.text();
    check(`listing ${p} serves base content`, response.status === 200 && html.includes('base listing content'), `status=${response.status}`);
    check(`listing ${p} no owner injection`, calls.db === 0, 'D1 was queried for owner overrides while the guard is active');
  }

  report();
  process.exit(results.fail === 0 ? 0 : 1);
}

function report() {
  console.log(`ROOT=${ROOT}`);
  console.log(`PASS=${results.pass} FAIL=${results.fail}`);
  for (const f of failures) console.log(`  FAIL: ${f}`);
  if (results.fail) console.log('NOTE: failures are expected when this suite is run as the negative control (guard removed).');
}

main().catch((error) => {
  console.error('harness error', error);
  process.exit(2);
});
