-- SEO OS, Phase 4: AI Visibility v1 and SOPs. Idempotent and forward-only:
-- every table and index uses IF NOT EXISTS, the new Content Studio column
-- uses ADD COLUMN IF NOT EXISTS, and seeded SOP templates are inserted only
-- when their fixed id is missing (edits made in the app are kept).

BEGIN;

-- 1. Prompts to ask the models, per site. brand_terms are matched in the
-- answer (the site host is always matched too); each competitor entry is
-- "Name" or "Name|alias|alias".
CREATE TABLE IF NOT EXISTS seo_ai_prompts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL CHECK (length(btrim(prompt)) > 0),
  brand_terms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  competitors TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_ai_prompts_site_prompt ON seo_ai_prompts (site_id, lower(btrim(prompt)));

-- 2. Per-site run settings. No row means the built-in defaults.
CREATE TABLE IF NOT EXISTS seo_ai_visibility_settings (
  site_id TEXT PRIMARY KEY REFERENCES seo_sites(id) ON DELETE CASCADE,
  models TEXT[] NOT NULL DEFAULT ARRAY['cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash']::TEXT[],
  classifier_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  classifier_model TEXT NOT NULL DEFAULT 'ag/gemini-3-flash',
  max_checks_per_run INTEGER NOT NULL DEFAULT 60 CHECK (max_checks_per_run BETWEEN 1 AND 300),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT seo_ai_visibility_settings_models CHECK (cardinality(models) BETWEEN 1 AND 10)
);

