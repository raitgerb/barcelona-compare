// POST /api/claim/start — ask for a verification code for one business.
//
// Body: { "placeId": "ChIJ...", "email": "owner@example.com", "locale": "es" | "en" }
// Success (200):
//   { ok: true, state: "code_sent" | "already_verified", business: {...}, email,
//     delivery: "resend" | "none", expiresAt, resendInSeconds }
//
// The business is resolved from the build catalog, so only listed businesses can be
// claimed. Errors: invalid_email 400, not_found 404, already_claimed 409,
// rate_limited 429, catalog_unavailable 503.
//
// Docs: docs/claim-flow.md

import { errorResponse, json, methodNotAllowed, readJsonObject } from '../../_lib/http';
import { requireBusiness } from '../../_lib/catalog';
import { startClaim } from '../../_lib/claim';
import { normalizeEmail } from '../../_lib/registry';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await readJsonObject(request);
    const business = await requireBusiness(request, body.placeId);
    const result = await startClaim(env, business, {
      email: normalizeEmail(body.email),
      ip: request.headers.get('cf-connecting-ip'),
      locale: typeof body.locale === 'string' ? body.locale : 'es',
    });
    return json({ ok: true, ...result }, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = async ({ request }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { allow: 'POST, OPTIONS' } });
  }
  return methodNotAllowed('POST');
};
