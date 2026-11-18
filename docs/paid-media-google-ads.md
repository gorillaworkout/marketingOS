# Paid Media: Google Ads

MarketingOS copies Google Ads reporting data into PostgreSQL once a day and on **Sync now**, and shows it under **Paid Media -> Google Ads** (`/dashboard/paid-media/google-ads`).

- **Read-only.** Only `customers:listAccessibleCustomers` and `customers/{id}/googleAds:search` (GAQL `SELECT`) are called. There is no mutate code path, so nothing in Google Ads is ever changed.
- **Free.** The Google Ads API has no per-call cost. treg and OpenRouter are not used.
- **Access** comes only from Accounts -> Departments: the `google-ads` feature ("Google Ads"). Migration 066 creates a **Paid Media** department that has it. Admins always see it. There is no separate Access tab.

## Server configuration (`.env.local` on the VPS)

Key names only; never commit values.

| Key | Required | What it is |
| --- | --- | --- |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | yes | Developer token from the MCC API Center (Basic access or higher for real accounts). |
| `GOOGLE_ADS_CLIENT_ID` | yes | OAuth client id. |
| `GOOGLE_ADS_CLIENT_SECRET` | yes | OAuth client secret. |
| `GOOGLE_ADS_REFRESH_TOKEN` | yes | Refresh token of a Google user who can read the MCC (scope `https://www.googleapis.com/auth/adwords`). |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | yes | MCC (manager) customer id, 10 digits (dashes allowed). |
| `GOOGLE_ADS_CUSTOMER_IDS` | no | Extra client ids, comma separated. Every client under the MCC is synced anyway. |
| `GOOGLE_ADS_API_VERSION` | no | Defaults to `v23`. |

After editing `.env.local`, restart: `pm2 restart marketingos --update-env`. Without the keys the page says which key names are missing.

## What is synced

Accounts: every non-manager client under the MCC (`customer_client`, all levels), plus any id from `customers:listAccessibleCustomers` or `GOOGLE_ADS_CUSTOMER_IDS` that is readable directly. Accounts that error (for example permission denied) are stored with a sanitized error, shown on the page, and skipped; the rest still sync. Closed or canceled accounts are skipped.

| Table | Grain | Notes |
| --- | --- | --- |
| `google_ads_accounts` | customer | Name, currency, time zone, status, last error, last synced. |
| `google_ads_campaign_daily` | customer, date, campaign | KPIs and the trend come from here. |
| `google_ads_ad_group_daily` | customer, date, ad group | |
| `google_ads_keyword_daily` | customer, date, ad group, criterion | `keyword_view`. |
| `google_ads_search_term_daily` | customer, date, ad group, term, match type | Terms with at least one click (the impression-only long tail is ~97% of rows and has no spend). |
| `google_ads_sync_runs` | run | Mode, trigger, counts, per-account details and errors. One running sync at a time. |

Metrics: impressions, clicks, `cost_micros` (account currency x 1,000,000), conversions, conversions value. CTR, average CPC, and cost per conversion are derived when read. Dates are in each account's time zone (Dupoin: Asia/Jakarta, IDR).

Each sync replaces whole 7-day chunks per account in one transaction (upsert, then delete rows in that chunk that Google no longer returns), so re-running is idempotent.

- **Incremental** (cron and Sync now): the last 14 days, because conversions are attributed late.
- **First sync of an account**: 90 days of history automatically.
- **Backfill**: `npm run google-ads:sync -- --backfill` (90 days) or `-- --days=N` (max 400).

## Commands

```bash
npm run google-ads:sync                         # last 14 days, every account (90 for a new account)
npm run google-ads:sync -- --backfill           # 90 days, every account
npm run google-ads:sync -- --customer=1234567890
npm run google-ads:sync -- --dry-run            # fetch + map only, no DB writes, prints row counts
npm run google-ads:sync -- --alerts-only        # recompute alerts from stored data (no Google Ads calls)
npm run google-ads:sync -- --alerts-only --as-of=2026-11-17
```

## Daily cron (not installed automatically)

Server crontab runs in UTC. 09:00 WIB = 02:00 UTC:

```cron
0 2 * * * cd /home/ubuntu/apps/marketingos && npm run google-ads:sync -- --scheduled >> /home/ubuntu/logs/google-ads-sync.log 2>&1
```

## Insights (Paid vs Organic, Search term analysis, Alerts)

Tabs on the Google Ads page. All are free: they read only data already in MarketingOS (the Google Ads sync and the SEO OS Search Console sync). Nothing is written to Google Ads, nothing is emailed or posted, and no paid API (treg, OpenRouter) is used. Thresholds live in `src/lib/google-ads/insights-config.ts`.

- **Paid vs Organic**: Google Ads search terms (or keywords) joined to Search Console queries for the Dupoin site in SEO OS (`seo_sites` matching `dupoin.co.id`), after lowercasing, trimming, and collapsing spaces. Flags: *Top 3 organic, still paying* (avg organic position <= 3, >= 10 organic clicks, >= IDR 50,000 ad spend; the spend is an upper bound of savings) and *SEO opportunity* (paid conversions >= 1 with no organic data, position > 10, or < 5 organic clicks). If Dupoin has no Search Console data for the range, the tab says so and raises no flags. CSV: `export?kind=paid-organic`.
- **Search term analysis**: negative keyword suggestions (search terms with >= the spend threshold, default IDR 100,000, and 0 conversions, per campaign; total = wasted spend) and keyword candidates (converting search terms that are not a keyword in that account and not already added/excluded). CSV: `export?kind=negatives`, `export?kind=keyword-candidates` (same `minCost`/`minConversions` params).
- **Alerts** (`google_ads_alerts`, migration 067): after every sync that stores data (cron and Sync now), the last 7 complete days (ending yesterday, Jakarta) are compared with the 28 days before, per account and campaign: spend spike, CPC rise, cost per conversion rise, conversions drop, and spend stopped (steady spend, then 0 for 2 days; removed campaigns skipped). One open alert per scope and kind; it is refreshed while the condition holds and resolved when it clears. Acknowledge or Dismiss keeps a repeating condition quiet for 7 days. The open count shows on the Alerts tab and on the Google Ads sidebar item. Recent conversions can still be attributed for a few days, so a conversions drop on the newest days can shrink after later syncs.

## Rollback

Alerts only: `db/rollbacks/067_google_ads_alerts_down.sql` drops `google_ads_alerts` (run it before 066's rollback).

`db/rollbacks/066_paid_media_google_ads_down.sql` drops the Google Ads tables, removes `google-ads` from every department, and keeps the Paid Media department row. Remove the cron line first.
