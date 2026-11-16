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

Months already rolled up by the retention script (see "Search Console data
retention" below) are skipped: the backfill never writes daily rows into them.

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

## Search Console data retention (migration 060)

Query+page rows (`seo_gsc_daily`) and page rows (`seo_gsc_page_daily`) grow by
about 140 MB a month for Dupoin. `npm run seo:gsc-retention` keeps them daily only
for recent months and folds older rows into one row per month:

- `seo_gsc_monthly` (site, month, query, page) and `seo_gsc_page_monthly` (site,
  month, page) hold summed clicks and impressions, CTR from the sums, the
  impression-weighted position, and `days_present`.
- `seo_gsc_rollup_months` records which months of a site are rolled up and which
  dates they cover (`first_date`..`last_date`, `days`).
- `seo_gsc_site_daily` (site totals) is never touched. Headline numbers, the
  unfiltered trend, and the data range stay daily for the full 16 months.

**Cutoff.** The cutoff is always the first day of a month, so a month is either
fully daily or fully monthly, never both. `--months=6` (default) means the cutoff
is the 1st of the month six months before the current month (Pacific date). Run
on 2026-11-16, the cutoff is 2026-05-01: May to November stay daily, everything
before May is rolled up. `--cutoff=YYYY-MM-01` sets it explicitly. The previous
full month must stay daily, so a more recent cutoff is refused.

**What the SEO pages show for old ranges.**

- Totals, top queries and pages, Opportunities, and Keyword Gap combine daily rows
  (from the cutoff on) with monthly rows (before it). CTR and position are
  recomputed from the summed clicks, impressions, and `position * impressions`,
  so for whole months the numbers are identical to the daily data.
- A month that is only partly inside the range is prorated by its covered dates
  (overlap days / covered days). Example: a range starting 16 April counts 15/30
  of April. This is an estimate; exact daily numbers for that month are gone.
- Trend with a query or page filter: each rolled-up month is one point at the
  month's start, valued at the month's daily average, and marked with a dot. This
  keeps the daily scale (no spike on the 1st). CTR and position points are the
  month's values. The unfiltered trend uses site totals and stays daily.
- Previous-period comparison works the same way on both sides of the cutoff.

**Procedure (VPS, as `ubuntu`).** Each `--apply` needs Bayu's OK.

1. Deploy this change. `scripts/deploy.sh` runs `npm run db:migrate`, which adds
   the three tables (migration 060, additive, no data changes).
2. Dry run. It only reads, and prints rows, clicks, and impressions per month and
   site:

   ```bash
   cd /home/ubuntu/apps/marketingos
   npm run seo:gsc-retention -- --cutoff=2026-05-01
   ```

3. Back up the slice that will be deleted (`date < cutoff`), compressed, mode 600.
   Use the same `psql` access as for other backups and never print
   `DATABASE_URL`:

   ```bash
   ts=$(date -u +%Y%m%dT%H%M%SZ); cutoff=2026-05-01
   for t in seo_gsc_daily seo_gsc_page_daily; do
     psql "$DATABASE_URL" -c "\copy (SELECT * FROM $t WHERE date < '$cutoff') TO STDOUT CSV HEADER" \
       | gzip > /home/ubuntu/backups/gsc-pre-retention-$ts-$t.csv.gz
     chmod 600 /home/ubuntu/backups/gsc-pre-retention-$ts-$t.csv.gz
     gzip -t /home/ubuntu/backups/gsc-pre-retention-$ts-$t.csv.gz
   done
   ```

   Check that the row counts (`gzip -dc FILE | tail -n +2 | wc -l`) are at least
   the dry-run counts. The backup taken on 2026-11-16
   (`gsc-pre-retention-20261116T061337Z-*`, `date < 2026-05-16`) covers a
   2026-05-01 cutoff as well.
4. Apply, outside the 08:30 WIB sync and with no backfill running (the script
   refuses while a sync run is `running`):

   ```bash
   npm run seo:gsc-retention -- --cutoff=2026-05-01 --apply              # one transaction per site
   npm run seo:gsc-retention -- --cutoff=2026-05-01 --apply --per-month  # or one transaction per site and month
   ```

   Each transaction inserts the monthly rows, checks that monthly clicks and
   impressions grew by exactly the daily sums, then deletes the daily rows. Any
   mismatch rolls the transaction back. Re-running is safe: with nothing older
   than the cutoff, it changes nothing. `--per-month` keeps each transaction,
   its locks, and its WAL small; a failure keeps the months already committed.
5. Verify: the dry run now reports 0 rows. On the SEO overview, a 6- or 12-month
   range with a query filter shows monthly dots before the cutoff.
6. Repeat monthly with `--months=6 --apply` if you want a rolling window (cron
   not installed automatically), for example `0 3 2 * *` (10:00 WIB on the 2nd).

**Disk space: VACUUM FULL is separate, manual maintenance.** `DELETE` does not
shrink the files. Autovacuum makes the space reusable for new rows, so the tables
stop growing for a while, but `df` stays the same. The script never runs VACUUM.
To return space to the OS, in a maintenance window, with the sync cron paused:

```sql
VACUUM (FULL, ANALYZE, VERBOSE) seo_gsc_daily;
VACUUM (FULL, ANALYZE, VERBOSE) seo_gsc_page_daily;
```

`VACUUM FULL` takes an `ACCESS EXCLUSIVE` lock (SEO pages and the sync wait)
and needs free disk about the size of the remaining table plus its indexes.
Check `pg_total_relation_size` and `df` first.

**Rollback.**

- Before any `--apply`: revert the code; the empty tables can stay, or run
  `db/rollbacks/060_seo_gsc_monthly_down.sql`.
- After `--apply`: restore the daily rows from the csv.gz backup and remove the
  monthly rows for the same months, in one transaction. This assumes the backup
  was made with `SELECT *` as above. The `WHERE date < cutoff` filter and
  `ON CONFLICT DO NOTHING` make a wider backup safe to use:

  ```sql
  -- psql "$DATABASE_URL", cutoff 2026-05-01
  BEGIN;
  CREATE TEMP TABLE restore_q (LIKE seo_gsc_daily INCLUDING DEFAULTS) ON COMMIT DROP;
  CREATE TEMP TABLE restore_p (LIKE seo_gsc_page_daily INCLUDING DEFAULTS) ON COMMIT DROP;
  \copy restore_q FROM PROGRAM 'gzip -dc /home/ubuntu/backups/gsc-pre-retention-<ts>-seo_gsc_daily.csv.gz' CSV HEADER
  \copy restore_p FROM PROGRAM 'gzip -dc /home/ubuntu/backups/gsc-pre-retention-<ts>-seo_gsc_page_daily.csv.gz' CSV HEADER
  INSERT INTO seo_gsc_daily SELECT * FROM restore_q WHERE date < '2026-05-01' ON CONFLICT DO NOTHING;
  INSERT INTO seo_gsc_page_daily SELECT * FROM restore_p WHERE date < '2026-05-01' ON CONFLICT DO NOTHING;
  DELETE FROM seo_gsc_monthly WHERE month < '2026-05-01';
  DELETE FROM seo_gsc_page_monthly WHERE month < '2026-05-01';
  DELETE FROM seo_gsc_rollup_months WHERE month < '2026-05-01';
  COMMIT;
  ```

  Then the code can be reverted, and `db/rollbacks/060_seo_gsc_monthly_down.sql`
  can drop the tables. Do not revert the code while rolled-up months exist: the
  old code reads daily rows only and would show those months as empty.

## Keyword Gap on treg.to (migration 061)

[treg.to](https://treg.to) is a pay-per-call gateway. Keyword Gap uses it for real
competitor rankings: position, search volume, keyword difficulty (KD), CPC and
search intent. Data comes from DataForSEO Labs "Ranked Keywords", which treg relays.
Without treg, Keyword Gap works exactly as before (Free mode).

### Server environment (`/home/ubuntu/apps/marketingos/.env.local`, never committed)

| Variable | Required | Meaning |
| --- | --- | --- |
| `TREG_API_KEY` | yes, to enable treg | treg token. Use an **org-scoped agent token** (`treg org agent-new`, or the treg dashboard: Team → API keys). It is sent only as the `X-Treg-Token` header, and it is never stored in the DB, logged or shown in the UI. |
| `TREG_DAILY_SPEND_LIMIT_USD` | no (default `5`) | Server-side cap on treg spend per Asia/Jakarta day. A run whose estimate would cross it is refused with a clear message. |
| `TREG_LOW_BALANCE_USD` | no (default `2`) | Below this balance the Keyword Gap page shows a low-balance warning. |
| `TREG_ADMIN_ONLY` | no (default `true`) | Paid runs are admin-only, like AI Visibility "Run now". Set `false` to let every SEO user run paid gaps. |
| `TREG_BASE_URL` | no (default `https://treg.to`) | Only `https://` URLs are accepted. |
| `TREG_ORG` | no | Sent as `X-Treg-Org`. Only needed for a personal (identity) token that belongs to more than one team. Org-scoped tokens do not need it. |

After editing `.env.local`, restart with `pm2 restart marketingos --update-env`.

### Endpoints used (all paths live in `src/lib/seo/treg-endpoints.ts`)

- `POST /call/dataforseo.google.domain.ranked_keywords`: one call for our domain and one per competitor. The body is
  `[{"target": "<domain>", "location_code": 2360, "language_code": "id", "limit": 100|200|500, "item_types": ["organic"], "order_by": ["keyword_data.keyword_info.search_volume,desc"]}]`.
  Indonesia, the US, Singapore and Malaysia use `location_code`. Any other market is sent as `location_name`.
- `GET /auth/me` gives `org_id`. `GET /orgs/{org_id}/balance` gives `balance_micro` (integer micro-USD).

### Costs

- **Estimate (before a run).** Catalog price: $0.012 per call plus $0.00012 per returned keyword.
  - 200 keywords is $0.036 per domain.
  - Our domain plus 3 competitors (4 calls) at 200 keywords is about $0.144.
  - The page shows this as an estimate, and the run button asks for a confirm click first.
- **Actual (after a run).** The `X-Treg-Cost-Micro` header on each call, summed, is recorded as `reported`.
  - A call that timed out may still have been charged, so its estimate is added and the run is flagged `estimate`.
  - Refused calls (402, 429, 5xx) are not charged by treg.
- **Records.** Each paid run is written to `seo_data_provider_spend` with user, feature, estimate, actual, cost source, balance before and after, treg call ids and time. It shows in:
  - Keyword Gap → Past runs → Cost
  - The run's status panel
  - Usage analytics (`/dashboard/analytics`) → "Data provider spend (treg)". This is kept separate from LLM token cost.
- **Balance.** Shown at the top of Keyword Gap and cached for 5 minutes. A 402 refusal updates it from `balance_micro`.

### Cost transparency for every treg feature (shared, required)

Every feature that spends treg balance (Keyword Gap now, keyword enrichment or anything later) must show:
- **before** a generate: the estimated cost of ONE generate and the remaining balance, with a confirm click;
- **after** it: the actual cost and the new remaining balance.

Use the shared pieces rather than building your own:

| Piece | Where | What it does |
| --- | --- | --- |
| `<TregBalancePanel status />` | `src/components/seo/TregCostNotice.tsx` | Remaining balance (cached 5 min), spent today vs the daily limit, low-balance and admin-only notes. |
| `<TregCostNotice feature estimate confirming onConfirm onCancel />` | same file | Before: "Estimated cost for one generate", the remaining balance, the balance after the run, and the confirm step. |
| `<TregCostNotice … result={{ estimatedMicro, actualMicro, source, balanceAfterMicro }} />` | same file | After: the actual cost (reported by treg, or flagged as an estimate) and the remaining balance. |
| `useTregStatus()` | same file | Reads `GET /api/seo/treg`, which is feature-agnostic and never returns the token. |
| `guardTregSpend({ feature, estimate, confirmedEstimateMicro, … })` | `src/lib/seo/treg-cost-guard.ts` | Server side, before calling treg. Checks, in order: admin-only, the client confirmed at least the server's estimate (409 otherwise), balance (too low means Free mode), then the daily limit, reserving the estimate under an advisory lock. The balance before is recorded. |
| `settleTregRun({ spendId, actualMicro, costSource, … })` | same file | After the run: records the actual cost, re-reads the balance (or takes `balance_micro` from a 402), and returns the cost object for the result. |

A new feature computes its own one-generate estimate. Keyword Gap's is `estimateKeywordGapMicro` in `treg-endpoints.ts`. Put any new endpoint id and price in that same file.

### Fallback (never blocks the page)

| Situation | What happens |
| --- | --- |
| `TREG_API_KEY` missing | Free mode, with the notice "treg unavailable: not configured — showing Free mode". |
| Balance below the estimate | Free mode before any paid call ("insufficient balance"). |
| 401/403, 402 `insufficient_balance` / `route_max_cost`, 429 caps, 5xx, timeout, network | The run stops calling treg and finishes in Free mode, with the reason in English. Calls already made stay recorded. |
| Daily limit reached | The paid run is refused with the amount used today. Free mode still works. |
| Non-admin picks treg (admin-only on) | Refused, with a hint to use Free mode. |

Free mode then needs stored Search Console rows or an uploaded Queries export, as before.

### Rollback

`db/rollbacks/061_seo_data_provider_spend_down.sql`:
- drops the spend table (export it first if you need the history);
- relabels treg gaps as `free`;
- restores the 056 provider check.

Revert the code first.

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

- Migration 060 adds the monthly roll-up tables; see "Search Console data retention".

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
   - The page has a **How to use AI Visibility** guide. It opens automatically while a site has no prompts and otherwise remembers whether you left it open or closed (per browser). It also shows example rows for a fictional broker (Acme Markets) and its competitors.
   - Write one question per prompt, worded the way a customer would ask an AI assistant. Avoid generic brand terms that can match by accident.
   - **Use example** fills the add-prompt form without saving. **Download CSV template** gives the import header plus example rows. The examples live in `src/lib/seo/visibility-examples.ts`.
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
