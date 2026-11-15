# Partnership: Global Industry Trends

Menu: Partnership → Global Industry Trends (`/dashboard/partnership/global-trends`).
Access: the `partnership` Accounts feature (same as Competitor Intelligence and Proposal Builder).

## What it does
A digest of what similar brokers worldwide are doing, grouped by theme:
sponsorships (sports/esports), affiliate/IB programs, brand collaborations, promos/campaigns,
app/product features, education/community, regulation & compliance, and marketing channel patterns.

Each digest has:
- item cards (brand, date, summary, source link), grouped by theme;
- **Top trends this period**: patterns across brands, each listing the item ids it is based on;
- **Ideas for Dupoin (Indonesia, BAPPEBTI-compliant)**: each idea lists the item ids that inspired it.

Window: last 30 or 90 days (picker next to Refresh). The weekly cron builds one 30-day digest.

## Sources (free only)
| Source | How | Notes |
| --- | --- | --- |
| Google News RSS (English) | one query per watched brand + one per theme, `when:30d` / `when:90d` | Reviews, rankings and "vs" comparison headlines are skipped |
| Official newsroom / blog | `crawlSite` (public host + DNS-rebinding guard, same host, robots.txt), 6 pages, 25 s per brand, 150 s total | Only pages with a published date inside the window are used |
| Serper news (optional) | only when `SERPER_API_KEY` is set | Skipped otherwise; noted in the digest |

## Citation enforcement (in code, not just the prompt)
- Every item must cite at least one source id from the catalog (`refsFor`, shared with Competitor Intelligence).
- The cited source must name the item's brand (whole-word match; "IG" never matches "trading").
- At least one cited source must be dated inside the window.
- Trends and ideas must cite surviving item ids; anything else is dropped.
- Ideas: unverified Dupoin claims (awards, licences, ratings) are stripped by `brand-fact-guard`;
  ideas promising guaranteed/risk-free profit are dropped; ideas mentioning bonuses, cashback,
  prizes, crypto, or leverage get a "Check with Compliance" note.

## Watchlist
Editable in the page (Add / Edit / turn off; admins can delete). Seeded by migration 059 with
13 well-known brokers. Seeded websites and newsroom URLs were checked on 2026-11-15; newsroom
URLs are blank where no real press/news listing was found (Exness, Valetax, FxPro).

## Weekly refresh
`npm run partnership:refresh` (VPS cron, Monday 07:30 WIB) runs the Competitor Intelligence
refresh and then one Global Trends digest when the last successful digest is 7+ days old.
The HTTP cron (`POST /api/partnership/cron/refresh` with `x-partnership-cron-secret`) does the same.

## AI
`generateContent` with model failover (`taskType: partnership-global-trends`, the user's
market-research model; scheduled runs use the first admin for token logging).

## Database
Migration `059_partnership_global_trends.sql` (additive, idempotent):
- reuses `partnership_reports` from 057; `kind` now allows `global-trends` (competitor_id NULL);
- one running digest at a time (partial unique index);
- `partnership_trend_brands` watchlist.
Rollback: `db/rollbacks/059_partnership_global_trends_down.sql` (deletes digests and the watchlist).
**Take a production DB backup before applying.**
