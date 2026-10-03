# Ownership static-UI correction — status (Builder, bounded slice)

Status as of 2026-09-21 (host time Europe/Madrid, run 09:01Z–09:0xZ).
Slice: three static UI defects from the browser-QA round. **NO DEPLOYMENT, NO GIT MUTATION.**
Coordinator/release owner: Agrippa session20260910_204639_71433f8a.
Concurrent writer respected: builder PID 20523 (session20260921_104348_566297, analytics PR4
production verification) — verified still alive at close, its resources untouched, nothing deployed.

## Evidence labels used below
LIVE = ran here with real output · PREPARED = written, not executed · UNTESTED = not run · BLOCKED = attempted, refused.

## 1. Fixes applied (LIVE)
| File | Change | sha256 before → after |
|---|---|---|
| `src/layouts/BaseLayout.astro` | shared header/nav: `flex-wrap`, `min-h-16 py-2`, `px-3 sm:px-4`, `gap-x-4/6 gap-y-1`, brand `text-lg sm:text-xl` + `whitespace-nowrap`, nav links `whitespace-nowrap` | `4685534…d06c1` → `bcbbde1ee4f5b833d05d3b7d461a4dfc4133dcde8d0b5f5468e3141c712be17e` |
| `src/components/OwnerEditor.astro` | malformed-email guard before any request + localized copy + `aria-invalid` + live-region hardening | `85c26fa…dd1b0b` → `66ec80d48c961bc24963d871c881d6fcda71e9ad0542419a16a41be9a9d04b5f` |
| `src/components/ClaimFlow.astro` | empty-result node becomes a live status region | `d134425…54190` → `5d9b285b76c2269b7e45ee976259612e98434c43b627e40f1349ec4cdfb8cdba` |

Full "before" hashes: `/tmp/bc-ui-before.txt`. Apply script (deterministic, asserts each anchor
matches exactly once): `/tmp/bc-ui-apply.py` — all 7 edits reported `OK`, none partial.

### Navigation path (established before editing, as required)
There is **no separate Header component**. The shared navigation is inline in
`src/layouts/BaseLayout.astro` lines 96–132: `<header>` → `<nav class="… px-4 h-16 flex items-center
justify-between">` → brand `<a>` + `<div class="flex items-center gap-6 …">` holding four
`navItems` (Home, Nails, Massage, Barrios) plus the `<span aria-label="Language">` locale switcher.
Root cause of the overflow: a fixed `h-16` bar that could not wrap, so the longer EN strings
(Nail salons / Massage / Neighbourhoods) had nowhere to go — hence EN 159px vs ES 76px.
The fix makes the bar wrap and grow; **no `overflow-hidden`, `truncate` or clipping was introduced**,
and the regression suite fails if one is (see negative control M2).

### Owner editor defect
`sendCode()` validated only that the fields were non-empty. The email input is `type="email"` but
the send button is a plain click handler (not a form submit), so the browser's native validation
never ran and a malformed address reached `POST /api/owner/session`. Now a single shape test
(`EMAIL_SHAPE`, the same regex the claim flow uses) runs first: no request, localized feedback in
the active locale (`needEmailMalformed` es+en), `aria-invalid="true"` on the field, focus moves
there. `#owner-status` was already `role="status" aria-live="polite"`; `aria-atomic="true"` added.

### Claim flow defect
`#claim-no-results` was shown/hidden visually with no live-region semantics, so the empty result
set was silent to screen readers. It is now `role="status" aria-live="polite" aria-atomic="true"`,
and the existing empty branch still clears stale rows before revealing it.

## 2. Tests (LIVE)
New focused suite: `scripts/ownership-ui-regression.cjs` (node, no deps, no network, no DOM).
Takes a root argument so it can be pointed at mutated copies.
sha256 `b3b68d795eff05750abb92daa4da8bc603fc2a3ba15a17775c94746d0ea7b65f`.

```
node scripts/ownership-ui-regression.cjs      → exit 0 · RESULT: PASS — 26 checks, 0 failures
```

Negative controls (`/tmp/bc-ui-negative-controls.py`, isolated `/tmp/bc-ui-neg/`, canonical tree
untouched; raw JSON `/tmp/bc-ui-neg/negative-controls.json`) — **exit 0, ALL OK**:

| Mutant | Expected failures | Observed |
|---|---|---|
| `nav-reverted` (restore `h-16`, drop wrap) | 2+ | FAIL, 4 hits incl. both expected |
| `nav-overflow-hidden` (the forbidden shortcut) | 1 | FAIL, exactly the overflow check |
| `owner-guard-removed` (delete the email guard) | 3 | FAIL, 4 hits incl. all 3 expected |
| `claim-not-live` (drop the live-region attrs) | 1 | FAIL, exactly the live-region check |
| pristine fixed tree (control) | must PASS | PASS |

`node --check` on the extracted `OwnerEditor.astro` client script → **exit 0** (the edited JS parses).

### A defect in my own test, found and fixed
The first version of the "no fixed 64px height" check used `\bh-16\b`, which **also matches
`min-h-16`** (`-` is a non-word character), so it failed on the corrected file. Rewritten to split
the class list into tokens and test membership. The mutant `nav-reverted` now hits it correctly.
Recorded because a check that cannot distinguish the fix from the defect is not evidence.

## 3. Gates NOT established (honest gaps)
- **UNTESTED — no build, no typecheck, no browser run in this slice.** The invocation capped this
  run at 300s/22 turns, and the canonical tree must not be built (shared generated state, another
  writer active). An isolated `/tmp` snapshot excluding `.git`, secrets and `.wrangler/state` with
  a symlinked `node_modules` is the next step; `npx astro check` previously reported 0 errors for
  these two components and the full build was 4957 pages.
- **UNTESTED — the 390px fit is not measured, only structurally asserted.** The suite proves the
  bar wraps, grows and does not clip; proving ES/EN headers *fit* at 390px needs a real render
  (the original QA measured ES 76px / EN 159px overflow). Do not read the green suite as a
  measurement.
- **UNTESTED — malformed-email "no request" is proved by source order, not by intercepting a
  live request.** A browser run with a request counter is still owed. No API was mocked and no
  mail was sent at any point.
- **UNTESTED — screen-reader behaviour** is not certified; only the correct ARIA wiring is asserted.
- **UNCHANGED / OUT OF SCOPE** — authenticated journeys, D1/workerd runtime, migrations, and every
  other pre-existing defect. Pagination overflow and unnamed select controls from the same QA round
  were not in this slice and remain open.

## 4. Preservation / boundary compliance
`git status --porcelain` before this slice: 34 entries. After: 36 — the only additions are
`M src/layouts/BaseLayout.astro` (my nav fix; this file was clean before) and the new untracked
`scripts/ownership-ui-regression.cjs`. Every prior uncommitted ownership correction
(functions/*, migrations/*, smoke scripts, docs/*, `.astro/content-assets.mjs`) is byte-untouched.
No git add/commit/checkout/stash, no installs, no network, no credentials, no analytics edits,
no `.wrangler/state` access, no canonical build, no deployment. $0 external services.

## 5. Next owner
Agrippa: independent review of this exact candidate (hashes above), then isolated build +
typecheck, then the 390px browser measurement and the request-count check, then the
runtime/migration/release continuation. The nav fix and the two component guards are independent
of the ownership/auth work and can be reviewed separately from it.
