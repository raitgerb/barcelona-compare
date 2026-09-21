// /api/registry/:placeId — read one registry entry, and (admin) change it.
//
// GET  public: claim state only, PII stripped. With the admin token: full record.
// PUT  admin only: { op: "claim" | "verify" | "setTier" | "revoke", ... }
//                  `verify` is the ownership approval and REQUIRES `evidence`
//                  (what independent source proved ownership) AND a named
//                  `approvedBy`. `approvedBy` is NEVER defaulted from anything, and
//                  both fields must be non-blank — an email-verified claim is not
//                  ownership, so it cannot be approved without provenance.
//                  A body `actor` is recorded only as operator-asserted provenance.
//                  The audit `actor` column holds the server-controlled credential
//                  class for the `verify`/ownership-approval event only (round 3, R3);
//                  the other ops on this route (claim/revoke/setTier/publish) still
//                  record the body-supplied actor, so that column is NOT a uniform
//                  credential-class field across every event — read the event's
//                  `actorAssertedSource` before treating `actor` as authenticated.
//                  The claim flow (Phase 0) and the Phase 1 owner dashboard call
//                  claimBusiness()/approveOwnership() from functions/_lib/registry.ts
//                  directly — this endpoint is the operator path (manual claims,
//                  ownership approval, tier upgrades, revocations).
//
// A write that actually changes verification state queues a production rebuild
// (functions/_lib/rebuild.ts) so the static badge HTML refreshes; send
// `"rebuild": false` to suppress it (bulk ops, smoke runs against production).
//
// Docs: docs/business-registry.md

import {
  errorJson,
  errorResponse,
  isAdminRequest,
  json,
  methodNotAllowed,
  readJsonObject,
} from '../../_lib/http';
import {
  RegistryError,
  approveOwnership,
  claimBusiness,
  getBusiness,
  listEvents,
  normalizeEmail,
  revokeBusiness,
  setTier,
  toPublic,
  isTier,
} from '../../_lib/registry';
import { queueRebuild } from '../../_lib/rebuild';

function placeIdFrom(params: Record<string, string | string[]>): string {
  const value = params.placeId;
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

export const onRequestGet: PagesFunction = async ({ request, params, env }) => {
  try {
    const placeId = placeIdFrom(params);
    const record = await getBusiness(env.DB, placeId);
    if (!record) {
      return errorJson('not_found', `no registry entry for ${placeId}`, 404);
    }

    const admin = await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN);
    const body: Record<string, unknown> = {
      ok: true,
      business: admin ? record : toPublic(record),
    };
    if (admin && new URL(request.url).searchParams.get('events') === '1') {
      body.events = await listEvents(env.DB, placeId);
    }

    return json(
      body,
      200,
      admin ? { 'cache-control': 'no-store' } : { 'cache-control': 'public, max-age=60' },
    );
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequestPut: PagesFunction = async (context) => {
  const { request, params, env } = context;
  try {
    if (!(await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN))) {
      return errorJson(
        'unauthorized',
        'write access requires a valid X-Registry-Admin-Token header',
        401,
      );
    }

    const placeId = placeIdFrom(params);
    const body = await readJsonObject(request);
    const op = typeof body.op === 'string' ? body.op : '';
    const actor = typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim() : 'admin-api';
    // Badge freshness: a real state transition queues a production rebuild; an
    // operator (or the smoke test) can opt out with {"rebuild": false}.
    const rebuild = body.rebuild !== false;
    const before = await getBusiness(env.DB, placeId);

    switch (op) {
      case 'claim': {
        const record = await claimBusiness(env.DB, {
          placeId,
          ownerEmail: normalizeEmail(body.ownerEmail),
          slug: typeof body.slug === 'string' ? body.slug : null,
          name: typeof body.name === 'string' ? body.name : null,
          category: typeof body.category === 'string' ? body.category : null,
          source: typeof body.source === 'string' ? body.source : 'admin',
          actor,
        });
        // A claim alone never changes the badge (verification does).
        return json({ ok: true, op, business: record });
      }
      case 'verify': {
        // Ownership approval. `approvedBy` + `evidence` are mandatory: a claim is
        // only email-verified, and the registry must record who decided this
        // business really belongs to that owner, and on what independent basis.
        //
        // `expectedOwnerEmail` + `expectedClaimGeneration` are mandatory too: the
        // approval is bound to the exact claimant the operator reviewed. Read the
        // current generation from `GET /api/registry/:placeId` (admin token) before
        // submitting; a stale or conflicting decision is refused with 409 rather
        // than approving whoever happens to be there now.
        const record = await approveOwnership(env.DB, placeId, {
          // Server-controlled: this call only reaches here because the request
          // presented the registry admin token, so the credential class is known
          // from the server side, not from the body.
          credentialClass: 'registry-admin-token',
          credentialIdentifier: 'X-Registry-Admin-Token',
          approvedBy: typeof body.approvedBy === 'string' ? body.approvedBy : '',
          evidence: typeof body.evidence === 'string' ? body.evidence : '',
          expectedOwnerEmail:
            typeof body.expectedOwnerEmail === 'string' ? body.expectedOwnerEmail : '',
          expectedClaimGeneration:
            body.expectedClaimGeneration === undefined || body.expectedClaimGeneration === null
              ? Number.NaN
              : Number(body.expectedClaimGeneration),
          // Only a name the caller actually asserted; the route never substitutes an
          // invented individual here. The credential class above is what authorizes.
          actor: typeof body.actor === 'string' ? body.actor : '',
        });
        if (rebuild && before && !before.verified) {
          queueRebuild(context, env, {
            reason: 'verify',
            placeId,
            actor,
            detail: { slug: record.slug, tier: record.tier },
          });
        }
        return json({ ok: true, op, business: record });
      }
      case 'setTier': {
        if (!isTier(body.tier)) {
          throw new RegistryError('invalid_tier', 'tier must be "free" or "pro"');
        }
        const record = await setTier(env.DB, placeId, body.tier, actor);
        if (rebuild && before && before.tier !== record.tier) {
          queueRebuild(context, env, {
            reason: 'tier_change',
            placeId,
            actor,
            detail: { tier: record.tier },
          });
        }
        return json({ ok: true, op, business: record });
      }
      case 'revoke': {
        const record = await revokeBusiness(
          env.DB,
          placeId,
          actor,
          typeof body.reason === 'string' ? body.reason : undefined,
        );
        // Only a row that actually carried something to revoke needs a rebuild.
        const changed = Boolean(
          before && (before.claimed || before.verified || before.tier !== 'free'),
        );
        if (rebuild && changed && before) {
          queueRebuild(context, env, {
            reason: 'revoke',
            placeId,
            actor,
            detail: { previousTier: before.tier, reason: typeof body.reason === 'string' ? body.reason : null },
          });
        }
        return json({ ok: true, op, business: record });
      }
      default:
        return errorJson(
          'invalid_body',
          'op must be one of: claim, verify, setTier, revoke',
          400,
        );
    }
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowed('GET, PUT');
