// POST /api/owner/session — start an owner login (Phase 1 self-service edits).
//
// Body: { "business": "<slug or place id>", "email": "owner@example.com" }
//
// Issues a 6-digit code for a business the registry already knows as claimed by
// that email. The response never contains the code to an anonymous caller: it is
// emailed (Resend, when configured) or handed over by the operator, which is how
// this audience already gets onboarded. A caller holding the operator token gets
// the code back so it can be passed on immediately.
//
// Response: { ok, sent, transport, expiresAt, business: { placeId, slug, name, category } }
// Errors:   404 not_claimed · 403 email_mismatch · 400 invalid_email · 429 too_many_requests
//
// Docs: docs/owner-profile-edits.md

import { isAdminRequest, readJsonObject } from '../../_lib/http';
import { normalizeEmail } from '../../_lib/registry';
import { sendLoginCode } from '../../_lib/mailer';
import {
  issueLoginCode,
  isPlaceId,
  ProfileError,
  resolveClaimedBusiness,
} from '../../_lib/profile';
import { json, methodNotAllowedSafe, ownerErrorResponse, requestLang } from '../../_lib/owner-handler';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await readJsonObject(request);
    const business = typeof body.business === 'string' ? body.business.trim() : '';
    if (!business) {
      throw new ProfileError('invalid_body', 'business is required (the slug or place id of your listing)');
    }
    const email = normalizeEmail(body.email);

    const record = await resolveClaimedBusiness(env.DB, business, email);
    if (!record) {
      throw new ProfileError(
        'not_claimed',
        'we have no verified owner for that business yet — claim it from its page first',
        404,
      );
    }
    if (record.ownerEmail.toLowerCase() !== email) {
      throw new ProfileError(
        'email_mismatch',
        'that email is not the owner we have on file for this business',
        403,
      );
    }

    const { code, expiresAt } = await issueLoginCode(env.DB, record.placeId, email);

    const lang = requestLang(request, body);
    const slug = record.slug ?? (isPlaceId(business) ? record.placeId : business);
    const origin = (typeof env.PUBLIC_SITE_URL === 'string' && env.PUBLIC_SITE_URL.trim()) ||
      new URL(request.url).origin;
    const manageUrl = `${origin.replace(/\/+$/, '')}/${lang === 'en' ? 'en/manage' : 'gestion'}/?b=${encodeURIComponent(slug)}`;

    const mail = await sendLoginCode(env, {
      to: email,
      code,
      businessName: record.name ?? slug,
      manageUrl,
      lang,
    });

    const admin = await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN);
    return json(
      {
        ok: true,
        sent: mail.delivered,
        transport: mail.transport,
        expiresAt,
        business: {
          placeId: record.placeId,
          slug,
          name: record.name,
          category: record.category,
        },
        // Operator-assisted onboarding: only with the admin token, never publicly.
        ...(admin ? { code } : {}),
      },
      200,
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowedSafe('POST');
