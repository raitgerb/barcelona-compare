# Business-owner identity and Google-contact recognition design

Status: discovery only; no schema, credential, provider, or production changes
Evidence date: 2026-09-27

## Executive recommendation

Keep the existing passwordless code UX where a contact transport is actually available, but replace its trust decision. A claim or owner login must first resolve the selected listing to its immutable Google Place ID and compare the claimant's contact value with a current, versioned Google contact snapshot for that Place ID. A successful challenge creates a user identity and an owner membership for that exact Place ID; it must never grant access based on a slug, business name, or possession of an arbitrary email address.

The executable recommendation is phone-only for a Google-supplied phone, because the permitted Google Places source currently supplies phone but not email. Email must not be assumed, derived from `websiteUri`, or collected from an unspecified second provider. If an owner-approved authoritative email source is added later, the same exact-match email challenge may be enabled; until then, a listing with only an email alleged by an operator or claimant is manual-review-only. If both an authoritative phone and an approved authoritative email are present, offer either matching contact as a challenge (with an explicit choice). If neither has an approved contact transport, do not self-serve: route to manual review. Existing email-only claims must be migrated as unverified legacy memberships and must pass the new Google-contact check before they receive a new session or edit access.

This is a recommendation, not an implementation approval.

## 1. Current-state audit

### Live journeys tested

The following were fetched with a browser-like User-Agent on 2026-09-27:

| URL | HTTP | Observed behavior | Gap |
| --- | ---: | --- | --- |
| `https://barcelonacompare.com/reclamar/` | 200 | Spanish claim flow renders | Visitor picks a catalog business, enters any syntactically valid email, requests a 6-digit code, then verifies it. |
| `https://barcelonacompare.com/en/claim-business/` | 200 | English claim flow renders | Same email-only trust model. |
| `https://barcelonacompare.com/gestion/` | 200 | Spanish owner editor renders | Login asks for a slug/name and the email used to claim; the code is keyed to the registry Place ID after lookup. |
| `https://barcelonacompare.com/en/manage/` | 200 | English owner editor renders | Same owner-session flow. |
| `https://barcelonacompare.com/ca/claim-business/` | 200 | Canonical is `https://barcelonacompare.com/`; HTML language is `es` | No Catalan claim route; this is the site's soft-404 homepage, not a claim flow. |
| `https://barcelonacompare.com/ca/manage/` | 200 | Canonical is `https://barcelonacompare.com/`; HTML language is `es` | No Catalan management route; soft-404 homepage. |
| `https://barcelonacompare.com/ca/for-businesses/` | 200 | Catalan page, canonical is itself | Catalan marketing CTA points owners to the Spanish `/reclamar`, not a Catalan auth journey. |

A 200 is not route proof on this site: canonical was checked for the CA negative cases.

The live registry probe `GET /api/registry/ChIJdummy` returned 404 `not_found`, proving the public Place-ID lookup is active. An invalid live owner-session POST returned 503 maintenance response (`Ownership and publication endpoints are temporarily disabled...`); therefore live owner mutation/login behavior was not exercised, and this document does not call the current flow a working login. The rendered source journey and endpoint contracts were audited from the repository.

### Source and identity evidence

- Claim page and UI: `src/pages/reclamar.astro`, `src/pages/en/claim-business.astro`, `src/components/ClaimFlow.astro`.
- Claim API: `functions/api/claim/start.ts`, `functions/api/claim/verify.ts`, `functions/_lib/claim.ts`.
- Owner pages and UI: `src/pages/gestion.astro`, `src/pages/en/manage.astro`, `src/components/OwnerEditor.astro`.
- Owner API/session: `functions/api/owner/session.ts`, `functions/api/owner/session/verify.ts`, `functions/_lib/profile.ts`.
- Registry key: `migrations/0001_business_registry.sql`, `functions/_lib/registry.ts`; `businesses.place_id` is the primary key and is sourced from listing `placeId`.
- Claim catalog: `src/pages/data/claim-index.json.ts`, read at the edge by `functions/_lib/catalog.ts`.
- Current claim schema: `migrations/0004_claim_verification.sql`; current owner sessions/profile edits: `migrations/0003_owner_profile_edits.sql`.

