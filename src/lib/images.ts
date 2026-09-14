// Shared image URL resolver for barcelonacompare.com
// Uses R2 bucket when R2_IMAGE_BASE_URL is configured, falls back to local /images/ path.
//
// Set in Cloudflare Pages env vars: R2_IMAGE_BASE_URL = https://images.barcelonacompare.com
// Or for R2.dev: R2_IMAGE_BASE_URL = https://pub-XXXX.r2.dev

import photoManifest from '../data/photo-manifest.json';

const R2_BASE = import.meta.env.R2_IMAGE_BASE_URL || "";

const manifest = photoManifest as Record<string, string[]>;

/**
 * The display order for a business's photos, as file indices.
 *
 * The manifest holds the *file* index at each *display* position, so position 0
 * is the photo we want to lead with. Photos are re-ordered (never renamed or
 * re-uploaded) by `scripts/score-photos.py`, which scores what we already have
 * and puts the best image first — a bad hero photo is the most expensive thing
 * on a listing page, and reordering is free.
 *
 * Falls back to natural order (0,1,2,…) for businesses with no manifest entry.
 */
export function photoOrder(category: string, slug: string, count = 5): string[] {
  const list = manifest[`${category}/${slug}`];
  if (Array.isArray(list) && list.length > 0) return list.map(String);
  return Array.from({ length: count }, (_, i) => String(i));
}

/**
 * True when at least one synced photo exists for this business.
 */
export function hasPhoto(category: string, slug: string): boolean {
  const list = manifest[`${category}/${slug}`];
  return Array.isArray(list) && list.length > 0;
}

/**
 * Resolves an image URL for a business listing.
 * @param category - "nails" or "massage"
 * @param slug - business slug (filename without .md)
 * @param index - display position (0 = the lead photo), not the file number
 */
export function imageUrl(category: string, slug: string, index: number): string {
  const fileIndex = photoOrder(category, slug)[index] ?? String(index);
  if (R2_BASE) {
    return `${R2_BASE}/images/${category}/${slug}-${fileIndex}.jpg`;
  }
  return `/images/${category}/${slug}-${fileIndex}.jpg`;
}

/**
 * Returns the base image path for a category+slug (used for Lightbox / dynamic src building).
 */
export function imagePath(category: string, slug: string): string {
  if (R2_BASE) {
    return `${R2_BASE}/images/${category}/${slug}`;
  }
  return `/images/${category}/${slug}`;
}
