# Ownership release — stage 2 candidate preparation (PREPARED, not released)

Status labels: **LIVE** = produced by a command actually run in this session; **PREPARED** =
written but not executed; **UNVERIFIED** = not executed here; **BLOCKED** = cannot proceed.

- Date: 2026-09-21 (Europe/Madrid). This document is the **sole canonical write** of this task
  (`/Users/agrippa/Projects/barcelona-compare` is otherwise read-only: no branch switch, no
  add/commit/stash/reset, no build, no install).
- Authority: Rutger (via task brief, 2026-09-21) — prepare a stage-2 ownership candidate, safely
  gated, unrelated pre-existing baseline gaps deferred, **collection stays disabled**.
  Stage 2 is **source preparation only**: no deployment, no migration, no cloud/API/credential
  access, no remote push/PR/branch. Release owner: **Agrippa**. Guard removal is a *later,
  separately reviewed* phase.
- Standard: Project Standard v1.0.0 (canonical `/Users/agrippa/Documents/Obsidian Vault/Hermes/
  Standards/Project Standard v1.md`). Modules WEB, DATA, EXTERNAL, ANALYTICS, AUTOMATION;
  maturity PUBLIC; ownership/auth change = SENSITIVE class → independent review required.
- Inputs read this session: canonical `AGENTS.md`, `docs/ownership-release-blockers.md`,
  `docs/ownership-migration-rehearsal.md`, `docs/ownership-guard-preparation.md`;
  guard workspace `/Users/agrippa/Projects/bc-release-guard` (read-only).

## 1. Provenance of the candidate base (LIVE, git read-only)

| fact | value |
|---|---|
| guard workspace | `/Users/agrippa/Projects/bc-release-guard` (clean tree, read-only this task) |
| guard PR | https://github.com/raitgerb/barcelona-compare/pull/5 — **OPEN** |
| guard PR head | `0242d693acf3cb26fd68d6133f53198227b41cd7` |
| guard branch | `guard/maintenance-guard` |
| guard HEAD merge-base with `origin/main` | `10ab9621f533f9b8351dd48c7af60ac7118c231d` = **`origin/main` tip** |
| guard touches (vs main) | `functions/_middleware.ts`, `functions/_lib/maintenance-guard.ts`, `scripts/guard-*.mjs`, `scripts/maintenance-guard-smoke.mjs`, `docs/ownership-guard-preparation.md`, `docs/project-standard.json`, `docs/handoffs/stage1-maintenance-guard-2026-09-21.md` |
| canonical checkout | `/Users/agrippa/Projects/barcelona-compare`, branch `analytics-fix16` @ `e2090dfa842f5baa3ed1faad059fd800b0a6a896` (read-only) |
| canonical dirty entries | 40 porcelain entries (22 modified tracked + 18 untracked) |

**Deployable guard property is preserved by construction**: the candidate is a clone of the guard
HEAD, and `functions/_middleware.ts` is **never** overwritten from canonical (canonical carries the
pre-guard middleware). The guard's `MAINTENANCE_GUARD_ACTIVE = true` constant and all guard files
stay byte-identical.

## 2. What "preserving newer main analytics" means here (LIVE)

`origin/main` is `10ab962` ("Analytics: repair the loader's foreign-SDK ownership boundary"). The
guard base already **is** that commit, so the candidate inherits the whole analytics line
(`6438325` → `ce34124` → `10ab962`). Main's analytics work between `6438325` (the commit canonical
`analytics-fix16` is based on) and `10ab962` touches exactly four paths:

    AGENTS.md                                          |  +7
    docs/project-standard.json                         | 247 +
    docs/handoffs/analytics-loader-2026-09-21.md       | 101 +
    public/js/portfolio-analytics.js                   | 480 change

None of those four is an ownership source file, so cherry-selecting the ownership changes cannot
disturb the analytics line. `public/js/portfolio-analytics.js` is asserted **untouched** in §5.

## 3. Cherry-select set (ownership source changes carried from canonical)

Ordered as the task brief enumerates them; exact per-file comparison and hashes in §5.

