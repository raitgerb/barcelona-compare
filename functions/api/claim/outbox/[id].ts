// POST /api/claim/outbox/:id — record that a code reached its owner.
//
// Operator-only. Body (optional): { "provider": "manual" | "phone" | "smtp" | ... }
// Marks `delivered_at` and drops the plain code from the row; the HMAC hash stays so
// the owner can still enter the code (until it expires or is consumed).
//
// Docs: docs/claim-flow.md

import { errorJson, errorResponse, isAdminRequest, json, methodNotAllowed, readJsonObject } from '../../../_lib/http';
import { markDelivered } from '../../../_lib/claim';

export const onRequestPost: PagesFunction = async ({ request, params, env }) => {
  try {
    if (!(await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN))) {
      return errorJson('unauthorized', 'the claim outbox requires the admin token', 401);
    }
    const idParam = params.id;
    const id = (Array.isArray(idParam) ? idParam[0] : idParam)?.trim() ?? '';
    if (!id) return errorJson('invalid_body', 'claim request id is required', 400);

    let provider = 'manual';
    try {
      const body = await readJsonObject(request);
      if (typeof body.provider === 'string' && body.provider.trim()) {
        provider = body.provider.trim().slice(0, 40);
      }
    } catch {
      // An empty body is fine: the operator handed the code over by hand.
    }

    const updated = await markDelivered(env.DB, id, provider);
    if (!updated) return errorJson('not_found', `no claim request ${id}`, 404);
    return json({ ok: true, id, provider }, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowed('POST');
