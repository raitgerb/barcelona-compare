# SMS OTP provider and cost spike (hobby scale)

Status: **research artifact, PREPARED — no account, credential, message, code, schema,
route, transport or deployment was created or changed by this spike.**
Evidence date / access date for every URL below: **2026-09-27**.
Scope: cheapest viable SMS OTP delivery for the approved phone-only owner identity
product, at hobby volume (few active listings, low monthly verification count).

This document answers one question the approved design left open
(`docs/business-owner-identity-design.md`, owner decision #3: *"Is operator-mediated
phone/WhatsApp code delivery acceptable as a temporary no-cost phone challenge, or
should phone-only listings be manual-review-only until an approved transport
exists?"*) and one constraint from the standing owner rules: **$0 is a hard ceiling;
no paid service without an explicit per-case decision.**

---

## 1. Current-state audit (step 1)

Command (run in this worktree; no secret value is printed anywhere below):

```bash
grep -rIn -i -E 'twilio|vonage|nexmo|telnyx|messagebird|plivo|sinch|brevo|smsapi|aws-sdk|@aws|amazon sns' \
  functions scripts src/components src/lib src/pages src/scripts package.json .dev.vars.example
```

Output: **no matches.** There is no SMS provider, no SMS SDK, no SMS credential and no
SMS environment variable anywhere in the repository. (A first, wider grep only matched
`.astro/data-store.json`, the generated Astro content index, i.e. listing text — not code.)

What the repository *does* have today:

| Transport | Where | Cost model | Notes |
| --- | --- | --- | --- |
| Email (Resend) | `functions/_lib/claim-mail.ts:141`, `functions/_lib/mailer.ts` | Free tier of the mail provider the owner already uses | The only outbound messaging API the edge code calls is `https://api.resend.com/emails`. Live in production (`docs/claim-flow.md`). |
| Operator outbox (no transport) | `functions/api/claim/outbox/*`, `claim_requests.code_pending` | **€0** | The code stays in D1 and an admin hands it over by phone/WhatsApp and records the hand-over. This is the shipped $0 path. |
| WhatsApp deep link | `functions/_lib/whatsapp.ts`, `docs/whatsapp-cta.md` | **€0** | `wa.me/<number>?text=…` links only — no WhatsApp Business API, no Meta account, no webhook. |
| No phone-as-identity flow | approved but unmerged | — | `docs/business-owner-identity-design.md`, `docs/owner-identity-phase1.md` and migration `0006_owner_identity.sql` exist on branch `wt/t_b6305b8e`, not on `main`. |

The design document's own words bound this spike: *"SMS is not assumed; phone can
initially be operator-mediated or a free-to-receive call/WhatsApp code only if policy
and transport are approved"* and, in the abuse table, *"Never add paid SMS by default."*
Phase 1's production boundary explicitly excludes *"SMS/WhatsApp/email transport, provider
configuration … production migration application"*.

**Who could even be reached by SMS** (frontmatter counts, this worktree):

```bash
for d in nails massage; do t=$(ls src/content/$d/*.md | wc -l); p=$(grep -l '^phone:' src/content/$d/*.md | wc -l); echo "$d: $p of $t"; done
# nails: 711 of 748   /   massage: 722 of 752   -> 1,433 of 1,500 listings carry a Google phone
```

So 95.5% of listings have a phone and (by design) none has an e-mail: the phone-only
challenge covers essentially the whole catalogue. The *demand* side is unmeasured in this
spike: the claim flow's own throttles (60 s per business+email, 5 codes/hour per email,
20/hour per IP, `docs/claim-flow.md`) bound what one visitor can do, but no production
verification count was read for this report — §5 recommendation 4 says how to get the real
number from `claim_requests` before any spend.