1. provenance / functions libraries + routes
   `functions/_lib/provenance.ts` (new), `functions/_lib/claim.ts`, `functions/_lib/profile.ts`,
   `functions/_lib/registry.ts`, `functions/api/claim/start.ts`, `functions/api/claim/verify.ts`,
   `functions/api/owner/profile/[placeId].ts`, `functions/api/owner/session.ts`,
   `functions/api/owner/session/verify.ts`, `functions/api/profile-overrides/[key].ts`,
   `functions/api/registry/[placeId].ts`
2. migrations `migrations/0006_ownership_approval.sql`, `migrations/0007_ownership_lifecycle.sql`
3. UI: `src/components/ClaimFlow.astro`, `src/components/OwnerEditor.astro`,
   `src/layouts/BaseLayout.astro`, and the EN category/type fix
   `src/pages/en/mejores/[category]/index.astro`
4. permanent tests: `scripts/ownership-lifecycle-test.cjs`, `scripts/ownership-ui-regression.cjs`

**Excluded on purpose**

- `functions/_middleware.ts` — guard copy preserved byte-identical (do NOT copy canonical's).
- `AGENTS.md` — canonical's dirty copy is byte-identical to main's (`10ab962`) version, i.e. it is
  the analytics edit, not an ownership edit; nothing to carry (LIVE: `diff` empty).
- `docs/project-standard.json` — declaration. Canonical's copy is untracked *stale* text and the
  guard clone already carries its own scoped declaration; the declaration is the parent's artifact.
  **No stale declaration is copied wholesale.**
- `.hermes/`, `.astro/`, `.wrangler/`, `.env*`, `.dev.vars*`, `dist/`, `data/` runtime state —
  private/generated/secret; never copied into the candidate.
- canonical status documents (`docs/ownership-*-status.md`, `docs/ownership-release-blockers.md`,
  `docs/phase-0-prerequisites-checklist.md`, `docs/improvement-execution-handoff.md`) — records,
  not source.

## 4. Deliverable and checkpoints

- Candidate tree: `/Users/agrippa/Projects/bc-release-ownership` (independent clone, isolated;
  canonical and guard remain untouched).
- Checkpoint after each batch below with raw output and hashes; durable evidence inside the
  isolated tree's gitignored data path (never in canonical `.hermes/`).

| # | checkpoint | state |
|---|---|---|
| C1 | isolated clone + candidate branch | **LIVE — PASS** |
| C2 | ownership source applied (patch) + untracked ownership files copied | **LIVE — PASS, 0 conflicts** |
| C3 | byte-identity proof: guard files unchanged, analytics untouched | **LIVE — PASS** |
| C4 | isolated tests: lifecycle 1093, UI 26, guard suite 1209 | **LIVE — PASS, all three exact** |
| C5 | offline build + typecheck under network-denied sandbox | **LIVE — PASS (4957 pages, 0 errors)** |
| C6 | source hashes, candidate commit, guard provenance recorded | **LIVE — this section** |

## 5. Evidence

### 5.1 Candidate identity (LIVE)

    base   = 0242d693acf3cb26fd68d6133f53198227b41cd7   (= guard PR5 head, unchanged)
    CORE   = 7e718b2426614ce114b86eef40a594d3d4930c6b   ownership core
    HEAD   = f76cc848bdd1c529e074c38dfd44a42e77af651a   + smoke suites / ownership docs
    tree   = /Users/agrippa/Projects/bc-release-ownership (independent clone; canonical and
             guard were never written to and never checked out)

Clone was made with an APFS copy of the guard workspace (1.4 s), then `.astro` (tracked in the
base commit — verified, not generated junk; `content-assets.mjs` is an empty map) was kept and
`.wrangler/` local state was moved out. No `.hermes/`, no `.env`/`.dev.vars` (only the committed
`*.example` files), no private data, no secrets, no `dist/` in the candidate.

### 5.2 Copied set — canonical working copy vs candidate, byte identity (LIVE)

19/19 files `SAME` (sha256 equal), 0 mismatched:

| file | sha256 |
|---|---|
| `functions/_lib/claim.ts` | `24c8fb7ca5f651e1c14820261ed4c3669e1070ea4c3954d0de50990b91e502c7` |
| `functions/_lib/profile.ts` | `655ba15905b59976e30b5be4b6f822843876ad8bf8236b13f22ea9be29a6a268` |
| `functions/_lib/registry.ts` | `26e5c0b5b181333e16cb5de4f21a4cf4828adec84043b129387698c232887a8e` |
| `functions/_lib/provenance.ts` (new) | `2bbc340722c30a1ce1d9aaa8c5b30c72c20ddaadd43cf0fbe4e017d291073186` |
| `functions/api/claim/start.ts` | `86e83c3d29089ec36c7eb9afb84d7ef8808eb595b8c5218edb857fe138ac345a` |
| `functions/api/claim/verify.ts` | `539a0c2812c0b1c7a65b77c088aa0f1452d453b3bb4aac0d6f1eec27792f5a66` |
| `functions/api/owner/profile/[placeId].ts` | `0a1b08271274772af387a1232d5ded7b8ac2c6fca58ffc6127c3785555dabc83` |
| `functions/api/owner/session.ts` | `f30cdcd1758e10beafbf040a0827824910dde8501853038989472aaf0ea07895` |
| `functions/api/owner/session/verify.ts` | `5e88231864e9b6541305ff18384c29408565a497a51f2c2cb0fa7e4465df1e14` |
| `functions/api/profile-overrides/[key].ts` | `d4b02e499ed31ff85322684ac119afc2d64c729982494b27c0003b9e89f2249e` |
| `functions/api/registry/[placeId].ts` | `239835390c8f2582b8c1e21deff7f831314dde153f6603b7b1350ff374c45500` |
| `migrations/0006_ownership_approval.sql` (new) | `0463a303bbecf08edd36f2aafa1013250d9fee8d3355577be02c543ede802dc8` |
| `migrations/0007_ownership_lifecycle.sql` (new) | `d907aa47f2781a419673b0aa4bfff041895f9908e80ad6164b7055507707f9be` |
| `src/components/ClaimFlow.astro` | `5d9b285b76c2269b7e45ee976259612e98434c43b627e40f1349ec4cdfb8cdba` |
| `src/components/OwnerEditor.astro` | `66ec80d48c961bc24963d871c881d6fcda71e9ad0542419a16a41be9a9d04b5f` |
| `src/layouts/BaseLayout.astro` | `bcbbde1ee4f5b833d05d3b7d461a4dfc4133dcde8d0b5f5468e3141c712be17e` |
| `src/pages/en/mejores/[category]/index.astro` (EN category/type fix) | `5893d92902c2450e46f72fe2f4194f9b43a8dceb2e18418533b7d3ecb9eb9e9e` |
| `scripts/ownership-lifecycle-test.cjs` (new) | `b7599ce51ce7254aa7fc944bc49d9cd149c6c6f644248e9e80f9f736ab759273` |
| `scripts/ownership-ui-regression.cjs` (new) | `b3b68d795eff05750abb92daa4da8bc603fc2a3ba15a17775c94746d0ea7b65f` |

Applied with `git apply` (no `--3way` fallback needed): the two `git apply --check` runs reported
zero rejects. Canonical was read with `git diff`/`shasum` only.

**Second batch (commit B, droppable independently)** — same canonical change set, not source:
`scripts/claim-smoke.sh`, `scripts/owner-edit-smoke.sh`, `scripts/registry-smoke.sh`,
`docs/claim-flow.md`, `docs/business-registry.md`. Included because the ownership change rewrote
those suites and docs; a release owner who wants the enumerated source set *only* can revert
commit B alone without touching the ownership code.

### 5.3 Guard preservation and analytics — byte identity, both directions (LIVE)

- Candidate vs guard HEAD `0242d69`, all 7 guard paths `GUARD-SAME` (byte-identical):
  `functions/_middleware.ts` `220bc6b8f1d0f0800ae797c875628872a180ce5260a8e99fb36f0c0926297ade`,
  `functions/_lib/maintenance-guard.ts` `359cc1db1adaf1839c6f2da4920a6a18e4eced4e7960cdd709ff0d2abfae3845`,
  `scripts/maintenance-guard-smoke.mjs` `465206d80fd1ce5173afa0fade1608e731e624a601d62f16c318a84df4407b1a`,
  `scripts/guard-register.mjs` `1428ea4f…`, `scripts/guard-resolve.mjs` `65592c61…`,
  `scripts/guard-ts-loader.mjs` `0e883018…`, `docs/ownership-guard-preparation.md` `6460aa75…`.
  Canonical's pre-guard `_middleware.ts` was **never** copied over the guard.
- `git diff 0242d69 -- public/js/portfolio-analytics.js AGENTS.md docs/project-standard.json
  docs/handoffs/analytics-loader-2026-09-21.md` → **empty**. The whole main-analytics line
  (`6438325` → `ce34124` → `10ab962`) is inherited untouched by construction; the ownership patch
  could not disturb it because main's changes and canonical's changes share no file.
- The applied set is exactly the intended set: candidate porcelain = 14 modified + 5 new files
  (batch A) then 5 more (batch B). Nothing else moved.

### 5.4 Test evidence (LIVE, in the isolated candidate)

| suite | command | result |
|---|---|---|
| guard smoke | `node --import ./scripts/guard-register.mjs scripts/maintenance-guard-smoke.mjs` | `PASS=1209 FAIL=0`, exit 0 — **still passes** |
| ownership UI | `node scripts/ownership-ui-regression.cjs .` | `RESULT: PASS — 26 checks, 0 failures`, exit 0 |
| ownership lifecycle | `node scripts/ownership-lifecycle-test.cjs` | `1093 passed, 0 failed`, exit 0 |

Logs + sha256 in `data/stage2-evidence/` (gitignored, durable inside the isolated tree):
`guard.log` `72967412851e354fb90b9fbc984c7a7225b7b60d87a8322b21c9712d1b7c7079`;
`ui.log` `4e58a7a2e568528c19551ea6aec81ed0d1637abe43520f59b7abe26a864ce7ee`;
`lifecycle.log` `162d766ccfcf192e19f219e40034282290d787fcfbab40aa940cf63d513b7bf8`.

All three were run with the repo's existing dependencies only — **no install was performed**.

### 5.5 Offline build + typecheck (LIVE, real OS network-denied sandbox)

- Sandbox: `/usr/bin/sandbox-exec -f /tmp/bc-netdeny.sb` — `(deny default)`, `(deny network*)`,
  writes allowed only inside the candidate tree / `/private/tmp` / `/private/var/folders` / `/dev`.
  **Probe before use (LIVE)**: `fetch('https://example.com/')` inside the sandbox was *denied*
  (`PROBE OK: network denied -> fetch failed`, exit 0), so the build really ran with no egress.
  Not a proxy-only / deadproxy claim.
- Sanitized env: `env -i PATH=… HOME=<candidate>/data/stage2-evidence/home TMPDIR=<…>/tmp
  REGISTRY_BADGE_URL=snapshot NODE_ENV=production CI=1`.
- **Offline registry source is explicit, not a fabricated record**: `REGISTRY_BADGE_URL=snapshot`
  is a documented existing mode (`src/lib/registry.ts:13-15`, "the literal value `snapshot` skips
  the network and reads the committed snapshot only"), and the build log shows it used the
  committed fixture: `[registry-badge] snapshot 2026-09-11T21:06:54.880Z: 0 row(s) from
  …/src/data/registry-verified.json`. No production API call, no invented production rows.
- `astro build` → **exit 0**, `4957 page(s) built in 1m 23s`, `dist/` produced
  (build.log `b259d6e7440f7840edfc0772cf5c4598598a325e00b5c11d8d0595b989838a3a`).
- `astro check` → **exit 0**, `Result (124 files): 0 errors, 0 warnings, 90 hints`
  (typecheck.log `21bb63db4f178385579f48ac33cc08576931bcc27df89b1ae0a13407df1db1b0`). The
  pre-existing `src/pages/en/mejores/[category]/index.astro` error reported by the older notes is
  **gone** in this candidate (that is the EN category/type fix). `astro check` bundles `--tsconfig`
  strictness; hints are not errors.
- No canonical build write: canonical `dist/` still carries its Sep 20 mtime, canonical HEAD is
  unchanged at `e2090dfa…`, and canonical shows exactly one new file — this document.
  Dependencies were **copied** (217 MB, 5 s) rather than symlinked, so no build could write into
  canonical's `node_modules`.

### 5.6 Integration review — current ownership controls with the guard (source-level; see limits)

- **The guard is stronger than the summary suggests, and the candidate keeps that property.**
  `functions/_lib/maintenance-guard.ts` has no env flag, header, query param or secret bypass;
  activation is the hardcoded constant `MAINTENANCE_GUARD_ACTIVE = true`, so removal is a reviewed
  code change. The candidate inherits it byte-identical, and the 1209-assertion suite (which
  dispatches real `Request`s through the real middleware entrypoint with a stub `next()` and
  asserts `next()` is never called) still passes here.
- **Guard vs ownership code is *mutually consistent in the tree* but the deployment order still
  matters — flag for the release owner.** `functions/_middleware.ts` imports
  `getPublishedOverrideBySlug` from `./_lib/profile` (line 16), and `functions/_lib/profile.ts` is
  one of the **changed** ownership files (it references `ownership_approved_by` /
  `approval_generation`). So in this *combined* candidate the guard's own middleware depends on
  ownership-aware profile code. Consequence: this tree must **not** be deployed before 0006+0007
  are applied — the guard deploy that precedes the migration must remain the guard head on old
  main, exactly as `docs/ownership-release-blockers.md` requires. Recorded as a source-level
  observation from the import graph; **not** runtime-verified (no workerd/D1 was run, budget bound).
- Ownership mutations stay unreachable while the guard is active (all mutating owner/claim/
  profile-override/registry-PUT/rebuild paths are blocked all-methods); `GET /api/registry` is
  deliberately allowed for the badge/build path, which is why §5.6's ordering note matters.
- `functions/_lib/provenance.ts` + `migrations/0006/0007` are the only new invariant sources; the
  schema-level trigger argument and the 1093-assertion runtime twin are green here, and the
  populated-data migration/recovery rehearsal is green in `docs/ownership-migration-rehearsal.md`.

### 5.7 Honest limits of this preparation

- Node-runtime harnesses and `astro build` — **no** workerd/wrangler HTTP smoke, no D1, no
  `wrangler pages dev`, no preview, no production request of any kind.
- The guard suite's negative control (25+ failures with the guard removed) is inherited from
  `docs/ownership-guard-preparation.md` evidence and was **not** re-run here; only the positive
  1209/0 run is this session's own.
- The 1093-assertion lifecycle suite's own documented limits apply (one-connection deterministic
  interleaving, SQLite-shaped D1 adapter — not workerd).
- Sandbox read access was **not** restricted (interpreter/runtime reads stay broad); only network
  and writes were confined. Disclosed rather than overclaimed.
- `docs/ownership-*-status.md`, the declaration and every release receipt are the parent's; this
  document asserts no release state and marks nothing VERIFIED or EXEMPT.

## 6. Not done here (explicit)

- No push, no PR, no remote branch, no deploy, no Cloudflare/D1/GitHub mutation, no production
  request, no migration applied or re-run, no credentials read or printed.
- No guard removal (later, separately reviewed phase).
- Runtime/migration/declaration/live validation and independent integrated review remain with
  Agrippa. This candidate is **source preparation only**.

## 7. Next owner: Agrippa

1. Independent review of this candidate (base, applied set, byte-identity proof, test logs).
2. Own the release sequence (guard deploy → live refusal verification → production export →
   0006+0007 under guard → reviewed ownership code → negative authorization paths → guard removal).
