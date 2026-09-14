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
- ✅ **EN compare page + lang-aware tray** — `/en/compare/` mirrors `/compare/`; tray CTA, comparison detail links and browse buttons follow the page language; cross-linked from EN homepage + money pages (204d0ae, Sep 11)
- ✅ **Business registry (B2B Phase 0)** — D1 `barcelona-compare-registry` keyed by `placeId`: claimed/verified flags, owner email, tier, claim dates + append-only audit trail; read/write path proven end to end through the deployed Pages Functions (ec0e017, Sep 11; `docs/business-registry.md`)
- ✅ **Per-business event tracking** — first-party, cookie-less counters for detail-page views + outbound clicks (phone, WhatsApp, website, directions), D1 `business_events` keyed by `placeId` and aggregated at write time; machine-readable read path `GET /api/analytics[/:placeId]` behind the registry admin token, plus a "Cómo llegar" / "Get directions" CTA on all four detail-page templates (`docs/business-analytics.md`)
- ✅ **Claim flow with email verification (B2B Phase 0)** — `/reclamar/` (ES) + `/en/claim-business/` (EN): owner picks the business, a 6-digit code goes to their email, and only then does the record go `claimed` + `verified`. Pending codes live in `claim_requests` (HMAC-hashed, 15-min TTL, single use, throttled) so requesting a code never touches the registry (5daa40e, Sep 11; `docs/claim-flow.md`; 54-assertion `scripts/claim-smoke.sh`)
- ✅ R2/CDN migration for images (July 2026)

---

## 1. B2B / Partner program — **ACTIVE, priority 1**

Goal: convert the directory into a platform with engaged partners. Sequence matters —
free tiers get partners in the door, paid tiers only work once businesses can see
what they're paying for.

### Phase 0 — Foundation (1 week, €0 to run)
- ✅ **Claim flow with email verification** — `/reclamar/` (ES) + `/en/claim-business/` (EN):
  "Claim this business" → owner enters email → 6-digit code → `claimed` + `verified` flags on
  the record (5daa40e, Sep 11; `docs/claim-flow.md`). Proven live end to end: a real business
  claimed through the UI, the code round-tripped through a real inbox, and the audit trail
  recorded `claim` → `verify` by `claim-flow`.
- ✅ **Claim flow — transactional email transport** — live since Sep 13 (2026-09-13). The edge
  mails the code from `no-reply@send.barcelonacompare.com` (`RESEND_API_KEY` + `EMAIL_FROM` as
  Pages vars on `barcelona-compare`, sender domain verified in Resend eu-west-1). The outbox is
  the *fallback*, not the default: if a send fails the code stays in `claim_requests` for
  `GET /api/claim/outbox` (admin token) so a mail outage can never block a claim, and an empty
  outbox is the signal that email is genuinely working. Proven live: `POST /api/claim/start`
  returned `delivery: "resend"` and the code landed in a real inbox with the outbox at `count: 0`.
- ✅ **Claim CTA on the listing itself** — all four detail templates (nails + massage, ES + EN)
  carry `ClaimCta.astro`: inline under the business name (the same block as the verified badge,
  so a verified listing shows the badge and no claim link) and as the banner at the end of the
  page. It deep-links `/reclamar/?place=<placeId>` / `/en/claim-business/?place=<placeId>`, which
  `ClaimFlow` resolves against the build catalog and hides the search step for
  (c0802c0, Sep 12; `docs/claim-flow.md`).
- ✅ **Business registry** keyed by `googlePlaceId`: claim status, owner email, tier,
  claim date — D1 `barcelona-compare-registry` + Pages Functions API
  (`GET`/`PUT /api/registry`), audit trail, 42-assertion smoke test
  (ec0e017, Sep 11; `docs/business-registry.md`).
- ✅ **Rewrite `/for-businesses`** into a real landing page: value prop, tier comparison,
  FAQ, claim CTA (466df13, Sep 11).

