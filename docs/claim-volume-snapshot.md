# Production claim-request volume snapshot

Status: **MEASURED, read-only**. This note records a direct production D1 read on
2026-09-27. No production write, migration, deployment, provider account, message,
or spend was performed.

## Access path

The production database was queried with Wrangler's read-only D1 execution path:

```bash
npx --yes wrangler d1 execute barcelona-compare-registry --remote --command "SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS total_requests, COUNT(DISTINCT place_id) AS distinct_businesses, SUM(CASE WHEN code_pending IS NOT NULL THEN 1 ELSE 0 END) AS code_pending FROM claim_requests GROUP BY month ORDER BY month;" --json | jq '.[].results'
```

Authentication was supplied by the ambient `CLOUDFLARE_API_TOKEN` environment
variable; its value is intentionally not recorded. The database was the production
D1 database named `barcelona-compare-registry` (database ID is configured in
`wrangler.toml`). The command reported `rows_written: 0` and `changes: 0` in the
underlying Wrangler JSON response.

## Query and columns

The exact SQL query was:

```sql
SELECT strftime('%Y-%m', created_at) AS month,
       COUNT(*) AS total_requests,
       COUNT(DISTINCT place_id) AS distinct_businesses,
       SUM(CASE WHEN code_pending IS NOT NULL THEN 1 ELSE 0 END) AS code_pending
FROM claim_requests
GROUP BY month
ORDER BY month;
```

The real schema column names queried are `created_at`, `place_id`, and
`code_pending`. `code_pending` is the nullable plain-code column in the production
schema; this count is the number of rows where it is currently non-null.

## Raw output

The command above was run with the `jq '.[].results'` projection shown above. Its
raw stdout was:

```json
[
  {
    "month": "2026-09",
    "total_requests": 1,
    "distinct_businesses": 1,
    "code_pending": 0
  }
]
```

For the covered date range, the exact read-only query was:

```sql
SELECT MIN(created_at) AS first_created_at,
       MAX(created_at) AS last_created_at,
       COUNT(*) AS rows_in_range
FROM claim_requests;
```

Its raw stdout, using the same `--json | jq '.[].results'` projection, was:

```json
[
  {
    "first_created_at": "2026-09-26T23:03:13.088Z",
    "last_created_at": "2026-09-26T23:03:13.088Z",
    "rows_in_range": 1
  }
]
```

The data actually covers **2026-09-26T23:03:13.088Z through
2026-09-26T23:03:13.088Z**: one production row, in the September 2026 calendar
month. This is not a full historical month and should not be extrapolated into a
forecast.

## Monthly counts

| Calendar month (UTC) | Total claim requests | Distinct businesses (`place_id`) | Rows with `code_pending IS NOT NULL` |
| --- | ---: | ---: | ---: |
| 2026-09 | 1 | 1 | 0 |

## Interpretation and decision band

- Measured demand is **1 verification request in the only observed month**, with 1 distinct business and 0 currently pending codes.
- This is **below the lowest spike band (10 verifications/month)**, not within the 10 / 25 / 50 / 100 bands.
- The observation window is only one request and one moment, so it establishes the recorded demand but not a stable monthly forecast.
- At this measured volume, the data does not justify buying a prepaid OVHcloud pack; it supports **decision (a), hold €0 on the shipped operator outbox**.
- The owner may still choose **(c), defer**, if a longer observation window is required before deciding; this measurement itself does not authorize **(b)** or any spend.

## Reproduction check

The monthly query and the date-range query were each re-run after the initial
read. The projected result JSON above was captured from that rerun. The result
rows reproduced exactly; only Wrangler's non-result timing/region metadata is
run-specific and is excluded by the documented `jq '.[].results'` projection.
