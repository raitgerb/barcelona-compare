# Barcelona Compare — Phase 0 prerequisites, blockers, acceptance and authority checklist

Status: **DISCOVERY ONLY — no implementation started, no code changed, nothing deployed.**
Artifact owner: Builder. Continuation owner: Agrippa (after vault recovery). Approvals: Rutger.
Written: 2026-09-20 21:21 CEST (2026-09-20T19:21:25Z).
Authority: Rutger approved execution of all recommended phases. Agrippa bounded this initial Builder assignment to Phase 0 discovery only because mandatory vault reads were blocked. Plan:
`.hermes/plans/2026-09-20_205738-project-review-and-improvement-plan.md` §6 (plan hash
`3bd6d0e033146c35a951c66efbf8dfabbf7b25fadcea83c7b4bf3271d5f689ef`).
Governing standard: Project Standard v1.0.0 — **currently unreadable; see BLOCKER-1.**
This document is not AGENTS.md, grants no new permission, and is not a release receipt.

---

## 1. What was actually done (in order)

1. Read `AGENTS.md` in the project root (hash `8ac6ead1a9b574d083b464df05215e561fd3e4739df6213092dcba7606f66e7d`).
2. Read the improvement plan in full (348 lines).
3. Attempted the mandatory standard/coordination read; **failed**; characterized the failure (BLOCKER-1).
4. Ran the installed `project_preflight.py --help` and captured the real interface.
5. Ran real preflight, `--phase onboarding` and `--phase audit`, against the real project root.
6. Inspected live processes and open file handles to identify active writers **before** any repository operation (§4).
7. Inspected git state read-only: branch, HEAD, dirty entries, stash list, remote.
8. Built a **throwaway fixture under `/tmp`** (real `AGENTS.md` bytes copied in, draft declaration, git repo + origin)
   to mechanically prove which failures would remain once a declaration exists. Nothing was written into the repo by it.
9. Wrote this checklist.

Not done, deliberately: no code change, no build, no deploy, no git branch/commit/stash operation,
no Google call, no external network call, no Cloudflare change, no worker started, no destructive test,
no vault write, no AGENTS.md edit, no declaration installed, no substitution of historical standard text.

---

## 2. Actual preflight results (raw, real repo)

Command (installed interface confirmed via `--help`: `--root`, `--phase {onboarding,release,audit}`,
`--declaration`, `--json`, `--version`; exit 0 pass / 1 fail / 2 usage; tool 1.0.0):

```
/usr/bin/python3 /Users/agrippa/project-foundations/scripts/project_preflight.py --root /Users/agrippa/Projects/barcelona-compare --phase onboarding
```

Actual result:

```
project_preflight 1.0.0  phase=onboarding
standard version implemented: 1.0.0
root: /Users/agrippa/Projects/barcelona-compare
declaration: docs/project-standard.json
  [FAIL] DECLARATION            missing
  [PASS] GIT_REPO               main
  [PASS] GIT_REMOTE             remotes not required for maturity None: origin

Failures (1):
  x declaration_missing [.../docs/project-standard.json]: no declaration at docs/project-standard.json

RESULT: FAIL (1 failure(s): declaration_missing)
```

`--json`: `"ok": false`, `"failure_codes": ["declaration_missing"]`, `"warnings": []`.

`--phase audit` (read-only inventory): same single failure, plus

```json
"git": {
  "branch": "main",
  "dirty_entries": 2,
  "head": "30cedecf071040e7eec549d2801cd84ee97756b5",
  "is_repo": true,
  "origin": "git@github.com:raitgerb/barcelona-compare.git",
  "remote_count": 1,
  "tracked_files": 1689
}
```

**Honest reading:** FAIL is caused by exactly one mechanical gap. A pass would be structural only —
per the tool's own printed limits, it is not compliance, not certification and not release permission.
`dirty_entries: 2` are the two preserved items in §4, not defects introduced here.

---

## 3. Blockers, with evidence

### BLOCKER-1 — Canonical standard and coordination procedure are unreadable (HARD GATE, unresolved)
Every content read of `Hermes/Standards/` fails at the OS level. Measured, not assumed:

```
FAIL Coordination and Completion.md : errno=11 (EDEADLK) 'Resource deadlock avoided'
FAIL Mandatory Project Onboarding.md: errno=11 (EDEADLK) 'Resource deadlock avoided'
FAIL Papercuts.md                   : errno=11 (EDEADLK) 'Resource deadlock avoided'
FAIL Project Registry.md            : errno=11 (EDEADLK) 'Resource deadlock avoided'
FAIL Project Standard v1.md         : errno=11 (EDEADLK) 'Resource deadlock avoided'
FAIL Project Workflow Templates.md  : errno=11 (EDEADLK) 'Resource deadlock avoided'
FAIL README.md                      : errno=11 (EDEADLK) 'Resource deadlock avoided'
OK   barcelona-compare/AGENTS.md    : read 64 bytes
OK   project-foundations/AGENTS.md  : read 64 bytes
```

