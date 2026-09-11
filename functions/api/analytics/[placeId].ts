// GET /api/analytics/:placeId — one business's views + clicks, day by day (admin only).
//
//   month=YYYY-MM   or   from=YYYY-MM-DD&to=YYYY-MM-DD     (required)
//   x-registry-admin-token: <REGISTRY_ADMIN_TOKEN>         (required)
//
// 200 {
//       ok, placeId, from, to,
//       views, clicks: { phone, whatsapp, website, directions }, clickTotal, total,
//       days: [ { date, views, clicks, clickTotal, total } ]   // oldest first
//     }
//
// An unknown placeId is not an error: a business with no traffic yet returns zeros
// (the partner report has to be able to say "0 views" rather than "not found").
//
// Docs: docs/business-analytics.md

import { errorJson, errorResponse, isAdminRequest, json, methodNotAllowed } from '../../_lib/http';
import {
  EventError,
  dailyTotals,
  isPlaceId,
  resolvePeriod,
  toDailyBreakdown,
} from '../../_lib/events';

function placeIdFrom(params: Record<string, string | string[]>): string {
  const value = params.placeId;
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

export const onRequestGet: PagesFunction = async ({ request, params, env }) => {
  try {
    if (!(await isAdminRequest(request, env.REGISTRY_ADMIN_TOKEN))) {
      return errorJson(
        'unauthorized',
        'analytics reads require a valid X-Registry-Admin-Token header',
        401,
      );
    }

    const placeId = placeIdFrom(params);
    if (!isPlaceId(placeId)) {
      throw new EventError('invalid_query', 'placeId must be a Google Places ID');
    }

    const range = resolvePeriod(new URL(request.url).searchParams);
    const days = toDailyBreakdown(await dailyTotals(env.DB, placeId, range));
    const totals = days.reduce(
      (acc, day) => {
        acc.views += day.views;
        acc.clickTotal += day.clickTotal;
        acc.total += day.total;
        for (const [kind, count] of Object.entries(day.clicks)) {
          acc.clicks[kind] = (acc.clicks[kind] ?? 0) + count;
        }
        return acc;
      },
      { views: 0, clicks: {} as Record<string, number>, clickTotal: 0, total: 0 },
    );

    return json(
      { ok: true, placeId, from: range.from, to: range.to, ...totals, days },
      200,
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowed('GET');
