# Keeping Google Places inside the free tier — two guards, both required

The data pipeline calls Google Places API (New). Since March 2025 Google bills **per SKU**,
and every SKU has its **own free monthly allowance** (no pooling between APIs, no rollover
to the next month). Past the allowance the calls are charged:

| Pipeline SKU | Google SKU | Free each calendar month | Price after the free allowance |
| --- | --- | --- | --- |
| `text_search` | Text Search (Enterprise) | 1,000 | $35 per 1,000 |
| `nearby_search` | Nearby Search (Enterprise) | 1,000 | $35 per 1,000 |
| `details` | Place Details (Enterprise) | 1,000 | $20 per 1,000 |
| `photo` | Place Details Photos | 1,000 | $7 per 1,000 |

**Why 1,000 and not 5,000.** The SKU a request bills under is decided by the *highest-tier
field in its field mask*, not by the endpoint. Our masks ask for `rating`,
`userRatingCount`, `regularOpeningHours`, `websiteUri` and `nationalPhoneNumber`, all of
which are Enterprise fields — so every SKU here gets the Enterprise allowance of 1,000, not
the Pro allowance of 5,000. Getting this wrong is not hypothetical: in September 2026 the
guard was written against a 5,000 details cap while the real cap was 1,000, so a run made
1,306 details calls and cost about $6. **If you narrow a mask, raise its cap in
`scripts/places_budget.py` in the same commit; if you widen one, lower it.**

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
   | `SearchTextRequest per day` | 33 |
   | `SearchNearbyRequest per day` | 33 |
   | `GetPlaceRequest per day` | 33 |
   | `GetPhotoMediaRequest per day` | 33 |

5. Confirm the four new limits appear in the table (the *Limit* column changes to your
   value). Lowering a limit applies immediately; Google never needs a redeploy.

**Why 33.** Every SKU's free allowance is 1,000 per *month* (see the table at the top —
Enterprise tier, because of our field masks), and Maps quotas are set per *day*. 1,000 / 30
= 33. The cap therefore lands slightly under one month of free calls, which is the point: a
runaway loop is stopped by Google, and the worst a bad day can do is use up a month of free
calls — never more. What a daily cap cannot do by itself is stop a *second* big day in the
same month from being charged: that is the monthly ledger's job (guard 1). Both together
mean a bill requires Google's quota and our ledger to be wrong at the same time.

**The trade-off to be aware of.** At 33/day a full discovery pass is no longer a one-day
job: last month's pass used 313 Text Searches and 286 Nearby Searches, so at 33/day each
SKU would spread over ~10 days. That is a consequence of our masks sitting in the
Enterprise tier — narrowing them to Pro fields (dropping `rating`, `userRatingCount`,
`regularOpeningHours`, `websiteUri`, `nationalPhoneNumber` from the *search* calls, which
do not need them) would raise Text/Nearby Search to a 5,000 allowance and 166/day. The
details mask genuinely needs those fields for the listing content, so its 1,000/month is
the pipeline's real ceiling either way.

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
