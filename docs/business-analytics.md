# Per-business event tracking (B2B analytics)

First-party counters for business detail pages: **profile views** and **outbound clicks**
(phone, WhatsApp, website, directions), keyed by Google Places ID — the same key as the
business registry, so a monthly partner report joins the two with no mapping table.

- Schema: `migrations/0002_business_events.sql`
- Data layer: `functions/_lib/events.ts`
- Write endpoint: `functions/api/track.ts` (`POST /api/track`, public, cookie-less)
- Read endpoints: `functions/api/analytics/index.ts`, `functions/api/analytics/[placeId].ts` (admin)
- Client: `src/components/EventTracking.astro` (inline script, detail pages only)
- Smoke test: `npm run analytics:smoke` (`scripts/analytics-smoke.sh`)
- Consumer: the monthly partner email card (t_d6ea2edf)

## Why first-party instead of the Cloudflare Web Analytics beacon

The site already ships the Cloudflare RUM beacon (`src/layouts/BaseLayout.astro`), which
serves **page-level traffic**. It was re-tested before writing any custom tracking
(2026-09-11) and the result was:

- **The ambient `Hermes Agrippa` API token CAN read per-path RUM** via the GraphQL API —
  `accounts(filter:{accountTag}).rumPageloadEventsAdaptiveGroups` filtered on
  `requestHost: "barcelonacompare.com"` — i.e. `requestHost` + `requestPath` works, one
  query per month, max 13 weeks per range. The old AGENTS.md line claiming the token
  "lacks Web Analytics SQL permission" was wrong for this query shape (it is a
  *permission* to read RUM, which this token has).
- But the numbers are **sample-weighted**: every count in this account's data is a
  multiple of 10, so a business with a handful of real views reports `0` or `10` — too
  coarse to put in front of a paying partner. There is also **no click dimension at all**
  (RUM records page loads, not outbound interactions), and free RUM history is finite.

So the beacon stays what it is (aggregate traffic, pricing context), and **per-partner
numbers come from first-party counters** where we control the granularity, the retention
and the audience definitions. The RUM API remains available as an independent
cross-check — if the first-party and RUM views ever diverge wildly, something is wrong
with the tracker.

## Schema

One row per `(place_id, date, event_type)`, aggregated at write time:

| column | meaning |
| --- | --- |
| `place_id` | Google Places ID (same key as `businesses.place_id`) |
| `date` | calendar day in **Europe/Madrid**, `YYYY-MM-DD` |
| `event_type` | `view`, `click_phone`, `click_whatsapp`, `click_website`, `click_directions` |
| `count` | counter, incremented on conflict |
| `first_seen`, `updated_at` | bookkeeping only |

The table grows with `businesses × days × event types` — never with traffic. Repeating an
event updates `count` instead of inserting a row (a day of traffic is one write per event,
and the storage is bounded by 1,182 businesses × 5 event types).

### Event types

| type | fires when |
| --- | --- |
| `view` | the detail page loads (one per page load) |
| `click_phone` | the `tel:` CTA is clicked |
| `click_whatsapp` | the `wa.me` CTA is clicked — the primary "Reservar por WhatsApp" button on the detail page, whether the number came from Google or from the owner dashboard (`docs/whatsapp-cta.md`) |
| `click_website` | the business website CTA is clicked |
| `click_directions` | the "Cómo llegar" / "Get directions" link is clicked |

## Client behaviour (`src/components/EventTracking.astro`)

- Inline (~1 KB), included only by the four detail-page routes (`/nails/…`, `/massage/…`,
  `/en/nails/…`, `/en/massage/…`); nowhere else.
- Sends with `navigator.sendBeacon()` (`fetch` + `keepalive` fallback) so clicks that
  navigate away (`tel:`, `wa.me`) are not lost.
- Buttons are marked in the templates with `data-track-event="click_*"`; the script
  delegates clicks in the capture phase, so any future CTA only needs the attribute.
