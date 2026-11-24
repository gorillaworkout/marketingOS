# Paid Media / Keyword Trends

Google Ads Keyword Planner monthly trends in MarketingOS, at
`/dashboard/paid-media/keyword-trends`. Port of Bayu's standalone Python tool
(collector + exporter). Design: `docs/superpowers/specs/2026-11-24-keyword-trends-design.md`.

## What it does

- Calls `KeywordPlanIdeaService.GenerateKeywordIdeas` (REST, API v23) with the
  same `GOOGLE_ADS_*` credentials as the Google Ads sync. Read-only planning
  call, free, no treg or other paid gateway.
- Fixed config: seed keyword `forex` + site `https://dupoin.com/`, Indonesia
  (geo 2360), Indonesian (language 1025), Google Search, up to 1000 ideas,
  adult keywords excluded. One keyword-seed request and one site-seed request;
  results merged and de-duplicated by keyword.
- Runs on the first enabled, non-test client account under the MCC (IDR first).
- Stores each fetch as a snapshot (`keyword_trend_snapshots`) with one row per
  keyword and month (`keyword_trend_rows`) and the computed metrics: MoM,
  trend direction, trend index, peak share, heat rank, percentile and level,
  competition, top-of-page bids in IDR.
- Page: latest snapshot table with sort and filters, a 12-month chart per
  keyword, last fetch status, Fetch now, and Export Excel (last 3 search
  months: Summary, Detail, Column guide).
- Access: the `google-ads` feature (Paid Media department) and admins.

## CLI

```bash
npm run keyword-trends:fetch                 # fetch once, store a snapshot
npm run keyword-trends:fetch -- --scheduled  # same, recorded as the monthly run
npm run keyword-trends:fetch -- --dry-run    # fetch and compute only; nothing written
npm run keyword-trends:fetch -- --dry-run --xlsx=/tmp/keyword-trends.xlsx
```

## Monthly cron (not installed automatically)

Server crontab runs in UTC. The 3rd at 06:00 WIB = 23:00 UTC on the 2nd:

```cron
0 23 2 * * cd /home/ubuntu/apps/marketingos && npm run keyword-trends:fetch -- --scheduled >> /home/ubuntu/logs/keyword-trends.log 2>&1
```

Google refreshes Keyword Planner volumes monthly, so fetching more often gives
the same numbers. Only one fetch runs at a time; a fetch still running after 1
hour is marked failed.

## Rollback

Remove the cron line, then run `db/rollbacks/068_keyword_trends_down.sql`. It
drops both Keyword Trends tables and removes the migration row. Google Ads
tables are untouched.
