# SEO OS setup (Phase 1: Search Console)

SEO OS pulls Google Search Console (GSC) Search Analytics into PostgreSQL and
shows it at **Dashboard → SEO OS → SEO overview** (`/dashboard/seo`).

- Access: departments with the **SEO OS** feature (`seo`). Admins always have access.
  Migration 035 creates the **Operations** department with `seo` and `internal-docs`.
  Admins can also enable SEO OS for any other department in **Accounts**.
- Sites: migration 035 seeds **ICA Cheerleading** (`https://indonesiancheer.org/`, active,
  property `sc-domain:indonesiancheer.org`) and **Dupoin** (`https://dupoin.co.id/`,
  inactive, property not set). The dashboard opens on the first active site.
- Auth: one Google Cloud **service account** with the read-only scope
  `https://www.googleapis.com/auth/webmasters.readonly`. The JSON key stays on the
  server outside the repo. The app reads its path from `GSC_SA_KEY_PATH` and never
  logs or returns the key.

## 1. Enable the API in the existing Google Cloud project

Use the existing project. Do not create a new one.

1. Open Google Cloud Console and select the project.
2. **APIs & Services → Library → "Google Search Console API" → Enable.**

## 2. Create the service account and JSON key

1. **IAM & Admin → Service Accounts → Create service account**, for example
   `marketingos-seo`. It needs no project roles.
2. Open it, then go to **Keys → Add key → Create new key → JSON**. The file downloads once.
3. Note the email, for example `marketingos-seo@<project-id>.iam.gserviceaccount.com`.

If the organization policy `iam.disableServiceAccountKeyCreation` blocks key
creation, a project or org admin must allow it for this project.

## 3. Put the key on the VPS (never in git)

```bash
# from your machine
scp ./key.json ubuntu@16.78.68.56:/tmp/gsc-sa.json
# on the VPS
mkdir -p /home/ubuntu/secrets && chmod 700 /home/ubuntu/secrets
mv /tmp/gsc-sa.json /home/ubuntu/secrets/gsc-sa.json
chmod 600 /home/ubuntu/secrets/gsc-sa.json
```

Delete the downloaded copy from your machine afterwards. `.gitignore` also ignores
`gsc-sa*.json` and `*service-account*.json`.

## 4. Set `GSC_SA_KEY_PATH` for the app

Add this to the app's `.env` on the VPS (the file the PM2 process and the npm
scripts load):

```bash
GSC_SA_KEY_PATH=/home/ubuntu/secrets/gsc-sa.json
```

Then restart with the new environment:

```bash
pm2 restart marketingos --update-env
```

If PM2 gets its env from an ecosystem file instead, add `GSC_SA_KEY_PATH` to that
app's `env` block and run `pm2 restart marketingos --update-env`.

## 5. Give the service account access in Search Console

A **property Owner** opens Search Console → the property → **Settings → Users and
permissions → Add user**, enters the service account email, and picks
**Restricted** permission. Read-only access is enough.

- ICA Cheerleading: Domain property `sc-domain:indonesiancheer.org`.
- Dupoin: confirm the property type first (`sc-domain:dupoin.co.id` for a Domain
  property, or `https://dupoin.co.id/` for a URL-prefix property).

## 6. Check or set the property in SEO settings

As an admin, open **SEO OS → SEO settings** (`/dashboard/seo/settings`):

- The service account card should show **Key loaded** and the email from step 2.
- Each site has a **GSC property** field. It accepts `sc-domain:example.com` or a
  URL prefix ending in `/` (for example `https://example.com/`). Leave it empty for
  "Not connected". **Active** sites are included in the daily sync.

## 7. Backfill 16 months

On the VPS:

```bash
cd /home/ubuntu/apps/marketingos
npm run seo:sync -- --backfill                                            # all active sites with a property
npm run seo:sync -- --backfill --site=00000000-0000-0000-0000-000000000101   # ICA only
```

The backfill runs one day at a time: about 486 days, three API queries per day,
with startRow pagination and retry/backoff on HTTP 429. Expect several minutes per
site. The **Recent sync runs** table in SEO settings shows the result. Only one
run per site can run at a time. A second one gets "already running", HTTP 409 in
the UI.

## 8. Daily sync (cron, not installed automatically)

Each incremental run re-pulls the last 5 days and upserts them, because GSC data
for the last 2–3 days is still provisional. Install the cron with `crontab -e` as
`ubuntu`:

