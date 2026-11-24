# Keyword Trends (Paid Media) — design

Date: 2026-11-24. Approved by Bayu in chat on 2026-11-24.

## Goal

Port Bayu's standalone Python tool (Google Ads Keyword Planner monthly trends,
`collector.py` + `exporter.py`) into MarketingOS as a Paid Media page. The
Python is not shipped; its logic is reimplemented in TypeScript on top of the
existing read-only Google Ads REST client (PRs #190/#191).

## Scope

- New page **Keyword Trends** at `/dashboard/paid-media/keyword-trends`, in the
  Paid Media sidebar group under Google Ads. English UI with a short explanation
  at the top.
- Access: same gate as Google Ads. The page is an alias of the existing
  `google-ads` Accounts feature (`DASHBOARD_FEATURE_ALIAS_HREFS`), so the Paid
  Media department and admins see it. No new Accounts feature key and no
  department changes. (A separate key can be added later if Bayu wants to grant
  Keyword Trends without Google Ads.)
- Every API route calls `requireFeature(request, 'google-ads')`.

## Fixed configuration (not editable in the UI)

| Setting | Value |
|---|---|
| Seed keywords | `forex` |
| Page URL (site seed) | `https://dupoin.com/` |
| Market | Indonesia, geo target constant 2360 |
| Language | Indonesian, language constant 1025 |
| Network | `GOOGLE_SEARCH` |
| Max ideas | 1000 |
| Include adult keywords | false |
| Keyword annotation | `KEYWORD_CONCEPT` |

Request specs mirror `_request_specs`: one keyword-seed request per batch of up
to 20 seeds, plus one site-seed request. Each request pages up to 1000 ideas.
Ideas are merged and de-duplicated by case-folded keyword text, first seen wins
(keyword batch before site), and every source that returned the keyword is kept.
The merged list is cut to the first 1000.

The account used for the call is the first enabled, non-test, non-manager
client account under the MCC (IDR preferred, then name, then id). Bids come
back in that account's currency (IDR for Dupoin).

## Data source and cost

`KeywordPlanIdeaService.GenerateKeywordIdeas` over REST
(`POST /v23/customers/{id}:generateKeywordIdeas`), using the same
`GOOGLE_ADS_*` credentials, OAuth refresh, retries and error sanitizing as the
Google Ads sync. It is a read-only planning call, free, and never uses treg.
Live check on 2026-11-24 from the VPS: HTTP 200 for both keyword and site seeds.

## Schedule

- Monthly, on the 3rd at 06:00 WIB (server crontab is UTC: `0 23 2 * *`),
  running `npm run keyword-trends:fetch -- --scheduled`. Like the Google Ads
  daily cron it is documented in `docs/paid-media-keyword-trends.md` and is not
  installed automatically.
- Manual **Fetch now** button on the page.
- One fetch at a time (partial unique index on running snapshots). A snapshot
  still running after 1 hour is treated as crashed and marked failed.

## Storage (migration 068)

- `keyword_trend_snapshots`: one row per fetch: status (running, succeeded,
  failed), trigger (manual, scheduled, cli), triggered_by, report_date (WIB
  date), account id/name/currency, config JSON, idea and row counts, first and
  last search month, error, started/finished timestamps.
- `keyword_trend_rows`: one row per snapshot x keyword x search month, with the
  metrics of `monthly_trend_rows`:
  - avg monthly searches, monthly searches, previous month searches
  - MoM change abs and pct
  - trend direction: NEW (previous 0, now above 0), RISING, FALLING, STABLE
    (also the first month, which has no previous)
  - trend index pct (month / average), peak monthly searches, peak share pct
  - heat rank (dense rank of the average, descending), heat percentile pct
    (share of ideas with average at or below this one, 0 when the average is 0),
    heat level (HIGH at 80 and above, MEDIUM at 50 and above, else LOW)
  - share of total average, result-set monthly total, monthly share, monthly
    rank and monthly heat percentile
  - competition and competition index
  - low and high top-of-page bid in micros and converted to the account
    currency (micros / 1,000,000), bid midpoint and range
  - keyword word and character counts, is seed keyword, discovery sources,
    concepts
- Percentages are stored on a 0 to 100 scale, rounded to 6 decimals.
- Rollback: `db/rollbacks/068_keyword_trends_down.sql` drops both tables and
  removes the migration row. No existing table is touched.

## Page

- Header: explanation of the data, snapshot date, last fetch status (time,
  trigger, result or error), Fetch now, Export Excel.
- Table of keywords from the latest succeeded snapshot: keyword, avg monthly
  searches, last-month searches, MoM abs, MoM %, trend, competition, CPC low,
  CPC high (IDR). Sort on every column. Filters: keyword text, trend,
  competition, minimum avg volume.
- Click a keyword to show its 12-month volume line chart (inline SVG, same as
  the Google Ads daily trend; the repo has no chart library).

## Excel export

`GET /api/paid-media/keyword-trends/export` builds an XLSX with ExcelJS (already
used in the repo) from the latest succeeded snapshot, last 3 search months:

- **Summary**: snapshot date, fetched at, account, market, language, network,
  seeds, page URL, months exported, keyword and row counts.
- **Detail**: one row per keyword and month. Percent columns are numeric
  fractions with `0.00%` number format, counts use `#,##0`, money `#,##0.00`.
  Header row frozen, auto filter.
- **Column guide**: column name and English definition.

## Out of scope

Editing seeds or markets in the UI, more markets, writing anything to Google
Ads, alerts, and comparisons across snapshots (snapshots are kept so this can
be added later).

## Open point found in the live dry run (2026-11-24)

Mirroring the Python merge (keyword batch first, then site, cut to 1000), the
`forex` keyword seed alone returns 1000+ ideas, so the dupoin.com site seed
only adds its source label to keywords already found (8 of 1000 in the dry
run) and contributes no site-only keywords. Options if Bayu wants the site
ideas to show: raise the cap, or reserve part of the 1000 for site ideas.
Kept as-is for now to match the Python tool.
