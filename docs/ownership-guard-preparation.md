# Ownership release — stage 1 maintenance guard (PREPARED, not released)

Status labels used below: LIVE / PREPARED / UNVERIFIED / BLOCKED.
Everything in this document is **PREPARED** unless it says otherwise. Nothing was
pushed, merged or deployed in this slice; no production or cloud resource was
touched or read for mutation; no credentials were printed.

- Date: 2026-09-21 (UTC)
- Owner approval (Rutger, via clarify, 2026-09-21): **YES — ship the safely gated
  ownership/UI release**; unrelated pre-existing baseline gaps deferred. Ownership
  review, maintenance protection, production backup, migration tests and live
  verification remain mandatory. Collection stays disabled. Release owner: Agrippa.
- Standard: Project Standard v1.0.0 (docs referenced: canonical
  `/Users/agrippa/Documents/Obsidian Vault/Hermes/Standards/Project Standard v1.md`).
  Maturity PUBLIC; ownership/auth changes are SENSITIVE-class change risk.

## 1. Workspace (isolated; canonical checkout untouched)

- Workspace: `/Users/agrippa/Projects/bc-release-guard` (separate clone, clean tree)
- Branch: `guard/maintenance-guard`
- Base: `ce34124209947caaaff9c9f667cb068de81d4c5b` (= origin/main at start of slice)
- Commit: `a53d2b8e0f79773118dd4a0850a3e2fdb2ac8d83` (local only, no remote branch, no push)
- Canonical shared checkout `/Users/agrippa/Projects/barcelona-compare` was treated
  read-only: no branch switch, no staging, no stash, no reset. Only git read/fetch
  was performed there, plus the copy of this document into `docs/`.

## 2. Changed paths (this commit)

    functions/_lib/maintenance-guard.ts   (new)  guard predicate + 503 response
    functions/_middleware.ts              (edit) guard runs before any route handler;
                                                 owner-content injection suppressed
    scripts/maintenance-guard-smoke.mjs   (new)  regression suite
    scripts/guard-resolve.mjs             (new)  test-only ESM resolve hook
    scripts/guard-ts-loader.mjs           (new)  test-only TS transpile hook (cached esbuild)
    scripts/guard-register.mjs            (new)  registers both hooks

No other file changed. No secrets, tokens or env values are read, written or logged
by the guard or by the test harness.

## 3. What the guard does (stage 1, deployable on the OLD schema-compatible main)

Root `functions/_middleware.ts` runs before every Pages Functions route handler, so
the refusal happens before any claim/owner handler, D1 write, code exchange or
session mint — which is exactly the old-code path Sol flagged as the mixed-version
vulnerability (old verify consumes the claim code and claims the row before the
provenance trigger refuses `verified = 1`, and old code can still mint sessions and
publish).

Refusal: `503`, `content-type: application/json`, `cache-control: no-store, max-age=0`,
`retry-after: 3600`, body `{error:"maintenance", message, retryAfterSeconds}`.
It contains no code, token or secret. There is deliberately **no** env flag, query
parameter, header, secret bypass or toggle endpoint: activation is a property of the
hardcoded constant `MAINTENANCE_GUARD_ACTIVE = true` in
`functions/_lib/maintenance-guard.ts`, so removal requires a reviewed code change.
The guard must stay in place across the subsequent ownership-code deployment until a
reviewed removal.

### Coverage decision (route map read from `functions/`, not guessed)

| Route | Methods | Guard |
|---|---|---|
| `/api/claim/start` | POST (+onRequest) | **blocked, all methods** |
| `/api/claim/verify` | POST (+onRequest) | **blocked, all methods** |
| `/api/claim/outbox`, `/api/claim/outbox/[id]` | GET, POST | **blocked, all methods** |
| `/api/owner/session`, `/api/owner/session/verify` | POST | **blocked, all methods** |
| `/api/owner/profile/[placeId]` | GET, PUT, DELETE | **blocked, all methods** |
| `/api/profile-overrides`, `/api/profile-overrides/[key]` | GET, PUT, DELETE | **blocked, all methods** |
| `/api/rebuild` | GET, POST | **blocked, all methods** (publication trigger) |
| `/api/registry`, `/api/registry/[placeId]` | GET (read) | **allowed** — read-only badge/build fetch |
| `/api/registry`, `/api/registry/[placeId]` | PUT (+ other mutating) | **blocked** |
| `/api/track`, `/api/analytics/*` | POST/GET | **allowed** (analytics) |
| static pages, listing detail pages, `/gestion` | GET | **allowed** — listing base content preserved |

Read coverage is deliberately *wider* than mutation coverage on the ownership
surface: claim/owner/profile-override **reads** are blocked too, because a read there
can expose pre-migration owner state (claim status, session validity, published
override content) and there is no read that the guard-period product needs. The
registry **read** is explicitly preserved because the build/badge pipeline fetches it
and it is already public today. Edge owner-content injection is suppressed while the
guard is active, so listing pages keep their build-time base content instead of
serving pre-migration owner-published regions.

Path normalisation is defensive because a miss is a bypass: percent-decoding (up to
three rounds, malformed escapes tolerated), backslash→slash, lowercasing, duplicate
slash collapse, `.`/`..` segment resolution, query/fragment stripped. Matching is on
whole segments (`/api/claimants` and `/api/owners` are **not** matched by
`/api/claim` / `/api/owner`), and trailing-slash, doubled-slash, uppercase, `./`,
encoded and query variants are all covered by tests.

## 4. Test evidence (local, no network, no mail)

