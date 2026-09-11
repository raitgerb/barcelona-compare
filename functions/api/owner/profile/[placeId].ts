// /api/owner/profile/:placeId — read, save and reset the owner's own listing content.
//
// Auth: `x-owner-session: <token>` from POST /api/owner/session/verify. The token
// is bound to one place id, so an owner can only ever touch their own record.
//
//   GET     current content + audit trail (the dashboard's "what is live now")
//   PUT     { services?, hours?, priceNote?, hiddenPhotos?, addedPhotos? } — only
//           the keys present are touched; an empty list deliberately blanks a section
//   DELETE  back to the Google-derived defaults
//
// Docs: docs/owner-profile-edits.md

import { isAdminRequest, readJsonObject } from '../../../_lib/http';
import { getBusiness } from '../../../_lib/registry';
import {
  deleteOverride,
  getOverrideByPlaceId,
  getOwnerSession,
  isPlaceId,
  listEditEvents,
  resetOverride,
  saveOverride,
  setOverridePublished,
  toPublicOverride,
  ProfileError,
} from '../../../_lib/profile';
import { json, methodNotAllowedSafe, ownerErrorResponse, ownerTokenFrom } from '../../../_lib/owner-handler';

type Ctx = EventContext;

async function authorized(ctx: Ctx) {
  const placeId = String(ctx.params.placeId ?? '').trim();
  if (!isPlaceId(placeId)) throw new ProfileError('not_found', 'unknown business', 404);

  // The operator token can act on any business (support + moderation).
  if (await isAdminRequest(ctx.request, ctx.env.REGISTRY_ADMIN_TOKEN)) {
    const business = await getBusiness(ctx.env.DB, placeId);
    if (!business) throw new ProfileError('not_found', `no registry entry for ${placeId}`, 404);
    return { business, actor: 'operator' as const };
  }

  const token = ownerTokenFrom(ctx.request);
  const session = await getOwnerSession(ctx.env.DB, placeId, token);
  if (!session) {
    throw new ProfileError('session_expired', 'your session has expired — request a new code', 401);
  }
  const business = await getBusiness(ctx.env.DB, placeId);
  if (!business || !business.claimed) {
    throw new ProfileError('not_claimed', 'this listing has no claimed owner', 404);
  }
  if (business.ownerEmail && business.ownerEmail.toLowerCase() !== session.email) {
    throw new ProfileError('email_mismatch', 'this session does not own that listing', 403);
  }
  return { business, actor: 'owner' as const };
}

export const onRequestGet: PagesFunction = async (ctx) => {
  try {
    const { business } = await authorized(ctx);
    const [override, events] = await Promise.all([
      getOverrideByPlaceId(ctx.env.DB, business.placeId),
      listEditEvents(ctx.env.DB, business.placeId),
    ]);
    return json(
      {
        ok: true,
        business: {
          placeId: business.placeId,
          slug: business.slug,
          name: business.name,
          category: business.category,
          tier: business.tier,
          verified: business.verified,
        },
        override: override ? toPublicOverride(override) : null,
        events,
      },
      200,
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

const PATCH_KEYS = ['services', 'hours', 'priceNote', 'hiddenPhotos', 'addedPhotos'] as const;

export const onRequestPut: PagesFunction = async (ctx) => {
  try {
    const { business, actor } = await authorized(ctx);
    if (!business.slug) {
      throw new ProfileError('invalid_body', 'this listing has no slug yet — ask us to set one', 409);
    }
    const body = await readJsonObject(ctx.request);

    const patch: Record<string, unknown> = {};
    for (const key of PATCH_KEYS) {
      if (key in body) patch[key] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      throw new ProfileError('invalid_body', `send at least one of: ${PATCH_KEYS.join(', ')}`);
    }

    const override = await saveOverride(ctx.env.DB, {
      placeId: business.placeId,
      slug: business.slug,
      category: business.category === 'massage' ? 'massage' : 'nails',
      patch,
    });

    return json(
      { ok: true, actor, override: toPublicOverride(override) },
      200,
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

/** Owner reset, or operator takedown of the whole edit (`?unpublish=1`). */
export const onRequestDelete: PagesFunction = async (ctx) => {
  try {
    const { business, actor } = await authorized(ctx);
    const unpublish = new URL(ctx.request.url).searchParams.get('unpublish') === '1';
    if (actor === 'operator' && unpublish) {
      await setOverridePublished(ctx.env.DB, business.placeId, false, actor);
      return json({ ok: true, action: 'unpublished' }, 200, { 'cache-control': 'no-store' });
    }
    const removed = actor === 'operator'
      ? await deleteOverride(ctx.env.DB, business.placeId, actor)
      : await resetOverride(ctx.env.DB, business.placeId);
    return json(
      { ok: true, action: actor === 'operator' ? 'deleted' : 'reset', removed },
      200,
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowedSafe('GET, PUT, DELETE');
