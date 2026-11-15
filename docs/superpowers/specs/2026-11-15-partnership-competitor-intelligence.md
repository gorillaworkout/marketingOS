# Partnership: Competitor Intelligence (PR 1 of the Partnership module)

Date: 2026-11-15. Owner: Bayu (Dupoin Futures). Status: approved scope (t546u decisions).

## Problem
The Partnership division researches competitor brokers by hand on Instagram and their websites.
They need a 3-month view of what each competitor is doing, a comparison across competitors, and
ideas for Dupoin. Later PRs add a B2B Proposal Builder (Slide 16:9 and A4 Dupoin templates) and
Global Industry Trends.

## Decisions (from Bayu)
- Free sources only: the competitor's own website (crawled), Google News RSS, and web search when a
  Serper key is already configured. No paid Instagram scraper.
- Instagram is covered by team evidence: pasted IG post links and caption text, and uploaded
  screenshots. Social network URLs are stored and never fetched.
- Elve has no website yet. Bayu will send it. No URL is ever invented.
- Order: Competitor Intelligence, then Proposal Builder, then Global Trends.

## Access
- New Accounts feature `partnership` (label "Partnership"). Admins assign it per department in
  Accounts → Departments, like every other menu. Migration 057 adds it to the departments check
  constraint and creates a "Partnership" department with the feature (no users are moved).
- Sidebar group "Partnership" with "Competitor Intelligence" at
  `/dashboard/partnership/competitor-intelligence`. The whole `/dashboard/partnership/*` tree and
  `/api/partnership/*` (except the cron endpoint, which uses a shared secret) require `partnership`.

## Data model (migration 057, reusable by later PRs)
- `partnership_competitors`: name (unique, case-insensitive), region (`local` | `international`),
  website, instagram_handle, notes, active, sort_order, audit columns. Seeded with MIFX, Finex,
  Valbury, Forex IMF, XTB (Local) and Valetax, Exness, Elve (International). Seeded websites were
  checked to resolve to the official site on 2026-11-15; Elve and every IG handle are left blank.
- `partnership_evidence`: per competitor; kind `link` | `text` | `screenshot`; source_url,
  pasted_text, screenshot_key (file under `data/partnership-evidence/`), extracted_text (vision),
  extraction_status, observed_on (optional date the post went live).
- `partnership_reports`: `kind` (only `competitor-activity` now; Global Trends will add a kind),
  competitor_id, trigger (`manual` | `scheduled`), status/progress/message, window_start/window_end,
  result JSONB, model, error. One queued/running report per competitor (partial unique index).
  The Proposal Builder can read the latest succeeded report per competitor.

## Refresh pipeline (per competitor)
1. Website: the SEO crawler (`crawlSite`: public-host and DNS checks on every hop, robots, same
   host, page and time caps) reads up to 25 pages starting from the homepage links. Pages with promo / campaign /
   event / news / blog / partner words in the URL or title, or a publish date inside the window,
   become sources (title, date, excerpt).
2. News: Google News RSS for `"<name>"` limited to the window (`when:90d`), with publish dates.
3. Web: Serper (only if `SERPER_API_KEY` is set) for promo/partnership/event queries.
4. Evidence: every evidence item for the competitor (caption text, or vision-extracted screenshot text).
5. The LLM (routing feature `market-research`, `generateContent` with the existing auth-expired
   failover in `src/lib/llm-auth.ts`) gets the numbered sources [S1..] / [E1..] and returns JSON items:
   category, title, summary, date, sourceIds. Server-side validation drops every item whose
   sourceIds do not match a known source. No source = not shown. Dates outside the window are dropped.
   Opportunities for Dupoin must cite items' sources too.
6. Categories: Campaigns/Promos, Partnerships/Collabs, Events/Sponsorships, New products/features,
   Social content patterns, News/PR.

## UI (English)
- Competitor list (add / edit / delete; delete is admin only), with region badge, last refresh and
  a Refresh button.
- Competitor detail: categorized activity with source links, monthly timeline (plus "Undated"),
  evidence panel (paste IG link + caption, upload screenshot), notes on what was read.
- Comparison table across competitors: item count per category and the latest headline.
- Opportunities for Dupoin (per competitor and a combined list), each with sources.

## Weekly auto refresh
No in-app scheduler exists; the app uses VPS cron (see `research:watches`). This PR adds
`npm run partnership:refresh` and `POST /api/partnership/cron/refresh` with header
`x-partnership-cron-secret: $PARTNERSHIP_CRON_SECRET`. Competitors whose last succeeded refresh is
older than 7 days are refreshed one at a time. Documented in `docs/partnership-competitor-intelligence.md`.

## Out of scope
Proposal Builder, Global Trends, paid scrapers, fetching Instagram/Facebook/TikTok pages.

## Rollout
Migration 057 is additive. Production needs a DB backup before deploy. Rollback:
`db/rollbacks/057_partnership_competitor_intel_down.sql`.
