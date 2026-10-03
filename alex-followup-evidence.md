# Alex Massage Barcelona follow-up evidence

Task: `t_5c909aef`

## Google Places API (New)

Exactly one request was made after the budget guard counted it:

- Method: `GET`
- Endpoint: `https://places.googleapis.com/v1/places/ChIJI2l2yHSjpBIRYsAesITxamo`
- Field mask: `id,userRatingCount`
- HTTP status: `200`
- Raw response: `{"id":"ChIJI2l2yHSjpBIRYsAesITxamo","userRatingCount":244}`
- Budget ledger details calls: `1` before, `2` after; delta `1`
- API key is not present in this record.

The complete key-free JSON record is `alex-review-verification-evidence.json`.

## Verified badge semantics

The existing ownership badge is `src/components/VerifiedBadge.astro`. Its title and copy state that it means the business was claimed and verified by its owner. A live read of `GET https://barcelonacompare.com/api/registry/ChIJI2l2yHSjpBIRYsAesITxamo` returned HTTP `404` (`no registry entry`). Therefore no ownership/verified badge was added: owner-supplied content and photos do not prove identity, and no registry state was changed.

## Draft email

`docs/alex-massage-owner-email.es.md` reports only implemented facts, including the fresh 244-review result now published in the listing and the reason the ownership badge is not shown. It was not sent.

## Validation and live checks

- `npm run build`: PASS; 4,957 pages built.
- ES live route: checked after deployment; canonical `https://barcelonacompare.com/massage/alex-massage-barcelona/`; listing name and `244 reseñas en Google` present; no `Negocio verificado` badge.
- EN live route: checked after deployment; canonical `https://barcelonacompare.com/en/massage/alex-massage-barcelona/`; listing name and `244 Google reviews` present; no `Verified business` badge.
- Control live route: `https://barcelonacompare.com/massage/alexquiro/` HTTP `200`; canonical/name markers identify `AlexQuiro`.
- No deploy was required for the documentation-only change; the live checks confirm the already-deployed listing remains unchanged by this task.