### Phase 1 — Free tier (2–3 weeks)
- **Verified badge** on detail + listing + money pages (trust for them, conversion for us).
- ✅ **Self-service profile edits**: services, prices, photos, hours via a form
  (Pages Function + D1, edge-injected into the static listing) — owner dashboard
  `/gestion/` + `/en/manage/`, owner login by emailed 6-digit code (no passwords),
  operator takedown/restore, audit trail; the claim confirmation screen now links
  straight into the panel (4c8b978, Sep 11; `docs/owner-profile-edits.md`;
  63-assertion smoke test, green against production).
- ✅ **WhatsApp / booking CTA** — detail pages lead with a full-width "Reservar por
  WhatsApp" button above the phone/website row, and the number is normalised to
  `wa.me` digits (the old code emitted `wa.me/640793674`, a dead link for all 9
  listings that had the field). Owners add theirs in `/gestion/` (new *Contacto*
  card; `profile_overrides.whatsapp`, migration 0005) and the edge injector puts the
  button on their listing within a minute; clicks land in `click_whatsapp` counters
  (56c4e83, Sep 11; `docs/whatsapp-cta.md`; 75-assertion owner smoke).

### Phase 2 — Paid tier (after ~20 claimed partners)
- **Pro (~€15–25/mo)**: disclosed priority placement in the Bayesian ranking, expanded
  photo gallery, service-page featuring, verified slots on money pages.
- **Partner analytics by email** — monthly profile views + clicks. No login; owners are
  non-technical. **Unblocked**: the data source is live (first-party counters per business,
  `docs/business-analytics.md`) and the job reads it with `GET /api/analytics?month=YYYY-MM`
  (admin token), joining `GET /api/registry?status=claimed` for owner emails.
- **Billing**: Stripe Payment Links (no dashboard build).

### Phase 3 — Ecosystem (later)
- Booking integration or referral deal with existing tools (Fresha, Booksy) — partner, don't compete.
- Catalan locale for partner-facing surfaces.
- "What clients say about you" — expose the review-keyword engine as a partner-facing asset.

### Open questions
- Traffic numbers before setting price points: both sources are readable from the CLI now —
  `GET /api/analytics` (exact first-party counters per business) and the Cloudflare RUM API
  per path (sample-weighted, multiples of 10 — see `docs/business-analytics.md`).
- Does the verified badge need to be visible enough to sell the paid tier? (Probably yes.)

---

## 2. EN compare page + tray link bug — ✅ SHIPPED (204d0ae, Sep 11)

- `/en/compare/` now exists (`src/pages/en/compare.astro`) — 200, `lang="en"`, canonical `/en/compare/`, hreflang both ways.
- Tray CTA in `src/scripts/listing.ts` and the detail/browse paths in `public/js/compare.js` derive
  from `document.documentElement.lang` (`/en/compare/` + `/en/{cat}/{slug}/` on EN pages).
- Cross-linked from the EN homepage hero, EN money hubs (`/en/mejores/{cat}/`) and every
  money-page leaf (ES surfaces got the same link for parity).

## 3. Catalan locale — priority 3 — ✅ SHIPPED (phase 1)

Shipped Sep 14 2026 (commit `5e93bc1`, `docs/i18n-locales.md`): `ca` is the third locale in
`astro.config.mjs`; every public page family is mirrored under `/ca/` (homepage, listings,
business detail pages, money pages, barrio guides, about / compare / for-businesses);
`hreflang` declares es + en + ca + x-default on every public page and the header switcher
offers all three; the client runtimes (search/sort/compare tray, compare table) and the edge
owner-content injector are locale-aware. 3,970 pages built (was 2,648).

Out of scope for phase 1 (unchanged from the original plan): the owner claim/login flows are
still ES+EN, and business data (names, addresses, review free text) is not translated — only
UI chrome and page copy.

Translation source: LLM Catalan, unreviewed (Rutger, Sep 14 2026: "a hobby project not
intended to make money", so no paid translator and no native review pass planned).

Follow-up shipped Sep 14 2026 (`28ddb57`): the EN detail templates now pass `lang="en"` to
`ReviewQuotes` (they had been rendering the Spanish heading "Lo que dicen los clientes"), and all
three detail trees emit the `BeautySalon` JSON-LD block (was ES-only). No ES page changed.

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
