// /api/registry/:placeId — read one registry entry, and (admin) change it.
//
// GET  public: claim state only, PII stripped. With the admin token: full record.
// PUT  admin only: { op: "claim" | "verify" | "setTier" | "revoke", ... }
//                  The claim flow (Phase 0 card t_9e30b622) and the Phase 1 owner
//                  dashboard call claimBusiness()/verifyBusiness() from
//                  functions/_lib/registry.ts directly — this endpoint is the
//                  operator path (manual claims, tier upgrades, revocations).
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
  claimBusiness,
  getBusiness,
  listEvents,
  normalizeEmail,
  revokeBusiness,
  setTier,
  toPublic,
  verifyBusiness,
  isTier,
} from '../../_lib/registry';

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

export const onRequestPut: PagesFunction = async ({ request, params, env }) => {
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
        return json({ ok: true, op, business: record });
      }
      case 'verify': {
        const record = await verifyBusiness(env.DB, placeId, actor);
        return json({ ok: true, op, business: record });
      }
      case 'setTier': {
        if (!isTier(body.tier)) {
          throw new RegistryError('invalid_tier', 'tier must be "free" or "pro"');
        }
        const record = await setTier(env.DB, placeId, body.tier, actor);
        return json({ ok: true, op, business: record });
      }
      case 'revoke': {
        const record = await revokeBusiness(
          env.DB,
          placeId,
          actor,
          typeof body.reason === 'string' ? body.reason : undefined,
        );
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
