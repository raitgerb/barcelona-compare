// /api/profile-overrides/:key — one published owner edit, plus operator moderation.
//
//   GET     public: the published content for a slug or place id (404 unless live)
//   PUT     operator only: { "op": "publish" | "unpublish" } — takedown / restore
//   DELETE  operator only: removes the row (the audit trail in profile_edit_events
//           stays) — used for support requests and by the smoke test's cleanup
//
// Docs: docs/owner-profile-edits.md

import { isAdminRequest, readJsonObject } from '../../_lib/http';
import {
  deleteOverride,
  getOverrideByPlaceId,
  getOverrideBySlug,
  ProfileError,
  setOverridePublished,
  toPublicOverride,
  type ProfileOverride,
} from '../../_lib/profile';
import { errorJson, json, methodNotAllowedSafe, ownerErrorResponse } from '../../_lib/owner-handler';

function keyFrom(params: Record<string, string | string[]>): string {
  const value = params.key;
  const key = (Array.isArray(value) ? value[0] : value) ?? '';
  try {
    return decodeURIComponent(key).trim();
  } catch {
    return key.trim();
  }
}

/** A key is either a place id (registry key) or a site slug; try both. */
async function lookup(db: D1Database, key: string): Promise<ProfileOverride | null> {
  if (!key) return null;
  const bySlug = await getOverrideBySlug(db, key);
  if (bySlug) return bySlug;
  return getOverrideByPlaceId(db, key);
}

export const onRequestGet: PagesFunction = async ({ params, request, env }) => {
  try {
    const key = keyFrom(params);
    const record = await lookup(env.DB, key);
    const admin = await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN);
    if (!record || (!record.published && !admin)) {
      return errorJson('not_found', `no published owner content for ${key}`, 404);
    }
    return json({ ok: true, override: toPublicOverride(record) }, 200, {
      'cache-control': admin ? 'no-store' : 'public, max-age=60',
    });
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

export const onRequestPut: PagesFunction = async ({ params, request, env }) => {
  try {
    if (!(await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN))) {
      return errorJson('unauthorized', 'moderation requires the X-Registry-Admin-Token header', 401);
    }
    const body = await readJsonObject(request);
    const op = typeof body.op === 'string' ? body.op : '';
    if (op !== 'publish' && op !== 'unpublish') {
      throw new ProfileError('invalid_body', 'op must be publish or unpublish');
    }
    const record = await setOverridePublished(env.DB, keyFrom(params), op === 'publish', 'operator-api');
    return json({ ok: true, op, override: toPublicOverride(record) }, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

export const onRequestDelete: PagesFunction = async ({ params, request, env }) => {
  try {
    if (!(await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN))) {
      return errorJson('unauthorized', 'deletion requires the X-Registry-Admin-Token header', 401);
    }
    const removed = await deleteOverride(env.DB, keyFrom(params), 'operator-api');
    if (!removed) throw new ProfileError('not_found', 'no owner content for that key', 404);
    return json({ ok: true, action: 'deleted' }, 200, { 'cache-control': 'no-store' });
  } catch (error) {
    return ownerErrorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowedSafe('GET, PUT, DELETE');
