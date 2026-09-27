import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const failures = [];

function fail(message) {
  failures.push(message);
}

function artifactPath(href) {
  const pathname = decodeURIComponent(new URL(href, 'https://barcelonacompare.com').pathname);
  const relative = pathname.replace(/^\//, '');
  return path.join(root, relative, 'index.html');
}

function routeIdentity(route) {
  return route === '/' ? '/' : route.replace(/\/+$/, '');
}

function readRoute(route) {
  const file = route === '/' ? path.join(root, 'index.html') : artifactPath(route);
  if (!fs.existsSync(file)) {
    fail(`${route}: missing artifact ${file}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function count(html, pattern) {
  return [...html.matchAll(pattern)].length;
}

function assertRoute(route, expectedLang, expectedTargets) {
  const html = readRoute(route);
  if (!html) return;

  const selector = html.match(/<details\b[^>]*class="relative group"[\s\S]*?<\/details>/);
  if (!selector || count(html, /<details\b[^>]*class="relative group"/g) !== 1) fail(`${route}: selector count is not 1`);
  const selectorHtml = selector?.[0] || '';
  if (count(selectorHtml, /aria-current="page"/g) !== 1) fail(`${route}: current-language marker count is not 1`);
  if (!selectorHtml.includes('<summary')) fail(`${route}: missing keyboard/no-JS summary`);
  if (!selectorHtml.includes('<nav aria-label="Choose language"')) fail(`${route}: missing language nav`);
  if (count(html, /<link\b[^>]*rel="canonical"/g) !== 1) fail(`${route}: canonical count is not 1`);
  if (count(html, /<link\b[^>]*rel="alternate"[^>]*hreflang="(?:es|en|ca)"/g) !== expectedTargets.length) {
    fail(`${route}: hreflang count does not match ${expectedTargets.length}`);
  }
  if (!html.includes(`<html lang="${expectedLang}"`)) fail(`${route}: wrong html lang`);

  const hrefs = [...selectorHtml.matchAll(/<a\b[^>]*hreflang="(?:es|en|ca)"[^>]*>/g)]
    .map(match => match[0].match(/\bhref="([^"]+)"/)?.[1])
    .filter(Boolean);
  const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/);
  const targetPaths = new Set(hrefs.map(routeIdentity));
  if (canonical) targetPaths.add(routeIdentity(new URL(canonical[1]).pathname));
  for (const target of expectedTargets) {
    if (!targetPaths.has(routeIdentity(target))) fail(`${route}: language target ${target} missing`);
  }
  if (html.includes('href="/manage/"') || html.includes('href="/en/gestion/"')) fail(`${route}: stale owner route emitted`);
  for (const href of hrefs) {
    if (!fs.existsSync(artifactPath(href))) fail(`${route}: language target missing artifact ${href}`);
  }
}

const representativeRoutes = [
  ['/', 'es', ['/', '/en', '/ca']],
  ['/en/', 'en', ['/', '/en', '/ca']],
  ['/ca/', 'ca', ['/', '/en', '/ca']],
  ['/nails/', 'es', ['/nails', '/en/nails', '/ca/nails']],
  ['/en/nails/', 'en', ['/nails', '/en/nails', '/ca/nails']],
  ['/ca/nails/', 'ca', ['/nails', '/en/nails', '/ca/nails']],
  ['/gestion/', 'es', ['/gestion/', '/en/manage/']],
  ['/en/manage/', 'en', ['/gestion/', '/en/manage/']],
];

for (const [route, lang, targets] of representativeRoutes) assertRoute(route, lang, targets);

const builtFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath);
    else if (entry.name === 'index.html') builtFiles.push(entryPath);
  }
}
walk(root);

let menuCount = 0;
for (const file of builtFiles) {
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes('<details class="relative group"')) continue;
  menuCount += 1;
  const selector = html.match(/<details\b[^>]*class="relative group"[\s\S]*?<\/details>/)?.[0] || '';
  const hrefs = [...selector.matchAll(/<a\b[^>]*hreflang="(?:es|en|ca)"[^>]*>/g)]
    .map(match => match[0].match(/\bhref="([^"]+)"/)?.[1])
    .filter(Boolean);
  for (const href of hrefs) if (!fs.existsSync(artifactPath(href))) fail(`${file}: missing language target ${href}`);
}
if (menuCount === 0) fail('full artifact scan: no language selectors found');

if (failures.length) {
  console.error(`language-selector-check: FAIL (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`language-selector-check: PASS (menus=${menuCount}, representative=${representativeRoutes.length}, missing_targets=0)`);