import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPrivateDashboardRoute } from './sitemap-routes.mjs';

const root = process.cwd();
const sitemapPath = join(root, 'dist', 'sitemap-0.xml');
const fail = (message) => {
  console.error(`sitemap-check: FAIL — ${message}`);
  process.exitCode = 1;
};

if (!existsSync(sitemapPath)) {
  fail('dist/sitemap-0.xml is missing; run npm run build first');
} else {
  const sitemap = readFileSync(sitemapPath, 'utf8');
  const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const privateRoutes = ['/gestion/', '/gestion/example/', '/en/manage/', '/en/manage/example/'];
  const publicRoutes = [
    '/nails/lin-hua-korean-nails/',
    '/en/nails/lin-hua-korean-nails/',
    '/ca/nails/lin-hua-korean-nails/',
  ];

  for (const route of privateRoutes) {
    if (pages.some((page) => page.endsWith(route))) {
      fail(`private dashboard route remains in sitemap: ${route}`);
    }
  }
  for (const route of privateRoutes) {
    if (!isPrivateDashboardRoute(`https://barcelonacompare.com${route}`)) {
      fail(`private dashboard fixture is not excluded: ${route}`);
    }
  }
  for (const route of publicRoutes) {
    if (!pages.some((page) => page.endsWith(route))) {
      fail(`public control route missing from sitemap: ${route}`);
    }
  }
}

if (process.exitCode !== 1) {
  console.log('sitemap-check: PASS (dashboard roots and variants absent; ES/EN/CA public detail routes present)');
}