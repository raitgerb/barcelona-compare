# Ownership migration rehearsal — 0006 + 0007 over seeded legacy data

STATUS: **TASK ONE COMPLETE — PASS (local, synthetic).** 23/23 migration+recovery assertions
and 4/4 runtime read-back checks green, plus a discriminating provenance control.
TASK TWO: **READ-ONLY discovery done**, recommendation below. Nothing was deployed, pushed,
merged, checked out, or applied to any remote database.

- Owner intent: Rutger — "finish and deploy asap" (recorded as intent, **not executed**).
- Release decision owner: **Agrippa** (coordinator). Builder does not deploy.
- Standard: Project Standard v1.0.0. PUBLIC project; ownership/auth + migration = SENSITIVE
  change-risk → independent review required before release.
- MODE: canonical tree **read-only**. Sole canonical write = this file (plus evidence copies
  under the already-untracked `.hermes/`). No production D1 query, no deploy, no credentials,
  no non-loopback egress.
- Labelling used below: **LIVE** = produced by a command actually run in this session;
  **UNVERIFIED** = not executed here.

## Wall clock (actual timestamps, not estimates)

| stamp (UTC) | event |
|---|---|
| 2026-09-21T09:15:50Z | session start, canonical reads |
| 2026-09-21T09:17:42Z | step 1 (fixture + pre-migration schema + seed + backup) |
| 2026-09-21T09:17:43Z | pre-phase complete (dump + `.backup` verified equal) |
| 2026-09-21T09:17:48Z | step 2 (apply 0006/0007 + post assertions) |
| 2026-09-21T09:19:01Z | evidence persisted to both handoff dirs |
| 2026-09-21T09:19:16Z | final canonical-tree check |

Measured orchestration wall time: **191 s** (09:15:50Z → 09:19:01Z), within the 300 s bound.
Budget compliance is stated from these stamps only.

## Why this rehearsal exists

The prior runtime gate (`/tmp/bc-runtime-recovery-current.md`) applied 0006+0007 to a database
holding **zero rows**, so 0006's legacy-verified downgrade, 0007's publication quarantine and
0007's credential quarantine all ran over empty tables, and the raw-SQL positive control for the
provenance trigger was explicitly **NOT ESTABLISHED**. All three are closed here.

## Method (LIVE)

1. Isolated fixture root `/tmp/bc-migrh-20260921-0917-7f3a2b` with a **synthetic**
   `wrangler.toml` (`database_id = "DB"`, no account, no real UUID). The canonical
   `wrangler.toml` was deliberately NOT copied; the shared `.wrangler/state` was never opened.
2. Pre-migration schema applied with the cached **wrangler 4.135.0** migration runner
   (`/Users/agrippa/.npm/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js`), local,
   `--persist-to` inside the fixture, sanitized env (`env -i`, isolated HOME/TMPDIR, metrics
   off, no ambient cloud tokens) under the OS egress sandbox `/tmp/bc-egress-deny.sb`.
   6 files applied: 0001, 0002, 0003, 0004, **0005_owner_whatsapp**, **0005_rebuild_requests**.
3. Seeded synthetic legacy state (see "What 0006/0007 actually changed" for the exact rows).
4. `sqlite3 .backup` of the whole database to `backup-outside-target/` — **outside** the target
   state directory — taken **before** any mutation, and verified to equal the live content.
5. Real 0006 + 0007 files copied in and applied by the same runner (`apply_0006_0007_exit=0`).
6. Assertions compare **every column value** against the pre-migration dump, not row counts.

## Results (LIVE)

Pre-phase (`checks-pre.txt`, 2/2): `.backup` rc=0, 143,360 bytes, and the backup's full content
**equals** the live pre-migration content across all 9 app tables.
`db_sha256` pre = `5013f0815eede47fa3342a2af76ef5c160cf7ceadc3a4ca8d527fbbd37995554`,
backup sha256 = `162672480dca492230432abbe888799c0843c487e461d95193d4cec75c0af6e4`.

Post-phase (`checks-post.txt`, **23/23 PASS**):

- R01 exactly the 8 migration filenames in `d1_migrations`; R02 all 5 new columns;
  R03 both provenance triggers; R04 `ownership_quarantine_log` + index present.
