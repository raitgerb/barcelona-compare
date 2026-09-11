// GET /api/profile-overrides — every published owner edit, newest first.
//
// Public and cacheable: no owner email, no session data, nothing but the content
// that is already live on the listing pages. Two consumers:
//
//   * `scripts/owner-edit-smoke.sh` — asserts the write path landed
//   * a future static rebuild path — fetch this at build time and bake the owner
//     content in instead of injecting it at the edge (today the edge injector in
//     functions/_middleware.ts is the live path)
//
// With the operator token, `?status=all` also returns unpublished (taken-down)
// rows so moderation has visibility.
//
// Docs: docs/owner-profile-edits.md

import { isAdminRequest } from '../../_lib/http';
import { listPublishedOverrides, toPublicOverride } from '../../_lib/profile';
import { json, methodNotAllowedSafe, ownerErrorResponse } from '../../_lib/owner-handler';

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const admin = await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN);
    const status = url.searchParams.get('status') ?? 'published';
    if (!['published', 'all'].includes(status)) {
      return json(
        { ok: false, error: 'invalid_query', message: 'status must be published or all' },
        400,
        { 'cache-control': 'no-store' },
      );
    }
    if (status === 'all' && !admin) {
      return json({ ok: false, error: 'unauthorized', message: 'status=all requires the admin token' }, 401, {
        'cache-control': 'no-store',
      });
    }

    const limit = Number(url.searchParams.get('limit') ?? '200');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (!Number.isFinite(limit) || !Number.isFinite(offset) || limit < 1 || offset < 0) {
      return json({ ok: false, error: 'invalid_query', message: 'limit/offset must be positive numbers' }, 400, {
        'cache-control': 'no-store',
      });
    }

    const { total, records } = await listPublishedOverrides(env.DB, { limit, offset });
    return json(
      {
        ok: true,
        status,
        total,
        count: records.length,
        limit,
        offset,
        overrides: records.map(toPublicOverride),
      },
      200,
      admin ? { 'cache-control': 'no-store' } : { 'cache-control': 'public, max-age=60' },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowedSafe('GET');
