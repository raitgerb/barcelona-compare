/**
 * Locale plumbing for the site's three languages.
 *
 * ES is the default and is served without a prefix (`/nails`), EN lives under
 * `/en/…` and CA (Catalan) under `/ca/…` — see `astro.config.mjs` i18n.locales.
 * Every public page family exists in all three; the owner-facing app surfaces
 * (claim flow, owner dashboard) are ES+EN only and pass `langs={['es','en']}`
 * to BaseLayout so no switcher entry or hreflang points at a page that is not
 * built.
 */
export const LOCALES = ['es', 'en', 'ca'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

/** Short label for the language switcher. */
export const LOCALE_LABELS: Record<Locale, string> = { es: 'ES', en: 'EN', ca: 'CA' };

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/**
 * Strip a leading `/en` or `/ca` so the path can be re-prefixed for any locale.
 * `/en/nails` → `/nails`, `/ca` → `/`, `/nails` → `/nails`.
 */
export function stripLocale(pathname: string): string {
  const bare = pathname.replace(/^\/(en|ca)(?=\/|$)/, '');
  return bare === '' ? '/' : bare;
}

/**
 * Locale-prefixed href for a bare path: `localePath('ca', '/nails')` → `/ca/nails`,
 * `localePath('es', '/nails')` → `/nails`, `localePath('en', '/')` → `/en`.
 * Deliberately mirrors the existing ES/EN link style (no trailing slash except
 * where the caller passes one).
 */
export function localePath(locale: Locale, bare: string): string {
  const clean = bare === '' ? '/' : bare;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}

/**
 * Canonical-shaped locale URL for hreflang: same as `localePath` but an existing
 * trailing slash is preserved, so the alternate URL matches the page's own
 * `<link rel="canonical">` (`/ca/` for the CA homepage, not `/ca`).
 */
export function localeHref(locale: Locale, pathname: string): string {
  const bare = stripLocale(pathname);
  if (locale === DEFAULT_LOCALE) return bare;
  return bare === '/' ? `/${locale}/` : `/${locale}${bare}`;
}
