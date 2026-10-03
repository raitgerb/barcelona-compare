# Paid framing inventory

Audit date: 2026-09-28
Task: t_244b9131
Scope: owner-facing ES, EN and CA `/for-businesses` pages, owner-management/claim entry points, shared owner-facing components, and the static build emitted from the current worktree. No application code or claim/registry data model was changed.

## Build and route surface

`npm run build` passed: 4,957 pages built in 1m25s.

Owner-facing routes present in `src/pages` and `dist`:

| Locale | Partner pitch | Claim flow | Owner management |
|---|---|---|---|
| ES | `/for-businesses/` | `/reclamar/` | `/gestion/` |
| EN | `/en/for-businesses/` | `/en/claim-business/` | `/en/manage/` |
| CA | `/ca/for-businesses/` | no Catalan flow; CTA points to `/reclamar/` | no Catalan management page |

The pitch pages are static and each emits both desktop comparison markup and the mobile tier cards. The claim and management pages are static shells backed by Pages Functions APIs and client-side scripts.

## Paid / plan-comparison framing

The commercial framing is concentrated in the three locale-specific pitch pages. There is no Stripe integration, checkout, purchase endpoint, or payment UI in the source or emitted owner pages.

### English — `/en/for-businesses/`

Source: `src/pages/en/for-businesses.astro`

- Lines 52-77: three tiers are declared:
  - `Free listing`, `€0`, `Live now`.
  - `Claimed`, `€0`, `Live now`.
  - `Pro`, `Price to be confirmed`, `In development`, with copy: `Extra visibility for the most competitive searches. Not on sale yet: claimed businesses get access first.`
- Lines 80-91: comparison rows promise or describe the future Pro tier: expanded photo gallery, featured position marked sponsored, and monthly email stats (views and clicks). Claimed tier is shown as including the verified badge, self-editing, and WhatsApp.
- Lines 93-129: FAQ repeats the framing:
  - `The Pro plan is in development and cannot be bought yet.`
  - `No position is for sale today.`
  - Future featured placements will be marked sponsored and will not change the real customer rating.
  - No booking commission; the site does not manage appointments.
- Lines 245-249: visible heading `Compare the plans` and text `The listing is free and stays free. The Pro plan is in development and cannot be bought yet.`
- Lines 251-301: desktop table and mobile cards emit the three tiers, prices/statuses and all feature rows.
- Lines 319-335: final CTA is claim-only; it does not offer Pro purchase. It repeats that the site is an independent aggregator.

Emitted route: `dist/en/for-businesses/index.html`.
Verified emitted strings include `The listing is free and stays free. The Pro plan is in development and cannot be bought yet.`, `Free listing`, `€0`, and the comparison table heading `What's included`. The emitted page contains no `Stripe` string.

### Spanish — `/for-businesses/`

Source: `src/pages/for-businesses.astro`

- Lines 52-77: equivalent tiers:
  - `Ficha gratuita`, `0 €`, `Activa ahora`.
  - `Reclamada`, `0 €`, `Activa ahora`.
  - `Pro`, `Precio por confirmar`, `En preparación`, with copy that it is not yet for sale and claimed businesses get access first.
- Lines 80-91: equivalent feature matrix, including `Galería de fotos ampliada`, sponsored featured ranking position, and monthly email statistics for Pro.
- Lines 93-129: FAQ repeats `El plan Pro está en preparación y todavía no se puede contratar`, `Hoy no se vende ninguna posición`, sponsored-placement disclosure, and no booking commissions.
- Lines 245-249: visible heading `Compara los planes` and text `La ficha es y será gratuita. El plan Pro está en preparación y aún no se puede contratar.`
- Lines 251-301: desktop table and mobile cards emit the tiers, prices/statuses and features.
- Lines 319-335: final CTA is free claim only; no purchase path.

Emitted route: `dist/for-businesses/index.html`.
Verified emitted strings include `La ficha es y será gratuita. El plan Pro está en preparación y aún no se puede contratar.`, `Ficha gratuita`, `0 €`, and `Qué incluye`. The emitted page contains no `Stripe` string.

