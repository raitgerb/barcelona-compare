# Business registry (B2B Phase 0)

Claim state for the partner program, keyed by Google Places ID — the same
identifier each business markdown file already carries in its frontmatter
(`placeId`). Everything the claim flow (Phase 0), the owner dashboard (Phase 1)
and the verified badge (Phase 1) needs to know about a business lives here.

- **Database:** Cloudflare D1, `barcelona-compare-registry`
  (`ca91d4f4-d44d-4163-9f5b-7db0464ef446`, region WEUR, account
  `135a01b78b043167860618dd0030c5f6`)
- **Code:** `migrations/0001_business_registry.sql` (schema),
  `functions/_lib/registry.ts` (data layer), `functions/api/registry/*` (HTTP)
- **Runtime:** Cloudflare Pages Functions (`functions/`), site stays static

## Schema

### `businesses` — one row per business

| column | type | notes |
| --- | --- | --- |
| `place_id` | TEXT PK | Google Places ID — the registry key |
| `slug` | TEXT | site slug (`/nails/<slug>/`), filled opportunistically |
| `name` | TEXT | display name snapshot |
| `category` | TEXT | `nails` \| `massage` |
| `claimed` | INTEGER 0/1 | owner email attached |
| `verified` | INTEGER 0/1 | email verification completed (Phase 0 card) |
| `owner_email` | TEXT | **PII** — never exposed publicly |
| `tier` | TEXT | `free` \| `pro` (Phase 2 adds paid tiers) |
| `claimed_at` | TEXT | ISO-8601 UTC, first claim date |
| `verified_at` | TEXT | ISO-8601 UTC |
| `source` | TEXT | `admin` \| `claim` \| `manual` \| `import` |
| `notes` | TEXT | **internal only** |
| `created_at`, `updated_at` | TEXT | ISO-8601 UTC, DB-maintained |

Invariants enforced by CHECK constraints:

- `claimed = 1` requires `owner_email` and `claimed_at`
- `verified = 1` requires `claimed = 1`
- `tier` is one of `free` / `pro`

### `registry_events` — append-only audit trail

`id`, `place_id`, `event` (`claim` / `verify` / `tier_change` / `revoke`),
`actor`, `detail` (JSON), `created_at`. Every state change through
`functions/_lib/registry.ts` writes one row; nothing ever updates or deletes it.

### `public_business_registry` — view

Everything in `businesses` minus `owner_email` and `notes`. Use this (or
`toPublic()` in the data layer) when rendering, never the base table.

## HTTP API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/registry` | none | list claimed businesses, PII stripped, `cache-control: public, max-age=300` |
| GET | `/api/registry?status=verified\|claimed\|all&limit=&offset=` | none (`all` needs token) | filter/paginate |
| GET | `/api/registry/:placeId` | none | one business, PII stripped |
| GET | `/api/registry/:placeId?events=1` | token | one business + audit trail |
| PUT | `/api/registry/:placeId` | token | operator write |
| POST | `/api/rebuild` | token | force a production rebuild (badge freshness) |
| GET | `/api/rebuild?limit=20` | token | rebuild trigger audit trail |

Write ops (body `{ "op": ... }`, header `x-registry-admin-token: <token>`):

```bash
curl -X PUT https://barcelonacompare.com/api/registry/ChIJxxxx \
  -H "x-registry-admin-token: $TOKEN" -H 'content-type: application/json' \
  -d '{"op":"claim","ownerEmail":"owner@example.com","slug":"salon-x","name":"Salon X","category":"nails"}'
```

| op | body | effect |
| --- | --- | --- |
| `claim` | `ownerEmail` (required), `slug`, `name`, `category`, `source` | attaches owner; **409** if already claimed by a different email, idempotent for the same email |
| `verify` | – | sets `verified`; **409 not_claimed** if there is no owner, idempotent |
| `setTier` | `tier`: `free` \| `pro` | partner tier |
| `revoke` | `reason` (optional) | clears owner/verification/tier, keeps row + history |

Any write that actually changes verification state also queues a production rebuild
(see "Badge freshness" below). Add `"rebuild": false` to the body to suppress that —
bulk imports and remote smoke runs use it so they do not start a build per change.

