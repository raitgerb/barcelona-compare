# Phase 1 local owner identity rehearsal

This is a local/test-only data layer for the approved phone-only owner identity design. The only authorization input is the committed `data/phone-self-service-eligibility-v1.json` manifest. `functions/_lib/owner-identity.ts` rejects every disposition except `eligible_unique_canonical`, requires the manifest version and policy, and keys admission only by Google Place ID; slug and name are not authorization inputs.

Migration `0006_owner_identity.sql` defines stable random users, Place-ID-scoped contact snapshots, memberships, append-only verification events, and Place-ID-scoped sessions. Contact snapshots contain a digest and source/version metadata, never a raw phone value. Legacy email memberships are explicitly `legacy_unverified` and therefore cannot authorize editing. User/session/membership revocation is represented by explicit state and timestamps.

Run locally with:

    npm run test:phone
    npm run test:owner-identity
    npm run build

The schema test applies the migration to an in-memory SQLite database, exercises the foreign keys/check constraints and idempotency key shape, revokes a session, and drops tables in dependency order as a rollback rehearsal. It never contacts Cloudflare or applies a remote D1 migration.

Production boundary: this phase does not add routes, challenge start/verify handlers, SMS/WhatsApp/email transport, provider configuration, freshness policy, manual review, production migration application, or live identity behavior. The next gate is an independently reviewed challenge/auth design and explicit approval before any production migration or transport work.