Suite: `scripts/maintenance-guard-smoke.mjs`, run with
`node --import ./scripts/guard-register.mjs scripts/maintenance-guard-smoke.mjs`.
It loads the **real shipped modules** (`functions/_lib/maintenance-guard.ts` and the
real `functions/_middleware.ts`) and dispatches real `Request` objects into the real
middleware entrypoint with a stub `next()`, so it proves the guard executes before
handler/asset code (assertion: `next()` was never called) and that no D1 access
happens while the guard is active.

- Guard present (this commit):
  `PASS=1209 FAIL=0`, exit 0 — `/tmp/bc-guard-evidence-positive.txt`
  sha256 `7c292ce68a6e69c3ba68c82c94f39c2a733c1fc9b2335de4a7f5b080e446c056`
- Negative control — same suite, same command, run with `GUARD_ROOT` pointing at a
  copy of `functions/` whose `_middleware.ts` is the pre-guard version
  (`git show ce341242:functions/_middleware.ts`, zero guard references):
  exit 1 with 25+ recorded failures (blocking assertions report `status=200` and
  `next() ran`, and the listing path reaches D1 for owner overrides) —
  `/tmp/bc-guard-evidence-negative.txt`
  sha256 `5f98fed0eb1de080fef0f6798ce0fec46ecc0ed4ba165dd99c155d4ef227ed8c`

The control demonstrates the suite discriminates: with the mechanism removed the
assertions fail, so the green run is evidence and not a tautology.

Matrix covered: 10 fully-guarded paths + 2 mutation-guarded registry paths × 7
methods (GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS) × 8 spellings (plain, trailing
slash, double trailing slash, doubled interior slash, uppercase, percent-encoded,
query string, `./` segment), plus 15 unrelated paths (static pages, listing detail
pages, `/robots.txt`, `/_astro/*` asset, `/gestion`, `/api/track`,
`/api/analytics/*`, `/api/claimants`, `/api/owners`, `/api/rebuild-requests`) that
must **not** be blocked, plus runtime 503-shape assertions (status/headers/body) and
listing base-content assertions.

### Honest limits of this evidence

- This is a Node-runtime harness through the real middleware entrypoint, **not** a
  workerd/wrangler HTTP smoke. The local wrangler copy was located
  (`/Users/agrippa/.npm/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js`)
  and the esbuild it ships was used for TS transpilation, but `wrangler pages dev`
  was not run in this slice (no `dist/` in the isolated clone, time box). The HTTP
  edge smoke against the deployed guarded build is **UNVERIFIED** and belongs to
  stage 2 (deploy + live refusal verification).
- The negative control removes the middleware guard only; it does not replay the
  full old-code claim/session path against a seeded D1 (that 20/20 + 23/23 synthetic
  lifecycle evidence is reported in `docs/ownership-release-blockers.md` by the
  earlier worker and was not re-run here — treat it as reported, not re-verified).
- No production D1 was read or exported in this slice. Production backup remains
  **BLOCKED/not started** and is mandatory before migration.

## 5. Release-scoped declaration / exemption record (PREPARED text, not yet applied)

`docs/project-standard.json` does **not exist on origin/main** (and therefore not in
this workspace), so this slice asserts no declaration state at all: nothing is marked
VERIFIED and nothing is marked EXEMPT. Note for the reviewer: an untracked
`docs/project-standard.json` does exist in the canonical checkout's dirty ownership
work (`/Users/agrippa/Projects/barcelona-compare`, branch `analytics-fix16`); it was
not read for authority, not modified and not copied here. The record below is the text
to fold into the declaration when the declaration itself is created/updated in the
ownership release slice. It records the owner's scoped deferral honestly.

- Owner decision (Rutger, 2026-09-21, clarify): unrelated pre-existing baseline gaps
  are deferred for the ownership/UI release; the deferral does not extend to
  security/ownership/migration/recovery gates.
- Deferred (unrelated to ownership), each with compensating safeguard:
  - R2 image backup gap → read-only public R2 bucket, no delete path in release
    scope; compensating safeguard: no migration or write touches R2.
  - Google content-rights + collector automation + budget-guard retirement → data
    collection stays **disabled** for the whole window; compensating safeguard: the
    paused weekly cron stays paused and no collector is run.
  - Wider accessibility/analytics coverage → release scope excludes both areas; no
    analytics change ships in this release.
- Explicitly NOT exempt (core sensitive gates, binding regardless of the deferral):
  ownership/auth change review, maintenance guard, pre-migration production backup,
  migration tests + readback, negative authorization path verification, live refusal
  verification, rollback target.
- Review deadline for the deferral: **2026-09-28** (current date + 7 days), and
  sooner if any affected system changes or collection is restarted. Owner: Agrippa;
  next action: fold into `docs/project-standard.json` with the same date.
- Deferred gaps block: collection restart and any change to the affected subsystems
  until resolved or re-approved with a compensating safeguard.

## 6. Not done in this slice (explicit)

- No push, no PR, no branch on the remote, no deploy, no Cloudflare/D1/GitHub
  mutation, no production DB access, no credentials output.
- No wrangler/workerd HTTP smoke; no production export/backup; no migration applied.
- `docs/project-standard.json` not created here; release preflight receipt not
  generated here (the installed release phase requires a clean tree plus a receipt
  bound to the exact HEAD, which belongs to the deploy slice — a receipt with
  invented deployment fields would be a falsified record).
- Guard removal path not implemented (correct: removal must be a reviewed change).

## 7. Next stage (owner: Agrippa, independently reviewed)

1. Independent review of `a53d2b8` (guard predicate, coverage table, suite).
2. Deploy the guard alone on the old schema-compatible main through the sanctioned
   release path (PR + required check), verify live refusals on production for every
   guarded route and confirm listing/analytics still serve.
3. Capture the production D1 export/bookmark.
4. Apply migrations 0006+0007 under the guard, read back, then deploy the reviewed
   ownership code under the guard, verify negative authorization paths, and only
   then remove the guard via a reviewed change.
