# Keeping Google Places inside the free tier — two guards, both required

The data pipeline calls Google Places API (New). Since March 2025 Google bills **per SKU**,
and every SKU has its **own free monthly allowance** (no pooling between APIs, no rollover
to the next month). Past the allowance the calls are charged:

| Pipeline SKU | Google SKU | Free each calendar month | Price after the free allowance |
| --- | --- | --- | --- |
| `text_search` | Text Search (Pro) | 5,000 | $32 per 1,000 |
| `nearby_search` | Nearby Search (Pro) | 5,000 | $32 per 1,000 |
| `details` | Place Details (Enterprise) | 1,000 | $20 per 1,000 |
| `photo` | Place Details Photos | 1,000 | $7 per 1,000 |

**Why the tiers differ.** The SKU a request bills under is decided by the *highest-tier
field in its field mask*, not by the endpoint. Discovery uses `TEXT_SEARCH_MASK`, which asks
only for identity, name, address, type and location — the highest of those is `displayName`,
which is Pro, so searches get the 5,000 allowance. Details uses `DETAILS_MASK`, which asks
for `rating`, `userRatingCount`, `regularOpeningHours`, `websiteUri` and
`nationalPhoneNumber` — all Enterprise — so details gets 1,000. That is deliberate:
discovery is only looking, and the listing content comes from details.

**Details is therefore the pipeline's binding constraint: 1,000 candidates a month.**

This is not hypothetical. In September 2026 the details mask was Enterprise but the guard
believed the cap was 5,000 (the Pro number), so a run made 1,306 details calls, crossed the
real 1,000 allowance and cost about $6. **If you change a mask, change its cap in
`scripts/places_budget.py` in the same commit — and re-derive both from
<https://developers.google.com/maps/documentation/places/web-service/data-fields>.**

Two independent guards keep us at $0. Neither replaces the other:

1. **In the code** — `scripts/places_budget.py` counts every call per SKU per calendar month
   in `data/usage-ledger.json` and *refuses* the call that would cross the free allowance.
   This is the guard that guarantees the monthly ceiling, because only it knows the month
   total. It needs nothing from Google. The pipeline phases and `scripts/fetch-reviews.py`
   all spend through it; the legacy scripts (`collect.py`, `enrich.py`,
   `fix-missing-photos.py`, `fetch-editorial.py`, `weekly-refresh.py`) still call the API
   directly and must not be run without a budget check.
2. **At the source (Google itself)** — per-SKU quota limits on the project, so a runaway
   loop is cut off by Google even if the code is wrong, plus a $0 budget alert so an
   unexpected euro is visible immediately. Set this up once, below.

