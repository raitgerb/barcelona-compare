# Claim flow with email verification (B2B Phase 0)

The owner-facing half of the business registry: an owner finds their listing, asks
for a code, gets it by email and types it in. A correct code records
`claimed = 1` in D1 and **nothing more** — it proves the requester can read that
mailbox, which is not proof of ownership. `verified = 1`, the public badge and the
owner editor come only from the manual ownership approval described in
*Ownership approval* below (migration `0006_ownership_approval.sql`).

- **Pages:** `/reclamar/` (ES) and `/en/claim-business/` (EN), both driven by
  `src/components/ClaimFlow.astro`
- **API:** `functions/api/claim/*` over the data layer in `functions/_lib/claim.ts`
- **Schema:** `migrations/0004_claim_verification.sql` (`claim_requests`)
- **Catalog:** `/data/claim-index.json`, generated at build time by
  `src/pages/data/claim-index.json.ts` and read at the edge by
  `functions/_lib/catalog.ts`
- **Test:** `bash scripts/claim-smoke.sh` (local) or `--url <deployment> --token <token>`

## The one rule that matters

**A code request never writes to `businesses`.** Pending codes live in
`claim_requests` and go nowhere else. The registry row is only touched after a
correct code, through `claimBusiness()` from `functions/_lib/registry.ts` — so the
hijack guard (`already_claimed`), the DB invariants and the audit trail stay in one
place, and a stranger who asks for a code to somebody else's salon changes nothing
at all.

**A correct code never grants ownership.** Anyone can select any listed business
and type their own address into the form, so mailbox possession must not award the
verified badge or edit/publish access. `POST /api/claim/verify` therefore no longer
calls `verifyBusiness()`; it answers `state: "pending_approval"` and leaves
`verified = 0`. The only transition to `verified` is `approveOwnership()` with a
named approver and the independent evidence used — see *Ownership approval*.

## Flow

```
  /reclamar/?place=<googlePlaceId>        owner arrives from a listing page
            |
            |  GET /data/claim-index.json    (browser: name/address for the card)
            |  GET /api/registry/:placeId    (public, PII-free: already verified?)
            v
  POST /api/claim/start  { placeId, email, locale }
            |   resolve placeId in the build catalog   -> 404 if not listed
            |   throughput checks                      -> 429 rate_limited
            |   write claim_requests row (HMAC hash + short-lived plain code)
            |   deliver: Resend when configured, otherwise leave it for the outbox
            v
  POST /api/claim/verify { placeId, email, code }
            |   HMAC compare, 5-attempt limit, 15-minute TTL
            |   on success: claimBusiness()  -> claimed, still verified = 0
            v
  { ok: true, state: "pending_approval", business: {...}, listingUrl,
    ownership: { state: "pending_review", approved: false, nextStep } }
            |
            |  (off-line of this flow, by a human)
            v
  PUT /api/registry/:placeId { op: "verify", approvedBy, evidence,
        expectedOwnerEmail, expectedClaimGeneration }                -> verified = 1
            |   the operator path; the ONLY transition that awards the badge
            v
  badge rebuild queued (functions/_lib/rebuild.ts)
```

## Table `claim_requests`

One row per code request (migration `0004_claim_verification.sql`):

