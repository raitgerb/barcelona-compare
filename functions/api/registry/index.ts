// GET /api/registry — list registry entries.
//
// Public callers get claimed businesses with PII stripped (safe to cache at the
// edge, which is what the build-time verified-badge job reads).
// Holders of X-Registry-Admin-Token also get owner emails and can use status=all.
//
// Query params: status=claimed|verified|all (default claimed), limit (<=500), offset.
// Docs: docs/business-registry.md

import { errorResponse, isAdminRequest, json, methodNotAllowed } from '../../_lib/http';
import { listBusinesses, toPublic, type ClaimStatus } from '../../_lib/registry';

const STATUSES: ClaimStatus[] = ['claimed', 'verified', 'all'];

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const admin = await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN);

    const requestedStatus = url.searchParams.get('status') ?? 'claimed';
    if (!STATUSES.includes(requestedStatus as ClaimStatus)) {
      return json(
        { ok: false, error: 'invalid_query', message: `status must be one of ${STATUSES.join(', ')}` },
        400,
        { 'cache-control': 'no-store' },
      );
    }
    const status = requestedStatus as ClaimStatus;
    if (status === 'all' && !admin) {
      return json({ ok: false, error: 'unauthorized', message: 'status=all requires the admin token' }, 401, {
        'cache-control': 'no-store',
      });
    }

    const limit = Number(url.searchParams.get('limit') ?? '100');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (!Number.isFinite(limit) || !Number.isFinite(offset) || limit < 1 || offset < 0) {
      return json({ ok: false, error: 'invalid_query', message: 'limit/offset must be positive numbers' }, 400, {
        'cache-control': 'no-store',
      });
    }

    const { total, records } = await listBusinesses(env.DB, { status, limit, offset });

    return json(
      {
        ok: true,
        status,
        total,
        count: records.length,
        limit,
        offset,
        businesses: records.map((record) => (admin ? record : toPublic(record))),
      },
      200,
      admin ? { 'cache-control': 'no-store' } : { 'cache-control': 'public, max-age=300' },
    );
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowed('GET');
