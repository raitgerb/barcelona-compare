# Ownership gate — bounded implementation slice: status and evidence report

**Status: LOCAL IMPLEMENTATION COMPLETE, TESTS RUN AND GREEN — NOT reviewed, NOT released, NOT accepted.**
Artifact owner: Builder (bounded worker, this slice). Independent review / next phases: Agrippa (unchanged).
"Complete" here means only: the draft reconciled, the pending-approval UX made coherent, the declared
suites executed against isolated local databases with the outputs below. No self-approval is implied, and
nothing is claimed about production.

Authority: `docs/improvement-execution-handoff.md` (Rutger approved all recommended phases 2026-09-20);
plan `.hermes/plans/2026-09-20_205738-project-review-and-improvement-plan.md`. Independent review is
required before any auth release (PUBLIC project, auth = SENSITIVE change risk). No deployment was
performed and no push was attempted.

---

## 1. What this slice actually did, in order

1. Read `docs/improvement-execution-handoff.md` in full, then `docs/project-standard.json` and
   `docs/phase-0-prerequisites-checklist.md`.
2. Wrote this file's checkpoint (§5) **before** inspecting or running anything long, so an interruption
   preserved the entry state.
3. Inspected the uncommitted draft on `b2b/ownership-gate` (functions, migration `0006`, the three smoke
   scripts) rather than restarting it — no existing work was reverted or rewritten from scratch.
4. Found three incoherences in the draft and fixed them (below).
5. Independently re-read the registry / branch-protection state and re-ran the onboarding preflight.
6. Made the smoke suites able to run against strictly isolated local D1 databases, then ran them.
7. Updated `docs/claim-flow.md`, `docs/business-registry.md` and the declaration's `B04`/`B05` so the
   source contract matches the code and the measured gaps.

Deliberately **not** done: no commit, no branch operation, no push, no PR, no deploy, no Cloudflare or
Google call, no production D1/R2 write, no email, no cron change, no credential change, no profile edit,
no stash apply/drop, no `AGENTS.md` edit, and no modification of the generated
`.astro/content-assets.mjs`.

## 2. Reconciliation of the existing draft — what it already had (kept)

The previous worker's draft was sound in shape and was kept: `claimed` (mailbox possession) and
`verified` (human ownership approval) split apart; `verifyBusiness()` replaced by `approveOwnership()`
requiring `approvedBy` + `evidence`; `POST /api/claim/verify` no longer sets `verified` and no longer
queues a badge rebuild; the three owner entry points (`/api/owner/session`, `/api/owner/session/verify`,
`/api/owner/profile/:placeId`) refuse a not-approved claim with `403 ownership_pending`;
`revokeBusiness()` deletes owner sessions; migration `0006` adds the two provenance columns and downgrades
legacy `verified` rows with an `ownership_review_required` audit event. I did **not** re-derive or
restructure any of that.

## 3. Gaps found in the draft and fixed in this slice

| # | Gap (measured) | Fix |
| --- | --- | --- |
| G1 | `src/components/ClaimFlow.astro` still told the owner "**Listing claimed and verified** … you are now recorded as the verified owner … edit your services, prices, hours and photos whenever you like", and its primary CTA linked to the editor (`/gestion/`). With the new server behaviour that is false twice over: the listing is not verified and the editor returns 403. | The panel now says the claim is **pending review**, explains the independent check that has to happen, links to the **listing** (`payload.listingUrl`), and deliberately offers no editor link. Both locales. |
| G2 | `POST /api/claim/start` can now answer `state: "already_pending"`, but the client only handled `already_verified`. A returning pending owner fell through into "We sent the code to …" even though **no code was sent** (the endpoint returns without sending mail), i.e. the UI lied. | Handled `already_pending` explicitly: shows the pending-review panel and does not pretend a code was mailed. |
| G3 | Deep link `?place=…` only pre-checked `verified`. A listing with a pending claim sent the visitor through the whole code step again. | It now reads `claimed` as well: `verified` → "already claimed", `claimed && !verified` → the pending-review panel. |
| G4 | The owner login screen (`src/components/OwnerEditor.astro`) surfaced the server's English message verbatim, including the new `ownership_pending` 403, which is the most likely error a pending owner will hit. | Added a localized `ownershipPending` string (ES/EN), an `errorText()` helper used by every `catch` in that component, and a message when a stored session is refused because the claim is no longer approved. |
| G5 | `scripts/registry-smoke.sh` asserted `verify without evidence leaves verified=false` against the **400 error body**, which has no `business` field — the assertion could never pass (measured: `got [null]`). | Reads the state back with a `GET` after the refusal and asserts on that. It now passes, and it tests what it claims to test. |
| G6 | All three smoke suites opened the **shared** local D1 in `.wrangler/state`, so a run could see or delete another agent's rows and could not be isolated on this machine. | Each script accepts `SMOKE_PERSIST_DIR` and passes `--persist-to` to every local wrangler call (migrations, `pages dev`, `d1 execute`). Unset keeps the old default. |
| G7 | Docs described the removed behaviour: `docs/claim-flow.md` ("`claimed = 1` + `verified = 1`", "on success: claimBusiness() + verifyBusiness()", `state:"verified"`, `claim,verify` audit trail) and `docs/business-registry.md` (an example importing `verifyBusiness()`). | Both updated, plus a new *Ownership approval* section with the operator command, the mandatory provenance, the three 403 paths and the migration's legacy-row downgrade. |

