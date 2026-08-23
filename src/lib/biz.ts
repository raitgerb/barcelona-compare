// Client-side business data for search + compare features.
// Built at build time into a JSON island on listing pages.
// No API calls at runtime — everything filters locally.

export interface BizRecord {
  slug: string;
  name: string;
  neighborhood: string;
  price: string;
  rating: number;
  reviews: number;
  hasPhotos: boolean;
  hours?: Record<string, string>;
  services: string[];
  languages?: string[];
  phone?: string;
  website?: string;
  address?: string;
}

import type { CollectionEntry } from 'astro:content';

type Hours = Record<string, string>;

function normalizeHours(hours?: Hours): Hours | undefined {
  if (!hours || Object.keys(hours).length === 0) return undefined;
  return hours;
}

export function toBizRecord(entry: CollectionEntry<'nails' | 'massage'>): BizRecord {
  const d = entry.data;
  return {
    slug: entry.id,
    name: d.name,
    neighborhood: d.neighborhood || '',
    price: d.priceIndicator || '',
    rating: d.googleRating || 0,
    reviews: d.googleReviewCount || 0,
    hasPhotos: true, // overridden below via photos check by caller if needed
    hours: normalizeHours(d.hours as Hours | undefined),
    services: (d.services || []).map((s: any) => (typeof s === 'string' ? s : s.name)),
    languages: d.languages || [],
    phone: d.phone || undefined,
    website: d.website || undefined,
    address: d.address || '',
  };
}

export function bizRecordsWithPhotoFlag(
  entries: CollectionEntry<'nails' | 'massage'>[],
  photoSlugs: Set<string>
): BizRecord[] {
  return entries.map(e => ({
    ...toBizRecord(e),
    hasPhotos: photoSlugs.has(e.id),
  }));
}