- **R05 legacy downgrade real**: 3 seeded `verified = 1` rows → all `verified = 0` **and**
  `verified_at IS NULL` (the 0-row path in the prior gate is now exercised).
- **R06 non-legacy rows untouched** on all 14 pre-existing columns.
- R07 three `ownership_review_required` events, actor `migration-0006`, one per downgraded row,
  detail JSON exactly `{reason, action}`.
- R08 pre-existing audit rows still present byte-identical in both event tables.
- **R09/R10 publication quarantine**: 3 seeded `published = 1` overrides → `published = 0`,
  `claim_generation IS NULL` (not inherited), `updated_by = 'migration-0007'`, while **every
  other column is preserved** (services, hours, price_note, hidden_photos, added_photos,
  whatsapp, created_at, updated_at).
- **R11** the unpublished override was not touched at all.
- R12 3 `publication` quarantine rows; generation = the business's `approval_generation` (0) for
  matched rows and **NULL for the override with no matching business**; owner_email taken from
  `businesses` (NULL for the orphan); detail JSON carries slug/published/updated_at/reason.
- **R13 credential invalidation**: all 3 `owner_sessions` rows preserved (id, attempts,
  expires_at, created_at, used_at identical) and set to `approval_generation = -1` — never a
  value a business can carry, so they can never be redeemed again.
- R14 3 credential quarantine rows, `code → login_code`, `session → session`, generation −1,
  owner_email = the session email, detail JSON carries created_at/expires_at/used_at/reason.
- R15 3 `ownership_unpublished` events, actor `migration-0007`.
- R16 `migration-0007` registry events cover exactly the 2 businesses holding −1 credentials.
- **R17 no data loss**: key sets for businesses / profile_overrides / owner_sessions /
  claim_requests / rebuild_requests are preserved, and `claim_requests` + `rebuild_requests` are
  byte-identical (out of scope for 0006/0007).

Runtime read-back (`runtime-readback.json`, **4/4 PASS**) — same wrangler 4.135 engine resolves
**the same D1 file** the migration runner wrote (the D1-identity trap from the prior gate):
8 migrations, `verified = 1` count 0, `published = 1` count 0, 3 quarantined tokens,
quarantine log `{publication: 3, login_code: 2, session: 1}`, 5 business rows all
`verified = 0 / verified_at NULL`.

## Recovery rehearsal (LIVE) — the part that was never tested before

- **R18** the pre-mutation backup was restored to a fresh path and its full dump is **equal to
  the pre-migration dump for every table and every value** (9 tables).
- **R19** the restored database carries the **original** `verified`/`verified_at` strings for all
  three downgraded rows (`2026-07-02T09:15:41.900Z`, `2026-07-03T11:21:12.500Z`,
  `2026-07-06T12:01:00.000Z`) — a value-level check, not a count.

## Provenance invariant — positive control now established (LIVE)

Target row: `ChIJlegacy0003CCCCCCCCCCCC`, `claimed = 1` with `owner_email` + `claimed_at` set
(the prior attempt failed because revoke had cleared those and two legitimate CHECKs fired first).

- **R20** `UPDATE businesses SET verified = 1` with no provenance → blocked, rc=19,
  `ownership_provenance_required: verified=1 needs non-blank ownership_approved_by and
  ownership_evidence`; read-back `verified = 0`.
- **R21** whitespace-only provenance (spaces / TAB / LF) → identical abort.
- **R22** valid provenance → **accepted** (rc=0), read-back
  `1 | operator:rutger | ownership review 2026-09-21, docs/claim-flow.md#ownership`.
- **R23** mechanism-absent control: the *same* statement on the pre-0007 schema is **accepted**
  (rc=0, read-back 1). So the block is caused by 0007's trigger — not by a CHECK that would have
  refused anyway. Success and failure both discriminate.

## What 0006/0007 actually changed (exact, from the seeded fixture)

Changed values: 3 businesses (`verified 1→0`, `verified_at → NULL`, `updated_at` refreshed),
3 profile_overrides (`published 1→0`, `claim_generation → NULL`, `updated_by → migration-0007`),
3 owner_sessions (`approval_generation → -1`). Appended: 6 `ownership_quarantine_log` rows,
3 `registry_events`, 3 `profile_edit_events`. Deleted: **nothing**.