```cron
30 1 * * * cd /home/ubuntu/apps/marketingos && npm run seo:sync >> /home/ubuntu/logs/seo-sync.log 2>&1
```

This runs at 01:30 UTC, which is 08:30 WIB. Create `/home/ubuntu/logs` first if it
does not exist. Admins can also press **Sync now** on the SEO overview, which runs
the same incremental pull for the selected site.

## Troubleshooting (messages shown to admins)

| Message | Fix |
| --- | --- |
| `GSC_SA_KEY_PATH is not set on the server` | Do step 4 and restart with `--update-env`. |
| `key file at GSC_SA_KEY_PATH cannot be read` | Check the path, then make the file owned by `ubuntu` with mode 600. |
| `not a Google service account JSON key` | Upload the JSON key file itself, not a P12 key or a client secret. |
| `Google rejected the service account token request` | The key was deleted or disabled, or the API is not enabled (step 1). |
| `has no access to Search Console property` | Do step 5 for that exact property. |
| `property ... was not found` | Wrong type: `sc-domain:` vs `https://.../` (step 6). |
| `set its GSC property in SEO OS settings` | Step 6. |

## Data model (migration 035)

- `seo_sites`: sites, `gsc_property` (nullable), `active`, `last_synced_at`.
- `seo_gsc_site_daily` (site, date), `seo_gsc_page_daily` (site, date, page),
  `seo_gsc_daily` (site, date, query, page): clicks, impressions, CTR, position.
  Site totals include anonymized queries, so they are the source for headline
  numbers when no query filter is set.
- `seo_sync_runs`: run history. A partial unique index allows only one `running`
  row per site, and a run stuck for more than 3 hours is released automatically.

Rollback: SEO OS only adds tables, a department, and a feature value. To hide it,
untick SEO OS on departments. The tables can stay.

## Phase 2: Opportunities, keywords, and the Content Studio hand-off

Migration `036_seo_opportunities.sql` adds `seo_keywords` and `seo_content_queue`. It is idempotent and needs no new environment variables or packages.

- **Opportunities** (`/dashboard/seo/opportunities`, `seo` feature): per site, last 28 days by default (7 days to 16 months, or a custom range), with a minimum-impressions filter.
  - **Push**: queries at position 11-20 (impression-weighted, rounded the way Search Console shows it: 10.5 ≤ position < 20.5).
  - **Re-optimize**: position 21-30 (20.5 ≤ position < 30.5).
  - **No page**: tracked keywords with no `target_page_url` and no Search Console impressions in the range, plus queries whose best page (most clicks, then impressions) is the homepage.
  - Search Console only reports queries with at least one impression, so zero-impression keywords can only come from the keyword list. The page says so.
- **Keywords** (`/dashboard/seo/keywords`, `seo` feature): CSV import with columns `keyword`, `target_page_url` (optional), `intent` (optional: informational, commercial, transactional, navigational; `info`/`comm`/`trans`/`nav` accepted).
  - UTF-8 with or without BOM, UTF-16 LE/BE (Excel "Unicode text"), and comma, semicolon, or tab separators. Max 2 MB and 5,000 rows.
  - "Check file" validates without saving. Duplicates in a file are merged (first wins). Re-importing updates the keyword; empty cells keep the saved target and intent.
  - Target pages must be on the site's domain (subdomains allowed for `sc-domain:` properties).
  - Export is formula-safe (cells starting with `=`, `+`, `-`, `@` get a leading apostrophe) and re-imports unchanged.
- **Send to Content Studio** writes a `pending` row to `seo_content_queue` (one pending item per keyword per site). Phase 3 Content Studio consumes it. Pending items can be removed (`dismissed`) from the Opportunities page.

API: `GET /api/seo/opportunities`, `GET|POST|DELETE /api/seo/keywords` (`format=csv` to export, `dryRun=1` to validate), `GET|POST|PATCH /api/seo/content-queue`. All require the `seo` feature.

Rollback: 036 only adds two tables and one index on `seo_gsc_daily`; reverting the code leaves them unused.

## Phase 3: Content Studio (migration 037)

No new environment variables or dependencies. Content Studio lives at **SEO OS → Content Studio** (`/dashboard/seo/content`) and is visible to anyone with the `seo` feature.

