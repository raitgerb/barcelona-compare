// /api/owner/profile/:placeId — read, save and reset the owner's own listing content.
//
// Auth: `x-owner-session: <token>` from POST /api/owner/session/verify. The token
// is bound to one place id, so an owner can only ever touch their own record.
//
//   GET     current content + audit trail (the dashboard's "what is live now")
//   PUT     { services?, hours?, priceNote?, whatsapp?, hiddenPhotos?, addedPhotos? } — only
//           the keys present are touched; an empty list deliberately blanks a section
//   DELETE  back to the Google-derived defaults
//
// Docs: docs/owner-profile-edits.md

import { isAdminRequest, readJsonObject } from '../../../_lib/http';
import { getBusiness, isOwnershipApproved } from '../../../_lib/registry';
import {
  deleteOverride,
  getOverrideByPlaceId,
  getOwnerSession,
  isPlaceId,
  listEditEvents,
  ownerSessionId,
  resetOverride,
  saveOverride,
  setOverridePublished,
  toPublicOverride,
  ProfileError,
} from '../../../_lib/profile';
import { json, methodNotAllowedSafe, ownerErrorResponse, ownerTokenFrom } from '../../../_lib/owner-handler';

type Ctx = EventContext;

async function authorized(ctx: Ctx): Promise<{
  business: NonNullable<Awaited<ReturnType<typeof getBusiness>>>;
  actor: 'owner' | 'operator';
  authority: { kind: 'owner'; sessionId: string } | { kind: 'operator' };
}> {
  const placeId = String(ctx.params.placeId ?? '').trim();
  if (!isPlaceId(placeId)) throw new ProfileError('not_found', 'unknown business', 404);

  // The operator token can act on any business (support + moderation).
  if (await isAdminRequest(ctx.request, ctx.env.REGISTRY_ADMIN_TOKEN)) {
    const business = await getBusiness(ctx.env.DB, placeId);
    if (!business) throw new ProfileError('not_found', `no registry entry for ${placeId}`, 404);
    return { business, actor: 'operator' as const, authority: { kind: 'operator' } as const };
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
  // Independent of revokeBusiness() deleting the session rows: a session only works
  // while the business is still an approved owner, and the approval predicate
  // includes recorded provenance (so a `verified = 1` row without provenance — a
  // mixed-version writer — cannot open the editor either).
  if (!isOwnershipApproved(business)) {
    throw new ProfileError(
      'ownership_pending',
      'ownership of this listing is not approved, so it cannot be edited',
      403,
    );
  }
  // ...and the session must have been minted under *this* approval generation. A
  // session from before a revoke/re-approval stops working here, even if the row
  // survived. This is the application-level check; the write itself re-checks both
  // conditions in SQL, so a revoke that lands mid-request still cannot publish.
  if (
    session.approvalGeneration === null ||
    session.approvalGeneration !== business.approvalGeneration
  ) {
    throw new ProfileError(
      'ownership_pending',
      'this session was issued under an earlier ownership approval — request a new code',
      403,
    );
  }
  if (business.ownerEmail && business.ownerEmail.toLowerCase() !== session.email) {
    throw new ProfileError('email_mismatch', 'this session does not own that listing', 403);
  }
  return {
    business,
    actor: 'owner' as const,
    authority: { kind: 'owner' as const, sessionId: await ownerSessionId(placeId, token) },
  };
}

/**
 * What the *ordinary* editor is allowed to prefill — the owner's own content when it is
 * currently published AND written under the current approved generation.
 *
 * Anything else is withheld: content from a revoked predecessor (different generation),
 * content published before the approval gate (migration 0007 binds it to NULL), and a
 * row an operator unpublished for moderation all resolve to `null` so the form starts
 * from safe defaults. Without this, `OwnerEditor.astro` prefilled the stored values and
 * submitted every field — including ones the owner never touched — which turned
 * quarantined predecessor content into an explicit patch and republished it.
 *
 * The retained copy is not discarded: it stays in `ownership_quarantine_log` and the
 * edit trail (`events` below), and `overrideState` tells the dashboard *why* the form is
 * blank, so an operator-mediated adoption is a deliberate, visibly separate act.
 */
function editorOverrideProjection(
  override: Awaited<ReturnType<typeof getOverrideByPlaceId>>,
  business: { approvalGeneration: number },
): {
  override: ReturnType<typeof toPublicOverride> | null;
  overrideState: {
    present: boolean;
    projected: boolean;
    reason: 'none' | 'current' | 'unpublished' | 'unbound-generation' | 'earlier-generation';
    published: boolean;
    claimGeneration: number | null;
    approvalGeneration: number;
  };
} {
  const base = {
    present: override !== null,
    published: override?.published === true,
    claimGeneration: override?.claimGeneration ?? null,
    approvalGeneration: business.approvalGeneration,
  };
  if (!override) {
    return { override: null, overrideState: { ...base, projected: false, reason: 'none' } };
  }
  if (override.claimGeneration === null) {
    return { override: null, overrideState: { ...base, projected: false, reason: 'unbound-generation' } };
  }
  if (override.claimGeneration !== business.approvalGeneration) {
    return { override: null, overrideState: { ...base, projected: false, reason: 'earlier-generation' } };
  }
  if (!override.published) {
    return { override: null, overrideState: { ...base, projected: false, reason: 'unpublished' } };
  }
  return {
    override: toPublicOverride(override),
    overrideState: { ...base, projected: true, reason: 'current' },
  };
}

export const onRequestGet: PagesFunction = async (ctx) => {
  try {
    const { business } = await authorized(ctx);
    const [stored, events] = await Promise.all([
      getOverrideByPlaceId(ctx.env.DB, business.placeId),
      listEditEvents(ctx.env.DB, business.placeId),
    ]);
    const projection = editorOverrideProjection(stored, business);
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
        override: projection.override,
        overrideState: projection.overrideState,
        events,
      },
      200,
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

const PATCH_KEYS = ['services', 'hours', 'priceNote', 'whatsapp', 'hiddenPhotos', 'addedPhotos'] as const;

export const onRequestPut: PagesFunction = async (ctx) => {
  try {
    const { business, actor, authority } = await authorized(ctx);
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

    const override = await saveOverride(
      ctx.env.DB,
      {
        placeId: business.placeId,
        slug: business.slug,
        category: business.category === 'massage' ? 'massage' : 'nails',
        patch,
      },
      authority,
    );

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
    const { business, actor, authority } = await authorized(ctx);
    const unpublish = new URL(ctx.request.url).searchParams.get('unpublish') === '1';
    if (actor === 'operator' && unpublish) {
      await setOverridePublished(ctx.env.DB, business.placeId, false, actor);
      return json({ ok: true, action: 'unpublished' }, 200, { 'cache-control': 'no-store' });
    }
    const removed = actor === 'operator'
      ? await deleteOverride(ctx.env.DB, business.placeId, actor)
      : await resetOverride(ctx.env.DB, business.placeId, authority);
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
