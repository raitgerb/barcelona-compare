# Barcelona Compare — Agent Instructions

## What this project is
barcelonacompare.com — a directory site comparing nail salons and massage businesses in Barcelona. Built as an Astro 6.x static site, deployed on Cloudflare Pages. Content-driven: one markdown file per business.

## Tech stack
- **Framework:** Astro 6.x (`astro@^6.4.6`)
- **Styling:** Tailwind CSS 4 via `@tailwindcss/vite`
- **Node:** >=22.12.0 (see `package.json` engines)
- **Package manager:** npm
- **Build:** `npm run build` → outputs to `dist/`
- **Dev:** `npm run dev`
- **Deployment:** Cloudflare Pages (connected to GitHub)

## Key directories
```
src/
  content/
    nails/*.md       — One file per nail salon (848+ businesses)
    massage/*.md     — One file per massage business
  pages/
    nails/[...slug]/ — Dynamic routes for nail listings (ES + EN)
    massage/[...slug]/ — Dynamic routes for massage listings (ES + EN)
    index.astro      — Homepage
    en/              — English-localized pages
  components/
    PaginatedListing.astro — Shared pagination component
  lib/
    images.ts        — Image URL resolution (R2 CDN)
scripts/
  sync-photos.py     — Google Places photo sync
  fix-slugs.py       — Slug normalization
  fix-missing-photos.py — Gap-fill missing photos
  broaden.py         — Discovery + enrichment pipeline for new businesses
  filter-broadened.py — Post-broaden dedup
public/
  robots.txt
```

## Content conventions
- Each business markdown file has frontmatter: `name`, `slug`, `address`, `rating`, `reviewCount`, `photos` (array of URLs), `category` (nails/massage), `placeId`
- Slugs are normalized (no special chars, lowercase, hyphens)
- Photos served from R2 CDN: `pub-37760591f0394eafb9519ca1c4db5865.r2.dev`

## Current state (July 2026)
- 848 businesses collected
- Photos migrated to R2, removed from git
- ~875 candidates remain uncollected (mostly outer barrios)
- Sitemap auto-generated via `@astrojs/sitemap`

## Future work (see FUTURE.md)
- Custom domain for R2 images (`images.barcelonacompare.com`)
- Smart photo selection (score-based filtering of Google Places photos)
- Resume remaining data collection (~875 businesses)

## Working on this project
- Always run `npm install` after pulling to sync dependencies
- Astro content collections auto-rebuild on markdown changes
- The `scripts/broaden.py` pipeline discovers + enriches businesses via Google Places API — it's the core data pipeline
- Deployment: Cloudflare Pages auto-deploys on push to main

## Non-technical context
- The site owner (Rutger) is non-technical. All deployment/config changes must be explained step-by-step with exact Cloudflare dashboard UI labels.
- Cloudflare Pages env vars: Text for public values, Secret for API keys. The UI tab is "Variables and secrets."