| column | notes |
| --- | --- |
| `id` | random UUID (also the operator handle in the outbox) |
| `place_id`, `business_name`, `slug` | the business, snapshotted from the build catalog |
| `email` | normalized owner email (lowercased) |
| `code_hash` | `HMAC-SHA256(CLAIM_CODE_SECRET, "claim-code:" + code:place:email)` |
| `code_pending` | the plain code **only until the message is delivered**, then `NULL` |
| `attempts`, `sends` | wrong-code counter and how many codes this pair has asked for |
| `ip_hash` | `HMAC-SHA256(secret, "claim-ip:" + ip)` — the raw IP is never stored |
| `created_at`, `last_sent_at`, `expires_at` | ISO-8601 UTC |
| `delivered_at`, `delivery` | when/where the code left our hands (`resend`, `manual`, …) |
| `consumed_at` | set when a correct code is used; rows are pruned after 7 days |

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/claim/start` | none (throttled) | `{placeId, email, locale?}` → `{state, business, email, delivery, expiresAt, resendInSeconds}`; `state` is `code_sent`, `already_verified` or `already_pending` (mailbox already confirmed, still awaiting ownership review — no new code is issued) |
| POST | `/api/claim/verify` | none (throttled) | `{placeId, email, code}` → `{state:"pending_approval", business, listingUrl, ownership}` |
| GET | `/api/claim/outbox` | `x-registry-admin-token` | codes that were requested but not delivered |
| POST | `/api/claim/outbox/:id` | `x-registry-admin-token` | record a hand-over (`{provider}`), drops the plain code |

Error codes (all with a stable `error` field, mapped from `RegistryError`):

| code | HTTP | when |
| --- | --- | --- |
| `invalid_email` | 400 | malformed owner email |
| `not_found` | 404 | `placeId` is not in the build catalog |
| `already_claimed` | 409 | somebody else's email owns the business |
| `invalid_code` | 400 | wrong code, no pending code, or a code already used |
| `code_expired` | 410 | older than 15 minutes |
| `too_many_attempts` | 429 | 5 wrong codes for one request |
| `rate_limited` | 429 | 60 s per (business, email), 5 codes/hour per email, 20/hour per IP |
| `catalog_unavailable` | 503 | the build catalog could not be read |
| `server_misconfigured` | 500 | `CLAIM_CODE_SECRET` missing or too short |

`start` never issues a second code for a business whose owner email already holds
an email-verified claim: an approved owner gets `state: "already_verified"` and a
pending one gets `state: "already_pending"` (both without sending mail). Requesting
a second code deletes the previous pending one, so **only the newest code can ever
be accepted**.

## Ownership approval

`claimed` and `verified` mean two different things and are never set together:

| flag | set by | evidence it rests on |
| --- | --- | --- |
| `claimed = 1` | `claimBusiness()` after a correct code | possession of the mailbox the claimant typed in |
| `verified = 1` | `approveOwnership()` (operator only) | a person checked an **independent** source, recorded in `ownership_approved_by` + `ownership_evidence` |

Because the mailbox is chosen by the claimant, a correct code alone must not open
the owner surfaces. All three owner entry points refuse a claim that is not
approved, with `403 ownership_pending`:

- `POST /api/owner/session` — no login code is minted for a pending claim
- `POST /api/owner/session/verify` — an old/again-used code cannot be exchanged
- `GET/PUT /api/owner/profile/:placeId` — a session token cannot read or write the profile

Approving is a deliberate operator action:

```
curl -X PUT "$BASE/api/registry/$PLACE_ID" \
  -H "x-registry-admin-token: $REGISTRY_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"op":"verify","approvedBy":"<who checked>","evidence":"<which independent source>",
       "expectedOwnerEmail":"<the claimant you reviewed>","expectedClaimGeneration":<n>}'
```

All four fields are mandatory, and none of them is inferred from the calling token:

* `approvedBy` — the **human who performed the independent check**, supplied by the
  operator. It is *not* defaulted from the token's `actor`: the token proves only that
  someone holding the operator credential called the API, which is a different claim
  from "this named person reviewed the evidence". Both are recorded separately (the
  audit event carries `approvedBy` and `actor`), so the audit never invents an approver.
* `evidence` — what independent source established ownership. No default, ever.
* `expectedOwnerEmail` + `expectedClaimGeneration` — the exact claim the decision is
  about. Read the current generation from `GET /api/registry/:placeId` with the admin
  token before approving. The transition is a compare-and-set on that claimant and that
  generation, committed in one transaction with its audit row, so a decision that
  arrives after a revoke/reclaim is refused with `409 approval_conflict` instead of
  approving whoever holds the claim by then, and a failed audit row cannot leave
  `verified = 1` behind. Re-approving a row therefore needs a *fresh* decision against
  the current generation (it is not silently idempotent, by design).

Missing fields fail with `400 approval_provenance_missing` and `verified` stays `0`.
Migration `0006` downgrades any legacy `verified = 1` row with no provenance to
"email-verified, pending review" and writes an `ownership_review_required` audit event.
Migration `0007` binds publications and credentials to the approval generation and
makes provenance a schema invariant, so the pre-0006 code path now fails closed at the
database.

`revokeBusiness()` now deletes the owner's session rows as well, and the write path
re-checks `verified` on every request: the two guards are independent, so a revoked
or merely pending owner cannot edit anything even with a live token.

The owner-facing consequence is stated in `src/components/ClaimFlow.astro`: the
"claim recorded" panel says the claim is **pending review**, offers the listing link
and deliberately offers no editor link.

## Delivering the code

Delivery is one function, `sendClaimCode()` in `functions/_lib/claim-mail.ts`, with
one optional transport:

- **`RESEND_API_KEY` + `EMAIL_FROM` set** → the code is mailed from the edge
  (`POST https://api.resend.com/emails`) and `code_pending` is cleared on success.
  One secret configures this and the Phase 1 owner-login codes: the same names are
  used in `functions/_lib/mailer.ts`. **This is the live configuration in production**
  (sender `no-reply@send.barcelonacompare.com`, domain verified in Resend eu-west-1).
