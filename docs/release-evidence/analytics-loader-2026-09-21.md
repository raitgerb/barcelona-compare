# Release evidence — BarcelonaCompare analytics loader repair (2026-09-21)

Worker: Builder (bounded, no children, DeepSeek Flash). Coordinator/continuation owner: Agrippa.
Owner: Rutger. Modules WEB DATA EXTERNAL ANALYTICS AUTOMATION. Maturity PUBLIC.
Isolated worktree: /Users/agrippa/dashboard/analytics-listener-fix/barcelona-release/worktree (canonical checkout NOT touched or built).
Result/checkpoint file: /Users/agrippa/dashboard/analytics-listener-fix/barcelona-release/result.md
Brief: ~/.hermes/tasks/analytics-barcelona-ship.txt — prior result ../result.md

## 1. Owner approval (recorded verbatim)

Rutger, Discord thread 1551271418543734866, 2026-09-21: **"I approve that bounded exception."**

Exact scope as given: BarcelonaCompare-ONLY bounded exception, **one** analytics repair release, for
**pre-existing foundation gaps unrelated to the loader**. Remains documented open; **review due 2026-09-28**.
Mandatory and **never exempt**: analytics privacy/consent checks, independent review, required CI, rollback,
live verification. No database, collector, credential or infrastructure change. FCF security-first unchanged
(no FCF change in this release). Coordinator Agrippa owns the attached continuation.

## 2. What the exception does and does not cover

The mechanical contract was read from the validator source, not guessed
(`/Users/agrippa/project-foundations/scripts/project_preflight.py`): release accepts requirement states
`VERIFIED` or `EXEMPT` (`RELEASE_ACCEPTABLE_STATES`); an `EXEMPT` requirement must carry real, non-placeholder
`reason`, `approved_by` and `review_date` strings (failure code `requirement_exempt_unauthorized`). There is no
`safeguards`/`approval_reference` key in the requirement schema, so those facts are additionally carried in
extra keys (`safeguards`, `approval_reference`) and inline in `reason`.

| Requirement | State | Why |
| --- | --- | --- |
| B01, B02 | VERIFIED | unchanged, evidence already recorded |
| B03 | EXEMPT | D1/R2 export-recovery gap; unrelated to a static loader |
| B04 | EXEMPT | stale prose in a PROTECTED instruction file; unrelated remainder only |
| B05 | EXEMPT | unpinned Python collector deps, no CI workflow, no 0006 migration; unrelated remainder only |
| B06 | EXEMPT | no in-repo CI workflow; no prior receipt/rollback record; unrelated remainder only |
| B07 | EXEMPT | Places cost-guard holes + D1 email retention; unrelated remainder only |
| B08 | EXEMPT | no D1/R2 backup-restore; unrelated remainder only |
| B09 | EXEMPT | no promoted regression checks for unrelated defects F01–F10 |
| WEB | EXEMPT | site-wide mobile/a11y certification never done; unrelated remainder only |
| DATA | EXEMPT | registry/claim data-plane gaps; **no DB change in this release at all** |
| EXTERNAL | EXEMPT | Places rights/quota gaps; no external call in this release |
| AUTOMATION | EXEMPT | unguarded legacy collectors; no job/cron/scheduler added |
| ANALYTICS | VERIFIED | change-scoped evidence for the exact candidate revision (§4) |

Every pre-existing `detail` field is preserved verbatim in the declaration. **No GAP was deleted and no
GAP was flipped to VERIFIED.** `ANALYTICS` is VERIFIED for this change only and explicitly does not claim
the production readback in advance.

## 3. The change

- Candidate: `foreign-repair/source/portfolio-analytics.candidate-final.js`
  sha256 `7f231e76d757511d370f025f70683ed78888e39c865ef4dacd0c948eedd8dea9` (bytes unchanged; hash re-verified this session).
