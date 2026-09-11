import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

type Biz = CollectionEntry<'nails'> | CollectionEntry<'massage'>;

/**
 * Static JSON endpoint: the business catalog the claim flow works from.
 * Emitted at build time to /data/claim-index.json (~110KB, gzip ~30KB).
 *
 * `/reclamar/` fetches it in the browser to resolve the business a visitor is
 * claiming (deep link or search) and `functions/_lib/catalog.ts` reads the same file
 * from the edge to validate the `placeId` — so the claim endpoints can only ever
 * attach an owner to a business that is actually listed on this build.
 *
 * Businesses without a `googlePlaceId` are skipped: the Places ID is the registry
 * key and there is nothing to claim without it.
 */
export async function GET() {
  const [nails, massage] = await Promise.all([getCollection('nails'), getCollection('massage')]);

  const pick = (entries: Biz[], category: string) =>
    entries
      .filter(e => Boolean(e.data.googlePlaceId))
      .map(e => ({
        placeId: e.data.googlePlaceId as string,
        slug: e.id,
        name: e.data.name,
        category,
        address: e.data.address || '',
        neighborhood: e.data.neighborhood || '',
        rating: e.data.googleRating ?? 0,
        reviews: e.data.googleReviewCount ?? 0,
      }));

  const businesses = [...pick(nails, 'nails'), ...pick(massage, 'massage')];

  return new Response(
    JSON.stringify({ generatedAt: new Date().toISOString(), count: businesses.length, businesses }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}
