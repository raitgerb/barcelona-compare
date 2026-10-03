# Ownership round 4 — implementation exited; independent review pending

## Coordinator reconciliation
Builder session `20260920_232356_96d12e` exited 0, but exhausted its turn budget without finalizing this record or executing mutation controls. **Those required closing steps were omitted by the worker.** Agrippa independently reran the retained suite and unchanged third-review harness: both exited 0. Reviewer harness: 238 passed, 0 failed. Logs: `/tmp/bc-round4-coordinator-lifecycle.log`, `/tmp/bc-round4-coordinator-extra.log`.

Candidate SHA256: registry helper `d65313d8326eb46e746e4c81170cbfac53c2e482599186dd72abfd7e142e6aad`; owner route `0a1b08271274772af387a1232d5ded7b8ac2c6fca58ffc6127c3785555dabc83`; approval route `239835390c8f2582b8c1e21deff7f831314dde153f6603b7b1350ff374c45500`; retained suite `c1920e80248c3b50441fafab3240b936a9c33d71287f9717135deabe6419fe61`.

Source edits present; offline execution PASS; independent review/mutation discrimination PENDING; UI build/runtime/migration/release gates OPEN; deployed/applied/accepted NO. Next owner Agrippa: exact-candidate independent review including removed-fix controls. Historical checkpoint below is superseded by this reconciliation.

Author: Builder (round-4 implementer). Started 2026-09-20 (CEST).
Scope: narrow correction of the three residuals in `/tmp/bc-ownership-third-review.md`
(verdict FAIL) plus the optional approval-route header truthfulness fix.
Latest approved phases still govern; **no release, no migration, no UI, no analytics,
no Git mutation, no shared build/state, no network, no production touch.**

## Pre-edit state (verified, not assumed)

- Root `/Users/agrippa/projects/barcelona-compare`; branch `analytics-fix16`;
  HEAD `e2090dfa842f5baa3ed1faad059fd800b0a6a896`; worktree already dirty with the
  ownership + analytics lanes (20 modified paths, `.hermes/` untracked).
- Canonical Project Standard v1.0.0 now readable from the vault (earlier EDEADLK /
  dataless-placeholder problem from `/tmp/bc-ownership-third-review.md` is gone:
  direct read returned 9945 bytes). Coordination and Completion.md applies.
- Preflight tool present: `/Users/agrippa/project-foundations/scripts/project_preflight.py`
  (`onboarding|release|audit`, `--json`). Onboarding PASS is claimed by the parent
  handoff; re-verified below.
- Reviewer artifacts present and hash-matched before editing:
  `/tmp/bc-third-extra.cjs` sha256 838eb723af447df4e5cf9f6a5f521d3691e9629c88a7db2232a141ddc04ab974
  (matches the review's recorded hash exactly), `/tmp/bc-third-original-extra.cjs`
  sha256 497b4555edb181ab371549b4a5169d719045bed345aca19a3220eeb453c7b844.
- No competing ownership writer found (`ps` shows only this worker's own `builder chat -q`
  process matched on the search terms). Parallel analytics/budget lane is separate.

## Changes made (source)

1. `functions/_lib/registry.ts` — `isOwnershipApproved` now requires
   `ownershipEvidence` non-blank in addition to `ownershipApprovedBy`, so the shared
   runtime predicate matches the SQL invariant (R2).
2. `functions/api/owner/profile/[placeId].ts` — new `editorOverrideProjection()` and the
   GET response now project the stored override **only** when it is currently published
   *and* written under the current `approvalGeneration`. Quarantined predecessor content
   resolves to `override: null` plus a truthful `overrideState`
   (`none|current|unpublished|unbound-generation|earlier-generation`), so the ordinary
   editor form starts from safe defaults (R1).
3. `functions/api/registry/[placeId].ts` — header comment narrowed: the credential-class
   audit actor claim holds for the `verify`/ownership-approval event only (R3 wording).
4. `scripts/ownership-lifecycle-test.cjs` — repaired the vacuous public assertion (seeds a
   valid visible publication first, then reads the returned value for NULL and
   space-only evidence/approver) and added section J4: the real ordinary GET →
   all-field serialized PUT round-trip with a valid same-generation positive control.

## Not yet done at this checkpoint

- Retained suite run, `/tmp/bc-third-extra.cjs` run, onboarding re-verification,
  final hashes. See the "final" section appended before exit.
