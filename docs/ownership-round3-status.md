# Ownership round 3 — bounded correction of R1/R2/R3 (status + evidence)

**Status: IN PROGRESS — not reviewed, not released, not applied, not accepted.**
Owner of the review/release gate: Agrippa. This worker cannot self-approve and does not deploy.

## Checkpoint 1 (pre-edit) — 2026-09-20T23:07:13+02:00

| Item | Value |
| --- | --- |
| Canonical root | `/Users/agrippa/Projects/barcelona-compare` |
| Branch | `analytics-fix16` (NOT switched) |
| HEAD | `e2090dfa842f5baa3ed1faad059fd800b0a6a896` |
| `git diff HEAD --binary` sha256 | `f4ba8e74338d25bb4e57711be273635182bc8492ed475240c6e13a0331ded095` |
| Onboarding preflight | PASS rc=0 (`project_preflight.py --root … --phase onboarding`); structural only |

Pre-edit file hashes (identical to the hashes the second review published, i.e. no candidate drift):

```
88c5901aa8ed23076aa820e613ad70f15edf889324dd83454777d910944d00e2  migrations/0007_ownership_lifecycle.sql
3c36d2bb3ba0f7b91df393aff721140b0d3e976c40fc8451858a5233e61adbd4  functions/_lib/profile.ts
2a3081b4a040200ca407cf3c0ccf82bf1b5383a3f4dbf5dd789e26762bd8b5bd  functions/_lib/registry.ts
c051f2468ffe164b3cc6c73e4bfb6ce9d35b27f01fdac2fb2063b8df3ed74c06  scripts/ownership-lifecycle-test.cjs
5cc910e45834f968606f25d859b0389168f0043477efc45cee01db893780ca77  functions/api/registry/[placeId].ts
6ea670fd75eebe420bd38e1a2aabbca92b507b3127a7a4544d13f295c1decac8  functions/api/owner/profile/[placeId].ts
```

Read this round: `AGENTS.md`; `docs/improvement-execution-handoff.md`; canonical
`Hermes/Standards/Project Standard v1.md` v1.0.0 and `Hermes/Standards/Coordination and Completion.md`
v1.0.0; `/tmp/bc-ownership-second-review.md` in full and `/tmp/bc-second-extra-fragment.cjs`.

Scope: R1, R2, R3 only, plus retained regression coverage. No branch switch, stage/commit/push, no
production/network/Google/mail, no shared build or shared `.wrangler/state`, no credential/profile/cron
or protected-instruction changes, no unrelated analytics/generated-asset edits.

(Round outcome, hashes, test logs and release blockers are appended below after the work.)

## Checkpoint 2 — corrections applied, suites executed (2026-09-20T23:12 local)

### R1 — partial save no longer inherits quarantined/different-generation content
`saveOverride()` now derives `inheritable` from the *current* approved generation
(`approvedClaimGeneration`) and the stored row's `published` + `claim_generation`. Omitted patch keys fall back
to safe defaults (`null` / `[]`) whenever the predecessor row was written under a different (or no) generation;
same-generation content is still carried forward, so ordinary owner partial saves are unchanged. The superseded
content is retained as evidence — `ownership_quarantine_log` row (`kind='publication'`) plus a
`profile_edit_events` row `ownership_predecessor_content_not_inherited` — and is never served. Adopting a
predecessor's content is therefore an explicit operator act, not a side effect of an unrelated save.

### R2 — one full provenance predicate, enforced and read
`0007` now enforces non-blank `ownership_approved_by` **and** `ownership_evidence` on INSERT and on UPDATE of
`verified`, `ownership_approved_by` or `ownership_evidence` (the third, narrower trigger is folded into this
one). `approvedClaimGeneration`, `ownerWriteGuard`, `OPERATOR_BOUND_GENERATION`, `PUBLIC_OVERRIDE_FROM`, the
operator re-publish guard and the claimed-row projection all require both fields non-blank, so runtime
authorization and public reads use the same predicate as the schema.

### R3 — truthful actor provenance, no new identity provider
The audit `actor` column now holds the **server-controlled credential class** (`registry-admin-token`, with
`credentialIdentifier: X-Registry-Admin-Token`), and the route no longer substitutes an invented individual
(`admin-api`) when the body names nobody. A body `actor` is recorded separately as
`actorAssertedBy` + `actorAssertedSource: 'operator-asserted-request-body'`. The shared token still proves
operator authority only; no person is claimed to be authenticated. Stale route header and the round-2 status
wording were corrected/superseded in place.

### Tests actually executed (all offline; no network, no wrangler, no shared state)