- **Nothing runs** when Do Not Track or Global Privacy Control is set, when the browser is
  automated (`navigator.webdriver`), or when the user agent looks like a bot / preview /
  uptime crawler.

## Privacy

No cookies, no `localStorage`, no session ids, no IP addresses, no user-agent strings, no
referrers, no page URLs, no cross-site identifiers. The request carries `placeId` and
`type`; the row written is a counter. There is no way to reconstruct a visit, let alone a
visitor, from `business_events`. The tracker is first-party only — no analytics vendor is
loaded for this.

## API

### `POST /api/track` — public

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://barcelonacompare.com/api/track \
  -H 'content-type: application/json' \
  -d '{"placeId":"ChIJN1t_tDeuEmsRUsoyG83frY4","type":"view"}'
# 204
```

`400 invalid_body` for an unknown `type` or a malformed `placeId`; `405` for any other
method. No response body on success.

### `GET /api/analytics/:placeId` — admin

`month=YYYY-MM` or `from=`/`to=` (inclusive days, max 400), plus
`x-registry-admin-token: <REGISTRY_ADMIN_TOKEN>`. Day-by-day breakdown plus totals; a
business with no traffic yet returns zeros (never 404), because the partner email has to
be able to say "0 views".

```bash
TOKEN="$(cat ~/.hermes/profiles/builder/secrets/barcelona-compare-registry-admin-token.txt)"
curl -s "https://barcelonacompare.com/api/analytics/ChIJN1t_tDeuEmsRUsoyG83frY4?month=2026-09" \
  -H "x-registry-admin-token: $TOKEN" | jq
```

```json
{
  "ok": true,
  "placeId": "ChIJN1t_tDeuEmsRUsoyG83frY4",
  "from": "2026-09-01",
  "to": "2026-09-30",
  "views": 42,
  "clicks": { "phone": 3, "whatsapp": 7 },
  "clickTotal": 10,
  "total": 52,
  "days": [{ "date": "2026-09-11", "views": 42, "clicks": { "phone": 3, "whatsapp": 7 }, "clickTotal": 10, "total": 52 }]
}
```

### `GET /api/analytics` — admin

Every business with at least one event in the period, busiest first, plus period totals —
the single call the monthly email job needs. Optional `placeId=` filter.

```json
{
  "ok": true, "from": "2026-09-01", "to": "2026-09-30",
  "totals": { "places": 87, "views": 3120, "clicks": 214, "total": 3334 },
  "places": [{ "placeId": "ChIJ…", "views": 42, "clicks": { "phone": 3 }, "clickTotal": 3, "total": 45 }]
}
```

Owner emails live in the registry, not here: join `GET /api/registry?status=claimed`
(admin, returns `ownerEmail`) with the analytics rows **on `placeId`**.

## Operating it

```bash
npm run analytics:smoke                       # local: migrate, serve, assert, clean up
npm run analytics:smoke -- --url https://<deployment> --token <admin-token>
npx wrangler d1 migrations apply barcelona-compare-registry --remote   # applies 0002
```

The smoke test proves the real path: 6 events in → 5 aggregated rows in D1 (2 views + 4
clicks for one business), read back through both read endpoints, plus the auth and
validation failures, and it deletes its own rows afterwards.

## Known limits / follow-ups

- **No rate limiting on `POST /api/track`.** The `placeId`/`type` allow-list is the only
  guard; a scripted client can inflate one counter. Add a Cloudflare rate-limiting rule
  (dashboard → Security → WAF → Rate limiting rules) on `POST /api/track` before the
  numbers go in front of paying partners. Same class of gap as the registry write path.
- **JavaScript-only.** No-JS visitors and ad-blocked clients are invisible to the tracker
  (the RUM beacon has the same limitation for detail paths).
- **Counts are not unique visitors** — a reload is another view. That is deliberate: the
  partner-facing metric is "how much attention did this page get", not a visitor count
  we could only produce by identifying people.
- Events are stored per day only; there is no hour dimension (monthly reporting is the
  only consumer).
