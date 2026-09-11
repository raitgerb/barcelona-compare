-- 0001_business_registry.sql
-- Business registry for the B2B partner program (Phase 0).
--
-- One row per business, keyed by Google Places ID (`place_id`) — the same key used
-- in the site's markdown frontmatter (`placeId`) and by scripts/broaden.py.
--
-- Invariants enforced by the DB:
--   * claimed = 1  => owner_email IS NOT NULL AND claimed_at IS NOT NULL
--   * verified = 1 => claimed = 1
--   * tier is one of free|pro
--
-- owner_email / notes are PII: never expose them from a public endpoint — read
-- through the `public_business_registry` view instead.

CREATE TABLE IF NOT EXISTS businesses (
  place_id    TEXT PRIMARY KEY,
  slug        TEXT,
  name        TEXT,
  category    TEXT,
  claimed     INTEGER NOT NULL DEFAULT 0 CHECK (claimed IN (0, 1)),
  verified    INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  owner_email TEXT,
  tier        TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  claimed_at  TEXT,
  verified_at TEXT,
  source      TEXT NOT NULL DEFAULT 'admin',
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (claimed = 0 OR (owner_email IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK (verified = 0 OR claimed = 1)
);

CREATE INDEX IF NOT EXISTS idx_businesses_claim_state ON businesses (claimed, verified);
CREATE INDEX IF NOT EXISTS idx_businesses_owner_email ON businesses (owner_email);
CREATE INDEX IF NOT EXISTS idx_businesses_tier        ON businesses (tier);

-- Append-only audit trail: who changed what, when. Never updated or deleted.
CREATE TABLE IF NOT EXISTS registry_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id   TEXT NOT NULL,
  event      TEXT NOT NULL,
  actor      TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_registry_events_place ON registry_events (place_id, id DESC);

-- Public-safe projection: no owner_email, no notes.
CREATE VIEW IF NOT EXISTS public_business_registry AS
SELECT place_id, slug, name, category, claimed, verified, tier, claimed_at, verified_at, updated_at
FROM businesses;
