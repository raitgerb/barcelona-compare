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

## Current state (Sep 11 2026)
- 2,643 pages built (commit 337c7b8): rating-distribution bars + bilingual review keywords on all detail pages, `/en/barrio/` hub + 10 EN district guides, EN money pages (`/en/mejores/`) live with district/service/combo routes, instant search + open-now badges + photo-less sorting + prev/next nav (b6afc42)
- **Open work lives in FUTURE.md** — includes the active B2B/partner program (phases 0-3), the missing `/en/compare/` page, Catalan locale, and deferred data collection
- **Known gap**: `/en/compare/` does not exist (returns homepage soft-404) and the compare tray in `src/scripts/listing.ts` hardcodes `/compare`, sending EN users to the Spanish page
- Backlog: Catalan locale, R2 custom domain, smart photo selection
- Weekly refresh cron `a0357cbcaf3b` is **intentionally paused** (Rutger, Sep 11 2026) — do not re-enable or re-propose without asking
- Google Places editorialSummary coverage ~3% for this niche — do NOT re-propose the $37 fetch; script kept at scripts/fetch-editorial.py

## R2 images
- Bucket `barcelona-compare-images` (account 135a01b78b043167860618dd0030c5f6), key prefix `images/{cat}/{slug}-{idx}.jpg`
- Upload: `npx --yes wrangler r2 object put {bucket}/{key} --file <local> --content-type image/jpeg --remote` — **--remote is MANDATORY** (wrangler 4.x defaults to local storage; without it objects never reach the public r2.dev URL)
- Auth: CLOUDFLARE_R2_TOKEN in repo .env (= 'barcelona-compare-r2' token), NOT the ambient CLOUDFLARE_API_TOKEN ('Hermes Agrippa' token lacks R2)
- 'Hermes Agrippa' token lacks Web Analytics SQL permission — analytics provisioning needs the dashboard

## Deploy verification + gotchas
- Verify deploys via CF API: GET accounts/{135a01b78b043167860618dd0030c5f6}/pages/projects/barcelona-compare/deployments — read latest_stage + commit_hash
- .gitignore must be ROOT-anchored '/data/' — bare 'data/' silently excluded src/data/* from commits, breaking CF Pages build while local builds passed (Aug 2026, cost one failed deploy)

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
