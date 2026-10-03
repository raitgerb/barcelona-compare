# Owner identity Phase 1 handoff

Status: local/test-only. This phase establishes and tests the admission contract and
identity data model; it is not a production onboarding or owner-login release.

## Admission contract

- `phone-self-service-eligibility-v1` is the sole admission manifest/version.
- Only the disposition `eligible_unique_canonical` is admissible.
- The Google Places **Place ID** is the authorization key. A canonical phone match
  does not authorize any other listing or Place ID.
- Eligibility evidence must remain tied to the exact manifest version and Place ID;
  policy and eligibility semantics are unchanged by this handoff.

## Explicitly disabled in this phase

The following remain disabled and must not be inferred from the local/test artifacts:

- SMS, WhatsApp, and email transport
- claim/start and verify APIs
- the live challenge flow
- production migration application or D1 writes
- UI enablement
- a freshness policy
- a manual-review lane
- email as an eligibility source
- live identity behavior

No provider configuration, route, challenge handler, or production data path is
introduced by this phase. Local schema/test work must not be run against Cloudflare
or treated as an authorization decision for a live owner.

## Next gate

The next implementation gate is Cato review of the exact commit containing this
handoff and the Phase 1 artifacts. Do not enable transport, routes, UI, production
migrations, D1 writes, freshness, manual review, email eligibility, or live identity
behavior before that exact-head review and its resulting decision.
