-- 0003_owner_profile_edits.sql
-- Self-service profile edits (B2B Phase 1) — the content an owner submits for
-- their own listing, plus the session records that authorize the edit.
--
-- Three tables:
--   * owner_sessions      — short-lived 6-digit login codes and the longer-lived
--                           session tokens they mint. One row per code/token,
--                           keyed by sha256(secret || ':' || place_id); the secret
--                           itself is never stored. `kind` separates the two.
--   * profile_overrides   — what the owner published, one row per business. Keyed
--                           by slug (the site URL key: /nails/<slug>/) with
--                           place_id for the registry join.
--   * profile_edit_events — append-only audit trail of every owner/operator change.
--
-- NULL semantics in profile_overrides (deliberate, so "not submitted" and
-- "submitted empty" are different states):
--   services IS NULL      -> owner never sent a list; keep the Google-derived one
--   services = '[]'       -> owner sent an empty list; hide the section
--   hours IS NULL / '{}'  -> same as above for the hours table
--   price_note IS NULL    -> no note
--
-- Docs: docs/owner-profile-edits.md

-- ---------------------------------------------------------------------------
-- Owner sessions (login codes + session tokens)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owner_sessions (
  -- sha256(secret || ':' || place_id), hex. The secret is never stored.
  id         TEXT PRIMARY KEY,
  place_id   TEXT NOT NULL,
  email      TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('code', 'session')),
  -- failed verification attempts for `kind = 'code'` rows
  attempts   INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  used_at    TEXT
);

-- Login-code lookups (latest unused code for a business) and rate limiting.
CREATE INDEX IF NOT EXISTS idx_owner_sessions_lookup
  ON owner_sessions (place_id, kind, created_at DESC);
-- Session-token validation is a point lookup on the primary key; this index only
-- serves expiry sweeps.
CREATE INDEX IF NOT EXISTS idx_owner_sessions_expiry ON owner_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Owner-submitted profile content
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_overrides (
  place_id      TEXT PRIMARY KEY,
  -- Site slug (/nails/<slug>/), unique: the edge injector resolves pages by slug.
  slug          TEXT NOT NULL UNIQUE,
  category      TEXT NOT NULL CHECK (category IN ('nails', 'massage')),
  -- JSON: [{"name": "...", "price": "25 €"}, ...]
  services      TEXT,
  -- JSON: {"monday": "10:00-20:00", "sunday": ""} — empty string = closed
  hours         TEXT,
  price_note    TEXT,
  -- JSON: [0, 3] — indexes of the Google photo strip the owner hid
  hidden_photos TEXT NOT NULL DEFAULT '[]',
  -- JSON: ["https://...", ...] — owner-supplied photo URLs (max 3)
  added_photos  TEXT NOT NULL DEFAULT '[]',
  -- Operator moderation switch: 0 = taken down, the injector ignores the row
  published     INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  updated_by    TEXT NOT NULL DEFAULT 'owner',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The public read path lists published rows newest first.
CREATE INDEX IF NOT EXISTS idx_profile_overrides_published
  ON profile_overrides (published, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only audit trail (never updated, never deleted)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_edit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id   TEXT NOT NULL,
  slug       TEXT,
  actor      TEXT NOT NULL,
  -- owner_save | owner_reset | operator_publish | operator_unpublish | operator_delete
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_profile_edit_events_place
  ON profile_edit_events (place_id, id ASC);
