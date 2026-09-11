// /api/rebuild — production rebuild control (B2B Phase 1, badge freshness).
//
// The badge is baked into the static HTML at build time, so Functions that change
// verification state POST the Pages deploy hook themselves (functions/_lib/rebuild.ts).
// This endpoint is the operator side of the same machinery:
//
//   POST /api/rebuild  { "reason": "manual", "actor": "...", "placeId": "...", "detail": {...} }
//        → { ok: true, rebuild: { status, detail, buildUuid } }
//        Force a production rebuild (e.g. after a bulk registry import, or when a
//        badge looks stale). Admin token required.
//   GET  /api/rebuild?limit=20
//        → { ok: true, rebuilds: [...] } — the `rebuild_requests` audit trail,
//          newest first: what changed, when, and whether a build actually started.
//
// A rebuild is triggered only by a state-changing registry op or by this endpoint,
// and the build itself only reads the registry, so this cannot loop.
//
// Docs: docs/business-registry.md

import { errorJson, isAdminRequest, json, methodNotAllowed, readJsonObject } from '../_lib/http';
import { listRebuildRequests, triggerRebuild, type RebuildReason } from '../_lib/rebuild';

const REASONS: RebuildReason[] = ['verify', 'revoke', 'tier_change', 'manual'];

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    if (!(await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN))) {
      return errorJson(
        'unauthorized',
        'rebuild control requires a valid X-Registry-Admin-Token header',
        401,
      );
    }

    const body = await readJsonObject(request);
    const requested = typeof body.reason === 'string' ? (body.reason as RebuildReason) : 'manual';
    const reason = REASONS.includes(requested) ? requested : 'manual';

    const rebuild = await triggerRebuild(env, {
      reason,
      actor: typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim() : 'admin-api',
      placeId: typeof body.placeId === 'string' && body.placeId.trim() ? body.placeId.trim() : null,
      detail: (body.detail ?? null) as Record<string, unknown> | null,
    });

    return json({ ok: true, rebuild }, rebuild.status === 'failed' ? 502 : 200, {
      'cache-control': 'no-store',
    });
  } catch (error) {
    return errorJson('internal_error', (error as Error).message, 500);
  }
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    if (!(await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN))) {
      return errorJson(
        'unauthorized',
        'rebuild history requires a valid X-Registry-Admin-Token header',
        401,
      );
    }
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? '20');
    const rebuilds = await listRebuildRequests(
      env.DB,
      Number.isFinite(limit) ? limit : 20,
    );
    return json({ ok: true, count: rebuilds.length, rebuilds }, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    return errorJson('internal_error', (error as Error).message, 500);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowed('GET, POST');
