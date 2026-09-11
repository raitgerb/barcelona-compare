// POST /api/owner/session/verify — exchange the 6-digit code for a session token.
//
// Body: { "business": "<slug or place id>", "code": "123456" }
// Response: { ok, token, expiresAt, business: { placeId, slug, name, category } }
//
// The token goes back in the `x-owner-session` header on every write. Wrong codes
// burn one of 5 attempts and the code dies after that, so the 6-digit space cannot
// be brute-forced; codes last 15 minutes, sessions 30 days.
//
// Docs: docs/owner-profile-edits.md

import { readJsonObject } from '../../../_lib/http';
import {
  isPlaceId,
  ProfileError,
  resolveClaimedBusiness,
  verifyLoginCode,
} from '../../../_lib/profile';
import { json, methodNotAllowedSafe, ownerErrorResponse } from '../../../_lib/owner-handler';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await readJsonObject(request);
    const business = typeof body.business === 'string' ? body.business.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!business) throw new ProfileError('invalid_body', 'business is required');
    if (!code) throw new ProfileError('invalid_code', 'the code is 6 digits', 401);

    const record = await resolveClaimedBusiness(env.DB, business);
    if (!record) {
      throw new ProfileError('not_claimed', 'we have no verified owner for that business yet', 404);
    }

    const session = await verifyLoginCode(env.DB, record.placeId, code);
    const slug = record.slug ?? (isPlaceId(business) ? record.placeId : business);

    return json(
      {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        business: {
          placeId: record.placeId,
          slug,
          name: record.name,
          category: record.category,
        },
      },
      200,
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowedSafe('POST');
