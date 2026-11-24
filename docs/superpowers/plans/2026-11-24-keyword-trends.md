# Keyword Trends — implementation plan

Spec: `docs/superpowers/specs/2026-11-24-keyword-trends-design.md`.

1. **Client.** Add `generateKeywordIdeas(customerId, request, options)` to the
   Google Ads REST client (`src/lib/google-ads/client.ts`): POST
   `customers/{id}:generateKeywordIdeas`, follow `nextPageToken` up to a row
   limit, same auth, retry and sanitizing as `search`. The existing
   `GoogleAdsClient` interface stays unchanged; the new method lives on
   `KeywordPlannerClient`.
2. **Pure logic** in `src/lib/keyword-trends/`:
   - `config.ts`: fixed config, `requestSpecs`.
   - `metrics.ts`: `parseIdea` (REST JSON to idea), `mergeIdeas`,
     `monthlyTrendRows` (port of the Python metrics), `summarizeKeywords`.
   - `export.ts`: `buildKeywordTrendsWorkbook`, `selectRecentMonths`.
   - `collector.ts`: `pickPlannerAccount`, `collectKeywordTrends`,
     `runKeywordTrendsFetch` with an injected store and client.
3. **Migration 068** + rollback; no `?` characters in either file.
4. **Store** `src/lib/keyword-trends/store.ts`: start/finish snapshot with
   the one-running lock and stale release, batched row insert, latest
   snapshot, keyword summary, rows for export.
5. **Service + routes** under `/api/paid-media/keyword-trends`: GET (data and
   status), POST `fetch` (after-response job), GET `export`. All gated with
   `requireFeature(request, 'google-ads')`.
6. **CLI** `scripts/keyword-trends-fetch.ts` (`npm run keyword-trends:fetch`),
   with `--scheduled` and `--dry-run`. Cron line documented, not installed.
7. **Page** `src/app/dashboard/paid-media/keyword-trends/page.tsx`, sidebar
   item, alias in `authorization.ts`.
8. **Tests** (`tests/keyword-trends.test.ts`): metric calculations against
   hand-computed values, merge/dedupe, request body, client paging, export
   workbook (sheets, months, numeric percent with `0.00%`), route gating,
   migration has no `?` and the rollback drops the tables, no treg.
   A PostgreSQL test runs the migration and store when a test DB URL is set.
9. `npm run build`, `npx tsx --test tests/*.test.ts`, lint the new files.
10. Live read-only check from the VPS; open a PR. No merge or deploy without
    Bayu's OK.