`GET /api/registry?status=verified` is the read path for the verified-badge work:
fetch it at build time (or from a cron) and match on `placeId`.

## Using the data layer

`functions/_lib/registry.ts` is the only place that touches these tables. The
claim flow should import `claimBusiness()` / `verifyBusiness()` instead of
writing SQL, so the invariants and audit trail stay in one place:

```ts
import { claimBusiness, verifyBusiness } from '../../_lib/registry';

const record = await claimBusiness(env.DB, { placeId, ownerEmail: email, source: 'claim' });
await verifyBusiness(env.DB, placeId);
```

Thrown `RegistryError`s carry a stable `code` (`not_found`, `already_claimed`,
`not_claimed`, `invalid_email`, `invalid_tier`, `invalid_body`) and an HTTP
`status`, so handlers can map them straight onto responses.

## Migrations

```bash
npm run db:migrate:local     # .wrangler/state/v3/d1
npm run db:migrate:remote    # the deployed database
```

Migrations live in `migrations/`, are applied in filename order and are never
rewritten — add `0002_*.sql` for the next schema change.

## Local development

```bash
cp .dev.vars.example .dev.vars      # REGISTRY_ADMIN_TOKEN for local calls
npm run build                        # `wrangler pages dev` serves dist/
npx wrangler pages dev dist --port 8799
npm run registry:smoke               # 42 assertions against the local server
npm run rebuild:smoke                # badge-freshness triggers, stub deploy hook
```

`wrangler.toml` holds the D1 binding **for local development only** — it
deliberately omits `pages_build_output_dir` so Cloudflare keeps using the
dashboard build configuration and env vars. Adding that key would make the file
the source of truth for the whole Pages project and drop the dashboard's
`GOOGLE_PLACES_API_KEY` / `R2_IMAGE_BASE_URL`.

## Deployment wiring (already done)

Cloudflare dashboard → **Workers & Pages → barcelona-compare → Settings**:

1. **Functions → D1 database bindings**: binding `DB` → `barcelona-compare-registry`
2. **Variables and secrets** → `REGISTRY_ADMIN_TOKEN`, type **Secret**

Both are also settable through the API
(`PATCH /accounts/<acct>/pages/projects/barcelona-compare`, keys
`deployment_configs.{production,preview}.d1_databases` and `.env_vars`; PATCH
merges, so unrelated variables are untouched). The operator token is stored
locally at
`~/.hermes/profiles/builder/secrets/barcelona-compare-registry-admin-token.txt`
and in the dashboard; rotate it by generating a new value, PATCHing the project
and updating that file.

Preview deployments share the **production** database — a preview write lands in
the real registry. Keep that in mind before running `registry-smoke.sh --url`
against a preview URL.

## Verified badge (B2B Phase 1)

The badge marks a business whose owner claimed it **and** completed verification.

- **Component**: `src/components/VerifiedBadge.astro` — ES + EN copy in one place,
  `variant="card"` for grids and `variant="detail"` for detail pages, plus a
  separate, clearly labelled `Socio Pro` / `Pro partner` chip when `tier = pro`
  (paid placement never masquerades as organic trust).
- **Read path**: `src/lib/registry.ts` fetches `GET /api/registry?status=verified`
  **at build time**, keyed on `googlePlaceId` (the value every business markdown
  file carries). Order of sources: `REGISTRY_BADGE_URL` (default: the production
  API; the literal value `snapshot` skips the network) → committed snapshot
  `src/data/registry-verified.json` → no badges. A 2.6k-page build never hinges on
  one network call.
- **Refresh the snapshot**: `npm run registry:snapshot [-- <registry-api-url>]`.
- **Where it renders**: listing cards (`ListingCard`, `PaginatedListing`), detail
  pages (ES + EN, nails + massage, where the claim CTA is replaced by an
  "owner-managed" note), money pages (`MoneyPage`) and the ES/EN homepages.
- **Trade-off**: the pages are static, so the badge only reaches the HTML when Pages
  builds again. That is handled automatically — see "Badge freshness" below.

## Badge freshness — rebuilding production when a business is verified