**Status: Part A and Part B are not applied yet** (they need the Google Cloud console, which
requires the operator's login). Until they are, the code guard is the only thing standing
between the project and a bill — which is why the free allowances above are also the
hard-coded caps.

Check usage at any time without opening the console:

```bash
python3 scripts/broaden.py status        # candidates + this month's usage + next-run cost
python3 scripts/places_budget.py         # just the ledger, per SKU, with the last runs
```

---

## Part A — per-SKU quota limits (Google blocks the calls, not just us)

Do this once in the [Google Cloud console](https://console.cloud.google.com/) for the
project that owns the Places API key (the project behind `GOOGLE_PLACES_API_KEY` in `.env`;
if you are not sure, it is the project listed at **APIs & Services → Enabled APIs &
services**, and the key is under **APIs & Services → Credentials**).

1. Open <https://console.cloud.google.com/> and, at the top of the page, select that project.
2. Open the quota page for the API:
   - Preferred path: open the **☰ Navigation menu** → **Google Maps Platform** → **Quotas**.
   - If you do not see *Google Maps Platform*: **☰ Navigation menu** → **APIs & Services** →
     **Enabled APIs & services** → click **Places API (New)** → open the **Quotas** tab.
   - Google moves these menus around. If a label does not match, click the **Search** box at
     the top of the console, type `Quotas`, and pick the Quotas result for the project.
3. On the Quotas page, filter the API to **Places API (New)**
   (there is an *API* dropdown / filter above the table).
4. For each row below, tick its checkbox, click **Edit** (or **Edit quota**), type the value,
   and click **Submit** / **Save**. Set the **per day** metric (Maps quota tables also show
   per-minute rows — do not use those for this):

   | Quota metric (row name) | Value to set |
   | --- | --- |
   | `SearchTextRequest per day` | 166 |
   | `SearchNearbyRequest per day` | 166 |
   | `GetPlaceRequest per day` | 33 |
   | `GetPhotoMediaRequest per day` | 33 |

5. Confirm the four new limits appear in the table (the *Limit* column changes to your
   value). Lowering a limit applies immediately; Google never needs a redeploy.

**Why these numbers.** Maps quotas are set per *day* while the free allowances are per
*month*, so each daily cap is the monthly allowance divided by 30: 5,000 / 30 = **166** for
the two search SKUs (Pro) and 1,000 / 30 = **33** for details and photos (Enterprise and
Photos). Each cap therefore lands slightly under a month of free calls, which is the point:
a runaway loop is stopped by Google, and the worst a bad day can do is use up a month of
free calls — never more. What a daily cap cannot do by itself is stop a *second* big day in
the same month from being charged: that is the monthly ledger's job (guard 1). Both
together mean a bill requires Google's quota and our ledger to be wrong at the same time.

**What that costs in time.** At 166/day a full discovery pass (313 Text + 286 Nearby last
month) fits inside two days. Details is the slow one: 1,000 candidates a month, 33 a day.

**The real ceiling is details, not discovery.** Discovery has room to spare (5,000 each,
166/day). The constraint is that every candidate costs one Enterprise details call against
an allowance of 1,000 — so filter candidates before enriching, and expect a large pass to
run across two months rather than one.

## Part B — budget alert (an email, not a stop)

A budget alert is a **smoke detector**. It notifies you; it does **not** stop spending —
quotas and the ledger are what stop spending.

1. In the console, **☰ Navigation menu** → **Billing** → make sure the billing account linked
   to the project is selected (if asked, click **Go to linked billing account**).
2. In the left menu of Billing, click **Budgets & alerts** → **Create budget**.
3. **Name:** `Maps Platform — free tier ceiling`.
4. **Time range:** Monthly. **Scope:** Projects → the project that owns the Places API key
   (leave *Services* and *Credits* at their defaults, i.e. all services).
5. **Amount:** *Specified amount* → `1` (Google does not accept 0). We expect the real spend
   to be 0, so any euro at all is already a defect.
6. **Thresholds:** tick 50 %, 90 % and 100 %, and enable the email notification to billing
   admins (Google emails billing admins by default). *Do not* spend time on Pub/Sub.
7. Click **Finish**.

You will now get an email the first time the project costs even half a euro, which is the
signal to run `python3 scripts/broaden.py status`, compare the ledger with the console usage
graph (**Google Maps Platform → Metrics**, or **Quotas** for usage-vs-limit), and stop the
pipeline.

## Known hole — legacy scripts bypass the guard

The guard is only as good as what goes through it. These still call the Places API
*directly*, uncounted and uncapped:

`collect.py` · `enrich.py` · `fix-missing-photos.py` · `fetch-editorial.py` ·
`weekly-refresh.py`

`collect.py` in particular still carries the old wide Enterprise search mask, so its calls
would bill at Enterprise (1,000) rather than the Pro allowance this document assumes. The
weekly refresh cron is paused, and the new pipeline (`broaden.py`) supersedes all of them.
**Do not run these scripts.** The fix is to delete them rather than keep patching them — if
one of them is ever needed again, route it through `places_budget.py` first.

## What the code guard does when the free tier is reached

`python3 scripts/broaden.py <phase>` stops *before* the over-limit call, saves its progress
and exits:

| Exit code | Meaning | What to do |
| --- | --- | --- |
| `0` | Finished what you asked for | nothing |
| `1` | Unexpected error (bad key, network) | read the message |
| `2` | This month's free allowance is used up | rerun on/after the 1st of next month — progress is saved |
| `3` | Google blocked the call (the Part A quota) | raise the quota, or wait for the window to reset |

Never work around an exit code 2/3 by raising `FREE_MONTHLY_CAPS` in
`scripts/places_budget.py`: those numbers are Google's published free allowances, and
raising them means paying. `--caps` deliberately cannot raise a cap either — it only lowers
one for a cautious run.
