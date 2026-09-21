// Edge injector for owner-published listing content (B2B Phase 1).
//
// The listing pages are static, so services / hours / photos are baked in at build
// time. When an owner publishes edits (`/gestion` → D1), this middleware swaps
// those three regions in the served HTML, so edits are live in seconds without a
// rebuild and crawlers see them (the content is in the response, not fetched by
// client-side JS afterwards).
//
// Cost control: only listing detail paths are considered, and the response body is
// only touched when the business actually has a published override — everything
// else returns `next()` untouched. A D1 outage or a template without markers falls
// back to the static page, never to an error.
//
// Docs: docs/owner-profile-edits.md

import { getPublishedOverrideBySlug } from './_lib/profile';
import { galleryBaseFor, hasOwnerMarkers, injectOwnerContent, matchDetailPath } from './_lib/owner-content';
import { MAINTENANCE_GUARD_ACTIVE, isGuardedRequest, maintenanceGuardResponse } from './_lib/maintenance-guard';

export const onRequest: PagesFunction = async (context) => {
  const { request, env, next } = context;

  const url = new URL(request.url);

  // FIRST-STAGE MAINTENANCE GUARD — executes before any route handler.
  // Ownership/claim/publication endpoints are refused outright (no handler code,
  // no D1 write, no session minted). See docs/ownership-guard-preparation.md.
  if (isGuardedRequest(url.pathname, request.method)) {
    return maintenanceGuardResponse();
  }

  // While the guard is active the edge must not inject owner-published content:
  // pre-migration overrides are exactly the state the guard exists to stop
  // serving. Listing detail pages keep their build-time base content.
  if (MAINTENANCE_GUARD_ACTIVE) return next();

  if (request.method !== 'GET') return next();

  const pathname = url.pathname;
  const detail = matchDetailPath(pathname);
  if (!detail) return next();

  let override;
  try {
    override = await getPublishedOverrideBySlug(env.DB, detail.slug);
  } catch (error) {
    console.error('owner-inject: override lookup failed', error);
    return next();
  }
  if (!override || override.category !== detail.category) return next();

  const response = await next();

  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return response;

    const html = await response.text();
    if (!hasOwnerMarkers(html)) return rebuild(response, html); // templates without markers: pass through

    const injected = injectOwnerContent({
      html,
      override,
      lang: detail.lang,
      galleryBase: galleryBaseFor(detail.category, detail.slug, env.R2_IMAGE_BASE_URL),
    });
    if (!injected.changed) return rebuild(response, html);

    const next5 = rebuild(response, injected.html);
    // Short edge TTL: owner edits appear within ~1 minute, D1 is hit once per minute
    // per listing instead of once per view.
    next5.headers.set('cache-control', 'public, max-age=60');
    return next5;
  } catch (error) {
    // Never break a listing page because of an injection bug.
    console.error('owner-inject: injection failed', error);
    return next();
  }
};

/** Re-wrap an already-read body, dropping the headers that no longer apply. */
function rebuild(response: Response, html: string): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