### Painted-door gaps

1. **Email is claimant-selected, not Google-recognised.** `POST /api/claim/start` accepts any valid email and sends a code there. A person who controls an arbitrary mailbox can become the recorded owner; no Google contact comparison occurs.
2. **The email is both claim identity and authorization.** `owner_email` is attached to the Place ID after code redemption; the owner session later checks that same registry value. This proves mailbox control, not that the mailbox belongs to the business.
3. **Slug/name input is an unnecessary ambiguity.** The owner UI accepts a slug/name and has duplicate-slug fallback logic. Authorization ultimately binds to Place ID, but the journey does not make the selected Place ID prominent or require a signed listing context.
4. **The code fallback is operationally powerful.** When transport is absent/fails, pending plaintext codes are available through the operator outbox. This is acceptable only as a tightly audited manual procedure, never as anonymous proof.
5. **No revocation relation exists between Google contact changes and memberships/sessions.** `businesses.owner_email` and 30-day owner sessions have no source version or re-verification state.
6. **No Catalan auth journey exists.** CA can link to Spanish claim, but must not imply CA login parity until deliberately added.

## 2. Options considered

| Option | Security / recognition | UX and recovery | Cost | Effort | Decision |
| --- | --- | --- | --- | --- | --- |
| A. Improve current email OTP only | Better throttling and audit, but still cannot establish that email is the contact Google lists. It remains a painted door. | Familiar and low friction; recovery is email-only. | $0 incremental if existing mail transport remains. | Low | Reject: fails the mandatory Google-contact rule. |
| B. Google-contact challenge + first-party business membership (recommended) | Challenge is scoped to Place ID and a normalized contact snapshot. Separate user identity, membership, contact verification, and sessions support revocation and multiple owners. Strongest recognition without trusting an external login. | Phone code only where Google supplies the phone and an approved transport exists; email remains disabled until an authoritative source is approved. One explicit listing selection. Manual path for no/stale contacts. Recovery can use a second matching contact or reviewed evidence. | $0 incremental using existing D1, Pages Functions, and mail if a phone transport is approved without paid SMS. No provider, scraping, or second data source is assumed. | Medium | Recommend. Meets the requirement with the currently feasible Google source. |
| C. External identity provider (Google/Microsoft/Auth0/Clerk/etc.) plus matching | Provider proves control of a human account, not that it matches the listing's Google contact. It still needs the same contact challenge, so the provider adds little recognition. Provider account takeover/dependency and data-sharing risks remain. | Polished sign-in and recovery, but confusing two identities and third-party consent. | Usually $0 at small scale on a free tier, but vendor limits and future cost/lock-in; paid services are not acceptable without approval. | Medium-high | Reject as primary; optional later for convenience after contact verification. |
| D. Operator-only verification | Strong review against public evidence and direct contact; can handle no/stale Google data. | Slow, inconsistent, and does not scale; owner waits for staff. | $0 service cost, but recurring human cost. | Low code, high operations | Retain only as fallback and dispute/recovery lane. |

## 3. Recommended architecture

### Trust boundaries and identifiers

- Listing selection is always a `place_id` from the build catalog, never a free-form name. A deep link may carry the Place ID, but the edge re-resolves it against the current catalog.
- The registry remains keyed by `googlePlaceId`. Slugs are display/routing keys only and never authorization keys.
- A `user` is a first-party identity identified by a stable random ID. Email and phone are contact methods, stored minimally and separately from public registry data.
- A `business_membership` joins `user_id` to `place_id` with a role (`owner`, later `manager`), state (`pending`, `active`, `revoked`), grant/revoke timestamps, and source. Multiple active owners can exist for one Place ID; one user can own multiple Place IDs.
- A `contact_snapshot` records the Google source version/time, contact kind (`email` or `phone`), canonical value hash, and encrypted or access-controlled raw value only if support needs it. Never expose contacts from public APIs. The snapshot is evidence for the exact Place ID, not a global directory of owners.
- A `contact_verification` records which snapshot and challenge proved control, method, timestamps, attempt count, and result. It is append-only/auditable; raw OTPs are never persisted after delivery.
- Sessions are opaque, random, short-lived tokens stored only as hashes and bound to `user_id` plus the selected Place ID (or a narrowly scoped membership). Logout/revoke invalidates them.