## 4. Real test output (this slice, all local)

Isolation: each suite ran with `SMOKE_PERSIST_DIR=/tmp/bc-ownership-d1-*` on its own port. The **shared**
local D1 was hashed before and after with `sha256` and is **byte-identical**, which is the evidence that
no run touched it:

```
$ shasum -a 256 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*
(6 files hashed before; diff against the after-hash -> IDENTICAL)
```

| Suite | Command | Result |
| --- | --- | --- |
| Data pipeline | `npm run data:smoke` | `57 passed, 0 failed` |
| Registry | `SMOKE_PERSIST_DIR=/tmp/bc-ownership-d1-r PORT=8811 bash scripts/registry-smoke.sh` | `registry smoke test: 48 passed, 0 failed` (exit 0) |
| Claim flow | `SMOKE_PERSIST_DIR=/tmp/bc-ownership-d1-c PORT=8812 bash scripts/claim-smoke.sh` | `claim smoke test (20260920213836-79882): 56 passed, 0 failed` (exit 0) |
| Owner edit (end-to-end) | `SMOKE_PERSIST_DIR=/tmp/bc-ownership-d1-o2 PORT=8813 bash scripts/owner-edit-smoke.sh` | `owner-edit smoke: 85 passed, 0 failed` (exit 0) |
| Astro compile check | `npx astro check` | 1 error, 0 warnings, 86 hints — the single error is **pre-existing and in an untouched file** (`src/pages/en/mejores/[category]/index.astro:42`, `ts(2339)` on `meta.plural`); **no error in any file changed by this slice** |

Raw logs (outside the repository, as required): `/tmp/bc-ownership-evidence/` —
`registry-smoke.txt` + `registry-smoke.rc` (48/0, rc=0),
`claim-smoke.txt` + `claim-smoke.rc` (56/0, rc=0),
`owner-edit-smoke-isolated-rerun.txt` + `.rc` (85/0, rc=0),
`owner-edit-smoke.rc` and `owner-edit-smoke-parallel-attempt.rc` (the failed concurrent
attempt), `astro-check.txt`, `preflight-onboarding.txt`, `shared-d1-before.txt`,
`shared-d1-after.txt`, `assets-before.txt`, `run-all.sh`.

Honest failure note: the first attempt ran the three suites **concurrently**; the owner suite exited
`rc=2` with `local server never came up` (three `wrangler pages dev` processes starting at once — no test
assertion ran in that attempt). It was re-run on its own and passed 85/85. Both the exit code and the
message of the failed attempt are kept in that directory; its raw server log was overwritten by the
re-run at the same path, which is why the passing log is now stored under
`owner-edit-smoke-isolated-rerun.txt`.

### Negative authorization regressions that now exist and pass

- A correct code yields `state=pending_approval`, `claimed=true`, `verified=false`, `verifiedAt=null`;
  the audit trail holds `claim` **only** (no `verify`) — `claim-smoke.sh`.
- `PUT /api/registry/:id {op:"verify"}` without `evidence` → `400 approval_provenance_missing`, and a
  read-back confirms `verified=false` / `verifiedAt=null` — `registry-smoke.sh`.
