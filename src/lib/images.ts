// Shared image URL resolver for barcelonacompare.com
// Uses R2 bucket when R2_IMAGE_BASE_URL is configured, falls back to local /images/ path.
//
// Set in Cloudflare Pages env vars: R2_IMAGE_BASE_URL = https://images.barcelonacompare.com
// Or for R2.dev: R2_IMAGE_BASE_URL = https://pub-XXXX.r2.dev

import photoManifest from '../data/photo-manifest.json';

const R2_BASE = import.meta.env.R2_IMAGE_BASE_URL || "";

const manifest = photoManifest as Record<string, string[]>;

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
 * @param index - photo index (0-4)
 */
export function imageUrl(category: string, slug: string, index: number): string {
  if (R2_BASE) {
    return `${R2_BASE}/images/${category}/${slug}-${index}.jpg`;
  }
  return `/images/${category}/${slug}-${index}.jpg`;
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
