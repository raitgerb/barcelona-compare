-- 0004_claim_verification.sql
-- Email-verified claim flow (B2B Phase 0): the pending side of "claim this business".
--
-- Flow: owner asks for a code (`POST /api/claim/start`) -> we mail a 6-digit code ->
-- owner types it (`POST /api/claim/verify`) -> only THEN do we touch `businesses`
-- (claimBusiness + verifyBusiness). Nothing in `businesses` changes while a code is
-- pending, which is what stops an unverified stranger from squatting a listing.
--
-- One row per code request. Rows are ephemeral credentials, not a record of truth:
--   * `code_hash` is HMAC-SHA256(secret, code:place_id:email) — the plain code is
--     never stored for verification (see functions/_lib/claim.ts).
--   * `code_pending` holds the plain code ONLY until the message is delivered, so an
--     operator (or the HTTP outbox endpoint) can hand it over when no transactional
--     email transport is configured. It is cleared on delivery and on consumption.
--   * consumed/expired rows are pruned after 7 days by functions/_lib/claim.ts.
--
-- Indexes cover the three lookups the flow does: the pending code for a
-- (business, email), the delivery outbox, and the two rate-limit windows
-- (per email, per hashed IP - no raw IP is ever stored).
--
-- Docs: docs/claim-flow.md

CREATE TABLE IF NOT EXISTS claim_requests (
  id            TEXT PRIMARY KEY,
  place_id      TEXT NOT NULL,
  business_name TEXT,
  slug          TEXT,
  email         TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  code_pending  TEXT,
  locale        TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  sends         INTEGER NOT NULL DEFAULT 1,
  ip_hash       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_sent_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  delivered_at  TEXT,
  delivery      TEXT,
  consumed_at   TEXT,
  CHECK (attempts >= 0),
  CHECK (sends >= 1)
);

CREATE INDEX IF NOT EXISTS idx_claim_requests_pending
  ON claim_requests (place_id, email, consumed_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claim_requests_outbox
  ON claim_requests (delivered_at, created_at);

CREATE INDEX IF NOT EXISTS idx_claim_requests_email
  ON claim_requests (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claim_requests_ip
  ON claim_requests (ip_hash, created_at DESC);