- Repo path: `public/js/portfolio-analytics.js` — same sha256 after copy; the only source change in this release.
- Pre-change live asset (`https://barcelonacompare.com/js/portfolio-analytics.js`) sha256
  `e3325f6efdea855300cb2a41da609f63c3c40ba23876df255b4f85a918267685` = origin/main version, i.e. the repair was not deployed before this release.
- Carried over, prior-approved, not authored here: `AGENTS.md` `## Project Standard` block (+7 lines,
  2026-09-20 owner-approved protected edit) and `docs/project-standard.json`. No other AGENTS.md edit.
- Generated `.astro/content-assets.mjs` drift from the build was reverted, not committed.

## 4. Evidence by gate

- **BUILT**: real `npm run build` executed in the isolated worktree on this revision → complete `dist/`
  with 4,957 HTML files; `dist/js/portfolio-analytics.js` sha256 `7f231e76…` identical to the candidate.
  (An earlier build attempt at 09:47 failed with `ENOSPC: no space left on device`; disk was free again
  before this build — recorded because the earlier `dist/` was a partial artifact.)
- **TESTED**: exact candidate → `168/168 assertions passed, 0 failed` (clean) and `168/168` (with the FCF
  banner fixture). Evidence: `foreign-repair/final-verification/suite-clean-final.log`,
  `suite-fcf-final.log`, `parent-acceptance.json`.
- **TESTED (discrimination — the suite is not green by construction)**: three mutation controls bound to
  recorded mutant sha256 values failed exactly their expected assertions —
  M1 `162/168` (T1,T2,T4,T5,T7,T10), M2 `162/168` (U1–U6), M3 `167/168` (V3);
  `parent-acceptance.json` `all_expected: true`, `source_sha256` = the candidate.
  *Papercut, recorded honestly*: the first M1 control run timed out (`suite-M1-init-success-not-verified.log`
  contains a `TimeoutError`); the accepted M1 artifact is the corrected run, and the accepted row names its
  own log file so the substitution is visible rather than hidden.
- **REVIEWED**: independent closure review of the exact candidate revision, log
  `~/.hermes/tasks/analytics-final-closure-review.log` (session `20260921_000752_9280f4`), verdict 9/10,
  reset-cleanup and failed-init ownership findings CLOSED. The review's own "next steps" say release
  preflight, authority and the page-level audit are separate gates not implied by that static approval —
  they are treated separately here.
- **MERGED / DEPLOYED / LIVE / PROVIDER-VERIFIED**: not claimed at the time this record was committed.
  These are the release's mandatory post-merge steps (below) and are recorded in
  `data/release-receipt.json` and `../result.md` when actually observed.

## 5. Rollback and required gate

- Rollback target, captured by Cloudflare API readback **before** the release: production deployment
  `a4795c83-22a4-47bc-8f20-093d7505e827`, commit `ce34124209947caaaff9c9f667cb068de81d4c5b`,
  alias `https://barcelonacompare.com`, `latest_stage` deploy/success. Rollback = revert commit on a new
  branch merged to protected main (no force-push, no history rewrite).
- Required CI: protected `main` requires a pull request and the Cloudflare Pages check, with admin
  enforcement on. No admin bypass is used. Merge is authorized only once review and the required check pass.

## 6. Mandatory live verification still owed at commit time (never exempt)

1. Pages API readback: deployed commit hash == merged commit; deployment id recorded.
2. `https://barcelonacompare.com/js/portfolio-analytics.js` sha256 == `7f231e76…` (served bytes, not a status code).
3. Browser consent gate on the live host: no send before an affirmative grant; withdrawal honoured; a
   consented, provider-tagged event read back through the existing analytics verification tooling
   (`scripts/analytics-smoke.sh` / the D1 `/api/track` readback path) without disclosing credentials.

Until 1–3 are observed, this change is **PREPARED/TESTED/REVIEWED, not DEPLOYED and not VERIFIED live**.
