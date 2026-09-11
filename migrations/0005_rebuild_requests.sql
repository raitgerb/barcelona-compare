-- 0005_rebuild_requests.sql
-- Production rebuild requests (B2B Phase 1 — verified-badge freshness).
--
-- The badge is baked into the static HTML at build time, so a verify (or a
-- revocation) only becomes visible after Pages builds again. functions/_lib/rebuild.ts
-- POSTs the project's Pages deploy hook whenever verification state actually changes;
-- every attempt is recorded here, so the freshness path is auditable through
-- `GET /api/rebuild` instead of only existing in Function logs.
--
-- status:
--   triggered — the deploy hook accepted the request and a build started
--   skipped   — no DEPLOY_HOOK_URL configured (local dev, preview): the badge waits
--               for the next normal deploy, exactly as before this card
--   failed    — the hook was configured but unreachable/refused; the badge waits
--
-- Append-only: nothing ever updates or deletes a row.

CREATE TABLE IF NOT EXISTS rebuild_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reason       TEXT NOT NULL,   -- verify | revoke | tier_change | manual
  place_id     TEXT,
  actor        TEXT,
  status       TEXT NOT NULL CHECK (status IN ('triggered', 'skipped', 'failed')),
  detail       TEXT,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_rebuild_requests_requested_at ON rebuild_requests (requested_at DESC);