The badge is baked into the HTML at build time, so a verify (or a revocation) needs a
new build before it is visible. Without one, an owner who just verified would see
"verified" in the registry and no badge on the site until the next unrelated deploy.

**How it works.** `functions/_lib/rebuild.ts` POSTs the project's Pages **deploy hook**
for the `main` branch. It is called — fire-and-forget through `ctx.waitUntil()`, so it
never delays or fails a request — from the three places that change what the badge
should say:

- `functions/api/claim/verify.ts` after a successful code (the owner-facing path)
- `functions/api/registry/[placeId].ts` on `verify`, on `setTier` and on `revoke`
- `POST /api/rebuild` (manual, admin token) for bulk work or when a badge looks stale

**It cannot loop.** A trigger is sent only when state actually changed (an idempotent
`verify` or `setTier`, a `claim`, or a revocation of an empty row all send nothing), and
the rebuild path itself only *reads* the registry — a build never triggers another
build. `scripts/rebuild-smoke.sh` asserts this: 32 checks, including "verify twice
queues nothing" and "a read never triggers".

**It cannot break anything.** No `DEPLOY_HOOK_URL`, a rotated hook, a Cloudflare API
outage or a D1 hiccup all end up as a logged, recorded no-op; the badge then simply
waits for the next deploy, exactly as before this feature. Every attempt lands in
`rebuild_requests` (migrations/0005) and is readable through `GET /api/rebuild`:

```bash
curl -s https://barcelonacompare.com/api/rebuild -H "x-registry-admin-token: $TOKEN" | jq
```

`status` is `triggered` (a build started — `detail` carries its UUID), `skipped` (no
hook configured: local dev, preview) or `failed` (hook unreachable).

### Deploy hook setup (done once)

Dashboard, in order:

1. **Workers & Pages → barcelona-compare → Settings → Builds → Deploy Hooks.**
2. **Add deploy hook** → name `badge-freshness`, branch **main** → **Create**.
3. Copy the generated URL (it *is* the credential — no auth header is used).
4. **Settings → Variables and secrets → Add** → name `DEPLOY_HOOK_URL`, value = that
   URL, type **Secret**, then save.
5. Confirm it under the **Production** environment only: a preview deployment must
   never start a production build (preview Functions write to the same D1, but their
   trigger stays a recorded `skipped`).

The API does the same thing (what was actually used):

```bash
# create the hook (returns hook_id)
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCT/pages/projects/barcelona-compare/deploy_hooks" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"badge-freshness","branch":"main"}'

# the trigger URL is https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/<hook_id>

# add it as a production-only secret (PATCH merges; never echo existing secrets back)
curl -s -X PATCH "https://api.cloudflare.com/client/v4/accounts/$ACCT/pages/projects/barcelona-compare" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'content-type: application/json' \
  -d '{"deployment_configs":{"production":{"env_vars":{"DEPLOY_HOOK_URL":{"type":"secret_text","value":"<hook url>"}}}}}'
```

The hook URL is kept locally at
`~/.hermes/profiles/builder/secrets/barcelona-compare-deploy-hook-url.txt` (mode 0600).
Rotate it by deleting the hook, creating a new one and PATCHing the new URL.

### Cost and timing

One build per real state change (~2-4 minutes on Pages, serialized with other builds).
A remote `scripts/registry-smoke.sh` run makes ~3 state changes and therefore opts out
with `"rebuild": false`; set `SMOKE_REBUILD=1` to exercise the real trigger instead.
Verify the whole path locally — no Cloudflare API involved — with
`npm run rebuild:smoke` (stub deploy hook + 32 assertions).

The live acceptance test is `npm run badge:e2e` (env: `REGISTRY_ADMIN_TOKEN`,
`CLOUDFLARE_API_TOKEN`): it claims + verifies a real listed business, waits for the
deploy-hook build, asserts the badge is in the served HTML, revokes, waits again,
asserts the badge is gone, and deletes the test rows. It starts two real production
builds, so run it by hand when this path changes — not on every commit.

A change made *while* a build is already in its final minutes can land after that
build's registry fetch: Pages may skip a queued build for the same commit, so the
badge then waits for the next state change. `POST /api/rebuild` forces one.

