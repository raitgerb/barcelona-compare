// POST /api/claim/verify — check the 6-digit code and, only then, claim + verify.
//
// Body: { "placeId": "ChIJ...", "email": "owner@example.com", "code": "123456" }
// Success (200): { ok: true, state: "verified", business: {...public record...}, listingUrl }
//
// Errors: invalid_code 400, code_expired 410, too_many_attempts 429,
// already_claimed 409 (somebody else claimed it in the meantime), not_found 404.
//
// Docs: docs/claim-flow.md

import { errorResponse, json, methodNotAllowed, readJsonObject } from '../../_lib/http';
import { requireBusiness } from '../../_lib/catalog';
import { verifyClaim } from '../../_lib/claim';
import { normalizeEmail } from '../../_lib/registry';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await readJsonObject(request);
    const business = await requireBusiness(request, body.placeId);
    const result = await verifyClaim(env, business, {
      email: normalizeEmail(body.email),
      code: typeof body.code === 'string' ? body.code : '',
    });
    return json(
      { ok: true, state: 'verified', business: result.business, listingUrl: result.listingUrl },
      200,
      { 'cache-control': 'no-store' },
    );
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
