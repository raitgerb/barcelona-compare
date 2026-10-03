#!/usr/bin/env node
/**
 * Focused regression checks for the static UI correction slice.
 *
 *   node scripts/ownership-ui-regression.cjs [rootDir]
 *
 * Default rootDir is the canonical repo this file lives in. Because the root is
 * a parameter, the SAME suite can be pointed at a deliberately mutated copy of
 * the tree to prove it discriminates (see the negative controls in
 * docs/ownership-ui-correction-status.md). A suite that cannot fail proves
 * nothing, so every check here is an assertion about a defect that was actually
 * observed, not a restatement of whatever the file happens to say.
 *
 * No dependencies, no network, no DOM: pure source inspection. It does not run
 * a browser and does not prove rendering; it proves the guards that the browser
 * QA depends on are present and wired.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let passed = 0;
const failures = [];
function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const result = fn();
    ok = result === true;
    if (typeof result === 'string') detail = result;
  } catch (error) {
    detail = error.message;
  }
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const nav = read('src/layouts/BaseLayout.astro');
const owner = read('src/components/OwnerEditor.astro');
const claim = read('src/components/ClaimFlow.astro');

console.log(`root: ${root}`);
console.log('shared navigation (BaseLayout.astro)');

check('nav bar wraps instead of clipping', () =>
  /class="[^"]*flex-wrap[^"]*"/.test(nav.match(/<nav class="([^"]+)"/)?.[0] || '')
    ? true
    : 'the <nav> class list has no flex-wrap');

check('nav bar grows vertically for the wrapped lines', () =>
  /<nav class="[^"]*min-h-16[^"]*py-2[^"]*"/.test(nav)
    ? true
    : 'nav must use min-h-16 + py-2 so wrapped rows are not overlapped');

// Token-exact on purpose: a `\bh-16\b` regex also matches `min-h-16` (the `-`
// is a non-word char, so the boundary sits between `-` and `h`), which made an
// earlier version of this check pass on the unfixed file.
check('nav bar no longer pins a fixed 64px height', () => {
  const cls = nav.match(/<nav class="([^"]+)"/)?.[1] || '';
  return cls.split(/\s+/).includes('h-16') ? 'still has fixed h-16' : true;
});

check('nav bar has a row/column gap for wrapped rows', () =>
  /<nav class="[^"]*gap-x-4[^"]*gap-y-1[^"]*"/.test(nav) ? true : 'missing gap-x/gap-y');

check('navigation links do not break mid-word', () =>
  (nav.match(/whitespace-nowrap text-stone-600 hover:text-stone-900 transition-colors/g) || []).length >= 1
    ? true
    : 'nav links lost whitespace-nowrap');

check('overflow is NOT hidden as a substitute for fitting', () =>
  /overflow-hidden|overflow-x-hidden|truncate/.test(nav) ? 'found overflow/truncate hiding' : true);

check('all four nav items and the locale switcher survive', () => {
  const items = (nav.match(/key: 'nav\.[a-z]+'/g) || []).length;
  const hasLang = /aria-label="Language"/.test(nav);
  return items === 4 && hasLang ? true : `nav items=${items} locale=${hasLang}`;
});

check('locale links still point at real localized paths', () =>
  /hreflang={l}/.test(nav) && /localePath\(l, bare\)/.test(nav)
    ? true
    : 'locale switcher lost its localized href');

console.log('owner editor — malformed email (OwnerEditor.astro)');

check('localized malformed-email copy exists in BOTH locales', () => {
  const es = /needEmailMalformed: 'Ese email/i.test(owner);
  const en = /needEmailMalformed: 'That email/i.test(owner);
  return es && en ? true : `es=${es} en=${en}`;
});

check('sendCode validates the address shape', () =>
  /const EMAIL_SHAPE = \/\^\[\^@\\s\]\+@\[\^@\\s\.\]\+\\\.\[\^@\\s\.\]\+\$\//.test(owner)
    ? true
    : 'EMAIL_SHAPE pattern missing');

check('the guard runs BEFORE any network call', () => {
  const guard = owner.indexOf('EMAIL_SHAPE.test(email)');
  const call = owner.indexOf("api('/api/owner/session'");
  if (guard === -1 || call === -1) return `guard=${guard} call=${call}`;
  return guard < call ? true : 'the request is still issued first';
});

check('invalid input is not submitted', () => {
  const body = owner.slice(owner.indexOf('async function sendCode()'), owner.indexOf('async function verify()'));
  const guardBlock = body.slice(body.indexOf('EMAIL_SHAPE.test(email)'));
  return /return;/.test(guardBlock.slice(0, 300)) ? true : 'guard does not return early';
});

check('the field is marked invalid for assistive tech', () =>
  /setAttribute\('aria-invalid', 'true'\)/.test(owner) ? true : 'aria-invalid never set');

check('the field is un-marked once the address is well formed', () =>
  /removeAttribute\('aria-invalid'\)/.test(owner) ? true : 'aria-invalid never cleared');

check('feedback is announced (role=status / polite / atomic)', () =>
  /id="owner-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/.test(owner)
    ? true
    : '#owner-status is missing its live-region attributes');

check('the malformed branch reports in the active language', () =>
  /status\(APP\.copy\.needEmailMalformed, 'error'\)/.test(owner)
    ? true
    : 'feedback is not localized');

check('original empty-field messages retained', () =>
  /status\(APP\.copy\.needBusiness, 'error'\)/.test(owner) && /status\(APP\.copy\.needEmail, 'error'\)/.test(owner)
    ? true
    : 'pre-existing validation messages were dropped');

check('valid submission path retained end to end', () =>
  /await api\('\/api\/owner\/session', \{ method: 'POST', body: \{ business, email, lang: APP\.lang \} \}\)/.test(owner)
    ? true
    : 'the POST body changed or vanished');

check('server-error handling retained', () =>
  /catch \(error\) \{\s*status\(errorText\(error\), 'error'\);/.test(owner) ? true : 'error branch lost');

console.log('claim flow — empty-result live status (ClaimFlow.astro)');

check('no-results node is a live region', () =>
  /id="claim-no-results"[^>]*role="status"[^>]*aria-live="polite"/.test(claim)
    ? true
    : '#claim-no-results is not announced');

check('no-results message stays localized', () =>
  /id="claim-no-results"[^>]*>\{copy\.noResults\}</.test(claim) ? true : 'copy.noResults no longer rendered');

check('the empty branch toggles the announced node', () => {
  const block = claim.slice(claim.indexOf('async function search('), claim.indexOf('async function postJson('));
  return /if \(!matches\.length\) \{[\s\S]*?noResults\.classList\.remove\('hidden'\)[\s\S]*?return;/.test(block)
    ? true
    : 'empty-result branch no longer reveals #claim-no-results';
});

check('the empty branch does not render stale rows', () => {
  const block = claim.slice(claim.indexOf('async function search('), claim.indexOf('async function postJson('));
  const cleared = block.indexOf("results.innerHTML = ''");
  const branch = block.indexOf('if (!matches.length)');
  return cleared !== -1 && cleared < branch ? true : 'results list is not cleared before the empty branch';
});

check('original claim guards retained (invalid_email + no request)', () =>
  /if \(!\/\^\[\^@\\s\]\+@\[\^@\\s\.\]\+\\\.\[\^@\\s\.\]\+\$\/\.test\(value\)\) \{\s*showError\('invalid_email'\);/.test(claim)
    ? true
    : 'claim email guard was weakened');

check('original error surface retained', () =>
  /id="claim-error"[\s\S]{0,200}role="alert"/.test(claim) ? true : '#claim-error lost role=alert');

check('no mock/short-circuit introduced into either component', () =>
  /__mock|mockFetch|MOCK_|testMode|stubResponse/.test(owner + claim)
    ? 'mock hook found in shipped component'
    : true);

console.log('');
if (failures.length === 0) {
  console.log(`RESULT: PASS — ${passed} checks, 0 failures`);
  process.exit(0);
}
console.log(`RESULT: FAIL — ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(1);
