import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const slug = 'noas-secret-l8e9eg';
const retiredRoutes = [
  `massage/${slug}`,
  `en/massage/${slug}`,
  `ca/massage/${slug}`,
];
const controlRoutes = [
  'massage/noas-secret',
  'en/massage/noas-secret',
  'ca/massage/noas-secret',
];

const fail = (message) => {
  console.error(`retired-route-check: FAIL — ${message}`);
  process.exitCode = 1;
};

for (const route of retiredRoutes) {
  if (existsSync(join(root, 'dist', route, 'index.html'))) {
    fail(`retired route still built: /${route}/`);
  }
}

for (const route of controlRoutes) {
  if (!existsSync(join(root, 'dist', route, 'index.html'))) {
    fail(`live control route missing: /${route}/`);
  }
}

const sitemap = readFileSync(join(root, 'dist', 'sitemap-0.xml'), 'utf8');
for (const route of retiredRoutes) {
  if (sitemap.includes(`/${route}/`)) {
    fail(`retired route remains in sitemap: /${route}/`);
  }
}

if (process.exitCode !== 1) {
  console.log('retired-route-check: PASS (3 retired routes absent, 3 live controls built, sitemap clean)');
}