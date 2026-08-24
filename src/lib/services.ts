// Service-intent money pages: shared definitions + ranking helpers.
// Tags come from scripts/classify-services.py (name/services/review mining).
import { getCollection } from 'astro:content';

export type CatKey = 'nails' | 'massage';

export interface ServiceDef {
  slug: string;
  es: { plural: string; keyword: string };
  en: { plural: string; keyword: string };
}

// Order = prominence (largest tagged pools first per category).
export const SERVICES: Record<CatKey, ServiceDef[]> = {
  nails: [
    { slug: 'pedicura',      es: { plural: 'pedicuras',                 keyword: 'pedicura' },                    en: { plural: 'pedicures',               keyword: 'pedicure' } },
    { slug: 'gel-acrilicas', es: { plural: 'salones de uñas de gel y acrílicas', keyword: 'uñas de gel y acrílicas' }, en: { plural: 'gel & acrylic nail salons', keyword: 'gel & acrylic nails' } },
    { slug: 'nail-art',      es: { plural: 'estudios de nail art',       keyword: 'nail art' },                    en: { plural: 'nail art studios',        keyword: 'nail art' } },
  ],
  massage: [
    { slug: 'tailandes',     es: { plural: 'masajes tailandeses',        keyword: 'masaje tailandés' },            en: { plural: 'thai massages',           keyword: 'thai massage' } },
    { slug: 'spa-bienestar', es: { plural: 'spas y centros de bienestar', keyword: 'spa' },                        en: { plural: 'spas & wellness centers', keyword: 'spa & wellness' } },
    { slug: 'deportivo',     es: { plural: 'masajes deportivos',         keyword: 'masaje deportivo' },            en: { plural: 'sports massages',         keyword: 'sports massage' } },
    { slug: 'quiromasaje',   es: { plural: 'centros de quiromasaje',     keyword: 'quiromasaje' },                 en: { plural: 'deep tissue massages',    keyword: 'deep tissue massage' } },
    { slug: 'pareja',        es: { plural: 'masajes en pareja',          keyword: 'masaje en pareja' },            en: { plural: 'couples massages',        keyword: 'couples massage' } },
    { slug: 'reflexologia',  es: { plural: 'reflexologías podales',      keyword: 'reflexología podal' },          en: { plural: 'foot reflexology sessions', keyword: 'foot reflexology' } },
  ],
};

export const MIN_CITY = 15;  // min tagged businesses for a city-level service page
export const MIN_COMBO = 8;  // min for a barrio × service page

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function findService(cat: CatKey, slug: string): ServiceDef | undefined {
  return SERVICES[cat].find(s => s.slug === slug);
}

interface RankedEntry {
  entry: any;
  weight: number;
}

// Same Bayesian weighting as the district money pages (PRIOR_M = 50),
// global mean computed over the whole collection for stability.
export async function loadRanked(
  cat: CatKey,
  opts: { neighborhood?: string; tag?: string } = {},
): Promise<RankedEntry[]> {
  const all = await getCollection(cat);
  const rated = all.filter((b: any) => b.data.googleRating);
  const globalMean = rated.reduce((s: number, b: any) => s + b.data.googleRating, 0) / (rated.length || 1);
  const PRIOR_M = 50;

  let pool = all;
  if (opts.neighborhood) pool = pool.filter((b: any) => b.data.neighborhood === opts.neighborhood);
  if (opts.tag) pool = pool.filter((b: any) => ((b.data.serviceTags ?? []) as string[]).includes(opts.tag!));

  return pool
    .map((entry: any) => {
      const r = entry.data.googleRating ?? globalMean;
      const c = entry.data.googleReviewCount ?? 0;
      return { entry, weight: (r * c + globalMean * PRIOR_M) / (c + PRIOR_M) };
    })
    .sort((a: RankedEntry, b: RankedEntry) => b.weight - a.weight);
}

export async function taggedCount(cat: CatKey, tag: string, neighborhood?: string): Promise<number> {
  const all = await getCollection(cat);
  return all.filter((b: any) =>
    ((b.data.serviceTags ?? []) as string[]).includes(tag) &&
    (!neighborhood || b.data.neighborhood === neighborhood)
  ).length;
}

export interface StatsBundle {
  total: number;
  avg: string | null;
  totalReviews: number;
}

export function bundleStats(ranked: RankedEntry[]): StatsBundle {
  const entries = ranked.map(r => r.entry);
  const withRating = entries.filter((b: any) => b.data.googleRating);
  return {
    total: entries.length,
    avg: withRating.length
      ? (withRating.reduce((s: number, b: any) => s + b.data.googleRating, 0) / withRating.length).toFixed(1)
      : null,
    totalReviews: entries.reduce((s: number, b: any) => s + (b.data.googleReviewCount ?? 0), 0),
  };
}
