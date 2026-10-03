# Stage-1 ownership guard release — checkpoint and result

Status labels: LIVE / PREPARED / UNVERIFIED / BLOCKED. This file is updated in place as
work proceeds, so a budget or context expiry does not lose state.

Release owner: Agrippa (parent). Executor: Builder. Stage-1 target ONLY.

## 0. Owner intent and authority

- Owner (Rutger), latest: finish and deploy as soon as possible, plus an explicit clarify
  approval **YES** for the safely gated ownership/UI release: unrelated pre-existing baseline
  gaps deferred; gaps block changes to affected systems; collection stays disabled.
- Scope of this release: deploy the already-reviewed stage-1 maintenance guard alone. **No
  migration, no production data write, no schema change, no guard removal.**

## 1. Chain of custody (parent-side, reported to me; re-verified where stated)

- Workspace: `/Users/agrippa/Projects/bc-release-guard`, branch `guard/maintenance-guard`.
- Base after rebase: `10ab9621f533f9b8351dd48c7af60ac7118c231d` (= origin/main and the commit
  Cloudflare Pages was serving in production when the rollback target was captured).
- Guard source commit: `a53d2b8e0f79773118dd4a0850a3e2fdb2ac8d83` (reviewed).
- Independent review: Sol session `20260921_113115_5ef4b9`, reviewed HEAD
  `1530d20067c587a3463031e2283125a62ebd1932`, base `ce34124209947caaaff9c9f667cb068de81d4c5b`,
  verdict **PASS guard source, no must-fix**, independently reproduced 1209/0, plus review of the
  compiled Wrangler Functions including `functions/_middleware.ts` ordering. The reviewer's own
  tool limit prevented it writing a file: **no reviewer file exists and none is claimed.**
  Bounded to a stage-1 DEPLOYMENT review, NOT a migration review. Node-harness tests are not live
  edge proof.
- **Guard source unchanged**: verified this session by git blob SHA, byte-identical at the new
  HEAD to the reviewed commit `a53d2b8`:
  `ac3780e4`, `2b5a2e2d`, `41699257`, `68534a56`, `8e94a9d3`, `d6e35923` for
  `functions/_lib/maintenance-guard.ts`, `functions/_middleware.ts`, `scripts/guard-register.mjs`,
  `scripts/guard-resolve.mjs`, `scripts/guard-ts-loader.mjs`, `scripts/maintenance-guard-smoke.mjs`.
  Parent additionally confirmed via `git diff` that the guard source is unchanged.
- Release commit (parent-side): `0242d693acf3cb26fd68d6133f53198227b41cd7` — parent corrected the
  stale **analytics-specific EXEMPT approval references** in `docs/project-standard.json` to the
  actual current owner clarify, then regenerated the receipt and re-ran the release preflight.
- PR: **#5** on `raitgerb/barcelona-compare`, head `guard/maintenance-guard` -> `main`.
- Stage-2 candidate is separately prepared at `/Users/agrippa/Projects/bc-release-ownership`
  `f76cc848` based on this guard — **not touched** by this slice.

## 2. Executed evidence (my own runs, on the exact tree)

Test suite: `scripts/maintenance-guard-smoke.mjs` through the real middleware entrypoint.

| run | command | exit | result | evidence sha256 |
|---|---|---|---|---|
| positive | `node --import ./scripts/guard-register.mjs scripts/maintenance-guard-smoke.mjs` | 0 | `PASS=1209 FAIL=0` | `7c292ce68a6e69c3ba68c82c94f39c2a733c1fc9b2335de4a7f5b080e446c056` |
| negative control | same, `GUARD_ROOT` = copy of `functions/` whose `_middleware.ts` is the pre-guard version (0 `maintenance` references), guard module still present | 1 | `PASS=732 FAIL=477`; blocking assertions report `status=200` and `next() ran` | `112a195d1ae0e7e43b04ba5c99d16443706c6e9f48656efdbe11c0fa1c1aebea` |

The control discriminates, so the green run is evidence and not a tautology. Local evidence files:
`/tmp/bc-guard-evidence-stage1-positive.txt`,
`/tmp/bc-guard-evidence-stage1-negative.txt`, and copies under
`/Users/agrippa/Projects/bc-release-guard/data/release-evidence/` (git-ignored).

`project_preflight --phase release` on the isolated tree: **PASS** — 18 checks including
`GIT_HEAD`, `GIT_CLEAN`, `RECEIPT bound to HEAD`, `RELEASE_REQUIREMENTS all VERIFIED or approved
EXEMPT` (12 `exempt_claimed` warnings). Structural PASS is **not** semantic compliance and **not**
release permission.

Rollback target captured by API readback before merge: production deployment
`5772f80c-bcdc-4815-973a-9b6e00cc648c`, commit `10ab9621f533f9b8351dd48c7af60ac7118c231d`,
aliases `['https://barcelonacompare.com']`, `latest_stage` deploy/success.

## Current parent-verified state — stage1 LIVE, migration BLOCKED
PR5 merged882577f646e346fb95dd6d8c7bc4b127d62d0b5c. Parent read Cloudflare production deployment3b8b0c52-522d-4402-b8f5-ee68c887e7fc deploy/success, canonical alias barcelonacompare.com. Parent GETs on eight claim/owner/profile/rebuild routes all503 with ownership-stage-1 marker and no-store; registry200 and homepage200 with correct title. Evidence `/Users/agrippa/Projects/bc-release-guard/data/stage1-live-parent.json`. Its body_marker=false is an incorrect guessed string probe, not absence of the actual verified header; no body-specific success claim.
BLOCKER: parent API confirms preview AND production DB binding same ca91d4f4-d44d-4163-9f5b-7db0464ef446; parent GET old analytics-fix16.barcelona-compare.pages.dev/api/owner/session returns405 allowPOST without guard while production503. Old deployment URLs remain reachable, so production guard alone does NOT establish all-writer quiescence. NO migration/export performed. Latest Sol integration invocation timed out without artifact, no review verdict claimed; no process remains. Need owner authorization for Cloudflare deployment retirement/preview isolation (existing restriction requires ask for settings). Preserve current guarded deployment as rollback; old unguarded history may need retirement including hash URLs. Agrippa owns inventory/safe retirement design after scope approval. Full ownership/UI candidate f76cc848 in separate bc-release-ownership tree built/tested but NOT pushed/deployed.

## 3. Historical deployment checkpoint (superseded above)

- PR #5 required check (Cloudflare Pages) was **IN_PROGRESS since 2026-09-21T09:38:40Z** as of
  this checkpoint, on deployment `1cd7b451-47a3-48ec-811b-4abf8008a2c2`.
- Result of that build: **PENDING — see §4, updated below.** Recorded here rather than asserted.

## 4. Result (updated after the deploy attempt)

_Pending. Next entries record, in order: the real deployment status/`latest_stage`; the merge SHA
if the protected squash merge was performed with `--match-head-commit 0242d69` and no bypass; the
production deployment id/commit that advanced; and the live guard verification (503 +
`x-maintenance-guard: ownership-stage-1` marker on the critical guarded routes, with listing/static
pages, `GET /api/registry` and `POST /api/track` still serving). Any claim not backed by command
output will be labelled UNVERIFIED rather than stated._