## Observations for the reviewer (not blockers)

1. **`verified_at` is destroyed in the migrated row and is preserved nowhere else.** 0006 sets
   `verified_at = NULL`; the 0007 quarantine log records `updated_at` for publications and
   `created_at/expires_at/used_at` for credentials, but never the old `verified_at`. The only copy
   is the pre-migration backup. That is a deliberate policy choice per the migration comment, and
   in this fixture the values are recoverable (R19) — but the production cutover must capture an
   export **before** applying, or the original approval timestamps are gone for ever.
2. **`claim_requests` is not quarantined by 0007.** It quarantines `owner_sessions` only. A
   pending claim row carries `code_pending` (the plaintext code) and survived this rehearsal
   intact and redeemable through the old verify path. Impact is bounded by the 15-minute TTL and
   by 0006 having already removed the automatic `verifyBusiness` step — recorded as a residual
   observation, not a finding against the fixture.
3. **Local D1 identity is deterministic, not random**: the DB file hash produced by this
   fixture (`e7352547…`) is the same file name the prior gate's *runtime* created — i.e. the
   identity follows `database_id`/`database_name`, which is why setting `database_id = "DB"`
   makes `d1 migrations apply` and the runtime converge. Keep that in the rehearsal procedure.
4. **The WAL nuance from the prior report did not reproduce here** (the WAL was 0 bytes at
   backup time, because the last writer before the snapshot was the `sqlite3` CLI seed, which
   checkpoints on close). Using `sqlite3 .backup` sidesteps the "restore main+wal+shm as a set"
   trap entirely; that trap still applies to anyone copying files by hand while workerd holds the
   last write. Not re-exercised here — stated as scope, not as a pass.

## Blockers / migration data loss

**None.** No row was lost and no unintended value changed; the only mutations are the intended
ones listed above. No blocker is recorded for task one.

## Task two — release-readiness discovery (READ ONLY, LIVE)

Local state: branch `analytics-fix16` @ `e2090dfa842f5baa3ed1faad059fd800b0a6a896`,
38 porcelain entries (37 at the prior gate); the single working-tree entry created **this**
session is this report (mtime 11:17:12 CEST). The UI files and status docs the earlier rounds
touched carry mtimes 11:03–11:04 CEST, i.e. **before** this session started at 11:15:50 CEST.

Remote (`gh`, account `raitgerb`, scopes repo/read:org/gist):

- `origin/main` HEAD = `10ab9621f533f9b8351dd48c7af60ac7118c231d`, pushed 2026-09-21T08:57:43Z —
  "Analytics: repair the loader's foreign-SDK ownership boundary (reviewed candidate 7f231e76)".
- **PR #4 MERGED** at 08:57:43Z, head `analytics-release/bc-loader`, required check
  "Cloudflare Pages" = SUCCESS. PR #3 and #2 merged 2026-09-20. **PR #1 is still OPEN**
  (`cloudflare/workers-autoconfig`, stale noise).
- Branch protection `main`: `strict = true`, required check `["Cloudflare Pages"]`,
  `enforce_admins = true`, force-push denied, deletion denied, required approvals = 0.