### Google contact source-of-truth and ingestion

The central feasibility constraint is explicit: Google Places API (New)'s permitted fields expose phone, but no email field. `websiteUri` is a website URL, not an email address and must never be scraped or transformed into one for self-service authorization. Therefore the first implementation can be executable without an email feed only by offering a phone challenge where a Google phone exists and an approved transport exists; email remains disabled for recognition until the owner approves an authoritative source and its acquisition path.

| Contact / evidence | Current field or source | Authoritative for mandatory self-service? | Acquisition, freshness, and version semantics | $0 / quota gate |
| --- | --- | --- | --- | --- |
| Phone | Google Places API (New) `nationalPhoneNumber`, requested by the existing `scripts/broaden.py` `DETAILS_MASK` and stored in the enrichment output | Yes, after canonicalization to E.164; only for the exact Place ID returned by Google | Obtain only through the existing budget-guarded enrichment path; snapshot the retrieval timestamp, source revision/hash, canonicalization version, and expiry policy. A later refresh that changes/removes it marks the prior snapshot stale and requires re-verification | One Place Details Enterprise call; current published cap is 1,000/month and 33/day. Do not widen the mask or bypass `scripts/places_budget.py`; verify the field/cap against the linked Google data-fields documentation before implementation |
| Email | No email field in the permitted Google Places API (New) fields; not present in the current enrichment path | No; unavailable from the permitted Google source | Do not infer from `websiteUri`, public web pages, social profiles, or claimant input. Enable only after a separately named, owner-approved authoritative source, with documented legal basis, retrieval method, freshness/version, and $0 gate | No Google Places call can supply it. No second provider, scraping, paid API, or quota change is authorized by this discovery |
| Website | Google Places API (New) `websiteUri` | No; website ownership is not an email/contact match | Existing field is retained as listing data only. It may be supporting evidence for manual review, never converted into an email challenge | Included in the existing Details Enterprise call; it does not create email coverage |
| Operator/manual evidence | Staff-provided documents, direct conversation, or a contact discovered outside the authorized Google snapshot | No; never satisfies the mandatory exact-match self-service path | Store only a restricted review record: evidence type, reviewer, reason, decision, grant expiry, and source timestamp. It may produce a time-limited manual membership after human review | No API call required, but it is not Google-supplied evidence and must not be presented as equivalent |

For each Place ID, a contact snapshot is immutable evidence of one retrieval: source name, retrieval time, source version/hash, canonicalization version, contact-kind, and keyed canonical digest. A refresh creates a new version rather than overwriting history. “Current” means the newest successful authorized snapshot inside the configured freshness window; stale, missing, changed, or removed contacts cannot authorize a new self-service challenge. The implementation must not start until the owner has approved the freshness window and confirmed the source/capacity check above.

The challenge service selects only contacts present in the current snapshot for that Place ID:

- Approved email present (only after the separate source gate is accepted): show a masked email and offer email challenge. Only the matching canonical email may continue.
- Google phone present: show a masked phone and offer phone challenge only if an approved, operational transport exists. Only the matching canonical phone may continue.
- Both approved contacts present: either matching method may continue; record which one was used. A policy decision is still needed on whether one method may add a second owner without staff review.
- Neither present: no self-service claim/login. Offer manual review without revealing which contact fields are missing to an unauthenticated caller.
- A phone or email that exists only in manual/operator evidence: no self-service challenge; route to manual review. Manual review may never be silently upgraded to a Google-contact verification.

### Exact-match and normalization rules

“Exact match” means exact equality after one published, deterministic canonicalization; it does not mean fuzzy similarity.

Email:

1. Trim leading/trailing Unicode whitespace and lowercase using the same locale-independent rule on the Google value and the submitted value.
2. Compare the complete address, including local-part punctuation and `+tag`; do not remove dots, tags, aliases, or anything after `+`.
3. Do not apply provider-specific Gmail rules. Do not accept display names, partial addresses, forwarding addresses, or a domain-only match.
4. Store/compare a keyed digest of the canonical address; retain the raw value only in a restricted contact snapshot if required for support.

