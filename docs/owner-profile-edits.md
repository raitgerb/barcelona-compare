# Self-service profile edits (B2B Phase 1)

Owners edit their own listing — services, prices, opening hours and photos — through
a form, and the change is live on their profile within a minute. No rebuild, no
deploy, no dashboard for us to touch.

- **Dashboard:** `/gestion/` (ES) · `/en/manage/` (EN) — static page + client-side JS
- **API:** `functions/api/owner/*` (session + edits), `functions/api/profile-overrides/*`
  (public read + operator moderation)
- **Data:** `migrations/0003_owner_profile_edits.sql` (`owner_sessions`,
  `profile_overrides`, `profile_edit_events`)
- **Data layer:** `functions/_lib/profile.ts` — the only module that touches those tables
- **Live render:** `functions/_middleware.ts` + `functions/_lib/owner-content.ts` —
  edge-injects the owner's content into the static listing HTML
- **Test:** `scripts/owner-edit-smoke.sh` (`npm run owner:smoke`) — 45 assertions
  through the real Pages Functions runtime, including the served listing page

Sits on top of the Phase 0 registry (`docs/business-registry.md`): only a business
the registry has as **claimed by that email** can log in.

## How an owner gets in

Owners are not technical, so there are no passwords — a short code and a device
that stays signed in:

1. `/gestion/?b=<slug>` (the profile page's manage link carries the slug; typing the
   slug by hand works too) → enter the email used to claim the listing.
2. `POST /api/owner/session` looks the business up in the registry. It only issues a
   **6-digit code** (15 minutes, 5 codes per business per hour) when that email is the
   one on `businesses.owner_email`.
3. `POST /api/owner/session/verify` trades the code for a **session token** (32 random
   bytes, 30 days, stored as `sha256(token || ':' || place_id)`, never in plaintext).
   The token is bound to one place id and travels in `x-owner-session`; the browser
   keeps it in `localStorage`, so an owner reopens the dashboard straight into step 3.
   Five wrong codes and the code dies — the 6-digit space cannot be brute-forced.

