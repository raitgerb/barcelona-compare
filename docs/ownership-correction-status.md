# Ownership correction round — status, evidence, dispositions

**Status: LOCALLY CORRECTED AND TESTED — NOT reviewed, NOT released, NOT applied, NOT accepted.**
**SUPERSEDED IN PART by round 3 (`docs/ownership-round3-status.md`):** its `actor` claims (R3) and the
provenance-predicate completeness claims (R2) were found incomplete by the second independent review and are
corrected there. This file remains the round-2 record.
This round corrects the blocking findings of the independent review (`/tmp/bc-ownership-independent-review.md`,
verdict FAIL). Independent review is required again on this exact candidate; this worker cannot self-approve.
Owner of the review/release gate: Agrippa. Continuation owner: Agrippa.

Authority: `docs/improvement-execution-handoff.md` § "Independent review — correction round" (Rutger approved
the improvement phases 2026-09-20; existing release/security/cost gates unchanged). Plan:
`.hermes/plans/2026-09-20_205738-project-review-and-improvement-plan.md`.

Read this round: `AGENTS.md`; canonical `Hermes/Standards/Project Standard v1.md` v1.0.0
(sha256 `c52e12d6a65ff2f0160d556116895f6a802b4063026459a3722f9bf84be6e46a`);
`Hermes/Standards/Coordination and Completion.md` v1.0.0 (sha256 `36527fa2d434d3dec578a2f2058868afb4becef25d389ca23091f11f81b07c9f`);
and the review in full, including both reproduction harnesses.

## 1. Candidate identity (measured, not assumed)

- `git diff HEAD --binary` sha256 = `e1b4d60b0686b9667575a59c4683f208fd2aec084f902b3d4456da29820e6d52`
  — **identical to the reviewed candidate**. Every reviewed source file is byte-identical to what the review saw.
- Candidate manifest drift: the 24-path manifest hashes to
  `035f9fd7c1d084cee62b15c4185c73df8f550c0f162de6ec70d445d7f4d06803`, not the reviewed
  `541b02570899aa1a2a664ec15ffd54b766e749c3648ae975e1256fd0fc0a01f3`. Exactly one path differs —
  `docs/improvement-execution-handoff.md` (`0f730985…` vs reviewed `0d9825fb…`, Agrippa's
  correction-round brief + continuation block). The other 23 paths match the reviewed manifest.
- Pre-correction source snapshot used for the discrimination test: `/tmp/bc-ownership-prefix/tree`
  (`functions/`, `migrations/`, `package.json`, symlinked `node_modules`).

## 2. What was corrected

