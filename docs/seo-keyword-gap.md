# SEO Keyword Gap (Beta)

Keyword Gap is a beta page under SEO OS. The menu label is Keyword Gap (Beta). Anyone with the `seo` feature can run it.

## Our keywords

The production cron is `npm run seo:sync` (`scripts/seo-sync.ts`). It writes Google Search Console Search Analytics into `seo_gsc_daily`: query, page, clicks, impressions, ctr, and position. Free mode uses those stored queries as the primary source, aggregated over the 16 months the sync keeps.

The cron only syncs sites that are active and have a GSC property (`syncableSiteIds`). Migration 035 seeds Dupoin as `https://dupoin.co.id/` with `gsc_property` NULL and `active` FALSE, and it does not insert `seo_gsc_daily` rows. Per the schema, Dupoin has no stored query or position data until an admin sets a property and a sync runs. This repo cannot see the live production row count.

When the matched site has no stored rows, Free mode uses an uploaded Queries export (CSV or XLSX: query, clicks, impressions, CTR, position). A file is not used while stored rows exist.

Live Search Analytics still uses the existing service account (`GSC_SA_KEY_PATH`). OAuth is not wired.

## Competitors in Free mode

Each competitor is crawled with the Website Audit crawler: same host, robots.txt, sitemap first, about 100 pages. Phrases come from titles, H1–H3, meta descriptions, URL slugs, and body word pairs. The Smart-tier SEO Content Studio model may cluster those phrases. It cannot add a phrase that was not extracted. If the model fails, the most frequent extracted phrases are used.

Buckets:

- Missing: a competitor covers it and we have no stored or uploaded position.
- Weak: our position is worse than 20.
- Almost: our position is 11–20.
- Shared: both cover it and our position is 10 or better.
- Strength: our position is 10 or better and no competitor page covered it.

Free mode does not measure competitor rankings. Competitor position and volume are an em dash. The page states that this is a content-coverage gap.

## Semrush and DataForSEO

Both stay Not configured until an admin saves a key in SEO settings, or the server has `SEMRUSH_API_KEY` or `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`. Keys are encrypted and are not written to logs.

Semrush calls `domain_organic` and `domain_domains` (domain vs domain). DataForSEO Labs calls `ranked_keywords` and `domain_intersection`. Those responses supply real positions and volume. A missing key does not invent numbers.

## Jobs

Each run is a row in `seo_keyword_gaps` (migration `056_seo_keyword_gap.sql`) with progress and history. The table exports as CSV or xlsx. Rollback: `db/rollbacks/056_seo_keyword_gap_down.sql`.
