# Plan: Partnership Competitor Intelligence (PR 1)

Spec: docs/superpowers/specs/2026-11-15-partnership-competitor-intelligence.md

1. Tests first: `tests/partnership-intel.test.ts` (pure helpers: input validation, RSS dates,
   page facts, source catalog, citation enforcement, timeline, comparison, weekly due, cron auth),
   `tests/partnership-access.test.ts` (feature key, route prefix, sidebar, migration text),
   `tests/partnership-run.test.ts` (pipeline with fake crawler/news/LLM), `tests/partnership-pg.test.ts`
   (057 up twice + seed + rollback on PostgreSQL; skipped without a DB URL).
2. Migration `db/migrations/057_partnership_competitor_intel.sql` and rollback.
3. `src/lib/authorization.ts`: `partnership` feature, label, href, prefix match. Sidebar group.
   Fix `tests/seo-os.test.ts` exclusion list.
4. `src/lib/partnership/intel.ts` (pure), `store.ts` (DB), `collect.ts` (sources),
   `run.ts` (pipeline + due runner), `evidence.ts` (screenshot vision).
5. API routes under `src/app/api/partnership/**`, cron route, `scripts/run-partnership-refresh.ts`.
6. Page `src/app/dashboard/partnership/competitor-intelligence/page.tsx` + redirect from `/dashboard/partnership`.
7. Docs, lint, typecheck, tests, build, PR, CI.
