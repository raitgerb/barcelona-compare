// FIRST-STAGE MAINTENANCE GUARD (ownership release, stage 1 of 2).
//
// Why this exists: applying migrations 0006/0007 while the current production
// code is still serving is unsafe. Old verification code consumes the claim code
// and claims the registry row *before* the provenance trigger refuses
// `verified = 1`, and the old owner-session / profile / profile-override paths
// still authorize ownership and can mint NULL-generation credentials and publish
// owner content after the one-time quarantine. The trigger protects the verified
// flag only; it does not remove the capability to claim, mint sessions or publish.
//
// The guard is therefore deliberately HARDCODED: no env var, no query flag, no
// secret bypass, no toggle endpoint. It is removed by a reviewed code change, not
// by a runtime switch. It must be deployed on the old, schema-compatible main
// *before* the migration, and it stays in place until the ownership-code release
// has been reviewed and taken live.
//
// What it blocks (mutation AND read, where a read can leak pre-migration owner
// state or a verified-flag claim): everything under /api/claim, /api/owner,
// /api/profile-overrides, both methods of /api/rebuild, and mutating methods on
// /api/registry. What it must NOT block: site browsing (static pages and listing
// detail pages, which keep serving their build-time base content), analytics
// (/api/track, /api/analytics), and the read-only registry fetch used by the
// build/badge pipeline (GET /api/registry, GET /api/registry/<placeId>).
//
// Docs: docs/ownership-guard-preparation.md

/** Hardcoded maintenance window. Review before removal — see the doc above. */
export const MAINTENANCE_GUARD_ACTIVE = true;

/** Seconds a client should wait before retrying a guarded endpoint. */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 3600;

/** Prefixes whose every method (including reads) is refused while the guard is on. */
const FULLY_GUARDED_PREFIXES = ['/api/claim', '/api/owner', '/api/profile-overrides'];

/** Exact paths whose every method is refused while the guard is on. */
const FULLY_GUARDED_EXACT = ['/api/rebuild'];

/**
 * Prefixes where only mutating methods are refused. The read-only registry fetch
 * is used by the build/badge pipeline, so GET/HEAD/OPTIONS stay available.
 */
const MUTATION_GUARDED_PREFIXES = ['/api/registry'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Normalise a request path for guard matching.
 *
 * Defensive on purpose: malformed, encoded, doubled-slash and trailing-slash
 * spellings must all land on the same guarded route. A miss here is a bypass.
 */
export function normalizePath(pathname: string): string {
  let path = (pathname || '').split('?')[0].split('#')[0];

  // Percent-decode repeatedly (defeats %2563laim style double encoding).
  for (let i = 0; i < 3; i += 1) {
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      break; // malformed escape: match on the raw form rather than throwing
    }
    if (decoded === path) break;
    path = decoded;
  }

  path = path.replace(/\\/g, '/'); // backslash variants
  path = path.toLowerCase();
  path = path.replace(/\/{2,}/g, '/'); // collapse duplicate slashes

  // Resolve '.' and '..' segments: /api/./claim/start and /api/x/../claim/start
  // must land on the same guarded route as /api/claim/start.
  const segments = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  path = `/${segments.join('/')}`;
  return path;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** True when this request must be refused by the maintenance guard. */
export function isGuardedRequest(pathname: string, method: string): boolean {
  if (!MAINTENANCE_GUARD_ACTIVE) return false;

  const path = normalizePath(pathname);
  const upper = (method || 'GET').toUpperCase();

  for (const prefix of FULLY_GUARDED_PREFIXES) {
    if (matchesPrefix(path, prefix)) return true;
  }
  if (FULLY_GUARDED_EXACT.includes(path)) return true;

  if (!SAFE_METHODS.has(upper)) {
    for (const prefix of MUTATION_GUARDED_PREFIXES) {
      if (matchesPrefix(path, prefix)) return true;
    }
  }

  return false;
}

/** The single refusal response shape: 503, JSON, no-store, Retry-After. */
export function maintenanceGuardResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'maintenance',
      message:
        'Ownership and publication endpoints are temporarily disabled during a planned maintenance window. No changes were made. Please retry later.',
      retryAfterSeconds: MAINTENANCE_RETRY_AFTER_SECONDS,
    }),
    {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'retry-after': String(MAINTENANCE_RETRY_AFTER_SECONDS),
        'x-maintenance-guard': 'ownership-stage-1',
      },
    },
  );
}