-- 3. Runs, with an overlap lock: at most one running run per site.
CREATE TABLE IF NOT EXISTS seo_ai_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  models TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  classifier_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  checks_planned INTEGER NOT NULL DEFAULT 0,
  checks_done INTEGER NOT NULL DEFAULT 0,
  checks_failed INTEGER NOT NULL DEFAULT 0,
  prompts_skipped INTEGER NOT NULL DEFAULT 0,
  cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  error TEXT,
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'cron')),
  triggered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seo_ai_runs_site_started ON seo_ai_runs (site_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_ai_runs_one_running ON seo_ai_runs (site_id) WHERE status = 'running';

-- 4. One row per prompt x model answer. `model` is the model that was asked;
-- `answered_model` differs when the gateway fell back to another model, and
-- such rows are left out of the per-model mention rate.
CREATE TABLE IF NOT EXISTS seo_ai_checks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES seo_ai_runs(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  prompt_id TEXT REFERENCES seo_ai_prompts(id) ON DELETE SET NULL,
  prompt_text TEXT NOT NULL,
  model TEXT NOT NULL,
  answered_model TEXT,
  fallback_label TEXT,
  response TEXT,
  mentioned BOOLEAN,
  rank_in_answer INTEGER CHECK (rank_in_answer IS NULL OR rank_in_answer > 0),
  cited_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  site_cited BOOLEAN NOT NULL DEFAULT FALSE,
  competitors_mentioned TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  detection TEXT CHECK (detection IS NULL OR detection IN ('terms', 'classifier')),
  classifier_evidence TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seo_ai_checks_site_created ON seo_ai_checks (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_ai_checks_prompt_model ON seo_ai_checks (prompt_id, model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_ai_checks_run ON seo_ai_checks (run_id);

-- 5. SOPs: shared Markdown playbooks for the SEO team.
CREATE TABLE IF NOT EXISTS seo_sops (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('on-page', 'content', 'linking', 'technical', 'research', 'other')),
  body_md TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seo_sops_category ON seo_sops (category, title);

-- 6. Content Studio can follow an SOP as extra instructions.
ALTER TABLE seo_content_drafts ADD COLUMN IF NOT EXISTS sop_id TEXT REFERENCES seo_sops(id) ON DELETE SET NULL;

-- 7. Seeded SOP templates (fixed ids, so re-running never duplicates them).
INSERT INTO seo_sops (id, title, category, body_md) VALUES
('00000000-0000-0000-0000-000000000201', 'On-page SEO checklist', 'on-page', $sop$
Use this before an article moves from **Approved** to the publish queue.

## Search intent
- [ ] The target keyword and its intent (informational, commercial, navigational) are written at the top of the brief.
- [ ] The first 100 words answer the main question directly.
- [ ] The page format matches what already ranks (guide, list, comparison, event page).

## Title, meta and URL
- [ ] Title tag: 50 to 60 characters, keyword near the start, no clickbait.
- [ ] Meta description: 140 to 155 characters, states the benefit and includes the keyword once.
- [ ] Slug: short, lowercase, hyphenated, keyword only (no dates unless the page is dated).

## Structure
- [ ] Exactly one H1 that matches the title.
- [ ] H2/H3 headings cover the sub-topics people search for (check GSC queries for the page).
- [ ] Short paragraphs, lists and tables where they help scanning.
- [ ] An FAQ section only when the questions are real (from GSC, People Also Ask or customer support).

## Trust (E-E-A-T)
- [ ] First-hand details from the case study: dates, places, numbers, photos, quotes.
- [ ] Author or organisation named; claims backed by a source link.
- [ ] No promises, guarantees or regulated-product claims the brand guideline forbids.

## Media
- [ ] Every image has descriptive alt text and a compressed file (WebP or AVIF, under 200 KB).
- [ ] Images have width and height set to avoid layout shift.

## Links
- [ ] 3 to 5 internal links to related pages with descriptive anchors (see the Internal linking SOP).
- [ ] External links only to reputable sources.

## After publishing
- [ ] Mark the article **Published** in Content Studio with the live URL.
- [ ] Request indexing in Search Console (URL Inspection).
- [ ] Check impressions for the keyword in SEO OS after 2 to 4 weeks.
$sop$),
('00000000-0000-0000-0000-000000000202', 'Content refresh', 'content', $sop$
Refresh pages that are slipping instead of writing a new page for the same keyword.

## When to refresh
- The page ranks in **Push (position 11 to 20)** or **Re-optimize (21 to 30)** in SEO OS Opportunities.
- Clicks dropped more than 30% versus the previous period while impressions held.
- Facts are outdated: last year's dates, prices, rules, results or broken links.

## Steps
1. Open the page's queries in SEO OS (Opportunities) and list the top 10 by impressions.
2. Compare the page with the top 3 results for the main query: missing sub-topics, newer data, better format.
3. In Content Studio, start a draft with **Page to improve** set to the live URL and paste the new facts into the case study.
4. Keep the URL. Only change the slug if it is clearly wrong, and add a 301 redirect if you do.
5. Update the title and meta description if CTR is below the site average for that position.
6. Add or fix internal links from 2 to 3 strong pages.
7. Show the updated date on the page if the site does that, and only when the change is substantial.
8. Publish, mark it **Published** in Content Studio, and request indexing.

## Measure
- Compare 28 days before and 28 days after (same weekday alignment) for clicks, impressions and average position.
- Log the result in the article's version note so the team learns what worked.
$sop$),
('00000000-0000-0000-0000-000000000203', 'Internal linking', 'linking', $sop$
Internal links tell search engines which pages matter and help readers keep going.

## Rules
- Every new article links to **3 to 5** relevant existing pages and gets **at least 2** links from existing pages.
- Anchor text describes the target page ("cheerleading competition rules"), never "click here".
- Link from pages that already get impressions (SEO OS overview, top pages) to pages you want to push.
- One link per target page per article is enough; do not repeat the same anchor sitewide.
- Avoid orphan pages: every published page is reachable within 3 clicks from the homepage.

## Process for a new article
1. Search the site for the target keyword and close variants (site:domain keyword).
2. Pick 2 to 3 older pages on the same topic and add a contextual link to the new article.
3. In the new article, link to the pillar page for the topic and to 2 to 4 supporting pages.
4. Check that no link points to a redirect or a 404.

## Monthly check
- Export top pages from SEO OS and make sure each is linked from at least one other strong page.
- Fix broken internal links reported in Search Console (Pages report).
$sop$),
('00000000-0000-0000-0000-000000000204', 'Schema and structured data', 'technical', $sop$
Structured data helps search engines and AI systems understand the page. Use JSON-LD in the page head.

## Which type
| Page | Schema type |
| --- | --- |
| Article, news, guide | Article (or NewsArticle for news) |
| Event page | Event (name, startDate, endDate, location, organizer, eventStatus) |
| Organisation homepage | Organization (name, url, logo, sameAs social profiles) |
| FAQ block with real questions | FAQPage (only when the questions and answers are visible on the page) |
| Breadcrumbs | BreadcrumbList |

## Rules
- Only mark up content that is visible on the page.
- Use absolute URLs and ISO 8601 dates (2026-03-14T09:00:00+07:00).
- Keep one Organization block sitewide with the same name and logo everywhere.
- Do not add Review or AggregateRating markup for your own organisation.

## Check
1. Test the URL in the Rich Results Test (search.google.com/test/rich-results).
2. Validate with the Schema Markup Validator (validator.schema.org).
3. After publishing, watch the Enhancements reports in Search Console for errors.
$sop$),
('00000000-0000-0000-0000-000000000205', 'Keyword research from Search Console', 'research', $sop$
Start from queries the site already gets impressions for. They are the cheapest wins.

## Steps
1. In SEO OS **Opportunities**, use the last 3 months and a minimum of 10 impressions.
2. **Push (11 to 20):** pick queries with high impressions and a clear matching page. Improve that page (Content refresh SOP).
3. **Re-optimize (21 to 30):** check whether the ranking page actually matches the intent. If not, plan a dedicated page.
4. **No page / homepage:** queries ranking with the homepage usually need their own page. Send them to Content Studio.
5. Group close variants (singular/plural, word order, Indonesian and English) into one target keyword per page.
6. Add the chosen keywords on the **Keywords** page with the target page URL, so SEO OS tracks them.

## Fill the gaps Search Console cannot show
- Search Console only lists queries with impressions. For topics you do not rank for at all, brainstorm with the team, check competitors' pages, Google autocomplete and People Also Ask, then import them as keywords with no page.

## Prioritise
- Score each keyword: impressions or estimated demand, business value (1 to 3), and effort (1 to 3).
- Work the list top-down every week and send the top items to Content Studio.
$sop$)
ON CONFLICT (id) DO NOTHING;

COMMIT;