- `POST /api/owner/session` for an email-verified-but-unapproved claim → `403 ownership_pending`, both
  anonymously and with the operator token, and **no login code is minted**; the same call returns 200
  only after `op:"verify"` records `approvedBy` + `evidence` (that positive control is what makes the
  refusal discriminating) — `owner-edit-smoke.sh` step 2b → step 3.
- After revoke, `op:"verify"` → `409 not_claimed`, and the recorded event order is
  `claim,ownership_approved,tier_change,revoke`.

### Onboarding gate, re-read independently this slice

```
/usr/bin/python3 /Users/agrippa/project-foundations/scripts/project_preflight.py \
  --root /Users/agrippa/projects/barcelona-compare --phase onboarding
RESULT: PASS (onboarding phase, structural and local checks only)   rc=0
13 warnings: B03-B09, WEB, DATA, EXTERNAL, ANALYTICS, AUTOMATION are GAP; branch note (declared
production branch main, current branch b2b/ownership-gate).
```

This is a **structural** pass. It is not compliance, not certification, not a test run and not release
permission (the tool states this itself). The GAP warnings are the honest remaining gaps, not noise.

### Registry / branch protection, read from the API and the remote (not inferred)

```
$ git ls-remote origin refs/heads/main
6438325179192070e4a103e182e4a606039d8460     <- production main
$ git rev-parse HEAD   -> 30cedecf071040e7eec549d2801cd84ee97756b5   (branch b2b/ownership-gate)
$ git rev-parse main   -> 30cedecf071040e7eec549d2801cd84ee97756b5   (local, ahead of the remote)
```

Declared release path (from `docs/project-standard.json`, matching the standing record): **rebase onto
`origin/main`, open a PR, obtain the `Cloudflare Pages` check, squash-merge** — `main` is protected and
there is no bypass. **No push was attempted**, so this is a read-only restatement, not a claim.

## 5. Checkpoint 1 — entry state (written before any inspection or test run)

Timestamp: 2026-09-20 21:36 CEST. Branch `b2b/ownership-gate`, HEAD
`30cedecf071040e7eec549d2801cd84ee97756b5`. Dirty tracked files at entry: `.astro/content-assets.mjs`,
`AGENTS.md`, the six `functions/*` files, the three smoke scripts (all present in the hash table in §7).
Untracked at entry: `.hermes/`, `docs/improvement-execution-handoff.md`,
`docs/phase-0-prerequisites-checklist.md`, `docs/project-standard.json`,
`migrations/0006_ownership_approval.sql`. `stash@{0}` unchanged; local `main` at `30cedec` unchanged.

## 6. Preserved state — verified after the work, not assumed

| Item | State |
| --- | --- |
| `.astro/content-assets.mjs` (generated, dirty) | **Untouched**: sha256 `6eec27650a023e5d1805c36b527913e976d473c2b4e5d659cbe1587643209e83` before *and* after `astro check`. Not committed, not reverted, not cleaned. |
| `stash@{0}` ("listing edits from the 2026-09-14 enrich run") | Still stashed, not applied, not dropped |
| Local `main` commit `30cedec` (ahead of remote) | Unchanged; not pushed, not rebased away |
| Unrelated analytics work | Untouched (already committed in `4885e66`/`30cedec`) |
| Shared local D1 `.wrangler/state` | Byte-identical before/after (sha256) |
| Production D1 / R2 / Cloudflare | Not opened, not written |
| `AGENTS.md` | Only Agrippa's earlier approval-gated edit is present; this slice did not touch it |

## 7. Exact file inventory

Changed by **this slice** (delta over the entry state hashes in the checkpoint table):

| File | sha256 after |
| --- | --- |
| `src/components/ClaimFlow.astro` | `d1344257afd02da142f2bd721864a91dfd6379c0963d26674ed2f863ad854190` |
| `src/components/OwnerEditor.astro` | `85c26fae8a767020593a694f811d446c1a208b96c964d5eaffd1734ea8dd1b0b` |
| `docs/claim-flow.md` | `c91977b09185fcd98f96ba8a19e6d56ac5d406f7bf12992fc9d5093305ba5347` |
| `docs/business-registry.md` | `9eda9c85c704fd1f44f2744560a6335d4780c012c1a489e79349af4c107aa430` |
| `docs/project-standard.json` (B04/B05 + the isolated-D1 write rule) | `3b83e08e2ff2f9c06e3985720138c42926a6bf4cbae8f5f1df8e50343db9da61` |
| `docs/ownership-implementation-status.md` (this file) | deliberately not self-referential: a hash written into the file cannot include the edit that writes it. The authoritative value is the one `shasum -a 256 docs/ownership-implementation-status.md` returns, and it is recorded in the handoff message. |
| `scripts/claim-smoke.sh` | `f2d29fc5dd4c28cac9edcf373336b981392cf159813c71759882675cd6b36233` |
| `scripts/registry-smoke.sh` | `6f3239cd2fb6676b3fa3e257fe839c9fe5062d302e873a19eb2abbb5b5472350` |
| `scripts/owner-edit-smoke.sh` | `d1620b61416f67f4d473061b07f2102aaf840e9bedf13694948a74fd954d7209` |