Phone:

1. Parse both values with a fixed country context derived from the Google listing (Spain for this Barcelona directory), accepting formatting differences such as spaces, parentheses, hyphens, and a leading `+`.
2. Convert to canonical E.164 digits (`+34600111222` shape) and compare the complete number. Do not accept last-7/last-9-digit matches, a different country code, extension omission, or a caller ID that merely resembles the listing.
3. A national Spanish number may be converted to +34 only when it is a valid Spanish national number and the listing country context is Spain. Invalid/ambiguous numbers fail closed and go to review.
4. Do not silently infer a phone from a website, social profile, or user-supplied value; those can be evidence for manual review only.

If canonicalization changes between releases, retain the canonicalization version on each snapshot and verification. Do not silently reclassify old evidence.

### Authorization and migrations from current claims

- Existing `businesses.owner_email` rows become legacy memberships with `recognition_state = legacy_email_unverified`; they remain visible as currently verified only if the owner has already passed the existing flow, but cannot obtain a new session or transfer rights until a matching Google contact challenge succeeds.
- A successful new challenge must atomically: create/find the user, create or activate the membership for the exact Place ID, append contact-verification evidence, and issue a scoped session. Replays are idempotent; concurrent claims cannot create a second conflicting primary owner.
- Existing `profile_overrides` stay attached to `place_id`; no slug migration is needed. Access checks must use active membership + Place ID, not `owner_email` alone.
- Revocation sets membership `revoked`, invalidates all sessions for that membership, and leaves audit events and content history. Reclaim requires a fresh matching Google-contact challenge or manual review.
- A wrong-business attempt must reveal only a generic failure. Never confirm whether a contact belongs to another listing or whether a Place ID is already claimed.

## 4. Threat, abuse, privacy, and recovery model

| Threat | Control |
| --- | --- |
| Claim a competitor's listing | Place-ID-scoped challenge; contact must match Google snapshot; no name/slug authorization. |
| Guess a 6-digit code | 15-minute expiry, single use, five attempts, per-contact/Place/IP throttles, generic errors, no code in anonymous response. |
| Enumerate businesses or contacts | Catalog may show public listing data, but challenge responses are uniform; mask contacts and never say “email exists.” |
| Replay/stolen session | Hash opaque tokens, bind to user+Place ID, short idle/absolute TTL, rotate on re-verification, revoke all sessions on membership/contact change. Prefer HttpOnly Secure SameSite cookies in implementation; if static JS must use a header, document localStorage/XSS trade-off and reduce TTL. |
| Operator/outbox compromise | Least-privilege admin access, no plaintext retention after handover, access logging, expiry, generic owner-facing responses, and a manual verification SOP. |
| Contact data is stale or hijacked in Google | Do not silently grant on stale data. Mark snapshot stale; stop new challenges when source changed/expired; require a fresh matching snapshot or manual review with independent evidence. |
| Google removes contact data | Existing memberships enter `reverify_required` at the next auth boundary; revoke active sessions for high-risk changes. Do not delete audit history or publish the raw reason. |
| Wrong business selected | Show name/address/category and the Place ID-derived canonical listing before challenge; deep link from the detail page; require explicit confirmation. |
| Spam, mail/SMS cost abuse | Per-IP, per-Place, per-contact, and global quotas; CAPTCHA/Cloudflare rule only if measured abuse warrants it. Never add paid SMS by default. |
| Privacy leakage | Public responses contain no contact or owner identity; keyed hashes, restricted raw snapshots, short OTP retention, deletion/retention schedule, and audit records without raw secrets. |

Recovery paths:

1. Matching second contact on the current Google snapshot can recover access.
2. If Google has stale, wrong, or no contact, the owner submits a manual request; staff verifies independent evidence and records a reason, reviewer, and expiry. Manual approval is explicitly not equivalent to a Google-contact match and may be time-limited.
3. A Google data correction triggers re-verification. Existing owner content is preserved but can be hidden by moderation if the business relationship is disputed.
4. For a disputed listing, freeze new membership grants, revoke sessions for the affected membership(s), retain audit history, and resolve the Place ID mapping before restoring access.