Scope characterization:
- the Standards directory **lists** (7 entries, correct names/sizes/mtimes) but **no file in it can be read**;
- the failure is **not disk-wide** — non-vault files read normally;
- sibling vault directories list fine (`Handovers/` 13, `People/` 22, `Sessions/` 84, `Investing/` 16, …);
- a filesystem search found **no second copy** of `Project Standard v1.md` anywhere under `/Users/agrippa` (depth 4).

Consequence: the canonical text cannot be certified, so **rule content must not be inferred, reconstructed or
replaced with historical quotes.** Gate respected — not bypassed. This blocks: declaration content that must
reflect the standard, the central-registry step, and the source-contract permission statement.

### BLOCKER-2 — `docs/project-standard.json` does not exist (declaration missing)
Confirmed twice: `ls` → "No such file or directory"; preflight → `declaration_missing`.
Only a reference *contract* is available (`project-foundations/docs/declaration-schema.md`,
`declaration-example.json`). No declaration was created, because its required content depends on BLOCKER-1.

### BLOCKER-3 — `AGENTS.md` does not reference the Project Standard or its version (PROVEN, not assumed)
Reference implementation `re.search(r"project\s+standard", text, re.IGNORECASE)` → no match;
`"1.0.0" in text` → false. Grep of the real file returns nothing (exit 1).

Mechanically demonstrated on the throwaway fixture (real `AGENTS.md` bytes + valid draft declaration +
git repo + origin). With the real entrypoint and a *passing* declaration, preflight still fails:

```
[FAIL] INSTRUCTIONS  AGENTS.md
failure_codes: ['entrypoint_no_standard_reference', 'entrypoint_no_version']
  x AGENTS.md does not reference the Project Standard
  x AGENTS.md does not state the adopted standard version 1.0.0
all other checks PASS  (DECLARATION, STANDARD_VERSION, IDENTITY, MATURITY, MODULES,
                        COMMANDS, BOUNDARIES, PUBLIC, RELEASE_BLOCK, REQUIREMENTS,
                        GIT_REPO, GIT_REMOTE)
```

Control (discriminating): appending only two lines to the fixture's `AGENTS.md` —
`## Standards` / `Project Standard: version 1.0.0 — Hermes/Standards/Project Standard v1` —
turned the same fixture green: `rc=0 ok=True failure_codes=[]`. So this gate discriminates on exactly
this condition and nothing else; it is a real requirement, not a data artifact.

`AGENTS.md` here is an **approval-gated / protected instruction file**. Not edited. Requires Rutger's approval.

### BLOCKER-4 — Central registry step not performed (unreadable + it is an external-state action)
The registry is `Hermes/Standards/Project Registry.md` — inside the BLOCKER-1 failure set, so the registry
format, the prescribed process and the current registration state are **UNKNOWN**. Per instruction, external
state was not modified. Registration is therefore **pending vault recovery**, not "done".
Note: the preflight tool itself has **no registry check** (grep: no match), so a green preflight will not
imply registration. Registration is a separate, owner-gated step.

### BLOCKER-5 — Source-contract permissions cannot be stated (depends on BLOCKER-1)
The requested "source contract permissions" (which sources may be read/written/retained, by whom, under what
authority) live in the canonical standard. Unreadable → UNKNOWN. Two adjacent facts are known and do **not**
substitute for it: (a) `AGENTS.md` still claims *"Standing authorization to ship: pushing `main` is authorized
without asking"*; (b) the plan §2 says *"No implementation authority is inferred from the older standing push
permission."* **These conflict. The permissive reading must not be assumed.** Until the standard is readable
and the entrypoint is corrected, the conservative reading (explicit approval per release) governs.

---

## 4. Active writers and preserved state (checked read-only, before any repo operation)

- Process check: the only live processes touching this repository are **this session** (`60621`/`60622`).
  No other session, worker or shell holds the tree open (`lsof` on the project directory).
- The one active Hermes worker (`PID 59418`, kanban `t_f993d79a`) is a **travel-tools** board task running in
  `/Users/agrippa/.hermes/kanban/boards/travel-tools/workspaces/t_f993d79a` and a `voyageary` worktree —
  **not this repository.** Unrelated; do not interfere.
