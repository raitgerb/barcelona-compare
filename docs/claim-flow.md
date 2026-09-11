# Claim flow with email verification (B2B Phase 0)

The owner-facing half of the business registry: an owner finds their listing, asks
for a code, gets it by email and types it in. Only then does the business get
`claimed = 1` + `verified = 1` in D1.

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
correct code, through `claimBusiness()` and `verifyBusiness()` from
`functions/_lib/registry.ts` — so the hijack guard (`already_claimed`), the DB
invariants and the audit trail stay in one place, and a stranger who asks for a
code to somebody else's salon changes nothing at all.

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
            |   on success: claimBusiness() + verifyBusiness()  -> claimed + verified
            v
  { ok: true, state: "verified", business: {...}, listingUrl }
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
| POST | `/api/claim/start` | none (throttled) | `{placeId, email, locale?}` → `{state, business, email, delivery, expiresAt, resendInSeconds}` |
| POST | `/api/claim/verify` | none (throttled) | `{placeId, email, code}` → `{state:"verified", business, listingUrl}` |
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

`start` is idempotent for an owner who is already verified (`state:
"already_verified"`, no new code). Requesting a second code deletes the previous
pending one, so **only the newest code can ever be accepted**.

## Delivering the code

Delivery is one function, `sendClaimCode()` in `functions/_lib/claim-mail.ts`, with
one optional transport:

- **`RESEND_API_KEY` + `EMAIL_FROM` set** → the code is mailed from the edge
  (`POST https://api.resend.com/emails`) and `code_pending` is cleared on success.
  One secret configures this and the Phase 1 owner-login codes: the same names are
  used in `functions/_lib/mailer.ts`.
- **Not set** → the code stays in `claim_requests` and the endpoint answers
  `delivery: "none"`. Anyone with `REGISTRY_ADMIN_TOKEN` can read it from
  `GET /api/claim/outbox` and hand it to the owner (phone, WhatsApp, a mailbox),
  then `POST /api/claim/outbox/:id`.

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
`claimed`/`verified` plus the `claim,verify` audit trail. Remote mode
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
