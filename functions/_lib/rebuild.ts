// Production rebuild trigger (B2B Phase 1 — verified-badge freshness).
//
// The badge is baked into the static HTML at build time: `src/lib/registry.ts`
// reads `GET /api/registry?status=verified` while `astro build` runs. A business
// that just verified — or one whose claim was just revoked — therefore only reaches
// the live site when Pages builds again. With discovery-driven claims starting, that
// lag is user-visible ("I verified, where is my badge?"), so the Functions that
// change verification state POST the project's Pages **deploy hook** and the badge
// lands within one build (~2-4 min) instead of "on the next deploy".
//
// Wire-up (done once, in the Cloudflare dashboard / API):
//   Workers & Pages → barcelona-compare → Settings → Builds → Deploy Hooks →
//   add hook "badge-freshness" for branch `main`. The generated URL needs no
//   Authorization header — the URL *is* the credential — and is stored in the Pages
//   project as the encrypted variable `DEPLOY_HOOK_URL` in the **production**
//   config only, so preview deployments never kick off production builds.
//   (Dashboard: Settings → Variables and secrets → DEPLOY_HOOK_URL, type Secret.)
//
// Without `DEPLOY_HOOK_URL` (local `wrangler pages dev`, preview deploys) every
// trigger is a recorded no-op and behavior is exactly what it was before this card:
// the badge waits for the next normal deploy.
//
// Two constraints shape this module:
//
//   * **No loops.** A trigger is only ever sent on an actual state transition
//     (nothing changed → nothing to rebuild), and the rebuild path itself only
//     *reads* the registry (`GET /api/registry`, plus the build's own nonce), so a
//     build can never trigger another build. `POST /api/rebuild` is the one manual
//     entry point, and it is admin-token gated.
//   * **No coupling.** `triggerRebuild()` never throws and callers hand it to
//     `ctx.waitUntil()`, so a missing/rotated secret, a slow Cloudflare API or a D1
//     hiccup can never fail a claim or delay the HTTP response.
//
// Every attempt is appended to `rebuild_requests` (migrations/0005) and readable via
// `GET /api/rebuild`.
//
// Docs: docs/business-registry.md

/** Why a rebuild was requested — also what lands in `rebuild_requests.reason`. */
export type RebuildReason = 'verify' | 'revoke' | 'tier_change' | 'manual';

export interface RebuildInput {
  reason: RebuildReason;
  /** The business whose state changed (absent for a manual rebuild). */
  placeId?: string | null;
  actor?: string | null;
  /** Free-form context stored with the row (shown by `GET /api/rebuild`). */
  detail?: Record<string, unknown> | string | null;
}

export interface RebuildResult {
  status: 'triggered' | 'skipped' | 'failed';
  reason: RebuildReason;
  /** Human-readable note: the skip reason, the build UUID or the failure. */
  detail: string;
  /** Deployment UUID returned by the deploy hook, when one started. */
  buildUuid?: string;
  requestedAt: string;
}

const HOOK_TIMEOUT_MS = 10_000;

function hookUrl(env: Env): string {
  const value = env.DEPLOY_HOOK_URL;
  return typeof value === 'string' ? value.trim() : '';
}

function detailText(detail: RebuildInput['detail']): string | null {
  if (detail === undefined || detail === null) return null;
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

/** Append the attempt to `rebuild_requests`. Never throws (a D1 hiccup must not
 *  matter — the trigger itself already happened). */
async function record(db: D1Database, input: RebuildInput, result: RebuildResult): Promise<void> {
  const detail = result.buildUuid ? `${result.detail} [build ${result.buildUuid}]` : result.detail;
  try {
    await db
      .prepare(
        `INSERT INTO rebuild_requests (reason, place_id, actor, status, detail, requested_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        input.reason,
        input.placeId ?? null,
        input.actor ?? null,
        result.status,
        detail,
        result.requestedAt,
      )
      .run();
  } catch (error) {
    console.error('[rebuild] could not record the trigger', error);
  }
}

/**
 * Ask Cloudflare Pages to rebuild production. Safe to call from a request handler:
 * never throws, and a missing hook URL is a logged no-op.
 *
 * Callers must have established that verification state actually changed — a trigger
 * per HTTP request (rather than per state transition) is how a rebuild loop starts.
 */
export async function triggerRebuild(env: Env, input: RebuildInput): Promise<RebuildResult> {
  const requestedAt = new Date().toISOString();
  const url = hookUrl(env);
  if (!url) {
    const result: RebuildResult = {
      status: 'skipped',
      reason: input.reason,
      detail: 'DEPLOY_HOOK_URL is not configured — the badge waits for the next deploy',
      requestedAt,
    };
    console.log(`[rebuild] skipped (${input.reason}${input.placeId ? ` ${input.placeId}` : ''}): ${result.detail}`);
    await record(env.DB, input, result);
    return result;
  }

  let result: RebuildResult;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HOOK_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    const body = (await response.json().catch(() => null)) as
      | { success?: boolean; result?: { id?: string; build_uuid?: string }; errors?: unknown }
      | null;
    if (!response.ok || body?.success === false) {
      throw new Error(`deploy hook replied HTTP ${response.status}`);
    }

    result = {
      status: 'triggered',
      reason: input.reason,
      detail: detailText(input.detail) ?? `${input.reason} rebuild requested`,
      // The deploy hook answers `{ result: { id } }` (older docs show build_uuid).
      buildUuid: body?.result?.id ?? body?.result?.build_uuid,
      requestedAt,
    };
    console.log(`[rebuild] triggered (${input.reason}) build ${result.buildUuid ?? 'unknown'}`);
  } catch (error) {
    result = {
      status: 'failed',
      reason: input.reason,
      detail: `deploy hook failed: ${(error as Error).message}`,
      requestedAt,
    };
    console.error(`[rebuild] ${result.detail}`);
  }

  await record(env.DB, input, result);
  return result;
}

/**
 * Fire-and-forget wrapper for request handlers: hands the trigger to
 * `ctx.waitUntil()` so the response is not held up and the trigger still runs.
 */
export function queueRebuild(context: EventContext, env: Env, input: RebuildInput): void {
  context.waitUntil(triggerRebuild(env, input));
}

export interface RebuildRequest {
  id: number;
  reason: string;
  placeId: string | null;
  actor: string | null;
  status: string;
  detail: string | null;
  requestedAt: string;
}

/** Most recent triggers, newest first — the audit view behind `GET /api/rebuild`. */
export async function listRebuildRequests(db: D1Database, limit = 20): Promise<RebuildRequest[]> {
  const rows = await db
    .prepare(
      `SELECT id, reason, place_id, actor, status, detail, requested_at
       FROM rebuild_requests ORDER BY id DESC LIMIT ?1`,
    )
    .bind(Math.min(Math.max(limit, 1), 100))
    .all<{
      id: number;
      reason: string;
      place_id: string | null;
      actor: string | null;
      status: string;
      detail: string | null;
      requested_at: string;
    }>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    reason: row.reason,
    placeId: row.place_id,
    actor: row.actor,
    status: row.status,
    detail: row.detail,
    requestedAt: row.requested_at,
  }));
}
