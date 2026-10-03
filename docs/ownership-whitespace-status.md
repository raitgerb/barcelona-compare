# Ownership whitespace correction — status

Slice: make every provenance non-blank predicate semantically equivalent to JavaScript
`String.prototype.trim()` (ECMAScript WhiteSpace + LineTerminator), without weakening the
JavaScript predicate, and without touching anything outside the declared file set.

Owner intent source: `docs/improvement-execution-handoff.md` § "Ownership whitespace
correction"; defect `/tmp/bc-ownership-fourth-review.md` § "Related R2 residual — FAIL".

## Checkpoint 1 — pre-edit (2026-09-20 23:36 CEST) — PREPARED, no source edits yet

Prerequisites (executed this run, raw output retained in this session):

| Check | Command | Result |
|---|---|---|
| Onboarding gate | `/usr/bin/python3 /Users/agrippa/project-foundations/scripts/project_preflight.py . --phase onboarding` | **PASS** (structural/local only; B03–B09 and module checks still declared GAP) |
| Overlapping writer | `ps -eo pid,etime,command` + `git status --porcelain` | No ownership writer in this repo. The only other Builder session (pids 42629/49650) works kanban task `t_a0fb9db9` on the **travel-tools** board (workspace `/Users/agrippa/.hermes/kanban/boards/travel-tools/workspaces/t_a0fb9db9/`); the long-lived wrangler (78869) belongs to the **fullcastfiction** board. Both out of scope for this project. |
| Branch / base | `git rev-parse` | branch `analytics-fix16`, HEAD `e2090dfa842f5baa3ed1faad059fd800b0a6a896` — same revision the round-4 review examined |
| Standard / Coordination | vault reads | `/Users/agrippa/Documents/Obsidian Vault/Hermes/Standards/Project Standard v1.md` read (9945 B) after `brctl download`; same technique applied to `Coordination and Completion.md`. Vault files are iCloud dataless placeholders; direct `open()` fails with `OSError(11) EDEADLK` until an explicit download request is made. |
| Migrations | `/opt` context | All migrations unapplied. This change is source-only; nothing is deployed, applied to D1, or pushed. |

### Defect being corrected (independently reproduced by round 4)

JavaScript `.trim()` at `registry.ts:210–212` strips tab / newline / NBSP / the rest of
ECMAScript whitespace; SQLite's one-argument `trim()` strips ASCII space (U+0020) only.
So `migrations/0007` triggers and the SQL read guards in `profile.ts` accepted a
provenance value that the runtime JS predicate rejected — a verified row could hold
whitespace-only provenance, stay published publicly, and 403 the owner. Twelve
reproduced failures in the round-4 supplement.

### Predicate design (PREPARED, applied below)

One shared definition, expressed twice because a `.sql` migration cannot import TypeScript:

* ECMAScript WhiteSpace: TAB U+0009, VT U+000B, FF U+000C, SP U+0020, NBSP U+00A0,
  ZWNBSP U+FEFF, U+1680, U+2000–U+200A, U+202F, U+205F, U+3000.
* ECMAScript LineTerminator: LF U+000A, CR U+000D, LS U+2028, PS U+2029.
* SQL form: SQLite's two-argument `trim(X, Y)` removes any character contained in the
  string `Y` from both ends, and `char(...)` emits Unicode code points, so
  `trim(X, char(9,10,11,12,13,32,160,5760,8192,…,8198,8232,8233,8239,8287,12288,65279)) = ''`
  is exactly "every character of X is ECMAScript whitespace" — the same set JS `trim()`
  removes. JS `trim()` itself is **not** modified; no predicate is loosened.
* Guard direction preserved: `IS NULL` still rejects, `<> ''` still rejects.

### Allowed-write set for this slice (declared)

1. `functions/_lib/registry.ts` — canonical predicate + the shared definition.
2. `functions/_lib/profile.ts` — SQL provenance guards.
3. `migrations/0007_ownership_lifecycle.sql` — the two provenance triggers.
4. `scripts/ownership-lifecycle-test.cjs` — retained lifecycle tests + new whitespace controls.
5. `docs/ownership-whitespace-status.md` — this file.
6. **Declared new file:** `functions/_lib/provenance.ts` — the minimal dedicated predicate
   helper (`ECMASCRIPT_WHITESPACE_CODEPOINTS`, `isNonBlankProvenance`, `sqlNonBlankProvenance`).
   Essential because the SQL fragment is needed by both `profile.ts` and `registry.ts` and
   must stay in step with the JS predicate; a dedicated module is smaller than teaching
   one of those files to serve the other's SQL.