- **Not set, or the send fails** → the code stays in `claim_requests` and the endpoint
  answers `delivery: "none"`. Anyone with `REGISTRY_ADMIN_TOKEN` can read it from
  `GET /api/claim/outbox` and hand it to the owner (phone, WhatsApp, a mailbox),
  then `POST /api/claim/outbox/:id`. A failing transport degrades to this on purpose —
  mail trouble must never block a claim — so `delivery: "none"` on a live site means
  "the send failed", not "email was never configured". Check Resend's view of the
  domain (`docs/owner-profile-edits.md` → *If email stops working*) before the code.

That outbox is also what a phone-first onboarding uses: this market books on
WhatsApp, and an owner who calls is verified by reading the code back to them.
Adding another provider (Cloudflare Email Service via
`POST /accounts/<acct>/email/sending/send`, Postmark, …) means one more branch in
`sendClaimCode()` — no schema, endpoint or UI change.

## Deployment wiring

1. **Migrations** — `npm run db:migrate:local` then `npm run db:migrate:remote`
   (0004 adds `claim_requests`; 0001–0003 are separate cards).
2. **Secret `CLAIM_CODE_SECRET`** — Pages project → Settings → Variables and
   secrets → type **Secret** (32+ random chars; rotate = new secret, old pending
   codes stop working). Without it the endpoints answer `500
   server_misconfigured` — the flow fails closed on purpose.
3. **Optional: `RESEND_API_KEY`** (Secret) and `EMAIL_FROM` (Text,
   `Barcelona Compare <no-reply@barcelonacompare.com>`), plus the Resend domain
   records (SPF/DKIM) on the zone. Until then, delivery is the outbox handover.
4. `REGISTRY_ADMIN_TOKEN` (already present) also guards the outbox endpoints.

Both production and preview share the same D1 database, so a claim run from a
preview URL writes real registry rows.

## Local development

```bash
cp .dev.vars.example .dev.vars     # REGISTRY_ADMIN_TOKEN + CLAIM_CODE_SECRET
npm run build                      # wrangler pages dev serves dist/ (claim-index.json lives there)
npx wrangler pages dev dist --port 8799
bash scripts/claim-smoke.sh        # 40+ assertions, cleans up after itself
```

`scripts/claim-smoke.sh` migrates the local D1, serves `dist/`, picks two real
`placeId`s out of `/data/claim-index.json` that have no registry state, and proves:
catalog validation, the resend cooldown, the operator outbox (401 without the
token, then hand-over), single-use codes, the attempt limit, that failed
verifications leave no trace in `businesses`, and that a correct code writes
`claimed` plus the `claim` audit trail (and *not* `verified`, migration 0006:
ownership needs a human approval with recorded evidence). Remote mode
(`--url https://barcelonacompare.com --token <token>`) runs the same suite against
production and deletes its own rows. If an email transport is configured the test
sends real mail — pass `SMOKE_EMAIL=you@example.com`.

## Entry points on the listing pages

`src/components/ClaimCta.astro` is where an owner enters the flow from the listing
they are looking at (c0802c0, Sep 12). It renders on all four detail templates
(`nails` + `massage`, ES + EN) and deep-links with the business already selected:

| locale | href |
| --- | --- |
| ES | `/reclamar/?place=<googlePlaceId>` |
| EN | `/en/claim-business/?place=<placeId>` |

Two placements per template, and they read as one block with the verified badge:

- **inline**, under the business name where the badge lives — `VerifiedBadge` when the
  business is verified, "¿Gestionas este negocio? Reclámalo gratis →" when it is not
- **banner**, at the end of the page: "¿Eres el dueño de <name>?" + the free/no-commitment note

A **verified listing never shows a claim CTA** — that slot holds the "gestionado por el
negocio" note instead, so a claim link can never invite a second owner onto a taken
listing (the flow would answer `already_claimed` / the "already" screen anyway). A
missing `placeId` falls back to `/for-businesses`; in practice every listing carries one
(1,182 of 1,182 markdown files), which is also exactly the set in `/data/claim-index.json`,
so **catalog membership and "has a placeId" are the same condition** — the deep link
resolves for every business the CTA is rendered on.

## Not in this card

- Self-service editing of services/prices/photos (Phase 1), the verified badge
  (Phase 1) and paid tiers (Phase 2).
- Cloudflare rate limiting in front of `/api/claim/start`: the per-email and
  per-IP windows above are the in-app substitute until then.
