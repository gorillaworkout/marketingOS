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
| Team evidence | Pasted IG post links + caption text, uploaded screenshots | Social links are stored, never fetched. Screenshots are read by the vision model when available; otherwise stored and only the caption text is used |

The LLM (routing feature `market-research`, normal gateway failover including the auth-expired
cooldown) only sees numbered sources. Every item and opportunity must cite a source id; the server
drops anything uncited or dated outside the last 3 months.

## Refreshing now (toolbar)
The **Refresh competitors** toolbar at the top of the page picks one, several, or all competitors
and a source:

- **Free sources** (default, $0): website crawl, news, web search, public Instagram post links and
  team evidence.
- **treg** (paid, optional): the free sources plus the competitor's recent Instagram posts through
  treg.to, about $0.0009 per competitor with an Instagram handle. The toolbar shows the total
  estimate and the remaining balance and asks for a confirm click. Competitors without a handle run
  on free sources. The option is disabled, with the reason shown, when treg is not configured,
  `PARTNERSHIP_TREG_INSTAGRAM=false`, the user is not an admin, or the balance / daily limit is short.

Competitors run one at a time (keep the tab open until the list finishes). Each goes through
`POST /api/partnership/competitors/[id]/refresh`, so the server-side treg guard (estimate, balance,
reservation, daily limit, actual cost settled after, fallback to free sources) applies to each.
The Comparison table's Last refresh column, the report header and Refresh history show which
source each report used ("Free" or "treg $0.0009").

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
`partnership_competitors`, `partnership_evidence`, `partnership_reports` (migration 057).
Screenshots: `data/partnership-evidence/`. Rollback: `db/rollbacks/057_partnership_competitor_intel_down.sql`
(keeps the Partnership department row, removes the feature).