Nothing else is edited. No auth redesign, UI, analytics, build, shared DB, network,
credentials, Git mutation, profile, cron or production action is part of this slice.

## Checkpoint 2 — after integration, before the test batches (2026-09-20 23:37 CEST)

Files changed in this slice (sha256 at this checkpoint):

```
2bbc340722c30a1ce1d9aaa8c5b30c72c20ddaadd43cf0fbe4e017d291073186  functions/_lib/provenance.ts
26e5c0b5b181333e16cb5de4f21a4cf4828adec84043b129387698c232887a8e  functions/_lib/registry.ts
655ba15905b59976e30b5be4b6f822843876ad8bf8236b13f22ea9be29a6a268  functions/_lib/profile.ts
d907aa47f2781a419673b0aa4bfff041895f9908e80ad6164b7055507707f9be  migrations/0007_ownership_lifecycle.sql
247d7f8f0149aca87652147236b52a9448756f38aef46109793df8d604a4f65f  docs/ownership-whitespace-status.md
838eb723af447df4e5cf9f6a5f521d3691e9629c88a7db2232a141ddc04ab974  /tmp/bc-third-extra.cjs (unchanged third-review harness, not edited by this worker)
a97ae787f0d22f2154f9992293d0782fb04c1fded165c8287064e7515dcd5a2b  /tmp/bc-r4-independent-owned-i739agpw/supplement-suite.cjs (round-4 supplement, not edited)
```

Branch `analytics-fix16`, HEAD `e2090dfa842f5baa3ed1faad059fd800b0a6a896` (no commit, no push, no branch change — all migrations remain unapplied).

### Test batch 1 — retained offline suite against the NEW source — RUN, PASS

```
cd /Users/agrippa/projects/barcelona-compare
BC_TEST_ROOT=/Users/agrippa/projects/barcelona-compare \
NODE_PATH=/Users/agrippa/projects/barcelona-compare/node_modules \
TMPDIR=/tmp/bc-ws-owned-20260920 \
node scripts/ownership-lifecycle-test.cjs
=> exit 0; "ownership lifecycle suite: 197 passed, 0 failed"
```
`BC_TEST_ROOT` points at the edited canonical source, not at any frozen copy. 197/0 is the
same count the round-4 review recorded for the pre-change candidate, so the predicate change
introduced no regression in the retained lifecycle, migration, editor-projection or
actor-provenance checks.

### Test batch 2 — unchanged third-review harness against the NEW source — RUN, PASS

```
BC_TEST_ROOT=/Users/agrippa/projects/barcelona-compare \
NODE_PATH=/Users/agrippa/projects/barcelona-compare/node_modules \
TMPDIR=/tmp/bc-ws-owned-20260920 \
node /tmp/bc-third-extra.cjs
=> exit 0; "ownership lifecycle suite: 238 passed, 0 failed"
```
`/tmp/bc-third-extra.cjs` was executed as found; its bytes were not modified.

### NOT RUN — reported as a gap, not as a pass

1. **Round-4 supplement (`supplement-suite.cjs`) against the new source: NOT RUN.** The run
   budget was exhausted while the new whitespace controls were still being written. Expected
   outcome, reasoned from the code and *not* observed: its six
   `check('L schema refuses blank ...', Boolean(result.error))` assertions should now PASS
   (the triggers abort), which makes its six `L public refuses blank ...` assertions
   unreachable (they sit behind `if(!result.error)`), so the twelve round-4 failures should
   become 6 passes + 18 skips with 0 failures — 276 passed / 0 failed. **This is an
   expectation, NOT evidence. It must be executed against the new source by the reviewer.**