**The decisive fact: the ownership gate is not on `origin/main`.** `migrations/0006`, `0007`,
`functions/_lib/provenance.ts` and the two ownership test scripts are **untracked** in the local
tree; `origin/main` carries only the analytics work. So production today runs the **old** claim
code against the **old** schema, and the whole ownership change (schema + code) is still
uncommitted local work — 38 entries that must be committed from an isolated worktree, not from
this shared checkout (other workers' edits are mixed into the same files).

### Recommended cutover / quiescence strategy (for Agrippa to authorize)

1. **Do not open the PR before the migration decision** — preview and production share one D1
   database, so a preview deployment of the feature branch would run the NEW code against the
   OLD schema and 500 the owner paths. Apply the migration first, or open the PR only after it.
2. **Order: export → quiesce → apply 0006+0007 to production D1 → merge → verify.** Migration
   before code is the safe direction: the two triggers make the old code *fail closed*
   (`UPDATE businesses SET verified = 1` aborts) instead of silently re-opening the original
   defect. The reverse order leaves new code reading columns that do not exist.
3. **Quiesce the claim/verify write path for the window.** Between the migration and the merge,
   live `/api/claim/verify` will return a 500 rather than granting a badge. Production measured
   zero claimed/zero verified rows (per 0006's own note), so the practical blast radius is ~0 —
   but the window should still be short and off-peak.
4. **Take a real production backup first.** `verified_at` is unrecoverable after 0006 (see
   observation 1). Use a D1 export/time-travel bookmark captured immediately before the apply,
   and record its identifier in the release receipt.
5. **Rollback reality**: migrations are forward-only and `main` is protected (no force-push,
   no history rewrite). Application rollback = revert commit + squash-merge. **Database rollback
   = restore the pre-apply export/bookmark only** — there is no down-migration. This is the
   single largest release risk and must be stated as "restore from export", never "revert the
   migration".
6. **Acceptance is not implied** by any of the above. This report is a local synthetic
   rehearsal; production application, deploy verification and acceptance stay with Agrippa.

## Evidence-integrity note (flagged, not resolved)

The prior report states "Started 2026-09-21T09:10Z. Finished ~09:26Z. ≈16 min wall" and
discloses a budget overrun. **The artifact timestamps do not support 16 minutes**: its own report
file was last written at 09:14:37Z and its last script at 09:13:38Z — about 4.6 minutes after the
stated start, and roughly a minute *before* this session began (09:15:50Z). The evidence
available to me is consistent with a ~4–5 minute run, not 16. Recorded as an unresolved
discrepancy for the coordinator; I did not have access to the prior run's start source.
By contrast, every duration in this report is derived from the timestamp table above.

## Artifacts

`/tmp/bc-migrh-20260921-0917-7f3a2b/` (not durable) — persisted copies in
`/Users/agrippa/Projects/barcelona-compare/.hermes/handoffs/2026-09-20-improvements/ownership-migration-rehearsal-20260921/`
and mirrored to `/Users/agrippa/.hermes/handoffs/2026-09-20-improvements/ownership-migration-rehearsal-20260921/`.

sha256 (source): verify.py `63112b42…8d6c539` · runtime-check.py `b1a9683d…383fd6a` ·
seed.sql `3db1e4e4…0682ded` · step1.sh `508be65e…09824d2` · step2.sh `cd53f7a5…b9b42eb` ·
pre-migration-dump.json `9a6db6dc…603913` · backup `16267248…0c0af6e4`.
Persisted: checks-post.txt `6748877c…f36283` · checks-pre.txt `7cf81f54…2edbc66` ·
post-meta.json `8e5fea36…4e69991` · pre-meta.json `a13c5ada…3cbb8f` ·
runtime-readback.json `8dd97c21…d25f2d0`.

Canonical tree check: HEAD unchanged at `e2090dfa…`; no add/commit/stash/checkout/push; no
install; no cloud/API/mail/credential access; no production query or export.

## What is NOT proven here

- Production D1: not queried, not exported, not migrated. Any production claim is UNVERIFIED.
- The provenance trigger was exercised through the **sqlite3** engine (schema-level invariant).
  Its runtime twin `functions/_lib/registry.ts#isOwnershipApproved` is exercised by the earlier
  lifecycle gate, not by this slice.
- The two `ownership-lifecycle-test.cjs` rewrites mentioned in the handoff were not re-run here.
- Mobile/keyboard/screen-reader acceptance, analytics read-back, R2, cron: untouched.

## Next owner: Agrippa

1. Independent review of this rehearsal (the fixture, `verify.py` and the seeded rows are in the
   handoff dir — re-runnable, `step1.sh` then `step2.sh`, no destructive cleanup).
2. Commit the ownership work from an **isolated worktree** (not this shared checkout) and open
   the release PR after the production backup decision.
3. Own the production export → quiesce → migrate → merge → verify sequence and the release
   receipt. **Exact next blocker: the ownership change is uncommitted local work (38 porcelain
   entries) not present on `origin/main`; there is no committed candidate to release yet, and no
   production export exists for rollback.**
