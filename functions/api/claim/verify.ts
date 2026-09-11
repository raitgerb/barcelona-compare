// POST /api/claim/verify — check the 6-digit code and, only then, claim + verify.
//
// Body: { "placeId": "ChIJ...", "email": "owner@example.com", "code": "123456" }
// Success (200): { ok: true, state: "verified", business: {...public record...}, listingUrl }
//
// Errors: invalid_code 400, code_expired 410, too_many_attempts 429,
// already_claimed 409 (somebody else claimed it in the meantime), not_found 404.
//
// A successful verification is exactly the moment the verified badge becomes due,
// so the response queues a production rebuild (functions/_lib/rebuild.ts) — the
// badge is baked into the static HTML, and without this the owner would see
// "verified" with no badge until the next deploy.
//
// Docs: docs/claim-flow.md, docs/business-registry.md

import { errorResponse, json, methodNotAllowed, readJsonObject } from '../../_lib/http';
import { requireBusiness } from '../../_lib/catalog';
import { verifyClaim } from '../../_lib/claim';
import { normalizeEmail } from '../../_lib/registry';
import { queueRebuild } from '../../_lib/rebuild';

export const onRequestPost: PagesFunction = async (context) => {
  const { request, env } = context;
  try {
    const body = await readJsonObject(request);
    const business = await requireBusiness(request, body.placeId);
    const result = await verifyClaim(env, business, {
      email: normalizeEmail(body.email),
      code: typeof body.code === 'string' ? body.code : '',
    });
    queueRebuild(context, env, {
      reason: 'verify',
      placeId: business.placeId,
      actor: 'claim-flow',
      detail: { slug: business.slug, source: 'claim-flow' },
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