2. **New retained-suite whitespace controls: NOT ADDED.** The planned section W (parity of the
   TypeScript code-point leader with the SQL `char(...)` literal, JS/SQL agreement over the
   whole ECMAScript set plus non-whitespace controls such as U+200B and U+180E, trigger-present
   refusal for every whitespace value on both columns with the stored value and the published
   content proven unchanged, trigger-dropped read-guard refusals standing in for a mixed-version
   writer, and the whitespace-only approval-input refusal) was designed but not written before
   the budget ended. Until it exists, the retained suite proves **no regression**, not the new
   invariant.
3. **Discrimination run (new controls against a mutant with the old one-argument `trim()` /
   `.trim()` restored): NOT RUN.** No mutation evidence exists for this change.

### Evidence-honesty note

Every LIVE claim above comes from a command actually run in this session and is quoted with its
exact exit code and printed totals. The supplement outcome and the mutant outcome are labelled
NOT RUN / expectation. No assertion was weakened, no gate adjusted and no existing control
removed to reach green: the two suites that ran green did so with their assertions untouched.
This candidate is **PREPARED, not TESTED-to-completion, not REVIEWED and not RELEASED**.
Agrippa owns the independent review of this exact candidate and must not treat this document as
acceptance.

## Checkpoint 3 — reviewer whitespace fragment integrated into the retained suite (2026-09-20 23:44 CEST) — RUN, LIVE 1093 / 0

Scope of this step: integration + execution only. **No runtime, migration, helper or other
source edit** — the only file written is the retained test script (plus this status file).

Integration (additive, mechanical):

* Source is the exact reviewer fragment `/tmp/bc-ws-review-owned-m3wqbt4z/whitespace-fragment.cjs`
  (76 lines, 6312 B), inserted immediately **before** the retained suite's summary block
  (`console.log('\n' + '='.repeat(60));`), i.e. the same position the reviewed harness uses.
* Proof the integration is exact rather than approximate: after the edit,
  `scripts/ownership-lifecycle-test.cjs` is **byte-identical** to the reviewed
  `/tmp/bc-ws-review-owned-m3wqbt4z/suite.cjs` — both
  `b7599ce51ce7254aa7fc944bc49d9cd149c6c6f644248e9e80f9f736ab759273`, `diff` prints nothing.
* The edit produced a single additive hunk (`@@ -1012,6 +1012,83 @@`); every one of the 197
  retained assertions is retained, none edited, none removed, no gate weakened.

Execution (LIVE — command and raw result):

```
cd /Users/agrippa/projects/barcelona-compare
node scripts/ownership-lifecycle-test.cjs
=> EXIT_CODE=0
=> "ownership lifecycle suite: 1093 passed, 0 failed"
```

Independent verification of that total from the same captured stdout (not inferred from the
suite's own print): `grep -c "^  ok   "` = **1093**, `grep -c "^  FAIL "` = **0**, no FAIL line
present. Inside that total, `grep -c "^  ok   W "` = **896** new whitespace assertions, and
1093 − 896 = **197** retained assertions — matching the 197 the round-4 review recorded for the
pre-change candidate. Node v26.8.1, real `node:sqlite` DatabaseSync, transpiled in-memory
TypeScript, offline transport guard active; `BC_TEST_ROOT` defaulted to this checkout, so the
suite ran against the **current canonical source**, not a frozen copy. The suite file's sha256 is
unchanged before and after the run (`b7599ce5…`), so the run wrote nothing.

Gaps that this step does **not** close (unchanged, still binding):

* **Discrimination/mutant run: NOT RUN here.** The 276-failure mutant figure in the review report
  belongs to the reviewer's owned workspace; no mutation was performed in this repo.
* **Misleading documentation: still uncorrected.** `functions/_lib/provenance.ts:26–27` and
  `migrations/0007_ownership_lifecycle.sql:74–75` still state that the retained tests assert full
  parity. They now do (896 new assertions), but those two files are outside this step's declared
  writable set, so the comment wording itself was not touched.
* **Runtime, UI/build, migration/recovery and release/acceptance: PENDING, unchanged** — no
  workerd/D1 concurrency run, no compiled ClaimFlow/OwnerEditor/locale verification, no migration
  applied, nothing committed, nothing pushed. This is a source-only, test-level result.

Agrippa owns independent execution of this integrated artifact; the UI/runtime gate is Agrippa's,
not this worker's.
