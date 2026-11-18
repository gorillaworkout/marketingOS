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
```

## Daily cron (not installed automatically)

Server crontab runs in UTC. 09:00 WIB = 02:00 UTC:

```cron
0 2 * * * cd /home/ubuntu/apps/marketingos && npm run google-ads:sync -- --scheduled >> /home/ubuntu/logs/google-ads-sync.log 2>&1
```

## Rollback

`db/rollbacks/066_paid_media_google_ads_down.sql` drops the Google Ads tables, removes `google-ads` from every department, and keeps the Paid Media department row. Remove the cron line first.
