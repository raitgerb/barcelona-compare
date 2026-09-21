# Stage-1 maintenance guard — release evidence (PRE-DEPLOY)

Status of this file: **PREPARED / PRE-DEPLOY.** It records only what was executed
before the PR was opened. Live post-deployment results are recorded OUTSIDE the
committed tree, in `data/` (git-ignored) and in the coordination checkpoint
`docs/ownership-stage1-release.md` of the canonical checkout — deliberately, because
the release receipt must name its own HEAD and a tracked post-deploy edit would move
that HEAD and invalidate the receipt (the circularity is stated, not bypassed).

## Owner intent and authority

- Owner (Rutger), latest: finish and deploy as soon as possible, plus an explicit
  clarify approval **YES** for the safely gated ownership/UI release: unrelated
  pre-existing baseline gaps deferred; gaps block changes to affected systems;
  collection disabled.
- Independent review (Sol session `20260921_113115_5ef4b9`): reviewed HEAD
  `1530d20067c587a3463031e2283125a62ebd1932`, base `ce34124209947caaaff9c9f667cb068de81d4c5b`,
  verdict **PASS guard source, no must-fix**, independently reproduced 1209/0, plus
  review of the compiled Wrangler Functions including `functions/_middleware.ts`
  ordering. Reviewer attribution is preserved here; the reviewer's own tool limit
  prevented it from writing a file, so **no reviewer file exists** and none is claimed.
  Node-harness tests are not live edge proof.

## Bounded review scope

The review above is a **stage-1 deployment** review, **not** a migration review.
Realms explicitly NOT covered: migration correctness, production data handling,
ownership-code deployment, guard removal.

## Source identity (this is what makes the bounded review still valid)

The guard source files are byte-identical to the reviewed commit. Blob SHAs:

    ac3780e477e22b9e10ec891a247e7d4207e0579c  functions/_lib/maintenance-guard.ts
    2b5a2e2d8cc9d29319f284b1046773480e2da2f7  functions/_middleware.ts
    416992570e49bb01ec794c2c65cd6a6d449db081  scripts/guard-register.mjs
    68534a5693a4e2d7acc54b4c50faa50eb6c2a6f2  scripts/guard-resolve.mjs
    8e94a9d33d8be5a43cefad4768c8edfdc3f6d663  scripts/guard-ts-loader.mjs
    d6e35923a7fc7cf3ce380f71d5cd21b2f107c01a  scripts/maintenance-guard-smoke.mjs

sha256 of the same files in the working tree:

    359cc1db1adaf1839c6f2da4920a6a18e4eced4e7960cdd709ff0d2abfae3845  functions/_lib/maintenance-guard.ts
    220bc6b8f1d0f0800ae797c875628872a180ce5260a8e99fb36f0c0926297ade  functions/_middleware.ts
    1428ea4f75f21a7785c096d8b99b84475c211c6a48b1fbcf99c27e691749ebfb  scripts/guard-register.mjs
    65592c61b362cb6e7b56286a16c1a645cd3edba22ee502003eb770945a280d71  scripts/guard-resolve.mjs
    0e883018f6f1840fea7b3ba746cb727e0a9d1a3b796f3b7a0cf32404dbbb54c8  scripts/guard-ts-loader.mjs
    465206d80fd1ce5173afa0fade1608e731e624a601d62f16c318a84df4407b1a  scripts/maintenance-guard-smoke.mjs

The branch was rebased from base `ce341242` onto `origin/main`
`10ab9621f533f9b8351dd48c7af60ac7118c231d` (the commit Cloudflare Pages was serving
in production when the rollback target was captured). The rebase touched no file the
guard review covered: `ce341242..origin/main` changes only `AGENTS.md`,
`docs/project-standard.json`, `docs/release-evidence/analytics-loader-2026-09-21.md`
and `public/js/portfolio-analytics.js` — there is no overlap with `functions/` or
`scripts/`. Verified by blob-SHA equality above, not by assertion.

The rebase is what removed the earlier preflight failures: `origin/main` already
carried the prior-approved `## Project Standard` entrypoint block and
`docs/project-standard.json` (carried over in `10ab9621`). No protected file was
rewritten in this slice.

## Tests actually executed on this tree (Node harness, not live edge proof)

- Positive: `node --import ./scripts/guard-register.mjs scripts/maintenance-guard-smoke.mjs`
  -> **`PASS=1209 FAIL=0`**, exit 0.
  Evidence file `/tmp/bc-guard-evidence-stage1-positive.txt`, sha256
  `7c292ce68a6e69c3ba68c82c94f39c2a733c1fc9b2335de4a7f5b080e446c056` — identical to the
  hash the earlier slice recorded, i.e. reproducible.
- Negative control: the same command with `GUARD_ROOT` set to a copy of `functions/`
  whose `_middleware.ts` is the pre-guard version from `origin/main`
  (zero `maintenance` references), guard module still present so nothing is removed
  from the module graph.
  See the receipt's `tests_evidence_file` for the recorded exit status and output.

## Declaration scoping in this commit

`docs/project-standard.json` was re-scoped from the earlier analytics-loader release
to THIS stage-1 guard release: the bounded exception now names the guard release, the
rollback target was refreshed to the production state captured immediately before
merge (`5772f80c-bcdc-4815-973a-9b6e00cc648c` / `10ab9621`), and the verification
clause now describes the guard checks. Every pre-existing EXEMPT reason is preserved
and each carries an appended `STAGE-1 RELEASE SCOPING` paragraph stating, for the
core security/backup/migration items, that **the gate itself is not deferred** and
why it is not triggered by this release.

Two honest caveats on that declaration, recorded so nobody reads more into it than it
says:

1. `project_preflight` (v1.0.0) accepts only VERIFIED / GAP / UNKNOWN / EXEMPT /
   PROPOSED for a requirement, and the release phase accepts only VERIFIED or
   EXEMPT. There is **no stage-specific N/A state in the tool**. A gate that this
   release does not trigger (no schema change, no data write) therefore cannot be
   encoded as "N/A"; it can only be left EXEMPT (its true project-wide state:
   unsatisfied, owner-deferred to 2026-09-28) or falsely marked VERIFIED. The
   EXEMPT state was kept and the reason text carries the non-deferral. This is a tool
   limitation showing through, not a compliance claim.
2. A passing structural preflight is not semantic compliance and not release
   permission.
