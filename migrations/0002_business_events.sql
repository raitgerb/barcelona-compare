-- 0002_business_events.sql
-- First-party, per-business event counters (B2B partner analytics).
--
-- One row per (business, day, event type), aggregated at write time: the table grows
-- with (#businesses x #days x #event types), never with traffic. A row is a counter
-- and nothing else — no cookies, no session id, no IP address, no user-agent string,
-- no referrer. See docs/business-analytics.md.
--
-- Keyed by `place_id`, the same key as `businesses` (migrations/0001) and the site's
-- markdown frontmatter (`googlePlaceId`), so partner counts join straight onto the
-- registry and onto GET /api/registry.
--
-- `date` is the Europe/Madrid calendar day (the market the site serves), written by
-- functions/_lib/events.ts. It is the only time dimension — deliberately: partner
-- reporting is monthly, and a day resolution keeps the table small.
--
-- Docs: docs/business-analytics.md

CREATE TABLE IF NOT EXISTS business_events (
  place_id   TEXT NOT NULL,
  date       TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('view', 'click_phone', 'click_whatsapp', 'click_website', 'click_directions')
  ),
  count      INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (place_id, date, event_type)
);

-- Monthly reporting reads a date range across all businesses.
CREATE INDEX IF NOT EXISTS idx_business_events_date ON business_events (date, place_id);