**Flow**

1. Start an article from a keyword plus a case study (first-hand material the AI may use), or click **Start draft** on an item sent from Opportunities. Starting from the queue moves the item to `in-progress`; publishing the article moves it to `done`.
2. **Generate AI draft** writes title, slug, meta description and a Markdown article through the normal model fallback chain. **Start blank** skips the AI.
3. Edit in the editor (Write / Preview). Every save, AI draft, AI rewrite and restore becomes a numbered version with author, model and fallback label. Any version can be diffed against the current one and restored (restoring creates a new version, nothing is overwritten).
4. Status flow: `draft → review → approved → queued (publish queue) → published`. **Request changes** sends review/approved back to draft; **Remove from queue** sends queued back to approved. Editing a reviewed, approved or queued article sends it back to draft. Authors cannot approve their own article; another `seo` user or an admin must.
5. Export Markdown (with YAML front matter) or a standalone HTML file, publish it in the site's CMS, then **Mark published** with the live URL (must be on the site's domain).

**Models and brand voice**

- Feature key `seo-content` (Admin → Model settings). Default `cc/claude-sonnet-5-5`; users can pick their own preference in Settings. Token usage is logged to `token_logs` with task type `seo-content`; fallbacks are recorded in `model_fallback_events` and shown as a label on the version.
- Brand guideline picker per article: **Dupoin Futures (default)** or any guideline the user created in Brand Guidelines. Rewrites reuse the article's guideline (or the default if it was deleted). Guidelines are per-user, so there is no per-site default yet.

**Data model (migration 037)**

- `seo_content_drafts`: one row per article (site, optional queue item, keyword, brief, brand guideline, current content, status, current version, model/fallback, approval and publish info).
- `seo_content_versions`: immutable history, unique `(draft_id, version)`.
- Extends `task_model_preferences_task_type_check` with `seo-content` and seeds `feature_model_assignments` for `seo-content` (`ON CONFLICT DO NOTHING`, so admin changes are kept).
- Rollback: `DROP TABLE seo_content_versions, seo_content_drafts;`, `DELETE FROM feature_model_assignments WHERE feature_key = 'seo-content';`, `DELETE FROM task_model_preferences WHERE task_type = 'seo-content';` and re-add the previous CHECK list without `seo-content`.

## Phase 4: AI Visibility + SOPs (migration 038)

No new environment variables or dependencies. Checks go through the existing llmdupoin gateway (`generateContent`) with the normal retry and model fallback.

### AI Visibility (`/dashboard/seo/visibility`)

> Model answers via API, not what ChatGPT.com, Perplexity or Google AI Overviews show users.

The page always shows this label. API answers have no live web search or personalisation, so treat the numbers as a trend signal, not a copy of what users see.

**Flow**

1. Add prompts per site: the questions a customer would ask an AI assistant. Each prompt has **brand terms** and **competitors** (`Name` or `Name|alias|alias`). You can add them one by one or import a CSV with the columns `prompt, brand_terms, competitors, active`. Put several terms in one cell separated by `;`. **Check file** is a dry run; re-importing a prompt updates it. Limits: 500 prompts per site, 20 terms per list.
2. A run asks every selected prompt on every configured model and stores one row per answer in `seo_ai_checks`. Each row holds the response, `mentioned`, `rank_in_answer`, `cited_urls`, `site_cited`, competitors mentioned, tokens, cost, the answering model and the fallback label.
3. Mention detection:
   - Brand terms are matched as whole words, case-insensitively. Empty terms fall back to the site name. The site's domain always counts, and so does any link to it.
   - Rank is the position in the answer's numbered or bulleted list. Without a list, it is the order of first mention among the brand and competitors.
   - The optional **LLM classifier** (off by default) runs only when no term matched. It must quote evidence from the answer, and its verdict is rejected if the quote is not in the answer.
4. Report:
   - Mention rate per model, by week (Asia/Jakarta weeks).
   - Share of voice: the brand vs competitors, as a share of all entity mentions.
   - A latest-answer matrix (prompt × model). Click a cell to read the full answer and its cited URLs.
   - Answers that the gateway served from a fallback model, and failed calls, are counted separately. They are left out of the rates so model comparisons stay honest.

**Settings (admin, per site)**

