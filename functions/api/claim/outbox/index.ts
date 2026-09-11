// GET /api/claim/outbox — codes that were requested but not delivered by email.
//
// Operator-only (header `x-registry-admin-token`). It answers one question: "which
// owners asked for a code and have not received it?". With a transactional email
// transport configured (`RESEND_API_KEY`) this list is always empty, because the
// code leaves from the edge the moment it is created.
//
// It is also the path a hand-delivered verification takes: read the code here, call
// the owner back (or mail it from a mailbox), then
// `POST /api/claim/outbox/:id/delivered`.
//
// Response: { ok: true, pending: [{ id, placeId, slug, businessName, email, code,
//             locale, attempts, sends, createdAt, expiresAt }] }
//
// Docs: docs/claim-flow.md

import { errorJson, errorResponse, isAdminRequest, json, methodNotAllowed } from '../../../_lib/http';
import { listPendingDeliveries } from '../../../_lib/claim';

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    if (!(await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN))) {
      return errorJson('unauthorized', 'the claim outbox requires the admin token', 401);
    }
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? '50');
    const pending = await listPendingDeliveries(
      env.DB,
      Number.isFinite(limit) ? limit : 50,
    );
    return json(
      { ok: true, count: pending.length, pending },
      200,
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowed('GET');
