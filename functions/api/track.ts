// POST /api/track — count one business detail-page event (view or outbound click).
//
// Public, first-party, cookie-less. Called by the inline tracker in
// src/components/EventTracking.astro with navigator.sendBeacon() (fetch keepalive as
// fallback); the body is { "placeId": "<google place id>", "type": "<event type>" }.
//
// Nothing identifying is read from the request — no IP, no user agent, no referer, no
// cookie. The only thing written is a counter row for (placeId, day, event type);
// see functions/_lib/events.ts and docs/business-analytics.md.
//
//   204 success (sendBeacon ignores the body) | 400 invalid body | 405 non-POST
//
// The placeId/type allow-list is the only abuse guard today. A Cloudflare rate-limit
// rule on this path is the documented follow-up (docs/business-analytics.md).

import { errorResponse, methodNotAllowed, readJsonObject } from '../_lib/http';
import { EVENT_TYPES, EventError, isEventType, isPlaceId, recordEvent } from '../_lib/events';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await readJsonObject(request);

    if (!isPlaceId(body.placeId)) {
      throw new EventError('invalid_body', 'placeId must be a Google Places ID');
    }
    if (!isEventType(body.type)) {
      throw new EventError('invalid_body', `type must be one of: ${EVENT_TYPES.join(', ')}`);
    }

    await recordEvent(env.DB, body.placeId, body.type);

    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const onRequest: PagesFunction = async () => methodNotAllowed('POST');