- Models: default `cc/claude-sonnet-5-5`, `cx/gpt-5.6-sol`, `ag/gemini-3-flash`. You can pick any model in the catalog, up to 10.
- Classifier on/off and classifier model (default `ag/gemini-3-flash`).
- Max checks per run: default 60, hard cap 300.
- Config lives in `seo_ai_visibility_settings`, not in Admin → Model settings. A check list is a set of models to compare, not a fallback chain.

**Runs, lock and cap**

- **Run now** (admin only) starts a background run and returns at once. The page refreshes every 5 s while the run is going.
- One run per site at a time. A unique partial index on `seo_ai_runs (site_id) WHERE status = 'running'` enforces this. A second start gets HTTP 409.
- A run still marked `running` after 3 hours (for example, after a server restart) is marked failed when the next run starts.
- Cap: checks = prompts × models, up to the cap. If there are too many prompts, the least recently checked prompts go first. The rest wait for the next run and are shown as "prompts left for the next run".
- Run status: `succeeded`, `partial` (some checks failed), or `failed` (no answers).

**Weekly cron (not installed automatically)**

```bash
# Every Monday 07:00 WIB (00:00 UTC). Runs every active site that has active prompts.
0 0 * * 1 cd /home/ubuntu/apps/marketingos && npm run seo:visibility >> /home/ubuntu/logs/seo-visibility.log 2>&1
```

Options:
- `--site <id>` runs one site.
- `--max-checks <n>` overrides the cap for this run (1 to 300).
- `--user <id|username>` sets the user that `token_logs` are recorded under. The default is the oldest admin.

A site that is already running, or that has no active prompts, is skipped.

**Cost notes**

- One check is one gateway call: up to 1,500 output tokens at temperature 0.7, and the system prompt is neutral. The classifier, when enabled, adds one short call (200 tokens, temperature 0) only for answers with no term match.
- Worst case per run = cap (60) × one answer, plus up to 60 classifier calls.
- Example: 20 prompts × 3 models = 60 checks per week, about 52 runs a year.
- Cost is stored per check, summed per run and shown in the runs table. Token usage also goes to `token_logs` with task type `seo-visibility`, and fallbacks go to `model_fallback_events`.
- To spend less, lower the cap, use fewer models, or pause prompts.

API (all require the `seo` feature; admin-only routes are marked):
- `GET|POST /api/seo/visibility/prompts` (`import=1` with a CSV body, `dryRun=1`)
- `PUT|DELETE /api/seo/visibility/prompts/[id]`
- `GET|PUT /api/seo/visibility/settings` (PUT is admin only)
- `GET|POST /api/seo/visibility/runs` (POST is admin only)
- `GET /api/seo/visibility/report?weeks=12`
- `GET /api/seo/visibility/checks/[id]`

### SOPs (`/dashboard/seo/sops`)

- These are Markdown playbooks shared by all sites. Anyone with the `seo` feature can create and edit them, with Write / Preview. Only admins can delete them.
- Migration 038 seeds five templates: on-page SEO checklist, content refresh, internal linking, schema and structured data, and keyword research from Search Console. Seeds use fixed ids with `ON CONFLICT DO NOTHING`, so edits are kept when migrations run again.
- Content Studio: pick **Follow SOP** on a new article. The SOP (first 6,000 characters) is added to the AI instructions, and rewrites of that article use it too. The editor shows "Follows SOP: …". Deleting an SOP keeps the articles and clears their link.

### Data model (migration 038)

- `seo_ai_prompts`: unique per site on `lower(btrim(prompt))`.
- `seo_ai_visibility_settings`: one row per site.
- `seo_ai_runs`: one-running lock index.
- `seo_ai_checks`: deleting a prompt keeps its checks, with `prompt_id` set to null.
- `seo_sops`, plus `seo_content_drafts.sop_id` (`ON DELETE SET NULL`).

### Rollback

1. Revert the PR. The tables can stay; nothing else reads them.
2. To remove the data as well, run:

```sql
BEGIN;
DROP TABLE IF EXISTS seo_ai_checks, seo_ai_runs, seo_ai_prompts, seo_ai_visibility_settings;
ALTER TABLE seo_content_drafts DROP COLUMN IF EXISTS sop_id;
DROP TABLE IF EXISTS seo_sops;
DELETE FROM schema_migrations WHERE name = '038_seo_ai_visibility_sops.sql';
COMMIT;
```

3. If you installed the cron line, remove it.