- Preserved, untouched:
  - `.astro/content-assets.mjs` — modified (`M`), content `export default new Map();`,
    sha256 `6eec27650a023e5d1805c36b527913e976d473c2b4e5d659cbe1587643209e83`. It is a build artifact,
    not source; do not commit, revert or "clean" it.
  - `stash@{0}` — *"On data/broaden-phases: listing edits from the 2026-09-14 enrich run (pending content review)"*.
    **Still stashed, still untouched.** The plan defers these until provenance checks (Phase 4).
- The recently described concurrent analytics work is **no longer dirty**; analytics landed in commits
  `4885e66` / `30cedec`. Current dirty set is therefore exactly: the `.astro` artifact + untracked `.hermes/`.
- Revision facts: local HEAD `30cedecf071040e7eec549d2801cd84ee97756b5`; remote `origin/main`
  `6438325179192070e4a103e182e4a606039d8460` (from `git ls-remote`, read-only). They differ —
  local `main` is **ahead 1** and is **not** the production revision.
- Note for the next owner: this checklist file is a new **untracked** path (`docs/phase-0-prerequisites-checklist.md`).
  It was intentionally not staged or committed.

---

## 5. Phase 0 acceptance criteria — current state

| # | Acceptance criterion (plan §6 Phase 0) | State |
|---|---|---|
| A1 | Read access restored to canonical standard + coordination procedure | **BLOCKED** (BLOCKER-1) |
| A2 | Latest owner intent inspected | DONE — plan §2/§7 + this session's instruction; no implementation authority inferred |
| A3 | Remote/local divergence identified | DONE — §4 |
| A4 | Active writers identified; no unknown writer's changes moved or committed | DONE — §4; nothing moved |
| A5 | Clean task worktree pinned | NOT STARTED — needs a branch decision; out of Phase 0 discovery scope |
| A6 | Bounded project declaration completed | **BLOCKED** (BLOCKER-2 + BLOCKER-3 + BLOCKER-1) |
| A7 | Registry migration completed | **BLOCKED** (BLOCKER-4) |
| A8 | Modules established: WEB, DATA, EXTERNAL, ANALYTICS, AUTOMATION; PUBLIC; ownership/contact-data sensitivity | DECLARED in intent; **not yet recorded in a declaration** (A6) |
| A9 | Boundaries established: $0 cap, no paid tier, no automatic collection restart | In force operationally (AGENTS.md standing constraints, weekly cron `a0357cbcaf3b` stays paused); **not yet recorded in a declaration** (A6) |
| A10 | Onboarding preflight passes | **NOT MET** — currently `FAIL: declaration_missing` |
| A11 | Instructions contain no known stale claims | **NOT MET** — `AGENTS.md` has no standard reference (§5 of this list), its "Current state (Sep 11 2026)" is stale per plan F09, and its standing-push claim conflicts with plan §2 |
| A12 | Source/permissions/owners reviewed separately | **BLOCKED** (BLOCKER-5) |

Phase 0 is **not complete**. Nothing above may be reported as complete until A1 clears.

---

## 6. Authority map for the next owner

**Builder may, without further approval:** read any project file; run read-only local inspection
(git status/log/ls-remote, process and handle inspection); run the local preflight; write **local**
Phase-0/blocker documentation under `docs/` that is not a protected instruction file; produce draft material
clearly labelled DRAFT/UNVERIFIED.

**Builder must not (and did not):** edit `AGENTS.md` or any other protected instruction file; install
`docs/project-standard.json` while its content depends on an unreadable standard; modify the central registry
or any external state; create, switch, merge, commit, stash or push branches; deploy or touch Cloudflare/Google;
start or stop workers; run destructive tests; re-enable the weekly refresh cron `a0357cbcaf3b`; spend money;
make Google calls; alter/revert/commit `.astro/content-assets.mjs`; apply or drop `stash@{0}`.

**Needs Rutger's explicit approval to proceed:** (1) the `AGENTS.md` edit adding the Project Standard
reference + `1.0.0`; (2) installing `docs/project-standard.json`; (3) the registry write; (4) any release or
spend decision. Standing push authorisation in `AGENTS.md` is **not** treated as implementation authority here.

**Escalation rule:** if permissions conflict, stop the affected action and resolve; never take the permissive
reading.

---

## 7. Safe next steps, in order (all gated on vault recovery)

1. **Rutger/Agrippa: restore vault reads.** Re-run the §3 read probe; success = all 7 Standards files read.
   Do not proceed on partial reads, and do not reconstruct the standard from memory or history.
2. **Agrippa: re-verify this checklist's UNKNOWNs** against the now-readable canonical text —
   in particular the B01–B09 and per-module checklist semantics, the source-contract permissions, and the
   registry procedure. §8 below flags exactly what is inferred versus known.