| Finding | Correction (file) |
| --- | --- |
| **B1** — revoked/unapproved claimants' content stayed public | `migrations/0007_ownership_lifecycle.sql`: `profile_overrides.claim_generation` + `businesses.approval_generation`, a quarantine pass over every pre-existing publication (row unpublished, unbound, logged in `ownership_quarantine_log` + `profile_edit_events`), and a public-projection join in `functions/_lib/profile.ts` (`PUBLIC_OVERRIDE_FROM`) that requires an approved claim **and** `claim_generation = approval_generation`. `revokeBusiness()` now unpublishes and unbinds in the same transaction. All four public paths covered: injector middleware, list, single read, owner read. |
| **B2** — approval could authorize a different claimant | `approveOwnership()` now requires operator-supplied `expectedOwnerEmail` + `expectedClaimGeneration`, makes the transition a compare-and-set on both, and commits the transition **and its audit row in one `db.batch`** with the audit gated on `changes() = 1`. Stale/conflicting decisions → `409 approval_conflict`, `verified` stays `0`, no approval event. Route passes the fields through (`functions/api/registry/[placeId].ts`). |
| **B3** — in-flight writes could publish after a revoke | `saveOverride()` is a **single** guarded upsert whose authorization predicate (live `owner_sessions` row at the business's current `approval_generation`, plus provenance) is evaluated by the writing statement itself: `changes = 0` → `403 ownership_pending`, nothing written. `resetOverride()` uses the same guard, so an interleaved revoke cannot delete either. `ownerSessionId()` + `OverrideAuthority` carry the authority; the route re-checks the session generation as a second, independent layer. |
| **B4** — pre-approval credentials reactivated | `owner_sessions.approval_generation` (codes and tokens), minted from the business's approved generation, required to match at exchange and at write; migration marks every pre-existing credential `-1`, which no business can carry; approval and revoke each increment the business generation. Quarantine rows preserve the evidence, not the authority. |
| **B5** — "named approver" not enforced | `approvedBy` is mandatory and **never defaulted from `actor`**; blank/missing → `400 approval_provenance_missing`; the audit event records `approvedBy`, `approvedBySource: 'operator-supplied'` and the calling actor as distinct fields
(**SUPERSEDED, round 3 / R3:** the recorded `actor` was the caller-*supplied* name, which is not an authenticated
individual under a shared token. Round 3 records the server-controlled credential class as `actor` and keeps the
body name as `actorAssertedBy` / `operator-asserted-request-body`. See `docs/ownership-round3-status.md`); `docs/claim-flow.md` (the false "token's actor" claim) and `docs/business-registry.md` corrected. |
| Rollout/mixed-version blocker | `0007` adds three triggers making provenance a schema invariant: `verified = 1` without `ownership_approved_by`/`ownership_evidence` aborts on insert and update, and provenance cannot be cleared while `verified` stays `1`. The old code path now fails **closed** at the database. Candidate owner routes and public reads use one predicate, `isOwnershipApproved()` (claimed + verified + provenance + generation), instead of the bare bit. |
| Test deficiencies | New retained offline suite `scripts/ownership-lifecycle-test.cjs` (see §3), plus the two shell suites updated to the tightened approval contract. |
| Migration/recovery rehearsal | §3, section H: populated migration, restore and retry, file-backed, synthetic data. |

The B3 correction is worth flagging: my **first** implementation used two guarded statements inside one
batch, which the retained suite's revoke/save interleaving test failed (`got 200, want 403`). The guard
now lives in the single writing statement, so there is one authorization evaluation point. The test
found a real weakness, not a formatting issue — and it was fixed, not relaxed.

## 3. Evidence actually executed

All commands run from `/Users/agrippa/projects/barcelona-compare`. Raw logs in
`/tmp/bc-ownership-correction/`.

### 3.1 Onboarding (structural, re-run this round)

```
/usr/bin/python3 /Users/agrippa/project-foundations/scripts/project_preflight.py \
  --root /Users/agrippa/projects/barcelona-compare --phase onboarding
RESULT: PASS (onboarding phase, structural and local checks only)   rc=0
13 warnings: B03-B09, WEB, DATA, EXTERNAL, ANALYTICS, AUTOMATION are GAP; branch_note
(declared production branch main; current local branch analytics-fix16).
```
Structural PASS is not compliance, not certification and not release permission.

### 3.2 Retained regression suite — offline, real SQLite, real handlers

`node scripts/ownership-lifecycle-test.cjs` (`BC_TEST_ROOT` selects the tree). It transpiles the current
TypeScript in memory, runs the repository's real migration SQL against a D1-shaped adapter over
`node:sqlite`, drives the real handlers with synthetic fixtures, forbids `fetch` by default, and reports
per-assertion ok/FAIL.

| Run | Command | Result |
| --- | --- | --- |
| Corrected tree | `node scripts/ownership-lifecycle-test.cjs` | **122 passed, 0 failed, rc=0** |
| Pre-correction tree | `BC_TEST_ROOT=/tmp/bc-ownership-prefix/tree node scripts/ownership-lifecycle-test.cjs` | **54 passed, 68 failed, rc=1** |

The pre-correction run enumerates the broken invariants, e.g. `after migration the legacy publication
disappears from the public read :: got {…priceNote "UNAPPROVED LEGACY CONTENT"…}, want null`,
`public list exposes nothing :: got 1, want 0`, `public single-read route refuses revoked content ::
got 200, want 404`, `a stale approval is refused :: got undefined, want 409`, `no ownership_approved
event was left behind :: got 1, want 0`, `a provenance-free verify is refused by the schema` (fails
pre-fix), `quarantine log holds the publication :: got -1, want 1`. Positive controls (an approved
owner can save and is visible; a correct approval succeeds; a fresh login works; a controlled-fetch
image URL is accepted) pass in the corrected tree, which is what makes the refusals discriminating.

Coverage: section A fresh-mailbox control; B quarantine + public guard + revoke withdrawal + operator
re-publish refusal; B2 approved-owner publish; C approval binding + atomicity (audit-failure rollback
via a `RAISE(ABORT)` trigger on `registry_events`, then the same approval succeeding after the trigger
is dropped); C2; D revoke/save race; D2 revoke/reset race + reset positive control; E pre-gate
credentials (token and code, pending and after re-approval, and after same-email revoke/re-claim);
F approver provenance (missing/blank approver, missing evidence, missing claimant, missing generation,
wrong claimant, then the complete decision); G mixed-version writer refusals; H populated migration +
restore + retry rehearsal; I photo reachability through a controlled transport with a counted
`fetch` (0 live HTTP calls).

Honest limits of the harness: interleavings are produced by a deterministic hook at real SQL statement
boundaries on **one** connection, so nested lifecycle calls share a transaction (savepoint-nested) where
real D1 would run them as separate transactions. This models "the revoke commits before this statement
runs"; it is not a reproduction of a live Cloudflare race.

### 3.3 Real local D1 runtime (`wrangler pages dev` / workerd), isolated persist dirs

```
SMOKE_PERSIST_DIR=/tmp/bc-ownership-correction/d1-registry3 PORT=8823 bash scripts/registry-smoke.sh
registry smoke test: 63 passed, 0 failed        rc=0
```
This is the evidence that the new SQL is real, not just SQLite-shaped: the guarded single-statement
upsert, the `changes()`-gated audit insert, the three provenance triggers, migration `0007`, the
generation CAS and the public projection all ran inside the actual Cloudflare worker runtime against a
local D1. The first run (port 8821) was `59 passed, 2 failed`: both failures were **assertions in my own
smoke edit** reading `approvalGeneration`/`ownershipApprovedBy` from the *public* GET, which
deliberately omits them; the scripts now read those via the admin GET and additionally assert the
public projection hides `approvalGeneration` and `ownershipEvidence`.

`bash -n` passes on `registry-smoke.sh`, `owner-edit-smoke.sh`, `claim-smoke.sh`.

### 3.4 Preserved state (verified after the work)

| Item | State |
| --- | --- |
| `.astro/content-assets.mjs` (generated, dirty) | sha256 `6eec27650a023e5d1805c36b527913e976d473c2b4e5d659cbe1587643209e83` before **and** after every test run — untouched |
| Shared local D1 `.wrangler/state` | never opened; every wrangler call used `--persist-to /tmp/bc-ownership-correction/d1-*` |
| `stash@{0}`, local ahead commits (`main` @ `30cedec`, `analytics-fix16` @ `e2090df`) | not applied, not dropped, not pushed, not rebased |
| Unrelated analytics work | untouched |
| `AGENTS.md` and other profiles | not modified this round |
| Production Cloudflare/D1/R2, Google, email, paid services, cron | no calls, no reads, no writes |

## 4. Gate status

| Gate | Status |
| --- | --- |
| BUILT | PASS (local): files + hashes in §5. |
| TESTED | PASS (local, honest scope): §3.2 offline suite 122/0 with 68 pre-fix failures; §3.3 real local D1 63/0. `owner-edit-smoke.sh` and `claim-smoke.sh` were **not run** this round. |
| REVIEWED | **PENDING** — requires a fresh independent review of this exact candidate. |
| MERGED | N/A (no commit, no branch operation, no push). |
| DEPLOYED / APPLIED | **NO.** Migration `0007` has been applied nowhere; production state remains UNKNOWN and unread. |
| VERIFIED (production) | **NO.** Public auth behaviour is unchanged in production. |
| ACCEPTED | **NO.** |

## 5. Artifacts changed this round (hash inventory is in the handoff message)

New: `migrations/0007_ownership_lifecycle.sql`, `scripts/ownership-lifecycle-test.cjs`,
`docs/ownership-correction-status.md` (this file).
Modified: `functions/_lib/registry.ts`, `functions/_lib/profile.ts`,
`functions/api/registry/[placeId].ts`, `functions/api/owner/profile/[placeId].ts`,
`functions/api/owner/session.ts`, `functions/api/owner/session/verify.ts`,
`functions/api/profile-overrides/[key].ts`, `scripts/registry-smoke.sh`,
`scripts/owner-edit-smoke.sh`, `docs/claim-flow.md`, `docs/business-registry.md`.

Not touched: `.astro/content-assets.mjs`, `AGENTS.md`, `docs/project-standard.json`,
`src/components/*` (no UI change this round), stashes, analytics commits.

## 6. Disposition of the remaining review findings

| Review item | Disposition |
| --- | --- |
| Rollout/rollback hazard (mixed-version) | **Addressed in code and tests**: migrate-before-code is an executed assertion ("the corrected code cannot run on a pre-0007 schema"); the old writer now aborts at the schema; owner routes and public reads require provenance, not the bit. **Still missing**: an agreed safe rollback *version*, write-quiescence procedure and a production backup/restore rehearsal — those need production access, which was out of scope. |
| "SQL downgrade alone does not remove static badges" | Publication quarantine is in the migration, and the projection fails closed at read time, so a stale `published` flag cannot serve content. A **badge** rebuild is still a queued production rebuild; not exercised here (no rebuild was triggered). |
| Empty-DB smoke suites didn't cover the migration's purpose | Superseded by §3.2; the shell suites were updated to the new contract but only the registry one was executed. |
| UI artifact not built/tested (blocker 3) | **UNCHANGED / UNRESOLVED.** No UI file was modified this round; `dist/` still predates the ClaimFlow/OwnerEditor changes; no browser QA, no locale exercise, `astro check` not re-run. |
| "All local / no Cloudflare call" wording + live HTTP in the owner suite (blocker 4) | The **retained** suite is genuinely offline (§3.2, counted fetches). `scripts/owner-edit-smoke.sh` still uses `PUBLIC_SITE=https://barcelonacompare.com` and live `og-default.png` / `robots.txt` URLs for its photo assertions (`:95-100,246,264`) — **not corrected this round**; it must not be described as offline until those become local fixtures, and it was therefore not run. |
| Recovery/audit plan missing (blocker 5) | Populated migration + restore + retry rehearsed with synthetic data (§3.2 H), including a byte-identical restore check. `0006` still clears `verified_at` without preserving the former value in the event — **residual**, unchanged. Existing duplicate `0005` prefixes left alone. |
| Pending claim squatting / misleading deep link | **Unchanged** (product decision): a confirmed mailbox still reserves a listing and `already_claimed` is the only signal, and the deep link panel does not identify the visitor. `docs/claim-flow.md` should state a dispute/expiry path; operator revoke remains the escape hatch. |
| Approval-outcome email promised | **Partially corrected**: the server string in `functions/api/owner/session.ts` no longer promises an email and now says "we will contact you at this address once the review is done". The claim-flow UI copy and the claim-verify response were not changed; delivery responsibility is still not stated as operator-owned. |
| Operator token bypasses pending checks | **Unchanged by design** (privileged support/moderation authority), and operator writes for an unapproved listing are stored unbound so they can never be served publicly. |
| No CI gate | **Unchanged.** The offline suite is runnable in CI (no network, no wrangler) but is not wired in; declaration `B05` remains GAP. |

## 7. Stop condition report

The brief set a 45-minute bound with a checkpoint before long actions. Checkpoint 1 of this file's
predecessor was written before any edit or test run (entry branch, HEAD, dirty manifest, port/writer
check, pre-fix snapshot location). **The round ran over the bound** (the corrected suite, the real-D1
run and the smoke-contract updates each needed a fix-and-re-run cycle). Nothing was left mid-write: all
edits are complete on disk, both suites' final runs are green, and the unresolved items in §6 are
recorded with the exact reason rather than silently dropped.

No deploy, no push, no production read/write, no migration applied, no Google/email/paid/cron action, no
profile or protected-instruction change, no second source writer launched.

## 8. Next owner and next action

**Agrippa** owns: (1) renewed independent review of this exact candidate (mandatory — this worker cannot
self-approve); (2) the release preflight and the production migration/backup decision for `0006`+`0007`
together, in the order migrate-then-code with writes quiesced; (3) re-running `owner-edit-smoke.sh` after
its photo fixtures are made local, and the UI build/browser QA from blocker 3. Production public auth
remains unchanged and must not be described as fixed until that review and release happen.
