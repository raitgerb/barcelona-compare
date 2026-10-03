-- 0006_ownership_approval.sql
-- Ownership approval: a verified mailbox is not a verified owner.
--
-- Until this migration, POST /api/claim/verify called claimBusiness() AND
-- verifyBusiness() as soon as the 6-digit code matched. `claimed` and `verified`
-- therefore meant the same thing in practice: whoever could read a mailbox they had
-- typed in themselves became the "verified owner" of any listed business, which
-- awarded the public verified badge and opened the owner editor + publish path.
--
-- After this migration the two flags mean different things:
--   * claimed  = the claimant passed the email step. Mailbox possession. Not ownership.
--   * verified = a human approved ownership, and the two columns added here record
--                who did it and on what independent evidence.
--
-- functions/_lib/registry.ts (approveOwnership) refuses to set `verified` without
-- both provenance values, and functions/api/claim/verify.ts no longer touches
-- `verified` at all. Owner login and the owner write path both require `verified`,
-- so an email-verified claim stays read-only until it is approved.
--
-- Legacy rows: anything already `verified` at migration time carries no provenance —
-- it was created by the automatic path this migration removes. It is downgraded to
-- "email-verified, pending review" and gets an audit event, so an operator can
-- re-approve the genuine ones with recorded evidence instead of letting them keep a
-- badge they never earned. Measured before writing this (2026-09-20): the production
-- registry held zero claimed and zero verified rows, so this is expected to affect
-- nothing; it exists so that a later reader does not have to take that on trust.
--
-- Docs: docs/claim-flow.md, docs/business-registry.md

ALTER TABLE businesses ADD COLUMN ownership_approved_by TEXT;
ALTER TABLE businesses ADD COLUMN ownership_evidence TEXT;

INSERT INTO registry_events (place_id, event, actor, detail)
SELECT place_id,
       'ownership_review_required',
       'migration-0006',
       '{"reason":"verified before migration 0006, i.e. by mailbox possession alone, with no ownership provenance recorded","action":"downgraded to claimed + pending manual ownership approval"}'
  FROM businesses
 WHERE verified = 1
   AND ownership_approved_by IS NULL;

UPDATE businesses
   SET verified = 0,
       verified_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE verified = 1
   AND ownership_approved_by IS NULL;