### Catalan — `/ca/for-businesses/`

Source: `src/pages/ca/for-businesses.astro`

- Lines 50-75: equivalent tiers:
  - `Fitxa gratuïta`, `0 €`, `Ja disponible`.
  - `Reclamada`, `0 €`, `Ja disponible`.
  - `Pro`, `Preu per confirmar`, `En desenvolupament`, with copy that it is not yet for sale and claimed businesses get access first.
- Lines 77-89: equivalent feature matrix, including sponsored featured ranking position and monthly email statistics for Pro.
- Lines 91-127: FAQ repeats `El pla Pro està en desenvolupament i encara no es pot comprar`, `Avui no hi ha cap posició a la venda`, sponsored-placement disclosure, and no booking commissions.
- Lines 246-250: visible heading `Compara els plans` and text `La fitxa és gratuïta i ho seguirà sent. El pla Pro està en desenvolupament i encara no es pot comprar.`
- Lines 252-302: desktop table and mobile cards emit the tiers, prices/statuses and features.
- Lines 320-336: final CTA is free claim only; it points to the Spanish claim flow.

Emitted route: `dist/ca/for-businesses/index.html`.
Verified emitted strings include `La fitxa és gratuïta i ho seguirà sent. El pla Pro està en desenvolupament i encara no es pot comprar.`, `Fitxa gratuïta`, `0 €`, and `Què inclou`. The emitted page contains no `Stripe` string.

## Shared component framing

- `src/components/VerifiedBadge.astro:9-11,21-40,57-64`: a verified listing with `tier === 'pro'` emits a separate `Pro partner` / `Soci Pro` / `Socio Pro` chip. Titles are `Partner on the Barcelona Compare Pro plan.`, `Negoci amb el pla Pro de Barcelona Compare.`, and `Negocio con el plan Pro de Barcelona Compare.` Paid placement is explicitly separate from the verified badge and is labelled as Pro.
- `src/components/ClaimCta.astro:29-51`: owner entry copy is free claim framing in all locales (`Claim it free`, `Reclámalo gratis`, `Reclama'l gratis`) and says email verification is free/no commitment. No paid CTA.
- `src/components/WhatsappCta.astro:30-35`: emits booking/contact CTA only when a number exists: `Book on WhatsApp`, `Reservar por WhatsApp`, `Reserva per WhatsApp`. This is a contact/booking link, not a paid feature or checkout.
- `src/components/OwnerEditor.astro:17-135`: management UI is free operational editing; it exposes services/prices, price note, WhatsApp, hours, Google-photo visibility and up to three owner photo URLs. It has no plan, price, purchase, Stripe or monetisation copy.
- `src/layouts/BaseLayout.astro:77-88,170-284`: site-wide analytics consent UI and first-party/portfolio analytics loader. This is measurement infrastructure, not partner pricing. It emits consent choices such as `Accept analytics`, `Reject analytics`, `Turn analytics off`, and `Change analytics choice`.

## Owner-management entry points and truthful capabilities

### Claim and verification

- `src/pages/reclamar.astro` and `src/pages/en/claim-business.astro` mount `src/components/ClaimFlow.astro`.
- `ClaimFlow.astro:29-104` emits localized steps for selecting a listing, entering the contact email, entering a six-digit code, and the success state `Listing claimed and verified` (EN) / equivalent Spanish text. It states that the email is used only to verify the person running the listing; it does not promise paid access.
- `docs/claim-flow.md:1-14,25-43,63-89` documents the implemented API path: `POST /api/claim/start`, email-code delivery, `POST /api/claim/verify`, then registry `claimed=1` and `verified=1`. It is throttled, expires codes after 15 minutes, and guards already-claimed listings.
- The CA pitch explicitly discloses at `src/pages/ca/for-businesses.astro:183-185` that the verification form is available in Spanish and English. CA CTAs use `/reclamar/` via `CLAIM_HREF` and `ClaimCta.astro:53-63`.

