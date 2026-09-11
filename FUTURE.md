# Barcelona Compare — Future Work

Living backlog. Update in place; mark shipped items with the commit hash.

## Shipped (was backlog)

- ✅ **Instant search** on listing pages — name/street/service, accent-insensitive (b6afc42, Aug 23; verified live)
- ✅ **Sort photo-less listings to bottom** (b6afc42)
- ✅ **"Open now" badges** on listing cards (b6afc42)
- ✅ **Prev/Next navigation** on detail pages (b6afc42)
- ✅ **Rating-distribution bars** on all detail pages — build-time histogram, honest "estimated from recent reviews" labeling (337c7b8, Sep 11)
- ✅ **Review keywords** — bilingual keyword chips mined from Google reviews, 912 pages (337c7b8)
- ✅ **EN money pages** — `/en/mejores/{cat}/`, district, service and combo routes (shipped with ea9bbe0)
- ✅ **EN barrio guides** — `/en/barrio/` hub + 10 district guides, EN nav + homepage + money-page cross-links (337c7b8)
- ✅ R2/CDN migration for images (July 2026)

---

## 1. B2B / Partner program — **ACTIVE, priority 1**

Goal: convert the directory into a platform with engaged partners. Sequence matters —
free tiers get partners in the door, paid tiers only work once businesses can see
what they're paying for.

### Phase 0 — Foundation (1 week, €0 to run)
- **Claim flow with email verification.** "Claim this business" → owner enters email →
  6-digit code → `claimed` + `verified` flags on the record. Requires a small backend
  (Cloudflare Pages Function + D1); site stays static.
- **Business registry** keyed by `googlePlaceId`: claim status, owner email, tier,
  claim date. JSON in a private repo or D1.
- **Rewrite `/for-businesses`** into a real landing page: value prop, tier comparison,
  FAQ, claim CTA. (Current page is a placeholder with a mailto line and "coming soon".)

### Phase 1 — Free tier (2–3 weeks)
- **Verified badge** on detail + listing + money pages (trust for them, conversion for us).
- **Self-service profile edits**: services, prices, photos, hours via a form
  (Pages Function + D1, rebuild or edge-inject).
- **WhatsApp / booking CTA upgrade** — only 9 of 1,182 businesses currently have a
  WhatsApp link. This market books on WhatsApp; this is the highest-impact free perk.

### Phase 2 — Paid tier (after ~20 claimed partners)
- **Pro (~€15–25/mo)**: disclosed priority placement in the Bayesian ranking, expanded
  photo gallery, service-page featuring, verified slots on money pages.
- **Partner analytics by email** — monthly profile views + clicks. No login; owners are
  non-technical.
- **Billing**: Stripe Payment Links (no dashboard build).

### Phase 3 — Ecosystem (later)
- Booking integration or referral deal with existing tools (Fresha, Booksy) — partner, don't compete.
- Catalan locale for partner-facing surfaces.
- "What clients say about you" — expose the review-keyword engine as a partner-facing asset.

### Open questions
- Traffic numbers from Cloudflare Web Analytics before setting price points.
- Does the verified badge need to be visible enough to sell the paid tier? (Probably yes.)

---

## 2. EN compare page + tray link bug — **priority 2, small**

- `/en/compare/` **does not exist** — request returns the homepage (soft-404, canonical `/`).
  ES `/compare/` works. Build the EN mirror of `src/pages/compare.astro`.
- **Bug**: the compare tray in `src/scripts/listing.ts` hardcodes `href="/compare"`, so on
  EN pages it sends users to the Spanish page. Should respect `document.documentElement.lang`.
- Cross-link the EN compare page from EN money pages and the EN homepage.

## 3. Catalan locale — priority 3

- `astro.config.mjs` i18n has `locales: ['es', 'en']`. Adding `ca` means a third copy of
  `src/i18n/ui.ts` plus route trees for all page families.
- Cost/benefit: real local-market credibility, but ~2,600 more pages to build and it
  triples the translation surface for every future feature. Revisit after the B2B work —
  partner-facing Catalan is a smaller, cheaper subset (see Phase 3).

## 4. Custom domain for R2 images — priority 4, cosmetic

- `images.barcelonacompare.com` instead of the `pub-37760591...r2.dev` hash.
- Steps: CF dashboard → R2 → `barcelona-compare-images` → Settings → Custom Domains → add
  subdomain → update `R2_IMAGE_BASE_URL` in Pages → redeploy.
- Zero functional gain; only worth it when sharing URLs publicly.

## 5. Smart photo selection — priority 4

- Google returns 10 photos/business; we take the first 5 blindly. Some are blurry, dark,
  logos or menus.
- Build-time heuristic, no AI, no paid service: file size (compression/detail), brightness
  (reject near-black), aspect ratio (reject extreme panoramas), resolution (reject thumbnails).
- Trigger to upgrade to a service: 10k+ images, on-the-fly transforms, or user uploads.

## 6. Remaining data collection (~875 candidates) — **deferred**

- `scripts/broaden.py` found 2,107 candidates, processed 1,232. ~875 remain — mostly outer
  barrios (Sant Andreu, Nou Barris, Horta-Guinardó) and marginal keyword variants.
- Estimated 200–400 legitimate businesses in that set; the rest are false positives.
- Requires refactor first: split into **Phase 1 discovery** (save `data/candidates.json`)
  and **Phase 2 enrichment** (read list, skip existing place IDs, batch 100 at a time).
- Cost: **$25–50** in Google Places API. Deferred until traffic justifies marginal coverage.
- **Decision (Sep 11 2026): stays deferred.**

## 7. Weekly refresh cron — **intentionally paused**

- Cron `a0357cbcaf3b`. Rutger's decision (Sep 11 2026): leave paused. Do not re-enable
  or re-propose without asking.

---

## Explicitly declined / do not re-propose

- **Google Places `editorialSummary` fetch ($37)** — ~3% coverage in this niche. Script kept
  at `scripts/fetch-editorial.py` for reference only.
