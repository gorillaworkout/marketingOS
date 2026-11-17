# Partnership: Competitor Intelligence

Menu: Partnership → Competitor Intelligence (`/dashboard/partnership/competitor-intelligence`).
Access: Accounts → Departments, feature **Partnership** (`partnership`). Migration 057 creates a
Partnership department with it; admins can grant it to any department.

## Where each item comes from
| Source | How | Notes |
| --- | --- | --- |
| Competitor website | SEO crawler (`crawlSite`): up to 25 same-host pages in 90 s, robots.txt respected, every hop checked for a public host and public DNS answers (DNS-rebinding guard) | Only pages that look like promos, events, partners, news, or blog posts, and are not dated before the window |
| News | Google News RSS (`when:90d`), Indonesian edition for Local, English for International | Publish dates are kept; older items are dropped |
| Web search | Serper, only when `SERPER_API_KEY` is already set | Skipped otherwise (noted in the report) |
| YouTube | Public channel RSS (`/feeds/videos.xml`), free, every refresh where a YouTube channel is saved | 15 newest uploads (title + description + date) |
| treg social feeds (manual, paid) | Instagram, TikTok, Facebook and X posts, Meta Ad Library ads | Only after the toolbar confirm; see below. Ads count as campaign evidence |
| Team evidence | Pasted IG post links + caption text, uploaded screenshots | Social links are stored, never fetched. Screenshots are read by the vision model when available; otherwise stored and only the caption text is used |

The LLM (routing feature `market-research`, normal gateway failover including the auth-expired
cooldown) only sees numbered sources. Every item and opportunity must cite a source id; the server
drops anything uncited or dated outside the last 3 months.

## Social accounts per competitor
Each competitor stores one account per platform (Instagram, TikTok, Facebook, YouTube, X, LinkedIn,
Telegram) in `partnership_competitors.social_handles` (migration 062; `instagram_handle` is kept in
sync for older code). Edit shows one field per platform; a handle or a profile link both work.

**Find social accounts** (detail view, or the toolbar for the selected competitors) reads the
competitor's own website for free with the public-page fetcher (SSRF/DNS guard): the homepage (www
and apex are both tried), the Indonesian `/id/` page, up to 6 contact/about pages, and `/llms.txt`.
Share/intent buttons and generic platform links are ignored. Visible links outrank URLs that only
appear in scripts or schema `sameAs` (often stale after a rebrand), and accounts linked from the
`/id/` page rank first because Dupoin's market is Indonesia; the other accounts are offered as
alternatives. When `SERPER_API_KEY` is set, one web search per platform still missing is tried, and a
hit is only kept when its title or snippet names the competitor. Nothing is invented and nothing is
saved until the user ticks the suggestions and clicks Save; a saved account is only replaced when
its suggestion is ticked explicitly. The route is
`POST /api/partnership/competitors/[id]/discover-social` (read-only, never calls treg).

Known gaps: accounts linked only from another subdomain (e.g. Telegram on smm.finex.co.id) are not
found; JS-only sites without `llms.txt` show nothing.

## Refreshing now (toolbar)
The **Refresh competitors** toolbar at the top of the page picks one, several, or all competitors
and a source:

- **Free sources** (default, $0): website crawl, news, web search, public Instagram post links and
  team evidence.
- **treg** (paid, optional): the free sources plus social feeds through treg.to. Pick the platforms
  (checkboxes); each competitor uses the picked platforms it has a saved account for, and Meta Ad
  Library always applies (it searches by company name + website domain, plus the Facebook page when
  known, and keeps only ads from a Page whose ads name the competitor or link to its site/accounts).
  The toolbar shows the per-platform breakdown, the total estimate and the balance, and asks for a
  confirm click. Competitors with none of the picked platforms run on free sources. The option is
  disabled, with the reason shown, when treg is not configured, `PARTNERSHIP_TREG_INSTAGRAM=false`
  (switches off all treg platforms here), the user is not an admin, or the balance / daily limit is
  short.

| Platform | treg endpoint(s) | Catalog price per competitor |
| --- | --- | --- |
| Instagram | `treg.instagram.user.posts` | $0.0009 |
| TikTok | `treg.tiktok.user.profile` → `treg.tiktok.user.videos` (sec_uid) | $0.00064 + $0.0005 |
| Facebook | `treg.facebook.user.posts` | $0.00135 |
| Meta Ad Library | `treg.meta-ads.library.advertiser` | $0.0012 |
| X | `treg.x.user.posts` | $0.0005 |

  Every call carries `X-Treg-Route-Max-Cost: 0.005` (treg refuses dearer routes for free). The actual
  cost per call comes from `X-Treg-Cost-Micro` and is settled once per competitor in the spend
  ledger; the report shows the cost per platform. A refusal for balance, spend cap or auth stops the
  remaining platforms for that competitor, and the refresh continues on free sources with a note.
  YouTube is not bought from treg: the free RSS feed covers it.

Competitors run one at a time (keep the tab open until the list finishes). Each goes through
`POST /api/partnership/competitors/[id]/refresh`, so the server-side treg guard (estimate, balance,
reservation, daily limit, actual cost settled after, fallback to free sources) applies to each.
The Comparison table's Last refresh column, the report header and Refresh history show which
source each report used ("Free" or "treg $0.0041").

## Weekly auto refresh
Competitors whose last successful refresh is 7+ days old are refreshed one at a time, **always on
free sources**: scheduled refreshes never spend treg balance. The CLI loads `.env.local`, then
`.env` (`scripts/load-env.ts`), like the app.

Option A, VPS cron (recommended, Monday 07:30 WIB):

```
30 0 * * 1 cd /home/ubuntu/apps/marketingos && npm run partnership:refresh >> /var/log/partnership-refresh.log 2>&1
```

Option B, HTTP cron: set `PARTNERSHIP_CRON_SECRET` in the server env, then

```
curl -X POST https://marketing-aws.gorillaworkout.id/api/partnership/cron/refresh \
  -H "x-partnership-cron-secret: $PARTNERSHIP_CRON_SECRET"
```

The endpoint returns 202 and runs the refreshes in the background. Without the secret it returns 503.

## Data
`partnership_competitors`, `partnership_evidence`, `partnership_reports` (migration 057);
`partnership_competitors.social_handles` (migration 062, rollback
`db/rollbacks/062_partnership_competitor_social_handles_down.sql`).
Screenshots: `data/partnership-evidence/`. Rollback: `db/rollbacks/057_partnership_competitor_intel_down.sql`
(keeps the Partnership department row, removes the feature).
