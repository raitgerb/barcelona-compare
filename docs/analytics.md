# Analytics (PostHog EU, consent-gated)

Owner-readable summary of the browser analytics on barcelonacompare.com, plus the
operator details an agent needs. Added 2026-09-19.

**Scope:** one first-party analytics tool, PostHog, hosted in the EU, capturing a single
`page_view` per page load and outbound-referral clicks — and only after the visitor says yes.

## What is installed

| Piece | Path | Role |
|---|---|---|
| Loader | `public/js/portfolio-analytics.js` | Consent gate + event allowlist. Loads the SDK, but capture is OFF until consent. |
| Outbound tracker | `public/js/portfolio-analytics-outbound.js` | One delegated click listener → `outbound_referral` for links leaving the site. |
| Wiring | `src/layouts/BaseLayout.astro` | Config block in `<head>`; consent banner + withdrawal control before `</body>`. Covers every page and all three locales. |

The existing **Cloudflare Web Analytics** beacon (`ce7b3abd9d7f489ab3433b50cf598784`) stays
exactly as it was. It is not replaced and not comparable: see "Two different denominators".

## Consent model

- The SDK is loaded **un-gated** (PostHog's own guidance: gate *capture*, not the snippet) and
  initialised `opt_out_capturing_by_default` with `persistence: 'memory'`.
- **Nothing** is sent and **no** identity is written to storage before the visitor accepts.
- The banner offers **Accept** and **Reject** with equal prominence; the footer control
  ("Change analytics choice") withdraws consent immediately and clears the stored identity.
- Global Privacy Control is honoured as a refusal.
- The loader is **inert on any host that is not `barcelonacompare.com` / `www.barcelonacompare.com`**:
  preview deployments, `npm run dev` and stray embeds load nothing and send nothing.
- Session replay, autocapture, console logs, web vitals, surveys, heatmaps and dead clicks are
  all disabled **in the shipped config and again in the PostHog project settings**, so a remote
  setting cannot turn them back on from the server side.
- URLs are stripped to pathname + campaign parameters (`utm_*`, `ref`, `gclid`, `fbclid`).
  Search terms, tokens and form contents are never sent.

## Event dictionary (the complete allowlist)

Every event carries `site`, `site_label`, `schema_version`, `is_consented`. Anything not listed
is refused by the loader and re-checked in `before_send`.

| Event | Properties | Emitted by |
|---|---|---|
| `page_view` | `path`, `referrer_host`, `utm_source`, `utm_medium`, `utm_campaign`, `ref` | every page (once per load) |
| `outbound_referral` | `target_host`, `path`, `placement` | outbound-clicks file |
| `claim_started`, `claim_submitted` | `category` | reserved for the claim flow (not wired yet) |

Deliberately absent: every click, scroll depth, rageclick, Web Analytics page-leave, session
replay, `$pageview`, `$autocapture`.

## Dashboards

PostHog EU, project **279080**, organisation **Agrippa** (free tier, no card).

| Dashboard | URL |
|---|---|
| Portfolio Overview (all sites) | https://eu.posthog.com/project/279080/dashboard/963108 |
| barcelonacompare.com | https://eu.posthog.com/project/279080/dashboard/963109 |

All sites share this one free-tier project; the `site` event property is the site label.

## Two different denominators — do not mix them

- **These charts** count consented browsers only.
- **Cloudflare Web Analytics** counts real browsers who did *not* block the beacon, sample-weighted.
- **Cloudflare edge requests** count everything, bots included.

Cloudflare Free cannot classify bots per request, so **no bot percentage exists anywhere**.
Never derive one by subtracting one number from another.

## Rollback

Revert the commit that added the integration and push to `main`; Cloudflare Pages redeploys.
That removes the tag everywhere at once. To stop collection without a deploy, turn the project's
`session_recording_opt_in`/capture settings off in PostHog, or delete the loader asset.

The integration is additive and reversible: it edits one layout, adds two static files, and
touches no data, no database and no existing script.

## Verification evidence

- Consent-gating suite (real `posthog-js` bundle, local mock ingestion): **32/32 assertions**.
- Local preview safety (non-allowlisted host): **13/13 assertions**.
- Live production check after deploy: see the handoff at
  `/Users/agrippa/dashboard/analytics-setup-handoff.md`.
