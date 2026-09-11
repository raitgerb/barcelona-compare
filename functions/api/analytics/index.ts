// GET /api/analytics — per-business views + clicks for a period (admin only).
//
// The machine-readable read path behind the monthly partner email (t_d6ea2edf): one
// call returns every business that recorded an event in the period, keyed by placeId —
// the same key as GET /api/registry, so the report job joins the two for owner emails.
// Analytics itself stays PII-free: no emails, no names, no URLs.
//
//   month=YYYY-MM   or   from=YYYY-MM-DD&to=YYYY-MM-DD     (required)
//   placeId=<google place id>                              (optional filter)
//
//   x-registry-admin-token: <REGISTRY_ADMIN_TOKEN>         (required — partner data)
//
// 200 {
//       ok, from, to,
//       totals: { places, views, clicks, total },
//       places: [ { placeId, views, clicks: { phone, whatsapp, website, directions },
//                   clickTotal, total } ]              // busiest first
//     }
//
// Docs: docs/business-analytics.md

import { errorJson, errorResponse, isAdminRequest, json, methodNotAllowed } from '../../_lib/http';
import {
  EventError,
  isPlaceId,
  resolvePeriod,
  toBreakdown,
  totalsByType,
} from '../../_lib/events';

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    if (!(await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN))) {
      return errorJson(
        'unauthorized',
        'analytics reads require a valid X-Registry-Admin-Token header',
        401,
      );
    }

    const url = new URL(request.url);
    const range = resolvePeriod(url.searchParams);

    const requestedPlace = url.searchParams.get('placeId');
    if (requestedPlace !== null && !isPlaceId(requestedPlace)) {
      throw new EventError('invalid_query', 'placeId must be a Google Places ID');
    }

    const breakdown = toBreakdown(await totalsByType(env.DB, range, requestedPlace ?? undefined));
    const totals = breakdown.reduce(
      (acc, row) => ({
        places: acc.places + 1,
        views: acc.views + row.views,
        clicks: acc.clicks + row.clickTotal,
        total: acc.total + row.total,
      }),
      { places: 0, views: 0, clicks: 0, total: 0 },
    );

    return json(
      { ok: true, from: range.from, to: range.to, totals, places: breakdown },
      200,
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowed('GET');