**Cloudflare-native option: none exists.** Cloudflare's own Workers tutorial for sending
SMS uses Twilio as the transport
(https://developers.cloudflare.com/workers/tutorials/github-sms-notifications-using-twilio,
accessed 2026-09-27); Cloudflare's 2026 messaging launch is **Email Service**, not SMS
(https://blog.cloudflare.com/email-for-agents, accessed 2026-09-27). A Workers function can
of course call any provider over HTTP — which is exactly what `sendClaimCode()` already does
for Resend. *Absence of a Cloudflare SMS product is asserted from Cloudflare's own
docs/blog only; no Cloudflare product-catalogue export was available to search.*

---

## 2. Providers compared (step 2)

Rates below are copied from the cited page on 2026-09-27. Where a rate could **not** be
retrieved from an official page, it is marked `DATA GAP` rather than estimated.

### 2.1 Twilio (US CPaaS; Spain supported, two-way, sender-ID preserved)

| Item | Value (official) |
| --- | --- |
| Outbound SMS to Spain, alphanumeric sender ID | **$0.0875 per segment** |
| Outbound SMS to Spain, international number | **$0.0875 per segment** |
| Inbound SMS | $0.0075 per segment |
| Sender/phone-number fee | Alphanumeric sender ID **free** ($0/month); international number **from $1.15/month** |
| Failed-message processing fee | $0.001 per message terminating in status `Failed` |
| Optional features | Engagement suite (link shortening/tracking, scheduling) $0.015, first 1,000/month free; SMS pumping protection $0.025/message |
| Alternative product | Verify "starts at **$0.05 per verification**" (higher per-verification price, fewer moving parts) |

Sender and deliverability constraints for Spain (same vendor, guidelines page):

- **Alphanumeric sender ID requires pre-registration, immediately, with provisioning "up to 4 weeks"**;
  dynamic sender IDs are *not* supported; the sender ID *is* preserved to the handset.
- International and domestic long codes are supported; short codes take **12–14 weeks**.
- Sending to a landline fails with error 21614 and is not charged.

Free trial vs free tier:

- Trial: **30 days**, and while on it *"You can send messages and make calls only to
  verified phone numbers"* (**up to 5 recipients**); *"SMS messages and voice calls are
  restricted to your sign-up country"*; account expires 30 days after sign-up.
  **A trial therefore cannot be used to message real Barcelona owners**: it can only text
  up to five numbers the operator has personally verified.
- Sustainable free tier: **none** (Twilio's own pricing page is "Start for free. Then pay
  as you go."). A third party (Sinch's comparison article) puts the trial credit at $15 —
  secondary source, not quoted as fact.

Sources: https://www.twilio.com/en-us/sms/pricing/es · https://www.twilio.com/en-us/guidelines/es/sms ·
https://www.twilio.com/docs/usage/trials · https://www.twilio.com/en-us/pricing (all accessed 2026-09-27).

### 2.2 OVHcloud SMS (EU/EU-billing provider, Spain supported)

| Item | Value (official, ES site) |
| --- | --- |
| Smallest prepaid pack | **118 SMS for €6 + IVA** → **€0.0508 per SMS** (page states "0,7 créditos = 1 SMS enviado a España") |
| Other packs | 1,176 SMS €58 (€0.0493/SMS) · 11,765 SMS €540 (€0.0459) · 588,235 SMS €24,500 (€0.0417) |
| Monthly/subscription fee | **None** — "solo pagas los créditos de SMS utilizados, sin suscripciones ni gastos ocultos" |
| Sender fee | Custom sender ("remitente personalizado") included in the packs; no number rental in the advertised product |
| API | **REST** and **SMPP**, plus a web console; OTP/2FA is named as a supported use case on the page |
| Free tier / trial | **None advertised** (prepaid packs from €6). `TRIAL: none found` — no trial claim was verifiable on the official pages. |

Constraints: sending inside Europe "is guaranteed by default", some destinations need a
prior feasibility study; the FAQ points at a per-country price grid
(https://www.ovhcloud.com/es-es/sms/prices/ — rendered client-side, so the Spain row was
not machine-extractable). Whether a custom alphanumeric sender must be pre-registered for
Spain (Twilio's guideline says operators require it) and whether SMS credits expire are
**open questions, not verified in this spike** — see §6.

Sources: https://www.ovhcloud.com/es-es/sms/ · https://www.ovhcloud.com/es-es/sms/prices/
(accessed 2026-09-27).

### 2.3 AWS (SNS / Pinpoint) — considered, no viable hobby path

| Item | Value (official) |
| --- | --- |
| Per-message Spain rate | **DATA GAP** — the worldwide table on the SNS pricing page is rendered client-side; `grep -i spain` over the served HTML returns **0 matches** |
| Free tier | *"AWS Free Tier includes 1 million mobile push notifications, 1,000 email deliveries and more with Amazon SNS"* — **SMS is not in the free tier** |
| Setup/structural fees | Origination identities must be purchased for many destinations; short codes e.g. US **$650 one-time + $995/month**, provisioning 12–16 weeks; US 10DLC fees ($4 company + $2–10/month campaign + $1/number) |
| Registration | Company/10DLC campaign registration required for US A2P |

Verdict: requires an AWS account, an origination identity and an unretrievable rate for
Spain; there is no zero-cost starting path. Cited for completeness because it is the
"existing cloud stack" fallback if the site ever runs on AWS — it does not: this site is
Cloudflare Pages + D1.
Source: https://aws.amazon.com/sns/sms-pricing/ (accessed 2026-09-27).

### 2.4 Other credible providers — priced but with gaps

| Provider | Official page (accessed 2026-09-27) | Spain rate | Trial / free | Verdict |
| --- | --- | --- | --- | --- |
| Telnyx | https://telnyx.com/pricing/messaging | `DATA GAP` (page prices US local: $0.004/part + carrier passthrough; "rates vary by destination") | Free sign-up, card on file, no platform fee | Cheap for US; Spain price not published on that page |
| Sinch | https://sinch.com/sms/pricing/ (served a Voice page) · https://sinch.com/es/blog/la-mejor-api-de-sms | `DATA GAP` for Spain | **14-day trial with credits** (stated in Sinch's own comparison article) | Enterprise-shaped; no published Spain rate retrievable |
| Brevo (EU) | https://www.brevo.com/pricing/ | `DATA GAP` | Free plan = **300 emails/day**, "SMS credit sold separately" | Attractive only if SMS is bundled with the e-mail plan; no published SMS rate |
| ClickSend (Sinch) | https://www.clicksend.com/pricing/sms/ | `DATA GAP` — `curl 'https://rest.clicksend.com/v3/pricing/sms?country=ES'` returned `404 Country not found` | Top-up model, inbound free | Country table client-side |
| GatewayAPI (DK, GDPR/ISAE-audited) | https://gatewayapi.com/pricing/ | `DATA GAP` (country table client-side) | **Free account**, no subscription, pay per sent message | EU-friendly alternative to OVHcloud; rate unverified |
| Altiria (ES) | https://www.altiria.com/tarifas-sms/ | `DATA GAP` (JS price calculator) | **Free trial account** advertised, no commitment | Spanish operator, prepaid balance, credits explicitly **do not expire**, REST API, custom sender |

**Sustainable free tier conclusion: none of the six providers offers one.**
Every "free" offer found is a **trial** (Twilio 30 days / ≤5 verified recipients;
Sinch 14 days; Altiria/LabsMobile free account) or a **free account with prepaid
credit** (OVHcloud, GatewayAPI). *A trial proves the integration works; it cannot run
a live hobby feature, because a trial cannot reach arbitrary Spanish numbers.*

### 2.5 Non-SMS channels that are genuinely €0 (context for the recommendation)

| Channel | Cost | Constraint |
| --- | --- | --- |
| Operator outbox (**already shipped**) | **€0** | Operator minutes; the code never leaves D1 until hand-over |
| WhatsApp thread, user-initiated | **€0 for the messages that matter**: Meta's pricing doc states messages *from* a WhatsApp user to a business are not charged and *"all non-template messages are free within an open customer service window"* (24 h) | Needs a WhatsApp Business account + verified number; **authentication templates are charged** (rate cards distributed as CSV/PDF; Spain rate `DATA GAP`); it is not SMS and is not part of the approved architecture |
| Cloudflare Email Service (public beta) | Free tier of the e-mail channel already in use | E-mail, not SMS; irrelevant for phone-only listings |

Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/
(accessed 2026-09-27).

---

## 3. Hobby-scale cost scenarios (step 3)

Reproducible arithmetic — the script below is the exact program that produced the tables
(it was run in this worktree, output pasted verbatim; nothing is hand-computed):

```python
VERIFICATIONS = (10, 25, 50, 100)
RETRY_FACTOR = 1.3
TWILIO_ES_USD_PER_SEGMENT = 0.0875
TWILIO_FAILED_FEE_USD = 0.001
OVH_PACK_EUR, OVH_PACK_SMS, OVH_IVA = 6.00, 118, 0.21
OVH_EUR_PER_SMS = OVH_PACK_EUR / OVH_PACK_SMS     # 0.0508 EUR

for v in VERIFICATIONS:
    print(v, v, v * RETRY_FACTOR)                                  # messages
    print(v * TWILIO_ES_USD_PER_SEGMENT, v * RETRY_FACTOR * TWILIO_ES_USD_PER_SEGMENT)
    print(v * OVH_EUR_PER_SMS,          v * RETRY_FACTOR * OVH_EUR_PER_SMS)
    print(v * 12 * TWILIO_ES_USD_PER_SEGMENT, v * 12 * OVH_EUR_PER_SMS,
          OVH_PACK_SMS / v)                                        # first year + pack lifetime
```

### Labelled assumptions

- **A1** 1 verification = 1 delivered SMS, 1 segment (a code message fits inside 160 GSM-7 chars).
- **A2** *Base* scenario: every verification succeeds first try → messages = verifications.
- **A3** *Realistic* scenario: **1.3 messages per verification** (30 % for typos, resends, retries).
- **A4** No number rental: Twilio alphanumeric sender ID ($0/month) or OVHcloud custom sender.
  A dedicated long code would add $1.15+/month (Twilio).
- **A5** Tax-exclusive: Twilio publishes USD ex-tax; OVHcloud shows **+ IVA (21 % in Spain)**.
  **No FX conversion is applied** — compare USD with USD, EUR with EUR.
- **A6** Twilio's $0.001 failed-message fee is shown as a sensitivity, not folded into totals.
- **A7** AWS SNS, Telnyx, Brevo, Sinch, ClickSend, GatewayAPI and the Spanish prepaid
  providers are absent from the money tables because no official Spain rate was retrievable.

### Monthly messages

| verifications/month | messages (base, A2) | messages (realistic, A3) |
| --- | --- | --- |
| 10 | 10 | 13.0 |
| 25 | 25 | 32.5 |
| 50 | 50 | 65.0 |
| 100 | 100 | 130.0 |

### Twilio (USD, ex-tax)

| verifications/month | base msgs | base USD | realistic msgs | realistic USD | +$0.001 failed @2 % |
| --- | --- | --- | --- | --- | --- |
| 10 | 10 | 0.8750 | 13.0 | 1.1375 | 0.00026 |
| 25 | 25 | 2.1875 | 32.5 | 2.8438 | 0.00065 |
| 50 | 50 | 4.3750 | 65.0 | 5.6875 | 0.00130 |
| 100 | 100 | 8.7500 | 130.0 | 11.3750 | 0.00260 |

### OVHcloud SMS (EUR, + IVA)

| verifications/month | base msgs | base EUR | realistic msgs | realistic EUR | months a 118-SMS pack lasts |
| --- | --- | --- | --- | --- | --- |
| 10 | 10 | 0.5085 | 13.0 | 0.6610 | 11.8 |
| 25 | 25 | 1.2712 | 32.5 | 1.6525 | 4.7 |
| 50 | 50 | 2.5424 | 65.0 | 3.3051 | 2.4 |
| 100 | 100 | 5.0847 | 130.0 | 6.6102 | 1.2 |

### First year, base scenario (messages + the one-off pack, no number rental)

| verifications/month | Twilio USD/yr | OVH EUR/yr | OVH EUR/yr + one-off 118-SMS pack (IVA incl., €7.26) |
| --- | --- | --- | --- |
| 10 | 10.50 | 6.10 | 13.36 |
| 25 | 26.25 | 15.25 | 22.51 |
| 50 | 52.50 | 30.51 | 37.77 |
| 100 | 105.00 | 61.02 | 68.28 |

**One-time / setup costs, separated from message fees**

| Item | Twilio | OVHcloud | Notes |
| --- | --- | --- | --- |
| Account | $0 | €0 | both free to open — **not opened by this spike** |
| Sender / number | Alphanumeric sender ID $0/month, **pre-registration required, up to 4 weeks** | Custom sender included in the pack; registration requirement **unverified** | The 4-week lead time is a scheduling cost, not a money cost |
| Minimum purchase | $0 (card on file, post-paid) | **€6 + IVA = €7.26** (118 SMS, prepaid) | Twilio's post-paid model is the unbounded-spend one |
| Dedicated long code (optional) | from $1.15/month | n/a (pack model) | |

**Zero-cost path already in production:** the operator-mediated outbox
(§1) costs **€0.00 per message**; its cost driver is operator minutes, not money.

---

## 4. Free trial vs sustainable free tier (explicit)

| Provider | Free **trial** | Sustainable **free tier** |
| --- | --- | --- |
| Twilio | 30-day trial, ≤5 verified recipient numbers, SMS restricted to sign-up country, credit expires | **No** — pay-as-you-go only |
| OVHcloud | None found | **No** — prepaid packs from €6 |
| AWS SNS | Free tier covers push + 1,000 e-mails; SMS **excluded** | **No** |
| Sinch | 14-day trial with credits (Sinch's own article) | **No** |
| Altiria / LabsMobile (ES) | Free trial account advertised, no commitment | **No** (prepaid balance; credits do not expire) |
| Telnyx / Brevo / ClickSend / GatewayAPI | Free account and/or signup credit | **No** for SMS (Brevo's free tier is **e-mail only**) |
| Operator outbox (shipped) | — | **Yes, €0 forever** (human time instead of money) |
| WhatsApp thread (user-initiated) | — | **Effectively yes** for the reply inside the 24-h service window; authentication templates are charged |

**Zero-cost *starting* path answer: yes, but only the one already built.** There is no
provider whose free tier can carry a live OTP feature; every offer is a trial. The only
€0 sustainable paths are the shipped operator outbox and (if the owner later approves a
non-SMS channel) a user-initiated WhatsApp thread.

---

## 5. Comparison and recommendation (step 4)

| Criterion | Twilio | OVHcloud SMS | AWS SNS | Operator outbox (shipped) |
| --- | --- | --- | --- | --- |
| Cost at 10–100 verifications/month | $0.88–$8.75 | €0.51–€5.08 (+€7.26 one-off) | `DATA GAP` | **€0** |
| Number of moving parts | Trial restrictions, sender pre-registration (≤4 weeks), per-segment billing, geo permissions, optional anti-pumping add-on | Prepaid credits, custom sender, REST API | AWS account + origination identity + registration | None |
| Delivery reliability to Spanish mobiles | Sender ID preserved, two-way, mature deliverability tooling; landline numbers fail visibly (21614) | EU network, sending inside Europe "guaranteed by default"; OTP named as a use case | Unknown for Spain | n/a (human-confirmed) |
| Lock-in | Proprietary REST API (well-supported by libraries) | REST **and** **SMPP** (portable, standard) | AWS-specific | None |
| Abuse / cost-spike risk | **Unbounded**: post-paid, card on file; SMS pumping is a known attack; Twilio sells protection at $0.025/msg | **Bounded by construction**: prepaid credits — a pumping attack can only drain the pack | Post-paid, unbounded | €0 by construction; the risk is operational (an operator handing a code to the wrong person) |
| Privacy / GDPR | US company; EU data-residency options exist but were **not verified** in this spike | EU (France) provider, Spanish billing, EU processing | US (EU regions exist; not verified) | Code stays in the owner's own D1 |
| Implementation effort | One branch in `sendClaimCode()` + 1 secret; **blocked on ≤4-week sender registration in Spain** | One branch in `sendClaimCode()` + 1 secret; account + pack purchase first | Highest (identity registration, rate unknown) | **Zero — already shipped** |
| Fits the approved architecture | Yes, as a transport | Yes, as a transport | Yes, as a transport | Yes — the design names it as the interim phone challenge |

### Recommendation

1. **Do not add paid SMS now, and do not open any account.** At hobby volume the money is
   trivial (€5–7/month at the top of the range) but the *process* is not: Twilio's Spain
   alphanumeric sender needs up to 4 weeks of pre-registration and its trial cannot message
   real owners at all; AWS has no free SMS tier and no retrievable Spain rate. This spike
   found **no provider with a sustainable free tier**.
2. **Run the pilot on the path that already exists:** the operator-mediated hand-over
   (`GET /api/claim/outbox` → phone/WhatsApp → `POST /api/claim/outbox/:id`). Cost €0,
   no credential, no new dependency, and it is already the design's interim phone challenge.
3. **If SMS is wanted later, OVHcloud SMS is the cheapest sourced transport and the only
   one where abuse is capped by construction** (prepaid pack, no card on file, no monthly
   fee, EU provider, REST + SMPP, OTP named as a use case): **€6 + IVA (€7.26) one-off buys
   118 SMS ≈ 11.8 months at 10 verifications/month**, versus Twilio at $0.0875/segment
   (≈1.7× the per-message price) plus up to 4 weeks of sender registration.
4. **Cheapest thing to do before spending anything: measure.** The claim flow already
   stores every request in `claim_requests`; the real monthly verification count is
   available from existing data with **no provider, no spend and no schema change**.

### The exact owner decision needed

> **Approve one of:** (a) keep the €0 operator-mediated hand-over for the pilot and revisit
> once real volume is measured **(recommended — no spend, no new dependency)**; or
> (b) approve a **single prepaid €6 + IVA (€7.26) OVHcloud SMS pack as the hard spend cap**
> — never a card-on-file CPaaS — for one bounded trial of SMS delivery of the existing
> e-mail code; or (c) defer, and let the measured volume decide.

Two facts must be confirmed before (b) can be executed, and both are free to check:
the **lead time/requirement to register a custom sender for Spain**, and **whether OVHcloud
SMS credits expire**. Neither was answerable from the official pages retrieved here.

**Boundary this spike did not cross:** buying credits, creating any account, adding a
secret, sending any message, changing code, schema, routes, or deploying. Also out of
scope: making *phone* the identity (that needs the approved `0006_owner_identity.sql`
schema and its own review) — SMS delivery of the existing e-mail code would not.

---

## 6. Data gaps (stated, not papered over)

| Gap | Why | How to close it (free) |
| --- | --- | --- |
| AWS SNS per-message rate to Spain | Worldwide table is rendered client-side; `grep -i spain` on the served HTML = 0 hits | AWS Pricing Calculator or the SNS FAQ |
| Telnyx, Sinch, Brevo, ClickSend, GatewayAPI, Altiria Spain rates | Country tables/dropdowns are client-side; ClickSend's pricing API answered `404 Country not found` for `country=ES` | Ask each provider for a rate card, or read the page in a real browser |
| OVHcloud: sender-registration requirement/lead time for Spain, credit expiry | Not stated on the pages retrieved | OVHcloud public documentation or support (free) |
| Twilio trial credit amount | Twilio's own pages state the 30-day/5-recipient/sign-up-country limits but not a credit figure; the $15 figure comes from a competitor's article | Twilio console on sign-up (would require creating an account — not done) |
| Data-residency guarantees (Twilio, AWS) | Not verified in this spike | Provider DPA / trust-centre pages |
| WhatsApp authentication-template rate for Spain | Meta distributes per-country rate cards as CSV/PDF links, not inline text | Download Meta's USD rate card CSV |

## 7. Sources (all accessed 2026-09-27)

- Twilio Spain SMS pricing — https://www.twilio.com/en-us/sms/pricing/es
- Twilio Spain SMS guidelines (alphanumeric sender pre-registration, ≤4 weeks) — https://www.twilio.com/en-us/guidelines/es/sms
- Twilio trial limits (30 days, ≤5 verified recipients, sign-up country) — https://www.twilio.com/docs/usage/trials
- Twilio all-products pricing (Verify $0.05/verification) — https://www.twilio.com/en-us/pricing
- OVHcloud SMS (Spain) — https://www.ovhcloud.com/es-es/sms/ · per-country grid — https://www.ovhcloud.com/es-es/sms/prices/
- AWS SNS SMS pricing (free tier excludes SMS; short-code and 10DLC fees) — https://aws.amazon.com/sns/sms-pricing/
- Meta WhatsApp Business Platform pricing (non-template messages free in the service window; authentication templates charged) — https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/
- Cloudflare Workers SMS tutorial (Twilio as transport) — https://developers.cloudflare.com/workers/tutorials/github-sms-notifications-using-twilio
- Cloudflare Email Service public beta — https://blog.cloudflare.com/email-for-agents
- Telnyx messaging pricing — https://telnyx.com/pricing/messaging
- Brevo pricing (free plan = e-mail only) — https://www.brevo.com/pricing/
- ClickSend SMS pricing — https://www.clicksend.com/pricing/sms/
- GatewayAPI pricing (free account, no subscription, GDPR/ISAE) — https://gatewayapi.com/pricing/
- Altiria tariffs (Spanish prepaid, credits do not expire, free trial account) — https://www.altiria.com/tarifas-sms/
- Sinch comparison article (secondary source for trial credits) — https://sinch.com/es/blog/la-mejor-api-de-sms

## 8. Reproduction

```bash
# 1. audit: no SMS provider anywhere in code/config
grep -rIn -i -E 'twilio|vonage|nexmo|telnyx|messagebird|plivo|sinch|brevo|smsapi|aws-sdk|@aws|amazon sns' \
  functions scripts src/components src/lib src/pages src/scripts package.json .dev.vars.example

# 2. the only outbound messaging host the edge code calls
grep -rIn -h -E 'api\.(resend)' functions

# 3. reachable-by-SMS population
for d in nails massage; do t=$(ls src/content/$d/*.md | wc -l); p=$(grep -l '^phone:' src/content/$d/*.md | wc -l); echo "$d: $p of $t"; done

# 4. cost scenarios (script in the workspace, output pasted in §3)
/usr/bin/python3 /tmp/sms_otp_scenarios.py
```