Inherited from the reconciled draft, **unchanged by this slice** (hashes identical to the entry
checkpoint): `functions/_lib/registry.ts` `da1d45ba…`, `functions/_lib/claim.ts` `24c8fb7c…`,
`functions/_lib/profile.ts` `4088c608…`, `functions/api/claim/start.ts` `86e83c3d…`,
`functions/api/claim/verify.ts` `539a0c28…`, `functions/api/owner/profile/[placeId].ts` `ffc138ec…`,
`functions/api/owner/session.ts` `1e76c72b…`, `functions/api/owner/session/verify.ts` `b658ba4e…`,
`functions/api/registry/[placeId].ts` `de7bdd53…`, `migrations/0006_ownership_approval.sql`
`0463a303…`.

Working tree relative to `HEAD`: 18 tracked files modified, 484 insertions / 133 deletions (the draft's
functions/migration plus this slice's UI, docs, script and declaration edits), 6 untracked paths. Nothing
is staged.

## 8. Status labels — nothing here is a live or accepted claim

- **LIVE / VERIFIED**: none. No deployment, no production read-back, no merged revision.
- **TESTED (local, real runtime)**: the four suites above, in `wrangler pages dev` against isolated local
  D1, plus `astro check`. These are real executions; their outputs are in §4 and in
  `/tmp/bc-ownership-evidence/`.
- **UNVERIFIED**: the claim-flow UI change has **not been exercised in a browser** and **not been built**
  (`dist/` was not regenerated, so the served bundle is older than the component change). Compile-level
  checking only (`astro check`: no error in the changed components).
- **BLOCKED / NOT DONE (needs other owners)**: any push to `main` (PR + `Cloudflare Pages` check
  required, no bypass); deploying; applying migration `0006` to the production D1; a full `npm run build`;
  browser/e2e QA of the pending panel; the independent strong review; the release preflight; and the
  production migration rehearsal/rollback plan for `0006`.

## 9. Review notes / residual risks for the independent reviewer

1. **Migration `0006` against a populated database has never been rehearsed.** The header states the
   production registry held zero claimed and zero verified rows when measured (2026-09-20), so the legacy
   downgrade is expected to touch nothing — but that figure is *trusted from the draft*, not re-measured
   against production by this worker (production reads were out of scope). The downgrade path
   (`verified=1 AND ownership_approved_by IS NULL` → `verified=0` + audit event) should be rehearsed on a
   copy before it meets real rows.
2. **`approveOwnership()` accepts `approvedBy` from the operator token's actor when the body omits it.**
   The evidence half has no default, so a bare `{"op":"verify"}` still fails closed; but the "who" is
   weaker than the "what". Consider making both mandatory in a follow-up if the reviewer wants symmetry.
3. **The pending state is invisible to the public listing.** A pending claim shows no badge and no CTA
   change — the listing looks unclaimed, so a second person can start a claim and be told
   `already_claimed` only after typing their email. That is honest but abrupt; a "claim under review"
   marker is a product decision for the owner, not a fix I made.
4. **No CI gate exists**, so "the suites pass" is a local statement. Pinning the Python collector
   dependencies and adding a workflow remain open (declaration `B05`).
5. The in-app copy is Spanish/English only; the operator-facing error messages in the edge functions stay
   English, and the client now overrides only `ownership_pending`.

## 10. Handoff

Agrippa owns: independent verification of the above (the evidence files are the raw material), the
strong review this auth change requires, the release preflight, the production migration decision for
`0006`, browser QA of the pending panel, and the next phase. If any part of this slice is wrong, the
entry-state hashes in §5 and the file hashes in §7 make it cheap to identify exactly what changed.

No self-approval. No live claim. No deployment.