**Code delivery.** With `RESEND_API_KEY` + `EMAIL_FROM` set in the Pages project the
code is emailed. Without them (today's state) the code is logged, and a caller holding
`X-Registry-Admin-Token` also gets it in the response, so the operator can hand it to
the owner by phone or WhatsApp — which is how this audience already gets onboarded.
An anonymous caller never sees a code; the response is deliberately explicit about
`not_claimed` (404) and `email_mismatch` (403) because a locked-out owner needs to know
which email to try.

## What an owner can edit

| field | rules |
| --- | --- |
| `services` | up to 25 `{ name, price? }` rows, name ≤ 80 chars, price ≤ 30 chars, duplicates dropped |
| `priceNote` | ≤ 120 chars, optional |
| `hours` | per weekday `HH:MM-HH:MM` (24h) or `""` = closed |
| `hiddenPhotos` | indexes `0-4` of the Google photo strip to hide |
| `addedPhotos` | up to 3 **https** image URLs, HEAD-checked (`image/*`) before saving |

`PUT /api/owner/profile/:placeId` is a patch: only the keys present are touched, and
`services: []` / `hours: {}` deliberately blank a section. `DELETE` puts the listing
back on its Google-derived data.

## How an edit becomes visible (edge-inject)

The listing pages are static, so the same HTML ships to everyone. The four listing
templates (`nails`, `massage` × `es`, `en`) carry three HTML-comment pairs:

```html
<!--owner:services--> …Google-derived section… <!--/owner:services-->
```

`functions/_middleware.ts` runs for **every** request but only continues past its
first line for `/nails/<slug>/`, `/massage/<slug>/` and their `/en/` twins. When a
business has a published row in `profile_overrides` (one indexed D1 point read), the
middleware takes the static response, swaps the three regions for the owner's version
and returns it with `cache-control: public, max-age=60`. Otherwise the response is
untouched — so unclaimed listings (1,182 of them) cost one boolean D1 lookup and
nothing else.

Why this instead of a rebuild: edits are live in seconds rather than after a 2,600-page
build, the content is in the server response (crawlers and no-JS clients see it), and
nothing in the build pipeline gains a dependency. The alternative — fetch
`GET /api/profile-overrides` at build time and bake the content in — remains available
and is what that endpoint exists for; it is the fallback if the middleware ever has to
go.

Two details worth knowing:

- **Hidden Google photos stay in the DOM** with `style="display:none"`. The lightbox
  (`src/components/Lightbox.astro`) resolves photos by DOM index against
  `<galleryBase>-N.jpg`, so removing a node would shift every later photo onto the
  wrong file. Hiding keeps each photo pointing at its own image, and the lightbox
  already skips elements with `offsetParent === null`.
- **Owner photos live in a separate block** (not `.photo-gallery`), so the lightbox
  never tries to resolve a third-party URL as a site image; each one links to the
  full-size file.

If the markers are missing from a response, the row does not exist, or anything throws,
the middleware returns the static page (or `next()`). A broken injector can never take
a listing page down.

## Operator surface

| call | purpose |
| --- | --- |
| `GET /api/profile-overrides` | every published edit, newest first (public, 60s cache) |
| `GET /api/profile-overrides/:slugOrPlaceId` | one edit (public; unpublished needs the token) |
| `PUT /api/profile-overrides/:key` `{"op":"publish"\|"unpublish"}` | takedown / restore |
| `DELETE /api/profile-overrides/:key` | remove the row (audit trail stays) |
| `GET /api/owner/profile/:placeId` with the admin token | read any business's content + audit trail |
| `PUT /api/owner/profile/:placeId` with the admin token | edit on an owner's behalf |

Every write appends to `profile_edit_events` (`owner_create`, `owner_save`,
`owner_reset`, `operator_publish`, `operator_unpublish`, `operator_delete`) with the
actor and a JSON detail, so disputes have a trail.

## Local development

```bash
npm run build                    # wrangler pages dev serves dist/
npm run db:migrate:local         # applies 0003 on top of 0001/0002
npx wrangler pages dev dist --port 8799
npm run owner:smoke              # 45 assertions, ends with the listing HTML check
```

Against a deployment (preview and production share the D1 database — the writes are
real and the script deletes its own rows at the end):

```bash
npm run owner:smoke -- --url https://barcelonacompare.com --token "$(cat ~/.hermes/profiles/builder/secrets/barcelona-compare-registry-admin-token.txt)"
```

`KEEP=1` leaves the test rows behind; `SLUG=… CATEGORY=…` point the test at another
listing (the slug must be a real page so the injection assertions have something to
read).

## Deployment checklist

1. Apply the migration: `npm run db:migrate:remote` (0003 only adds tables).
2. Nothing else is required — the D1 binding `DB` and the operator token already exist
   in production and preview from Phase 0.
3. Optional, for emailed codes: add Pages → Settings → **Variables and secrets**
   → `RESEND_API_KEY` (type **Secret**) and `EMAIL_FROM` (type **Text**, e.g.
   `Barcelona Compare <hola@barcelonacompare.com>`), then redeploy. Without them the
   dashboard works, codes are logged, and the operator hands them over.
4. Optional: `PUBLIC_SITE_URL` (Text) if emails should link to a canonical origin
   instead of the request origin.

## Known limits / next steps

- **Photo uploads:** owners paste image URLs, they cannot upload files yet. That needs
  an R2 binding on the Pages project plus multipart handling — a separate card.
- **One platform, two categories:** the dashboard renders the listing URL from the
  business's category; a business whose registry `category` is missing falls back to
  `nails`.
- **No email transport yet** (see above), so production onboarding is operator-assisted.
- **Cache:** injected pages are cached for 60s at the edge; an owner staring at their
  own profile may see the previous version for up to a minute.
- The public list endpoint has no rate limiting; the write endpoints are protected by
  the session token and the registry admin token. Add Cloudflare rate-limit rules before
  promoting the dashboard publicly.