Truthful claim statement: an owner can select a listed business, request and verify a six-digit email code, and obtain claimed/verified registry state. The verified badge means claimed plus completed email verification; it does not mean Google endorsement or paid placement.

### Profile editing

- `/gestion/` and `/en/manage/` mount `OwnerEditor.astro`; the login requires the email used to claim the listing and then a six-digit owner session code.
- `OwnerEditor.astro:17-135,193-264,446-531` exposes and saves services/prices, an optional price note, opening hours, WhatsApp, hidden Google-photo indexes, and up to three HTTPS owner-photo URLs. Buttons are `Guardar y publicar` / `Save and publish`; success is `Tus cambios ya están publicados en tu ficha` / `Your changes are live on your listing.`
- `docs/owner-profile-edits.md:1-19,53-66,68-108` documents the edge-injected live path and field limits. Published changes are injected into ES/EN detail pages without a rebuild; the edge cache can leave the previous version visible for up to 60 seconds.
- The owner management surface is ES+EN only. The CA page has no `/ca/manage/` equivalent and the CA pitch directs owners to the Spanish claim path.

Truthful profile-edit statement: a claimed/verified owner can authenticate and edit listing services, prices, price note, hours, WhatsApp and photo visibility/URLs; published content is edge-injected into the public ES/EN listing and can be reset to Google-derived data. File uploads are not implemented; owners provide HTTPS URLs.

### Contact and booking links

- All six detail trees use `src/components/WhatsappCta.astro`: ES/EN/CA nails and massage detail routes import it and pass the locale. It emits a full-width WhatsApp link when a valid number exists, with `data-track-event="click_whatsapp"` and a prefilled message.
- `docs/whatsapp-cta.md:7-16,46-62` documents the owner capture path through `/gestion/` and `/en/manage/`, number normalization to `wa.me`, and edge injection after save. It also records the current limitation that an owner cannot remove a Google-derived number through an empty field.
- Phone, website, directions and WhatsApp links are existing direct outbound links. `for-businesses` copy explicitly says the site does not manage appointments and takes no per-customer booking commission.

Truthful contact statement: the directory sends visitors directly to a business's phone, website, directions and (where available) WhatsApp. It does not process appointments, collect booking payments, or take a booking commission.

### Analytics

- `src/components/EventTracking.astro` is included by the four ES/EN detail templates and records first-party counters for views and outbound phone, WhatsApp, website and directions clicks.
- `docs/business-analytics.md:1-13,38-82,84-139` documents `POST /api/track`, admin-only monthly reads at `/api/analytics/:placeId` and `/api/analytics`, and the privacy boundary: no cookies, localStorage, session IDs, IPs, user agents, referrers or visitor identities.
- `src/layouts/BaseLayout.astro` also includes consent-gated PostHog portfolio analytics. This is separate from partner event counters and is not exposed as a partner-facing paid dashboard in the current UI.
- The pitch matrix lists `Monthly stats by email (views and clicks)` / Spanish / Catalan equivalents only under the not-yet-sale Pro column. Current docs describe admin read endpoints and a planned/linked monthly partner email consumer, but no owner-facing analytics page or email UI was found.

Truthful analytics statement: the system currently counts per-business detail views and outbound clicks and exposes monthly aggregates through authenticated admin endpoints. Do not claim that owners currently receive monthly email reports or have a self-service analytics dashboard; the pitch lists that as a future Pro feature.

## Not found / negative controls

Repository/source searches across owner-facing pages, components, functions and docs found no `Stripe` integration, checkout route, purchase handler, subscription management, payment processor, or live Pro purchase CTA. `purchase` occurrences in generated listing review text are third-party review content, not product framing.

Consumer-facing `Precio` / `Preu` / `Price` filters and service-price labels in listing/detail pages are ordinary business price metadata and comparison UI, not paid partner-plan framing. They were not treated as commercial plan occurrences.

The only plan-comparison surfaces are the three `/for-businesses/` locale pages. The only reusable paid-plan label outside them is the conditional Pro chip in `VerifiedBadge.astro`.
