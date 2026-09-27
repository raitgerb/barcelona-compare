-- 0006_owner_identity.sql
-- Local/test-only Phase 1 phone identity data layer.
-- No transport, challenge endpoint, or production application is enabled by this migration.

CREATE TABLE IF NOT EXISTS owner_users (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS owner_contact_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  user_id TEXT,
  phone_digest TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('google_places')),
  eligibility_version TEXT NOT NULL,
  eligibility_disposition TEXT NOT NULL CHECK (eligibility_disposition = 'eligible_unique_canonical'),
  captured_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES owner_users(user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_contact_current
  ON owner_contact_snapshots(place_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_owner_contact_user
  ON owner_contact_snapshots(user_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS owner_memberships (
  membership_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role = 'owner'),
  state TEXT NOT NULL CHECK (state IN ('legacy_unverified', 'verified', 'revoked')),
  source TEXT NOT NULL CHECK (source IN ('legacy_email', 'phone_manifest')),
  created_at TEXT NOT NULL,
  verified_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES owner_users(user_id),
  UNIQUE (user_id, place_id, role)
);
CREATE INDEX IF NOT EXISTS idx_owner_membership_place
  ON owner_memberships(place_id, state);

CREATE TABLE IF NOT EXISTS owner_verification_events (
  event_id TEXT PRIMARY KEY,
  membership_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('legacy_imported', 'admitted', 'verified', 'revoked')),
  channel TEXT NOT NULL CHECK (channel IN ('legacy_email', 'phone')),
  eligibility_version TEXT,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (membership_id) REFERENCES owner_memberships(membership_id),
  FOREIGN KEY (user_id) REFERENCES owner_users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_owner_verification_membership
  ON owner_verification_events(membership_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS owner_identity_sessions (
  session_id TEXT PRIMARY KEY,
  token_digest TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('owner_edit')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES owner_users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_owner_identity_sessions_scope
  ON owner_identity_sessions(user_id, place_id, revoked_at, expires_at);

-- Rollback rehearsal (not applied by D1 migrations):
-- DROP TABLE owner_identity_sessions;
-- DROP TABLE owner_verification_events;
-- DROP TABLE owner_memberships;
-- DROP TABLE owner_contact_snapshots;
-- DROP TABLE owner_users;
