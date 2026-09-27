# Phone-only owner identity foundation

Measured with `npm run owner:phone-coverage` on the committed listing markdown, without network access or API credentials:

- Nails: 748 total, 711 with a non-empty stored phone, 37 missing (95.05%).
- Massage: 752 total, 722 with a non-empty stored phone, 30 missing (96.01%).
- Total: 1,500 listings, 1,433 with a non-empty stored phone, 67 missing (95.53%).

This is stored-data coverage only. It does not prove that a number is currently valid, reachable, owned by the business, or recently retrieved. No freshness window is enforced by this foundation; retrieval/source metadata is unchanged because this card performs no fetches.

`src/lib/phone.ts` provides versioned `es-e164-v1` canonicalization. It accepts only the ES listing context, valid nine-digit Spanish numbers, and explicit `+34` numbers, while rejecting malformed, ambiguous, and other-country inputs with `null`.

## Audit of the committed dataset

Run `npm run owner:phone-coverage` for the deterministic, zero-network audit. The command runs the same fail-closed rules over every committed listing and reports, by category and overall, total, non-empty, canonicalizable, invalid/ambiguous, and missing values. The current result is:

- Nails: 748 total, 711 non-empty, 711 canonicalizable, 0 invalid/ambiguous, 37 missing.
- Massage: 752 total, 722 non-empty, 716 canonicalizable, 6 invalid/ambiguous, 30 missing.
- Total: 1,500 total, 1,433 non-empty, 1,427 canonicalizable, 6 invalid/ambiguous, 67 missing.

The same command finds 33 normalized-number collision groups affecting 78 listings. Each collision line identifies the affected `googlePlaceId`, slug, category, and a bounded disposition (`plausible shared/chain/contact` or `data-quality conflict: manual review`); it never prints the phone value. Shared/chain/contact is only a screening disposition based on same-category name overlap, not proof of common ownership. The manual-review disposition is intentionally conservative, especially for cross-category matches and unrelated names.

These measurements establish stored coverage and normalization uniqueness only. Canonicalization does not prove reachability, business ownership, consent, or freshness; those remain bounded risks for any later identity design. The six non-canonical stored values and all collision groups require exclusion or review before a canonical number is used as an owner identifier. Schema/auth design can proceed against the canonical value plus an explicit review policy, without treating it as verified identity.

No self-service challenge, contact transport, production schema, authentication/session change, API endpoint, provider setup, Google fetch, or production write is enabled by this card. Listings without a usable phone remain outside self-service scope.
