import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

type Biz = CollectionEntry<'nails'> | CollectionEntry<'massage'>;

/**
 * Static JSON endpoint: every business's compare-relevant fields.
 * Emitted at build time to /data/businesses.json (~500KB, gzip ~110KB).
 * Only fetched by /compare pages — never on listing pages.
 */
export async function GET() {
  const nails = await getCollection('nails');
  const massage = await getCollection('massage');

  const pick = (entries: Biz[], category: string) =>
    entries.map(e => ({
      slug: e.id,
      cat: category,
      name: e.data.name,
      nb: e.data.neighborhood || '',
      address: e.data.address || '',
      price: e.data.priceIndicator || '',
      rating: e.data.googleRating || 0,
      reviews: e.data.googleReviewCount || 0,
      hours: e.data.hours || {},
      langs: e.data.languages || [],
      services: (e.data.services || []).map((s: any) => (typeof s === 'string' ? s : s.name)),
      phone: e.data.phone || '',
      site: e.data.website || '',
    }));

  const all = [...pick(nails, 'nails'), ...pick(massage, 'massage')];

  return new Response(JSON.stringify(all), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
