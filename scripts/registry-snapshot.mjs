#!/usr/bin/env node
/**
 * Refresh the committed verified-registry snapshot used as the badge fallback
 * when a build cannot reach the registry API (see src/lib/registry.ts).
 *
 * Usage:
 *   npm run registry:snapshot                       # production registry
 *   npm run registry:snapshot -- <registry-api-url>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_URL = 'https://barcelonacompare.com/api/registry?status=verified';
const url = process.argv[2] || process.env.REGISTRY_BADGE_URL || DEFAULT_URL;
const outPath = new URL('../src/data/registry-verified.json', import.meta.url);

const response = await fetch(url, { headers: { accept: 'application/json' } });
if (!response.ok) {
  console.error(`registry snapshot failed: HTTP ${response.status} from ${url}`);
  process.exit(1);
}

const body = await response.json();
const businesses = (Array.isArray(body?.businesses) ? body.businesses : [])
  .filter((row) => row && typeof row.placeId === 'string' && (row.verified === true || row.verified === 1 || row.verified === '1'));

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: url,
  businesses,
};

await mkdir(dirname(outPath.pathname), { recursive: true });
await writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`registry snapshot: ${businesses.length} verified business(es) -> src/data/registry-verified.json`);
