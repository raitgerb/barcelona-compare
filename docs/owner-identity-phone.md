# Phone-only owner identity foundation

Measured with `npm run owner:phone-coverage` on the committed listing markdown, without network access or API credentials:

- Nails: 748 total, 711 with a non-empty stored phone, 37 missing (95.05%).
- Massage: 752 total, 722 with a non-empty stored phone, 30 missing (96.01%).
- Total: 1,500 listings, 1,433 with a non-empty stored phone, 67 missing (95.53%).

This is stored-data coverage only. It does not prove that a number is currently valid, reachable, owned by the business, or recently retrieved. No freshness window is enforced by this foundation; retrieval/source metadata is unchanged because this card performs no fetches.

`src/lib/phone.ts` provides versioned `es-e164-v1` canonicalization. It accepts only the ES listing context, valid nine-digit Spanish numbers, and explicit `+34` numbers, while rejecting malformed, ambiguous, and other-country inputs with `null`.

No self-service challenge, contact transport, production schema, authentication/session change, API endpoint, provider setup, Google fetch, or production write is enabled by this card. Listings without a usable phone remain outside self-service scope.
