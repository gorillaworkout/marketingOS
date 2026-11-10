# Settlement Report redesign — implementation plan

**Spec:** `docs/superpowers/specs/2026-11-10-settlement-report-redesign-design.md` (approach C, hybrid)
**Branch:** `feat/settlement-report-redesign`, fresh off current `origin/main` (da35c73, Access tabs already removed in #136/#137). Rebase on `main` before opening the PR. Final nav: **Report | Data sources** only.
**Goal:** a professional report page (KPI strip, charts, numbered sections, Pending chips, 0-decimal IDR on screen), uploads moved to a Data sources tab, Commission in UI + xlsx, Export PDF via a print route.

## Global constraints

- Do not touch access/department code (`src/lib/settlement/access.ts`, layout guard semantics). Do not push to `main`; squash-merge only after Bayu's OK.
- No raw settlement data, no prod `.env` in the repo. Tests use `tests/fixtures/settlement.ts` and `OFFICIAL_COMMISSION_BUCKETS`.
- No new runtime dependency. Charts are hand-rolled SVG; PDF = browser print.
- TDD for every task: write the failing test, run it, implement, run it green, commit. Test runner: `npx tsx --test tests/<file>.test.ts`. Render tests: `renderToStaticMarkup`.
- Pending is never 0. IDR on screen 0 decimals; exports exact.
- **Period rules (confirmed):** Daily = 12:00–12:00 WIB (report day D = (D−1 12:00:00, D 12:00:00]); Weekly = Mon–Sun; Monthly = calendar month with the existing monthly logic.
- **Withdrawal % KPI is NOT final.** Every use goes through `WITHDRAWAL_PCT_KPI` (Task 7). No other file hard-codes a definition.
- After each task: `npx tsc --noEmit` and the touched tests. Before the PR: all `tests/settlement-*.test.ts` and `npm run build`.

## File map

| File | Status | Task |
|---|---|---|
| `src/lib/settlement/format.ts` | new | 1 |
| `src/lib/settlement/conventions.ts` | modify (`settlementDayOf`) | 2 |
| `src/lib/settlement/report.ts` | modify (period basis, `PeriodSummary`, loader) | 2, 5 |
| `src/lib/settlement/metrics.ts` | modify (day-key parameter) | 3 |
| `src/lib/settlement/summary.ts` | new | 4, 6 |
| `src/lib/settlement/kpi-config.ts` | new (single Withdrawal % definition point) | 7 |
| `src/lib/settlement/kpis.ts` | new | 7 |
| `src/lib/settlement/report-data.ts` | new (`attachDealsHistory`) | 8 |
| `src/lib/settlement/export.ts` | modify (Overview KPIs, Commission sheet) | 9 |
| `src/lib/settlement/upload-route.ts` | new | 10 |
| `src/app/api/settlement-report/{report,export,uploads}/route.ts` | modify | 8, 9, 10 |
| `src/components/settlement/report/*` | new | 11–15 |
| `src/components/settlement/SettlementNav.tsx` | modify | 13 |
| `src/components/settlement/{SettlementDashboard,SettlementWorkspace,SettlementUploadPanel}.tsx` | modify | 16 |
| `src/components/settlement/{SettlementHome,DealsHistoryPanel,JisdorPanel,SettlementTables}.tsx` | removed (folded in) | 16 |
| `src/app/dashboard/settlement-report/{page,data/page,print/page}.tsx` | modify / new | 16, 17 |
| `src/app/globals.css` | modify (print) | 17 |
| tests: `settlement-format`, `settlement-conventions`, `settlement-metrics`, `settlement-summary`, `settlement-kpi-config`, `settlement-report`, `settlement-export`, `settlement-upload-route`, `settlement-report-view`, `settlement-page` | new / extend | all |

---

### Task 1 — Formatters (`format.ts`)

1. Test `tests/settlement-format.test.ts`:
   - `formatIdr(48210770000.49)` → `48,210,770,000`; `formatIdr(-1234.5)` → `−1,235` (U+2212); `formatIdr(null)` → `—`.
   - `formatUsd(1957.449)` → `1,957.45`; negative uses U+2212.
   - `formatCompact`: `48_210_000_000` → `48.21 B`, `1_840_000` → `1.84 M`, `912_400` → `912.4 K`, `999` → `999`, negatives.
   - `formatDurationShort`: `252` → `4m 12s`, `72_900` → `20h 15m`, `null` → `—`.
   - `computeDelta(cur, prev, { kind: 'relative' | 'points' | 'seconds', favourable: 'up' | 'down' | 'neutral' })` → `{ text, tone: 'good'|'bad'|'neutral'|'flat', sr }`; `prev` null or 0 → `null`; |Δ| < 0.05% → `flat`.
2. Run → fail. Implement with `Intl.NumberFormat('en-US')`. Run → pass. Commit `feat(settlement): report formatters`.

### Task 2 — Period basis: Daily 12:00–12:00 (`conventions.ts`, `report.ts`)

1. Tests (extend `tests/settlement-conventions.test.ts`, `tests/settlement-report.test.ts`):
   - `settlementDayOf('2026-11-10T05:00:00.000Z')` (10 Nov 12:00:00 WIB) → `2026-11-10`; `…05:00:01Z` → `2026-11-11`; `2026-11-09T05:00:01Z` → `2026-11-10`.
   - `resolveSettlementPeriod('day', '2026-11-10')` → `basis: 'noon'`, `window` equal to `reconciliationWindow('2026-11-10')`; `week` and `month` → `basis: 'calendar'`, ranges unchanged (Mon–Sun; calendar month).
2. Implement `settlementDayOf(iso) = wibDateOf(new Date(Date.parse(iso) + 12h − 1ms).toISOString())` next to `reconciliationWindow`. Add `basis` + optional `window` to `SettlementPeriod`. Add `dayKeyFor(period): (iso) => string` returning `settlementDayOf` for `noon`, `wibDateOf` for `calendar`.
3. Run → pass. Commit `feat(settlement): daily period is 12:00–12:00 WIB`.

### Task 3 — Metrics take the day key (`metrics.ts`)

1. Tests (extend `tests/settlement-metrics.test.ts`): with the noon key, `applications` counts a withdrawal requested 10 Nov 11:59 WIB for D = 10 Nov and one at 10 Nov 12:30 WIB for 11 Nov; `processingTime` rows follow the same rule; with the default key every existing test is unchanged.
2. Add an optional last parameter `dayKey = wibDateOf` to `applications`, `processingTime`, `withdrawalPercentage` (week grouping) and `swapReport`, used **only** for period membership / row date. Keep "2nd withdrawal = completed on a later WIB calendar day" and `isOfficeHour` unchanged. `marginInOut` is untouched (monthly logic).
3. `buildSettlementReport` passes `dayKeyFor(period)`. Run all settlement tests → pass. Commit.

### Task 4 — Summaries (`summary.ts`)

1. Test `tests/settlement-summary.test.ts`:
   - `previousSettlementRange`: day → D−1 (noon window), week → previous Mon–Sun (incl. across a month), month → previous calendar month (Jan → Dec of previous year), custom → same length immediately before.
   - `periodTotals(deposits, withdrawals, range, dayKey)`: successful only; deposits by completion day, withdrawals by request day; rate 1 → USD, other rates → IDR = `amountUsd × rate`; counts; `withdrawalPct = { officeHourPct, ofDepositsPct }` where `officeHourPct = (total − second) / total × 100` (second = completed on a later WIB day) and `ofDepositsPct = wdIdr / depIdr × 100`; zero denominators → `null`.
   - `dailyFlows(...)`: one row per date of the range, zeros where no rows.
2. Implement; run → pass; commit.

### Task 5 — Report payload (`report.ts`)

1. Tests (extend `tests/settlement-report.test.ts`): `buildSettlementReport` returns `previousRange`, `summary.current/previous` (`PeriodSummary` with `totals`, `processing.{deposit,withdrawal}`), and `daily`; existing fields unchanged.
2. `loadSettlementReport` widens the CRM load to `min(previousRange.from, weeksTouching(range).from)` − 1 day padding (covers the noon window). No migrations. Run → pass; commit.

### Task 6 — Deals History summary (`summary.ts`)

1. Tests: `dealsHistorySummary(days)` over `officialBucketDeals()` → `status: 'complete'`, `commissionIdr` = Σ(rate≠1 × rate) (expected −663,133,880 for the Oct 1–5 buckets), `commissionByRate` = `{1: −100.79, 10000: −14033.77, 12000: −66.89, 14000: −37285.25}`; a `missing` day → `status: 'pending'`, `pendingDays: 1`; `attested` → counted, not pending. `sourceFreshness(through, today)` → `current | behind(n) | none`; `coverageTone(through, rangeEnd)` → `ok | warn`.
2. Implement; run → pass; commit.

### Task 7 — KPI definitions + the single Withdrawal % config point (`kpi-config.ts`, `kpis.ts`)

1. Test `tests/settlement-kpi-config.test.ts`:
   - `WITHDRAWAL_PCT_KPI` is one of `'office-hour' | 'wd-over-dep' | 'both'`.
   - `withdrawalPctCards(summary, mode)`: `office-hour` → 1 card "Withdrawal % (office hour)", value `officeHourPct`, favourable up, note "{office} of {total} same-day"; `wd-over-dep` → 1 card "Withdrawal % (of deposits)", value `ofDepositsPct`, favourable down; `both` → 2 cards in that order.
   - `buildKpis(summary)` returns Deposits, Withdrawals, Net margin in–out, the Withdrawal % card(s) from config, Avg processing, Commission (PendingChip flag when `commission.status === 'pending'`, delta only when both periods complete).
   - `withdrawalPctMethodology(mode)` returns the Methodology text.
2. Implement. `kpi-config.ts` holds **only** the constant (default `'office-hour'`), its type, labels and the methodology text. Switching definitions after Bayu decides = change the constant + one expected label in this test.
3. Run → pass; commit `feat(settlement): KPI builder with configurable Withdrawal %`.

### Task 8 — Attach Deals History in routes (`report-data.ts`)

1. Test (pure part): `applyDealsHistory(report, currentDays, previousDays)` sets `report.dealsHistory` and both `summary.*.commission`.
2. Implement `attachDealsHistory(report)` calling `loadDealsHistoryDays` for current and previous range, and `loadDealsHistoryThrough()` (max `server_date` across `settlement_dh_daily` ∪ `settlement_dh_coverage`, via `queryAll`). Wire into `report` and `export` routes; `uploads` GET adds `dealsHistoryThrough`. Commit.

### Task 9 — xlsx export (`export.ts`)

1. Tests (extend `tests/settlement-export.test.ts`): `SETTLEMENT_SHEETS` ends with `'Commission'`; `commissionRows` has a daily block (Date, USD, 10000, 12000, 14000) with exact numbers or `PENDING_DEALS_HISTORY` / `ATTESTED_EMPTY`, never 0 for a missing day; total row Pending while incomplete; "Commission IDR (Σ × rate)" and "Commission USD" rows. `overviewRows` adds KPI rows with Current / Previous / Change; the Withdrawal % row(s) follow `WITHDRAWAL_PCT_KPI` and use the screen labels. Values are not rounded.
2. Implement; run → pass; commit.

### Task 10 — Upload routing (`upload-route.ts`)

1. Test `tests/settlement-upload-route.test.ts`: bytes `FF FE` + UTF-16LE text containing `Deal` → `'deals_history'`; BOM without `Deal` → `'standard'`; xlsx (`PK`) / csv → `'standard'`.
2. Implement `routeSettlementFile(firstBytes, name)`; commit.

### Task 11 — Primitives (`src/components/settlement/report/`)

`ReportTable.tsx` (`TABLE` class constants, `Th`, `Td`, `NumTd`, `GroupHeader`, `Money` with `data-currency`), `PendingChip.tsx` (`data-pending="true"`, text "Pending", optional reason in `title`), `CoverageChips.tsx`, `Sparkline.tsx` (hidden when < 2 points, e.g. Daily). Render tests in `tests/settlement-report-view.test.ts` for each; commit.

### Task 12 — KPI strip and charts

`KpiStrip.tsx` renders `buildKpis` output (6 columns, 7 when mode `both`), deltas with arrow + text + `sr-only`. `FlowChart.tsx` (daily IDR deposits/withdrawals bars, net line), `ProcessingChart.tsx` (gaps for no data). `role="img"` + `aria-label`. Render tests; commit.

### Task 13 — Nav

`SettlementNav.tsx` tabs: `Report` (`/dashboard/settlement-report`) and `Data sources` (`/dashboard/settlement-report/data`). Update `tests/settlement-page.test.ts`: both labels present, no `Access`. Commit.

### Task 14 — Sections

`SettlementPeriodBar.tsx` (Daily "12:00–12:00 WIB" with the window as sub-label, Weekly "Mon–Sun", Monthly "Calendar month"; "Compared with …"), `SectionNav.tsx` (sticky, IntersectionObserver, `aria-current`), `ReportSectionHeader.tsx`, `ReconciliationSection.tsx`, `ProcessingSection.tsx`, `WithdrawalTimingSection.tsx` (title "Withdrawal timing split"), `MarginSection.tsx`, `CommissionSwapSection.tsx` (Pending chips, coverage strip), `JisdorSection.tsx` (from `JisdorPanel`), `MethodologySection.tsx` (includes period rules and `withdrawalPctMethodology(WITHDRAWAL_PCT_KPI)`). Render test per section; commit per 2–3 sections.

### Task 15 — `SettlementReportView`

Pure composition from props with `variant: 'screen' | 'print'`. Render test with fixture props asserts: KPI labels (Withdrawal % label taken from the config, not a literal), "Withdrawal timing split", IDR `48,210,770,000` without `.00`, a Pending chip and no `0.00` in a missing-day commission cell, all section ids, no "Access". Commit.

### Task 16 — Containers and Data sources tab

`SettlementDashboard.tsx` → fetch + `SettlementReportView`; `SettlementWorkspace.tsx` Report tab only; `page.tsx`. `SettlementUploadPanel` exposes `choose` / `hideInput` via `forwardRef`; new `SettlementDataSources.tsx` (5 source cards with `sourceFreshness`, one drop zone using `routeSettlementFile`, Deals History chunked flow, upload history) and `data/page.tsx`. Remove `SettlementHome`, `DealsHistoryPanel`, `JisdorPanel`, `SettlementTables` once nothing imports them. Update `tests/settlement-page.test.ts`. Commit.

### Task 17 — PDF print route

`print/page.tsx` + `SettlementPrint.tsx` (`variant="print"`, `.print-report` light vars, header "Dupoin · Settlement Report", period label, generated WIB timestamp, coverage as text, first 50 mismatches, `window.print()` once unless `?noprint=1`). `globals.css`: `@page { size: A4 landscape; margin: 12mm }`, `break-inside: avoid`, `thead { display: table-header-group }`. Export PDF button opens it in a new tab. Render test with `noprint`; commit.

### Task 18 — Verify and PR

1. `npx tsc --noEmit`; every `tests/settlement-*.test.ts`; `npm run build`.
2. Rebase on `origin/main`; push `feat/settlement-report-redesign`; open a PR (draft until Bayu reviews). Note in the PR: Withdrawal % mode currently `office-hour`, pending Bayu's choice.
3. After Bayu's OK and deploy: on production open Report (Daily, Weekly, Monthly), Data sources and Print for Oct 2026; check Daily totals follow 12:00–12:00 against one reconciliation day; check Oct 1–5 commission equals the audited buckets.
