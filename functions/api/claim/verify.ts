// POST /api/claim/verify — check the 6-digit code and, only then, record the
// email-verified claim.
//
// Body: { "placeId": "ChIJ...", "email": "owner@example.com", "code": "123456" }
// Success (200): { ok: true, state: "pending_approval", business: {...public record...},
//                  listingUrl, ownership: { state, nextStep, ... } }
//
// What this endpoint does NOT do, on purpose: it does not mark the business
// verified, it does not award the public badge, and it does not open the owner
// editor. A correct code proves the caller can read that mailbox — a stranger can
// point the form at their own address, so mailbox possession is not ownership.
// Ownership is approved separately, by a human, through the operator API
// (`PUT /api/registry/:placeId` with `op: "verify"` requires `approvedBy` +
// `evidence`), which is also the moment the badge rebuild is queued.
//
// Errors: invalid_code 400, code_expired 410, too_many_attempts 429,
// already_claimed 409 (somebody else claimed it in the meantime), not_found 404.
//
// Docs: docs/claim-flow.md, docs/business-registry.md

import { errorResponse, json, methodNotAllowed, readJsonObject } from '../../_lib/http';
import { requireBusiness } from '../../_lib/catalog';
import { verifyClaim } from '../../_lib/claim';
import { normalizeEmail } from '../../_lib/registry';

export const onRequestPost: PagesFunction = async (context) => {
  const { request, env } = context;
  try {
    const body = await readJsonObject(request);
    const business = await requireBusiness(request, body.placeId);
    const result = await verifyClaim(env, business, {
      email: normalizeEmail(body.email),
      code: typeof body.code === 'string' ? body.code : '',
    });
    // No queueRebuild() here: the badge follows ownership approval, not the code.
    return json(
      {
        ok: true,
        state: result.state,
        business: result.business,
        listingUrl: result.listingUrl,
        ownership: {
          state: 'pending_review',
          approved: false,
          // What the owner should expect. Deliberately not a promise of a deadline.
          nextStep:
            'a person reviews that this business is yours using an independent source, then emails you; until then your listing is not marked verified and the editor stays closed',
        },
      },
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
