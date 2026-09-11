# WhatsApp booking CTA (B2B Phase 1)

This market books on WhatsApp: you send a message, you get an appointment. Only
**9 of 1,182 listings** had a WhatsApp number when this shipped — that is both the
argument for the feature and the reason it ships in two halves.

1. **Prominent CTA where a number exists.** Detail pages lead with a full-width
   green "Reservar por WhatsApp" / "Book on WhatsApp" button, above the phone /
   website row — not a third small button next to "Web".
2. **A capture path for the other 1,173.** The owner dashboard (`/gestion/`,
   `/en/manage/`) has a *Contacto* card where an owner types their number, and the
   edge injector puts the same button on their listing within a minute — no
   rebuild, no deploy, no email to us.

Both halves carry `data-track-event="click_whatsapp"`, so clicks land in the
per-business counters (`docs/business-analytics.md`).

## The link: formats are normalised

`wa.me` needs the full international number. The content collection stores numbers
the way a local writes them (`640 79 36 74`), and the first version of this CTA
built `wa.me/640793674` — a dead link for **all 9** businesses that had the field.
`normalizeWhatsapp()` in `functions/_lib/whatsapp.ts` (shared by the build-time
templates and the runtime injector) accepts:

| input | stored / linked as |
| --- | --- |
| `640 79 36 74`, `640793674` | `34640793674` (Spanish 9-digit numbers get +34) |
| `+34 640 79 36 74`, `0034…`, `34…` | `34640793674` |
| `+351 912 345 678` | `351912345678` (explicit international is trusted as written) |
| `not-a-phone` | rejected (`invalid_whatsapp`) — the owner sees a format hint |

```bash
# what a listing with a Google number links to today
curl -s https://barcelonacompare.com/nails/%C3%A0ngel-nails/ | grep -o 'https://wa.me/[^"]*'
# -> https://wa.me/34640793674?text=Hola%2C%20os%20escribo%20desde%20barcelonacompare.com%20para%20pedir%20cita.
```

## The message is prefilled

Every link carries `?text=` with a short line in the page's language
("Hola, os escribo desde barcelonacompare.com para pedir cita."). Two reasons: the
business can tell the enquiry came from the directory even without WhatsApp
Business tooling, and the visitor does not have to invent an opening line.

## Owner path

`whatsapp` is one more key on the existing Phase 1 profile patch
(`PUT /api/owner/profile/:placeId`, `docs/owner-profile-edits.md`):

- stored **normalised** (`34611223344`) in `profile_overrides.whatsapp`
  (migration `0005_owner_whatsapp.sql`); `NULL` = the owner never set one, so the
  Google-derived CTA stays;
- the dashboard pre-fills the field with whatever is live right now — the owner's
  number, or the Google-derived one from `/data/businesses.json` (`wa`);
- the templates carry a fourth marker region, `<!--owner:whatsapp-->`, and
  `functions/_lib/owner-content.ts` renders the same button the static page uses.
  That is what makes the capture path real: an owner with no WhatsApp link at all
  sees one on their public page seconds after saving;
- **known limit:** an owner can replace a wrong Google number but not delete it —
  an empty field means "no owner value", so the Google value stays. Ask us and we
  change the frontmatter (operator path).

## Prove it

```bash
PORT=8877 npm run owner:smoke                       # 75 assertions, includes the WhatsApp ones
PORT=8877 npm run owner:smoke -- --url https://barcelonacompare.com --token "$(cat ~/.hermes/profiles/builder/secrets/barcelona-compare-registry-admin-token.txt)"
```

The smoke test saves `+34 611 22 33 44` as an owner, asserts it comes back as
`34611223344`, and reads the served listing HTML for the injected button, the
`wa.me` digits, the label and the attribution message — then asserts it is gone
after a reset. It also fetches a Google-sourced listing (`àngel-nails`) and checks
the dead `wa.me/640793674` form is no longer emitted.

Clicks are measured, not assumed: the CTA fires `click_whatsapp`, so

```bash
curl -s "https://barcelonacompare.com/api/analytics/<placeId>?month=$(date +%Y-%m)" \
  -H "x-registry-admin-token: $(cat ~/.hermes/profiles/builder/secrets/barcelona-compare-registry-admin-token.txt)" \
  | jq '.totals.clicks'
# -> { "phone": 3, "whatsapp": 7 }
```

## Known limits / next steps

- Numbers come from Google or from the owner. Nothing verifies that the number
  actually has WhatsApp on it — an owner who says so is trusted, and there is no
  in-product way to check before publishing.
- The CTA covers the four detail templates. Money pages (`/mejores/`) and the
  listing cards still link only to the listing.
- No click-to-chat tracking beyond our own first-party counter (no UTM, by
  design: the prefilled message is the attribution).