| Command | Result |
| --- | --- |
| `node scripts/ownership-lifecycle-test.cjs` | **154 passed, 0 failed** (122 before; 32 retained round-3 assertions added) |
| same suite against the pre-fix snapshot `/tmp/bc-ownership-prefix/tree` | R1/R2 round-3 assertions **FAIL** with the reviewers' exact reproductions (`got "UNAPPROVED LEGACY CONTENT", want null`; `the refused writes left provenance intact :: got null`), then the run aborts with `no such trigger: trg_businesses_verified_requires_provenance_update` — that snapshot predates `0007`, so the later assertions have no precondition. Honest scope: pre-fix discrimination is demonstrated for R1/R2, not for R3. |
| reviewer's independent suite (`/tmp/bc-third-extra`-shaped build: current suite + `/tmp/bc-second-extra-fragment.cjs`, built by `/tmp/bc-round3/build_extra.py`) | **161 passed, 1 failed** |

The single failing reviewer assertion is `public read must refuse evidence-free ownership`, and it is
**unsatisfiable together with the fragment's own first assertion** (`schema must reject clearing evidence while
verified`, which now passes): the evidence-clear is refused, so provenance stays intact, the owner PUT is
legitimate and returns 200 (`SECOND_REVIEW evidence-cleared owner PUT 200` in the log) and the public read
correctly serves the approved listing. Passing it would require either weakening the schema invariant (its
assertion 2) or refusing a valid approved-owner save (contradicting the retained positive control "approved
owner can save"). The intent is covered by a discriminating retained pair — with the trigger lifted to
construct the legacy evidence-free row: `the public read refuses an evidence-free verified listing` **ok**,
`an owner write on an evidence-free listing is refused` **ok**. This is reported, not adjusted: no reviewer
assertion was edited.

### Identity of the corrected candidate (post-edit)

```
0173e28b9e3eb0e4c9a3b91096ca740d090aa72525c627c23a761afd8fbe50da  git diff HEAD --binary   (was f4ba8e74338d…)
bf6f807f259b999a6d18018e1be704d03e80183a20e54719743981db1852efbe  migrations/0007_ownership_lifecycle.sql
2842a89199e753966d95d38754fbefbec40717f0e030951ebc2077da373e4f97  functions/_lib/profile.ts
acdbbd94e379e96251864392402dc4e973290b99bad4ae90a83c71630623887b  functions/_lib/registry.ts
795b7a6e25818a2620d7e99a74255b1d9a1e2fbfe73c042933921924f4838a39  functions/api/registry/[placeId].ts
e82e8167c51b827ec38d0a577ec4867051da85819a4d387187ccbb27118b0a97  scripts/ownership-lifecycle-test.cjs
```

Branch `analytics-fix16`, HEAD `e2090dfa842f5baa3ed1faad059fd800b0a6a896` — unchanged; nothing staged, committed,
pushed or branched. Logs: `/tmp/bc-round3/{lifecycle-r3.log,extra.log,lifecycle-prefix.log}`.
`.astro/content-assets.mjs` sha256 `6eec2765…` — byte-identical before and after (untouched), shared
`.wrangler/state` never opened, no production/Google/mail/credential/cron/profile access.

### Gates

| Gate | Status |
| --- | --- |
| BUILT | PASS (local): hashes above |
| TESTED | PASS (local, offline): 154/0 retained; reviewer's suite 161/1 with the one contradiction documented above. Real local D1 (`registry-smoke.sh`) and the shell suites were **not** re-run this round. |
| REVIEWED | **PENDING** — renewed independent review of this exact candidate is required (Agrippa owns it) |
| MERGED / DEPLOYED / APPLIED / VERIFIED / ACCEPTED | **NO** |

### Remaining release blockers (unchanged unless stated)
1. Renewed independent re-review of this candidate, including a decision on the contradictory reviewer assertion.
2. Migration/cutover/rollback: 0007 applied nowhere; quiesce writes across 0006+0007+code; name a safe rollback
   version, snapshot/restore procedure and post-cutover provenance/session checks. Production population and
   backup/restore capability remain UNKNOWN.
3. `scripts/owner-edit-smoke.sh` still uses live production photo/robots fixtures and must not be called offline;
   `registry-smoke.sh` was not re-run after these edits (the R2 predicate change and R1 inheritance change both
   touch paths it exercises — re-run before release).
4. UI artifact: `src/components/ClaimFlow.astro` / `OwnerEditor.astro` still unbuilt/untested; no browser QA.
5. No CI gate wired for the offline suite (declaration `B05` GAP); duplicate `0005` prefixes; 0006 still clears
   `verified_at` without preserving the former value.
6. Product residuals: pending-claim squatting, dispute/expiry path, approval-outcome notification ownership.
7. Honest scope limit of this round: one connection with deterministic interleavings models statement
   ordering, not a real concurrent Cloudflare race; not re-certified against real workerd this round.

**This round ran over its 15-minute bound** (the R1/R2 edits each required a harness-driven re-run cycle).
Nothing was left mid-write; both suites' final runs are recorded above.
