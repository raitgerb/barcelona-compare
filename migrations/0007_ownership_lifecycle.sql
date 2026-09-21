-- 0007_ownership_lifecycle.sql
-- Bind published content and owner credentials to an approved claim *generation*,
-- quarantine everything that predates that binding, and make the provenance
-- requirement a schema invariant rather than a convention.
--
-- Why this exists (independent review, 2026-09-20, findings B1/B4 + rollout blocker):
--   * `published = 1` alone was treated as public truth. A claimant who passed the old
--     mailbox-only policy could leave prices/links/photos live for ever: migration 0006
--     downgrades `businesses`, but never touched `profile_overrides`, so revoking a
--     claimant removed their editor access and left their content on the public page.
--   * Login codes and session tokens minted before the approval gate survived the
--     downgrade. They were blocked only by `verified = 0`, so a later approval of the
--     same stored email made an old token valid again with no new login.
--   * Nothing in the schema stopped a writer from setting `verified = 1` without
--     provenance, which is exactly what the previous code version does — so a
--     code-before-migration rollout could re-open the original defect.
--
-- After this migration:
--   * `businesses.approval_generation` is the epoch of the current ownership approval.
--     approveOwnership() increments it; revokeBusiness() increments it again.
--   * `profile_overrides.claim_generation` records the epoch the content was written
--     under. Public reads require `claim_generation = businesses.approval_generation`
--     on an approved claim, so revoked/quarantined content fails closed even if the
--     `published` flag is stale.
--   * `owner_sessions.approval_generation` records the epoch a code/token was minted
--     under, and must equal the business epoch to be usable. -1 is the quarantine
--     value for credentials that predate the approval gate: it can never match.
--   * `ownership_quarantine_log` preserves the *evidence* of what was withdrawn
--     (never the authority).
--
-- Rollout order: apply this migration before the new code, or with writes quiesced.
-- The two triggers below make the old code fail closed instead of open: a legacy
-- `UPDATE businesses SET verified = 1` now aborts with a SQL error.
--
-- Docs: docs/claim-flow.md, docs/business-registry.md, docs/owner-profile-edits.md

ALTER TABLE businesses ADD COLUMN approval_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profile_overrides ADD COLUMN claim_generation INTEGER;
ALTER TABLE owner_sessions ADD COLUMN approval_generation INTEGER;

CREATE TABLE IF NOT EXISTS ownership_quarantine_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id    TEXT NOT NULL,
  -- publication | login_code | session
  kind        TEXT NOT NULL CHECK (kind IN ('publication', 'login_code', 'session')),
  generation  INTEGER,
  owner_email TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ownership_quarantine_place
  ON ownership_quarantine_log (place_id, id ASC);

