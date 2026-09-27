# Phone self-service eligibility control

This repository contains the versioned, zero-network control `phone-self-service-eligibility-v1`. It is generated from the committed listing markdown and records exactly one bounded disposition for every listing in `data/phone-self-service-eligibility-v1.json`.

A listing is eligible only when its stored phone is unambiguously canonical under `es-e164-v1` and that canonical value is unique across all listings. The control assigns one of:

- `eligible_unique_canonical`
- `ineligible_missing`
- `ineligible_invalid`
- `ineligible_shared_or_collision`

The artifact contains category, slug, Place ID, disposition, and opaque collision-group identifiers only. It never stores or prints raw phone values. Collision groups remain traceable through their listing identifiers, including same-category, cross-category, and multi-listing collisions.

This is an eligibility control only. Eligibility is not proof of reachability, ownership, consent, freshness, or successful contact. There is no freshness window and no manual-review lane. The control does not implement identity, authentication, sessions, challenges, phone transport, or recovery. Any future identity implementation must consume only values belonging to `eligible_unique_canonical`; all other dispositions are fail-closed.

Regenerate with `npm run phone:eligibility`. Run `npm run test:phone` for the executable regression suite. The generator refuses to write a manifest unless the committed dataset has all 1,500 listings.