## 5. Implementation phases and gates

### Phase 0 — decision and measurement (no production writes)

- Owner confirms the source matrix: `nationalPhoneNumber` is the only currently feasible Google self-service contact; Google Places supplies no email field. Decide the freshness window, whether either approved contact is sufficient when both exist, whether phone challenge may use an existing free/manual operator path, session storage policy, and manual-review SLA/evidence standard. An email source is a separate future approval, not an open Phase 0 task.
- Measure phone coverage and freshness from an existing authorized dataset without changing masks or spending budget. Report email coverage as “not available from the permitted Google source,” rather than implying an email count. Do not scrape, fetch, or enrich contacts in this phase.
- Gate: written owner acceptance of the exact-match and stale/no-contact policy; Cato review of this design.

### Phase 1 — schema and pure data layer (test/local only)

- Add migrations for users, contact snapshots, memberships, verification events, and scoped sessions. Keep old registry tables intact for rollback.
- Implement canonicalization as pure functions with table-driven tests (case/whitespace, plus tags, Unicode, phone formatting, country context, invalid values).
- Add migration tooling that creates legacy memberships but does not activate new recognition.
- Gate: unit tests, migration apply/rollback rehearsal in local D1, no production migration.

### Phase 2 — challenge API and UI behind a disabled flag

- Build Place-ID-only start/verify endpoints, generic anti-enumeration errors, throttles, audit events, and a phone transport adapter only after owner decision. Keep email challenge code disabled until its source gate is approved; if phone transport is unavailable, return the same generic manual-review path as no-contact cases.
- Update ES and EN claim/manage journeys. Keep CA links explicitly routed to ES until a CA UI is approved; do not create a false CA login.
- Gate: adversarial tests for wrong Place ID, wrong contact, replay, concurrency, code brute force, stale snapshot, no contact, revoke, and duplicate owners.

### Phase 3 — controlled pilot

- Enable for a small, operator-selected set using existing free infrastructure. No paid provider or API quota change.
- Verify exact Place ID recognition, membership scoping, revocation, edge-rendered profile access, and support recovery. Preserve a timestamped audit export with no raw OTPs.
- Gate: Cato accepts the exact reviewed head; owner approves live pilot; all smoke tests pass; no unresolved critical abuse finding.

### Phase 4 — migration and public rollout

- Re-verify legacy memberships, communicate the new requirement, and put unverified legacy access into read-only or reverify-required state according to owner decision.
- Enable listing/deep-link CTAs, monitor false rejects and abuse, and publish retention/manual-review policy.
- Gate: uncached live ES/EN verification and revocation tests on a designated test listing, production deployment evidence, and rollback procedure.

## 6. Explicit owner decisions required before implementation

1. When both approved authoritative contacts exist, is either matching contact sufficient, or must a claimant prove both? (Today only Google phone is approved; Google Places email is unavailable.)
2. What is the contact freshness window, and should a changed/removed Google contact immediately revoke sessions or only require re-verification at next login?
3. Is operator-mediated phone/WhatsApp code delivery acceptable as a temporary no-cost phone challenge, or should phone-only listings be manual-review-only until an approved transport exists? A transport failure must never fall back to claimant-selected email or manual evidence as self-service proof.
4. Should legacy email-verified owners become read-only pending matching re-verification, or retain editing until the announced deadline?
5. What independent evidence and reviewer authority are acceptable for stale/no-contact recovery, and how long should a manual grant last?
6. Approve the first pilot population and whether a CA claim/manage UI is in scope; until then CA must continue to link to the ES journey.
7. If email recognition is desired, name and approve the authoritative email source, acquisition path, legal basis, freshness/version semantics, and $0 gate; until that decision, email is not a supported self-service method.

## Evidence and scope boundary

This artifact records source paths, live route behavior, options, and a proposed design. It makes no production writes, creates no provider account, changes no credentials, changes no schema, and does not fetch additional paid Google data.