3. **Rutger approval → one protected-file change:** add to `AGENTS.md` a `## Standards` block stating
   `Project Standard: version 1.0.0 — Hermes/Standards/Project Standard v1` and resolve the stale
   standing-push sentence so it stops contradicting the plan. Proof the gate is the only remaining check is
   in §3/BLOCKER-3.
4. **Builder: create `docs/project-standard.json`** matching the contract in
   `project-foundations/docs/declaration-schema.md`, with honest `requirements` states
   (`GAP`/`UNKNOWN`, never VERIFIED without evidence + date). Then re-run onboarding preflight.
5. **Agrippa: register the project** in the central registry through its prescribed process (vault step;
   not an external system).
6. **Only then** start Phase 1 (plan §6), beginning with Task A (ownership gating) and Task B (fail-closed
   spending), each with its own failing-test-first evidence and release receipt.

---

## 8. Verification honesty — what this document does and does not establish

**Established by direct tool output in this session:** the vault read blocker and its scope; the real
preflight interface and its real FAIL/codes; the git/process/dirty/stash state; that the `AGENTS.md`
entrypoint condition fails on the real bytes and that it is the condition the gate discriminates on.

**Inferred, NOT certified** (labelled so on purpose): the meaning of checklist items `B01`–`B09` and the
per-module ids. The canonical standard is unreadable, so their semantics were read off the **reference
implementation's own declaration** (`project-foundations/docs/project-standard.json`): B01 purpose/audience/
non-goals; B02 canonical root and sources of truth; B03 repository/remote/branch and input-vs-generated
boundary; B04 instruction-file approval state; B05 tests green on named interpreters with artifact logs;
B06 release/receipt/rollback flow; B07 credentials/network/install footprint; B08 continuity, backup and
restore; B09 papercuts recorded. Treat as a working hypothesis to be replaced by the canonical text at step 2.

**Not established at all:** whether the module selection WEB/DATA/EXTERNAL/ANALYTICS/AUTOMATION is
*correct* under the standard (only that it is a valid enum selection); anything about production state, quota
settings, billing, credentials or the live deployment (none of which this tool reaches); and whether a future
green preflight means compliance — it does not.

No claim is made that implementation has started. It has not.

---

## 9. Reproducible evidence

| Item | Value |
|---|---|
| Working tree HEAD | `30cedecf071040e7eec549d2801cd84ee97756b5` |
| `origin/main` | `6438325179192070e4a103e182e4a606039d8460` |
| Branch | `main` (ahead 1) |
| `AGENTS.md` sha256 | `8ac6ead1a9b574d083b464df05215e561fd3e4739df6213092dcba7606f66e7d` |
| `.astro/content-assets.mjs` sha256 | `6eec27650a023e5d1805c36b527913e976d473c2b4e5d659cbe1587643209e83` |
| Plan sha256 | `3bd6d0e033146c35a951c66efbf8dfabbf7b25fadcea83c7b4bf3271d5f689ef` |
| Preflight tool | `project_preflight 1.0.0 (Project Standard v1.0.0)` |
| Preflight FAIL code | `declaration_missing` (onboarding and audit) |
| Fixture-proven codes | `entrypoint_no_standard_reference`, `entrypoint_no_version` |

Commands run (all local; no network, no repo mutation):

```
/usr/bin/python3 /Users/agrippa/project-foundations/scripts/project_preflight.py --help
/usr/bin/python3 .../project_preflight.py --root /Users/agrippa/Projects/barcelona-compare --phase onboarding [--json]
/usr/bin/python3 .../project_preflight.py --root /Users/agrippa/Projects/barcelona-compare --phase audit
/usr/bin/python3 /tmp/bc-phase0-probe.py        # vault read characterization + prerequisites (read-only)
/usr/bin/python3 /tmp/bc-phase0-fixture.py      # /tmp fixture: proves the remaining blockers
git rev-parse HEAD ; git status --porcelain=v1 ; git stash list ; git ls-remote origin refs/heads/main
ps -o pid,lstart,command -p 59418,60485,60476 ; lsof +D /Users/agrippa/Projects/barcelona-compare
```

Scratch scripts live under `/tmp` (`bc-phase0-probe.py`, `bc-phase0-fixture.py`, `bc-phase0-fixture/`) — outside
the repository, intentionally not tracked. The fixture contains a **DRAFT** declaration used only to
characterize the gate; it is not a project artifact and must not be adopted as one.

**Next owner: Agrippa, on vault recovery. Do not treat this document as permission to implement.**
