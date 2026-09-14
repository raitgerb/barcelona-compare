# Locales: ES (default) + EN + CA

The site builds three locales from one Astro project:

| Locale | Prefix | Notes |
| --- | --- | --- |
| `es` | *(none)* | default: `/nails/`, `/mejores/…` |
| `en` | `/en/…` | `/en/nails/`, `/en/mejores/…` |
| `ca` | `/ca/…` | Catalan: `/ca/nails/`, `/ca/mejores/…` |

`astro.config.mjs` → `i18n.locales = ['es', 'en', 'ca']`, `defaultLocale: 'es'`,
`prefixDefaultLocale: false`.

## Where things live

- `src/i18n/locales.ts` — `LOCALES`, `DEFAULT_LOCALE`, `LOCALE_LABELS`,
  `stripLocale(pathname)`, `localePath(locale, bare)`, `localeHref(locale, pathname)`.
  `localeHref` preserves a trailing slash (used for `hreflang`, which should equal the
  page's canonical URL); `localePath` mirrors the plain link style (`/ca/nails`).
- `src/i18n/ui.ts` — nav / chrome / generic page strings, one block per locale.
- Per-component copy lives inside the component as an `es | en | ca` record
  (`VerifiedBadge`, `ClaimCta`, `WhatsappCta`, `ReviewInsights`, `ReviewQuotes`,
  `DetailEnhancements`, `FilterBar`, `PaginatedListing`, `MoneyPage`).
- `src/data/neighborhoods.ts` — per-district guide intro in `es` / `en` / `ca` plus the
  short `vibe` / `vibeCa` hub descriptor.
- `src/lib/services.ts` — money-page service keywords in `es` / `en` / `ca`.
- `src/data/constants.ts` — massage-type filter labels in `es` / `en` / `ca`.
- Client runtime: `src/scripts/listing.ts` (search / sort / compare tray) and
  `public/js/compare.js` (side-by-side table) both read `<html lang>` and pick their copy
  from a locale record; both also derive the compare-page path from that locale.

## Routing

Each locale has its own page tree, mirroring the others:

```
src/pages/index.astro            src/pages/en/index.astro            src/pages/ca/index.astro
src/pages/nails/index.astro      src/pages/en/nails/index.astro      src/pages/ca/nails/index.astro
src/pages/nails/[..slug]/        src/pages/en/nails/[..slug]/        src/pages/ca/nails/[..slug]/
src/pages/massage/…              src/pages/en/massage/…              src/pages/ca/massage/…
src/pages/mejores/[category]/…   src/pages/en/mejores/[category]/…   src/pages/ca/mejores/[category]/…
src/pages/barrio/…               src/pages/en/barrio/…               src/pages/ca/barrio/…
src/pages/about.astro            src/pages/en/about.astro            src/pages/ca/about.astro
src/pages/compare.astro          src/pages/en/compare.astro          src/pages/ca/compare.astro
src/pages/for-businesses.astro   src/pages/en/for-businesses.astro   src/pages/ca/for-businesses.astro
```

The money-page routes are thin wrappers around `MoneyPage.astro` (`lang="ca"`); the listing
pages are standalone duplicates, exactly like ES/EN today. Consolidating the three detail
templates into one locale-aware component is possible but was deliberately not done here —
see "Known limits".

## hreflang + language switcher

`BaseLayout.astro` derives everything from the current pathname:

- one `<link rel="alternate" hreflang>` per locale the page exists in, **including a
  self-referencing one**, plus `hreflang="x-default"` → the ES URL;
- a switcher in the header offering every locale the page exists in (current one is a
  non-link pill).

Owner-facing app surfaces (`/reclamar/`, `/en/claim-business/`, `/gestion/`, `/en/manage/`)
pass `langs={['es','en']}` — they are not translated in this phase, so they declare only the
two locales that exist and get **no** `x-default`. `/reclamar/` ↔ `/en/claim-business/` keep
the `altPath` override because their paths do not correspond.

**Adding a locale to a page family later:** create the page file, pass `lang`, and it is
automatically wired into hreflang and the switcher — no registry to update.

## Edge injector (owner content)

`functions/_lib/owner-content.ts` matches detail paths with
`^\/(?:(en|ca)\/)?(nails|massage)\/([^/]+)\/?$` and renders the owner's services / hours /
photos / WhatsApp CTA with `es`, `en` or `ca` labels and day names, so a claimed partner's
edits show up on `/ca/…` pages too (not just ES/EN).

## What is NOT translated (phase 1)

- **Business data** — names, addresses, review quotes free text stay as the source has them.
  Only UI chrome and page copy are Catalan.
- **The claim/owner flows** (`/reclamar/`, `/en/claim-business/`, `/gestion/`, `/en/manage/`):
  still ES+EN. Catalan `ClaimCta` and `/ca/for-businesses/` deep-link to the Spanish flow and
  say so inline.
- **Lightbox** aria-labels (`Photo viewer`, `Close`, `Previous`, `Next`) are still English on
  every locale.
- **Catalan copy is LLM-written and unreviewed** (Rutger, Sep 14 2026: no paid translation, no
  native review pass planned — hobby project). Treat wording as "good but unverified"; a
  native speaker reading a page may still want to fix phrasing.

## Known limits / follow-ups

- The ES and EN detail templates carry a `BeautySalon` JSON-LD block that EN and CA do not.
  Mirrored EN for CA rather than diverging further; worth adding to all three at once.
- `ReviewQuotes.astro` rendered Spanish copy on EN pages before this work (it ignored `lang`);
  the `lang` prop now exists and CA passes it, but the EN detail templates still do not pass
  `lang="en"` — so those pages keep the Spanish heading.
- The EN detail breadcrumb's "Neighborhoods" crumb pointed at the ES `/barrio/` index; for CA
  it is `/ca/barrio/`. The EN one was left as it was to keep this change reviewable.