-- ---------------------------------------------------------------------------
-- Schema invariants: verification without provenance is impossible
-- ---------------------------------------------------------------------------
-- These run for writers of any code version. The pre-migration owner verification
-- path (`UPDATE businesses SET verified = 1`) now aborts at the database instead of
-- silently granting a badge + edit access under the mixed-version rollout.
-- Round 3 (R2): ONE predicate, every column. Both provenance fields must be
-- non-blank *text*, and every UPDATE that can leave a verified row without them is
-- covered -- not only `UPDATE OF verified` (a writer could otherwise clear
-- `ownership_evidence`, or blank the approver to spaces, and still stay published).
--
-- Round 5 (whitespace): "non-blank" means ECMAScript `String.prototype.trim()`, which is
-- what the runtime predicate `functions/_lib/registry.ts#isOwnershipApproved` uses. SQLite's
-- one-argument `trim(X)` strips ASCII space (U+0020) ONLY, so tab/newline/NBSP-only
-- provenance passed the schema while the runtime refused it (round-4 finding). SQLite's
-- TWO-argument `trim(X, Y)` strips any character contained in `Y`, and `char(...)` emits
-- Unicode code points, so `trim_ws` below is exactly the ECMAScript WhiteSpace +
-- LineTerminator set: TAB/LF/VT/FF/CR/SP, NBSP, ZWNBSP, U+1680, U+2000-U+200A, U+2028,
-- U+2029, U+202F, U+205F, U+3000. Keep in step with
-- `functions/_lib/provenance.ts`; `scripts/ownership-lifecycle-test.cjs` asserts parity
-- between this literal and that module over the whole set.
-- (`trim_ws` is a plain string expression, not a column: SQLite has no variables, and
--  every guard site repeats the same literal.)
CREATE TRIGGER IF NOT EXISTS trg_businesses_verified_requires_provenance_update
BEFORE UPDATE OF verified, ownership_approved_by, ownership_evidence ON businesses
FOR EACH ROW
WHEN NEW.verified = 1
 AND (NEW.ownership_approved_by IS NULL OR trim(NEW.ownership_approved_by, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = ''
      OR NEW.ownership_evidence IS NULL OR trim(NEW.ownership_evidence, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')
BEGIN
  SELECT RAISE(ABORT, 'ownership_provenance_required: verified=1 needs non-blank ownership_approved_by and ownership_evidence');
END;

CREATE TRIGGER IF NOT EXISTS trg_businesses_verified_requires_provenance_insert
BEFORE INSERT ON businesses
FOR EACH ROW
WHEN NEW.verified = 1
 AND (NEW.ownership_approved_by IS NULL OR trim(NEW.ownership_approved_by, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = ''
      OR NEW.ownership_evidence IS NULL OR trim(NEW.ownership_evidence, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')
BEGIN
  SELECT RAISE(ABORT, 'ownership_provenance_required: verified=1 needs non-blank ownership_approved_by and ownership_evidence');
END;

-- ---------------------------------------------------------------------------
-- 1. Quarantine publications that predate approval-generation binding
-- ---------------------------------------------------------------------------
INSERT INTO ownership_quarantine_log (place_id, kind, generation, owner_email, detail)
SELECT o.place_id,
       'publication',
       b.approval_generation,
       b.owner_email,
       json_object(
         'slug', o.slug,
         'published', o.published,
         'updated_at', o.updated_at,
         'reason', 'published content predates approval-generation binding (migration 0007)'
       )
  FROM profile_overrides o
  LEFT JOIN businesses b ON b.place_id = o.place_id
 WHERE o.published = 1;

INSERT INTO profile_edit_events (place_id, slug, actor, action, detail)
SELECT o.place_id,
       o.slug,
       'migration-0007',
       'ownership_unpublished',
       json_object('reason', 'published content predates approval-generation binding (migration 0007)')
  FROM profile_overrides o
 WHERE o.published = 1;

UPDATE profile_overrides
   SET published = 0,
       claim_generation = NULL,
       updated_by = 'migration-0007'
 WHERE published = 1;

-- ---------------------------------------------------------------------------
-- 2. Quarantine credentials issued under the pre-approval policy
-- ---------------------------------------------------------------------------
-- Not deleted, and not marked used: the rows are evidence of what was issued and
-- when. They are marked with generation -1, which no business can ever carry, so
-- they can never be redeemed even if the same mailbox is approved later.
INSERT INTO ownership_quarantine_log (place_id, kind, generation, owner_email, detail)
SELECT place_id,
       CASE kind WHEN 'code' THEN 'login_code' ELSE 'session' END,
       -1,
       email,
       json_object(
         'created_at', created_at,
         'expires_at', expires_at,
         'used_at', used_at,
         'reason', 'issued before the ownership-approval gate; a mailbox alone was treated as ownership'
       )
  FROM owner_sessions;

UPDATE owner_sessions
   SET approval_generation = -1
 WHERE approval_generation IS NULL;

INSERT INTO registry_events (place_id, event, actor, detail)
SELECT b.place_id,
       'ownership_review_required',
       'migration-0007',
       json_object(
         'reason', 'credentials and publications from before the approval-generation binding were quarantined',
         'action', 're-approve ownership with the expected claimant email and the reviewed generation'
       )
  FROM businesses b
 WHERE EXISTS (
         SELECT 1 FROM ownership_quarantine_log q
          WHERE q.place_id = b.place_id AND q.generation = -1
       );
