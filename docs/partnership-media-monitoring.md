# Partnership › Media Monitoring

Dataxet/DXT360-style media monitoring for **Dupoin only** (one settings row, `brand_key = 'dupoin'`).
Page: `/dashboard/partnership/media-monitoring` (sidebar: Partnership › Media Monitoring, `partnership` feature access).

## What the page shows (mirrors the Dataxet report)

Total mentions · total engagement · potential reach (estimate) · ad value (estimate) · mentions & engagement over
time · sentiment distribution · sentiment by channel · top 5 posts · top sources · insights & recommendations
(executive summary, perception, key insights, strengths/fixes/additional). Date-range filter (7/30/90 days or custom)
and **Export PDF** (A4, pdfkit, same fonts/logo as the proposal export).

## Sources

| Source | Cost | Scheduled (cron) | Manual |
|---|---|---|---|
| Google Alerts RSS (feeds on the Google Alerts page) | free | yes | yes |
| Google News RSS (keywords, ID/EN edition) | free | yes | yes |
| GDELT DOC API (1 request / 5 s, retried once on 429) | free | yes | yes |
| YouTube Data API — only when `YOUTUBE_API_KEY` is set | free quota | yes | yes |
| treg: IG hashtag posts, IG reels, TikTok, X, Threads, YouTube, Facebook (justoneapi), Google News SERP | paid | **never** | only "Generate with treg" after confirming the estimate |

### Google Alerts → RSS

1. google.com/alerts → type the query → **Show options** → **Deliver to: RSS feed** → Create alert.
2. Click the RSS icon next to the alert and copy the URL (`https://www.google.com/alerts/feeds/<user>/<alert>`).
3. Paste it on **Partnership › Google Alerts** (`/dashboard/partnership/google-alerts`) with an optional label. Only Google Alerts feed URLs are accepted (max 20).

The Google Alerts page (migration 064) lists feeds with their last fetch status, has a free **Fetch now**, and shows the
latest articles per alert. Articles are stored in `partnership_media_mentions` (deduplicated by URL, the same rows Media
Monitoring reports on) and linked to their feed in `partnership_media_mention_alerts`. Feeds live in
`partnership_google_alert_feeds`; `partnership_media_settings.alert_feeds` mirrors their URLs so a rollback of 064 keeps
them. Media Monitoring Settings no longer edit feeds. Fetch now and the scheduled refresh never call treg.

Entries are Atom; `google.com/url?...&url=<article>` redirect links are unwrapped to the article URL.

## treg (paid) rules

* Cron / `npm run media:refresh` / `npm run partnership:refresh` / `POST /api/partnership/cron/refresh` call
  `runDueMediaRefresh()`, which runs **free sources only**. `media-run.ts` and `media-sources.ts` never import treg;
  `fetchTregMentions` refuses any trigger other than `manual`. Enforced by `tests/partnership-media-no-treg-cron.test.ts`.
* The manual flow shows the estimate (catalog price × up to 3 keywords per platform) and the remaining balance, needs
  a confirm click, reserves through the shared guard (`src/lib/seo/treg-cost-guard.ts`: `canRunTreg`, $5/day cap shared
  with Competitor Intelligence and Keyword Gap), and records the actual cost from `X-Treg-Cost-Micro` afterwards.
  Low balance, a refused token, or a provider error falls back to the free results.
* Prices (cheapest provider, treg catalog 18 Nov 2026): IG hashtag $0.00188, IG reels $0.0015, TikTok $0.001,
  X $0.00075, Threads $0.002, YouTube $0.001, Google News SERP $0.00015, Facebook (justoneapi, GET) ≈ $0.0295.

## Estimates

`Ad value = estimated reach ÷ 1,000 × CPM(channel)`; `estimated reach = views → followers → (online media) assumed
readers per article → engagement × multiplier`. All numbers are editable in Settings; the defaults are placeholders,
not agency rates.

## Sentiment & insights

Sentiment (positive/neutral/negative, batches of 40, up to 160 new mentions per refresh) and insights use the existing
`generateContent` helper with the user's preferred model; the provider mode and paid OpenRouter toggle are untouched.
A team member can correct any sentiment label in the Mentions table.

## Ops

* Migration `063_partnership_media_monitoring.sql` (rollback `db/rollbacks/063_partnership_media_monitoring_down.sql`).
* Optional env: `YOUTUBE_API_KEY`. Existing: `TREG_API_KEY`, `TREG_ADMIN_ONLY`, `PARTNERSHIP_CRON_SECRET`.
* Suggested daily cron (06:00 WIB): `0 23 * * * cd /home/ubuntu/apps/marketingos && npm run media:refresh >> /var/log/media-refresh.log 2>&1`.
