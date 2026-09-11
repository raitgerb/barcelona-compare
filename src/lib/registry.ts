/**
 * Build-time read path for the verified badge (B2B Phase 1).
 *
 * The badge is baked into static HTML from the public registry API
 * (`GET /api/registry?status=verified`, PII stripped, edge-cacheable) and keyed
 * on Google Places ID — the value every business markdown file carries in
 * `googlePlaceId`.
 *
 * A 2.6k-page build must never hinge on one network call, so a failing fetch
 * falls back to the committed snapshot (`src/data/registry-verified.json`,
 * refresh with `npm run registry:snapshot`) and then to "no badges".
 *
 * Env override: REGISTRY_BADGE_URL points at another registry read API (e.g. a
 * local `wrangler pages dev`); the literal value `snapshot` skips the network
 * and reads the committed snapshot only.
 *
 * Docs: docs/business-registry.md
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RegistryBusiness {
  placeId: string;
  slug?: string | null;
  name?: string | null;
  category?: string | null;
  claimed?: number | boolean;
  verified?: number | boolean;
  tier?: 'free' | 'pro' | null;
  claimedAt?: string | null;
  verifiedAt?: string | null;
  updatedAt?: string | null;
}

const DEFAULT_API_URL = 'https://barcelonacompare.com/api/registry?status=verified';
const SNAPSHOT_RELATIVE = 'src/data/registry-verified.json';
const PAGE_SIZE = 500;   // registry API caps limit at 500
const MAX_PAGES = 20;    // hard stop at 10k rows
const FETCH_TIMEOUT_MS = 10_000;

function log(message: string): void {
  console.log(`[registry-badge] ${message}`);
}

function envValue(): string | undefined {
  const fromVite = typeof import.meta !== 'undefined'
    ? (import.meta.env?.REGISTRY_BADGE_URL as string | undefined)
    : undefined;
  const fromNode = typeof process !== 'undefined' ? process.env?.REGISTRY_BADGE_URL : undefined;
  return fromVite || fromNode || undefined;
}

function apiUrl(): string {
  return envValue() || DEFAULT_API_URL;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function asArray(value: unknown): RegistryBusiness[] {
  return Array.isArray(value) ? (value as RegistryBusiness[]) : [];
}

/** Read every verified row, paging until the API stops returning a full page. */
async function fetchFromApi(url: string): Promise<RegistryBusiness[] | null> {
  try {
    const collected: RegistryBusiness[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const target = new URL(url);
      target.searchParams.set('limit', String(PAGE_SIZE));
      target.searchParams.set('offset', String(collected.length));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let body: any;
      try {
        const response = await fetch(target, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        body = await response.json();
      } finally {
        clearTimeout(timer);
      }

      const batch = asArray(body?.businesses);
      collected.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return collected;
  } catch (error) {
    log(`fetch failed (${(error as Error).message}) — falling back to snapshot`);
    return null;
  }
}

async function readSnapshot(): Promise<RegistryBusiness[] | null> {
  // The SSR bundle is emitted under dist/, so import.meta.url does not survive
  // the build — resolve the committed snapshot from the project root instead and
  // keep the module-relative path as a fallback for direct (non-Astro) runs.
  const candidates = [
    resolve(process.cwd(), SNAPSHOT_RELATIVE),
    fileURLToPath(new URL('../data/registry-verified.json', import.meta.url)),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate, 'utf8'));
      const rows = asArray(parsed?.businesses);
      log(`snapshot ${parsed?.generatedAt ?? 'unknown date'}: ${rows.length} row(s) from ${candidate}`);
      return rows;
    } catch (error) {
      log(`snapshot at ${candidate} unusable (${(error as Error).message})`);
    }
  }
  return null;
}

async function load(): Promise<Map<string, RegistryBusiness>> {
  const url = apiUrl();
  let source = url;
  let rows: RegistryBusiness[] | null = null;

  if (url !== 'snapshot') {
    rows = await fetchFromApi(url);
  }
  if (!rows) {
    rows = await readSnapshot();
    source = 'snapshot';
  }

  const map = new Map<string, RegistryBusiness>();
  for (const row of rows ?? []) {
    if (!row || typeof row.placeId !== 'string' || !row.placeId) continue;
    if (!isTruthyFlag(row.verified)) continue;
    map.set(row.placeId, row);
  }
  log(`${map.size} verified business(es) from ${source}`);
  return map;
}

let cached: Promise<Map<string, RegistryBusiness>> | null = null;

/** All verified businesses for this build, keyed on Google Places ID. */
export function loadVerifiedRegistry(): Promise<Map<string, RegistryBusiness>> {
  if (!cached) cached = load();
  return cached;
}

/** The verified registry record for one place, or null when it is not verified. */
export async function verifiedBusinessFor(placeId?: string | null): Promise<RegistryBusiness | null> {
  if (!placeId) return null;
  const registry = await loadVerifiedRegistry();
  return registry.get(placeId) ?? null;
}
