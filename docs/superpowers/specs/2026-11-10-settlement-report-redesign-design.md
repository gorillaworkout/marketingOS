# Settlement Report redesign — design spec

**Date:** 2026-11-10 · **Status:** approved by Bayu (approach C, hybrid); §15 decisions are final · **Base:** `main` da35c73 (Access tabs removed)
**Plan:** `docs/superpowers/plans/2026-11-10-settlement-report-redesign.md`

## 1. Problem

The Settlement Report (`/dashboard/settlement-report`) shows correct numbers but reads like a copy of the Excel sources:

- Upload tools (file inputs, upload history, the Deals History panel) sit above the report, so the page opens on data entry, not results.
- Tables are raw: headers are left-aligned over right-aligned numbers, there are no grouped headers or subtotal styling, and there are no sticky headers. Some cells are joined strings ("2m 31s · 198", "612 (67.3%)", "USD 1.00 · 10000 …").
- Every amount shows 2 decimals, including IDR. Amounts have no currency labels and negatives are not colored.
- Pending is plain text inside a cell ("Pending: Dealing FTD list"), with no visual status.
- The only chart is deposit request counts. The KPI cards show counts and times only, with no amounts and no comparison with the previous period.
- Methodology paragraphs are repeated under every table.
- **Commission is not shown anywhere.** `report.dealsHistory[].commission` is loaded but no component renders it, and the xlsx export has no commission sheet.

Onboarding Reports is the bar for polish: segmented period control, a "compared with previous" line, data-through chips, one KPI panel with deltas, charts in panels, and uploads on their own tab.

## 2. Decision

**Approach C (hybrid).** The page has two tabs, **Report | Data sources**. The Report tab is one numbered report document. A sticky section bar links to each section, and Export PDF and Export .xlsx sit in the page header.

Rejected alternatives:
- **A (dashboard + drilldown tabs):** hides context and does not print as one document.
- **B (single print document only):** too long for interactive drilldowns such as mismatch lists.

The reference mockup was a static HTML file built from sample numbers (screens: overview, reconciliation + processing, commission & swap, data sources). It is intentionally **not** committed. It used sample data and a copied brand asset. This spec is the source of truth.

## 3. Global rules

- **Copy:** UI copy is English; Bayu is spoken to in Indonesian outside the app. Labels are short and specific.
- **Brand:** reuse the `--mos-*` tokens (`src/app/globals.css`) and `DUPOIN` from `src/components/monthly-report/brand.ts` (teal `#2EB5C4`, deep `#1A8A96`). The layout already sets the Dupoin accent vars. No new logo usage on screen. The PDF header uses the text "Dupoin · Settlement Report" only; no image is required.
- **Shared components:** reuse `Panel`, `SectionHeader`, `MetricCard`-style layout, `StatusBadge`, `Button` and `PageHeader`/`PageStack` from `src/components/ui/dashboard.tsx`.
- **No new runtime dependency.** The PDF uses the browser's print pipeline (section 9). Charts are hand-rolled SVG, following `src/components/monthly-report/charts.tsx`.
- **Access is not part of this work.** There is no Access tab. Department access from the Account menu is the only gate (`settlement-report` feature; already merged in #136/#137, `main` da35c73).
- **No raw settlement data in the repo.** Tests use the existing synthetic fixtures (`tests/fixtures/settlement.ts`) and the audited bucket constants.

## 4. Number formatting rules

All formatters live in `src/lib/settlement/format.ts` and are unit-tested.

| Kind | Screen | Export (xlsx) |
|---|---|---|
| IDR amount (USD × account rate) | `formatIdr`: 0 decimals, en-US thousands separators, e.g. `48,210,770,000` | exact value (2-decimal rounding as computed) |
| USD / account-currency amount (rate 1, or per-rate commission/swap) | `formatUsd`: 2 decimals, e.g. `1,957.45` | exact |
| KPI headline | `formatCompact`: `48.21 B`, `1.84 M`, `912.4 K`, below 1,000 = integer; the currency prefix (`IDR`/`USD`) is a separate small label | n/a |
| Negative | U+2212 minus `−1,234` with class `neg` (red); positives that represent inflow may use `pos` (green) only in Net columns and CRM-SR | plain negative number |
| Percent | `formatPct` (existing, 1 decimal max) | number with 2 decimals |
| Duration | `formatDurationShort`: `<1h` → `4m 12s`; `≥1h` → `20h 15m`; `null` → `—` | existing `HH:MM:SS` (`formatDuration`) |
| Count | `formatInteger` (existing) | number |
| Empty, not pending | `—` (muted) | empty cell |

Numbers are right-aligned with `tabular-nums`. Header cells over numeric columns are right-aligned too.

## 5. Pending rules (never 0)

A value is **Pending** when its source does not cover the period. The cell shows `PendingChip` (amber `StatusBadge tone="warning"` with a dot and the text "Pending", optionally with a reason in the title attribute). It never shows `0` or `—`.

| Value | Pending when |
|---|---|
| Commission, Deals History swap (per day) | the day's `DealsDay.status` is `missing` or `partial` |
| Commission / DH swap period total and KPI | any day in the period is `missing` or `partial`. Per-rate rows still show the sum of imported days with a chip "N d Pending" beside them. |
| Initial margin (month) | `idrInitialMargin`/`usdInitialMargin` is `null` (no Dealing FTD list) |
| Deposit ex-IM column | same as Initial margin |
| `attested` day | not Pending. Shows `0.00` with the subtle chip "Attested" because the uploader confirmed there were no deals. |

Net margin in–out is **never** Pending. It is all successful deposits minus withdrawals and does not depend on the FTD list. (The mockup showed it Pending; that was wrong.)

## 6. Layout — Report tab

Top to bottom:

0. **Page header:** eyebrow "Reports", title "Settlement Report", one-line description. Actions: `Export PDF` (secondary) and `Export .xlsx` (primary).
1. **Tabs:** `Report | Data sources` (`SettlementNav`, links `/dashboard/settlement-report` and `/dashboard/settlement-report/data`).
2. **Period bar** (`SettlementPeriodBar`, inside the toolbar):
   - Segmented control: **Daily** (sub-label "12:00–12:00 WIB"), **Weekly** ("Mon–Sun"), **Monthly** ("Calendar month"). Built as buttons with `aria-pressed`, styled like the Onboarding control.
   - `‹` / `›` buttons and a period label, e.g. "October 2026" with sub-label "1 – 31 Oct 2026 · WIB". For Daily the label is both dates of the window, e.g. "05–06 Nov" for 05 Nov 12:00 → 06 Nov 12:00 (report day D = 06 Nov, the window end). The sub-label is the precise window from `reconciliationWindow`, e.g. "2026-11-05 12:00:01 – 2026-11-06 12:00:00 WIB".
   - Period rules (confirmed by Bayu, see §7.1 and §15): **Daily = 12:00 WIB → 12:00 WIB** (report day D = (D−1 12:00:00, D 12:00:00]), **Weekly = Mon–Sun** WIB dates, **Monthly = calendar month** using the existing monthly logic (same as Initial margin / Margin in–out).
   - Right side: "Compared with September 2026" (the previous-period label). Same-period-last-year was dropped (YAGNI).
3. **Coverage chips** (`CoverageChips`): "Data through:" then one chip per source: CRM Deposit, CRM Withdrawal, MT5 D&W, Dealing FTD, Deals History.
   - Green (`ok`) when the data-through date ≥ the period end.
   - Amber otherwise. Deals History shows "Deals History · {last covered date}, {n} days Pending" from the period's `dealsHistory`.
4. **KPI strip** (`KpiStrip`): one `Panel padding="none"`, 6 columns (3 on md, 2 on sm). Each card has a label with an info tooltip (definition), the value, a delta vs the previous period, a note line, and a sparkline.

   | KPI | Value | Delta kind | Favourable | Note |
   |---|---|---|---|---|
   | Deposits | IDR compact | relative % | up | `USD x · n requests` |
   | Withdrawals | IDR compact | relative % | down | `USD x · n requests` |
   | Net margin in–out | IDR compact (deposits − withdrawals, IDR) | relative % | up | "Deposits − withdrawals" |
   | Withdrawal % (office hour, §15) | from `WITHDRAWAL_PCT_KPI = 'office-hour'` (§6.1) | points (`pt`) | up | "{office} of {total} same-day" |
   | Avg processing | deposit office-hour mean (`processing.summary.deposit`) | seconds | down | `WD {withdrawal office-hour mean}` |
   | Commission | IDR compact (Σ IDR-rate commission × rate), or `PendingChip` | relative % (only when both periods are complete) | neutral | `USD x` or "{observed} of {total} days imported" |

   **6.1 Withdrawal % KPI — one definition point.** Bayu decided `office-hour` (§15). All KPI code still reads `WITHDRAWAL_PCT_KPI` in `src/lib/settlement/kpi-config.ts` (`'office-hour' | 'wd-over-dep' | 'both'`); no component, export or test hard-codes a definition. The constant is `'office-hour'`.
   - `office-hour` (Excel, `Withdrawal Percentage - 2026.xlsx`): `office ÷ total × 100` of withdrawal requests in the period, where **office = total − 2nd withdrawal** (completed on the same WIB day as requested). Favourable = up. Label "Withdrawal % (office hour)", note "{office} of {total} same-day".
   - `wd-over-dep`: `withdrawals IDR ÷ deposits IDR × 100`. Favourable = down. Label "Withdrawal % (of deposits)", note "Withdrawals ÷ deposits (IDR)".
   - `both`: two cards side by side; the strip becomes 7 columns (4 on md, 2 on sm).
   - `PeriodSummary.withdrawalPct` carries both values (`officeHourPct`, `ofDepositsPct`) so switching mode is a one-line change with no data or API change. The xlsx Overview writes the row(s) for the active mode with the same labels; the Methodology card text comes from the same config.
   - Decided value: `office-hour` (the Excel the team already uses). A later change is still one constant plus its expected label in one test.

   Delta text: `▲ 12.4%`, `▼ 38s`, `▲ 3.5 pt`, colored by favourability (good = green, bad = red, neutral = muted), followed by the muted text `vs {previous formatted value}`. If the previous value is `null` or 0, the delta is omitted and the note says "No previous data". A screen-reader text spells it out ("up 12.4% versus previous period").

   Sparkline series come from `report.daily` (deposits, withdrawals, net, withdrawal %) and `processing.deposits` (daily office-hour mean of API + manual, weighted by hits). Commission has no sparkline.
5. **Sticky section nav** (`SectionNav`, `position: sticky; top: 0`): Overview · Reconciliation (count of mismatches) · Processing time · Withdrawal timing · Margin in–out · Commission & swap (Pending count) · JISDOR, and Methodology right-aligned. Plain anchor links to section ids. An `IntersectionObserver` marks the active link with `aria-current="true"`.
6. **Charts row** (2 columns, `1.45fr 1fr`):
   - `FlowChart`: daily IDR deposits (teal) and withdrawals (gray `#5e626b`) as grouped bars, with the net line in amber. Y axis is compact IDR.
   - `ProcessingChart`: three lines (deposit API, deposit manual, withdrawal office hour), daily office-hour averages, Y axis in minutes. Days without data are gaps, not 0.
7. **01 · Daily reconciliation** (`ReconciliationSection`):
   - Header: title "CRM vs MT5", a chip "{n} mismatches" (danger) or "Matched" (success), the same both-dates label as the period bar ("05–06 Nov"), and a sub-line with the 12:00:01–12:00:00 WIB window. The window and the figures are the existing reconciliation (`buildDailyReconciliation('2026-11-06')` stays CRM 1,390/445/88 and MT5 1,306/445/2).
   - Its own date stepper (‹ date ›), defaulting to the existing `defaultReconDate()`. When the period preset is Daily, it follows the period anchor.
   - Body has three columns: the CRM statement, the MT5 statement (rate rows, Clients row, Total row), and a match panel. The match panel has a ring with `matched ÷ (matched + mismatches)` and four filter buttons with counts (CRM only, MT5 only, Amount differs, Account differs).
   - Below is the mismatch table: Reference (monospace), Account, Side, Time (WIB), CRM, MT5, Difference (signed, red when negative), State chip (pending → amber "Pending in CRM", missing → red "MT5 missing"), and pagination.
8. **02 · Processing time** (`ProcessingSection`):
   - Grouped header: Deposit · office hour (API, Manual) | Deposit · after office (API, Manual) | Withdrawal (Office hour, 2nd withdrawal).
   - Each cell shows the duration with "{hits} req" below in muted text.
   - After each Sunday there is a weekly subtotal row: the mean of daily office-hour averages, same rule as the existing summary. The last row is the period average.
   - Scroll container with `max-height: 360px` and a sticky `thead`.
9. **Withdrawal timing split** (`WithdrawalTimingSection`, renamed from "Withdrawal %"): weeks Mon–Sun with Office hour / After office / 2nd withdrawal (count, % below), Total, and a mix bar (teal / teal-soft / amber). The total row is the period sum.

   **Margin in–out** (`MarginSection`), in a 2-column grid with the section above:
   - Months of the anchor year. Grouped header IDR | USD.
   - Columns per currency: Initial margin, Deposit (ex-IM when FTD is loaded, else Pending), Withdrawal, Net in–out (all deposits − withdrawals).
   - Total row (year to date) and an `IDR` / `USD` chip in the header.
10. **03 · Commission & swap** (`CommissionSwapSection`):
    - One row per account rate (USD, 10,000, 12,000, 14,000).
    - Grouped header: Commission (Deals History) | Swap, three separate lines (CRM-S, CRM-SR, Deals History swap) | IDR equivalent.
    - IDR equivalent shows CRM-S + SR × rate for IDR rates and "n/a (USD)" for USD.
    - Period total row: commission and DH swap are Pending while any day is not covered.
    - The footer note explains the Pending rule.
    - Below the table is a Deals History coverage strip: one cell per day of the period (MT5 server date), colored imported / attested / pending, with a legend.
    - Section header chip: "Deals History covers {observed + attested} of {total} days".
11. **JISDOR reference** (`JisdorSection`, refactor of `JisdorPanel`): chip "Display only", a line chart of fixings, latest fixing and range text, and a `Fetch latest` button. The behavior of the existing `/api/settlement-report/jisdor` is unchanged.

    **Methodology & sources** (`MethodologySection`): a static grid of short definitions. These replace the long per-table descriptions:
    - report day 12:00 window
    - account rate digit map
    - office hour
    - MT5 server time for commission and swap
    - Pending, not zero
    - initial margin
    - Withdrawal % definition (text from `WITHDRAWAL_PCT_KPI`)
    - Period rules: Daily 12:00–12:00 WIB, Weekly Mon–Sun, Monthly calendar month

Section ids: `overview`, `reconciliation`, `processing`, `withdrawal-timing`, `margin`, `commission-swap`, `jisdor`, `methodology`.

## 7. Data needed per section

The existing `/api/settlement-report/report` response is extended. It stays backwards compatible: fields are only added.

```ts
interface SettlementReport {
  // existing: period, applications, processing, withdrawalWeeks, margin, swap, swapLabel, coverage, dealsHistory?
  previousRange: DateRange;          // previousSettlementRange(period)
  summary: { current: PeriodSummary; previous: PeriodSummary };
  daily: DailyFlow[];                // one row per WIB date in period.range
}
interface PeriodSummary {
  range: DateRange;
  totals: PeriodTotals;              // successful only
  processing: { deposit: number | null; withdrawal: number | null }; // seconds, office-hour means
  commission?: DealsHistorySummary;  // attached by the route with Deals History
}
```

### 7.1 Period basis (confirmed)

- `SettlementPeriod` gains `basis: 'noon' | 'calendar'` and, for Daily, `window: { start, end, label }` = `reconciliationWindow(anchor)`.
- **Daily (`basis: 'noon'`):** every metric of the report (applications, processing rows, totals, daily flows, KPIs, withdrawal timing, CRM swap) assigns a transaction to report day D when its timestamp falls in (D−1 12:00:00, D 12:00:00] WIB, using the same timestamp field each metric uses today (request time, or completion time for successful-deposit totals). One helper decides this: `settlementDayOf(iso) = wibDateOf(iso + 12h − 1ms)` in `conventions.ts`, so the window rule lives in one place and matches `reconciliationWindow`/`inWindow`.
- **Weekly / Monthly / Custom (`basis: 'calendar'`):** unchanged WIB calendar dates; weeks Mon–Sun; month = calendar month with the existing `marginInOut` monthly logic (Initial margin, Margin in–out untouched).
- Definitions inside a metric do not change with the basis: "2nd withdrawal" stays "completed on a later WIB calendar day than requested", and office hour stays `isOfficeHour`. Only period membership changes.
- Deals History (commission, DH swap) stays per MT5 server date; for Daily the report shows the MT5 server date equal to D (stated in Methodology).
- Confirmed: report day D is the window's **end** date, the same instant `reconciliationWindow` already uses, so Daily 05–06 Nov figures do not move. The visible label shows **both** dates ("05–06 Nov" for the window ending 06 Nov 12:00), matching the team's Excel name "Daily Report Deposit and Withdrawal (05-06 November)". The xlsx daily sheet keeps the precise `window.label` string.

- **Previous period** (`previousSettlementRange`):
  - day → the previous 12:00–12:00 window (D−1)
  - week → the previous Mon–Sun
  - month → the previous calendar month
  - custom → the same number of days immediately before
- **Totals:** use the same conventions as `marginInOut`.
  - Successful deposits are dated by WIB completion date; successful withdrawals by WIB request date.
  - Rate 1 goes to USD; other rates go to IDR as `amountUsd × rate`.
  - `count` is the number of successful rows.
  - `withdrawalPct = { officeHourPct: total > 0 ? (total − second) / total × 100 : null, ofDepositsPct: deposit.idr > 0 ? withdrawal.idr / deposit.idr × 100 : null }` (both always computed; the KPI picks by config, §6.1).
- **Loading:** `loadSettlementReport` widens its CRM query start to `min(previousRange.from, weeksTouching(range).from)`, padded 1 day. There are no new tables or migrations. The worst case is a custom 93-day range, which loads 186 + 14 days of CRM rows. That is acceptable.
- **Deals History:** the route helper `attachDealsHistory(report)` loads `loadDealsHistoryDays` for both ranges. It sets `report.dealsHistory` (current) and `summary.current.commission` / `summary.previous.commission` via `dealsHistorySummary(days)`. It is used by the report, export and print routes.
- `DealsHistorySummary` has:
  - `status: 'complete' | 'pending'`
  - `commissionByRate` and `swapByRate` (sums of observed days)
  - `commissionIdr` (Σ rate≠1 × rate), `commissionUsd` (rate 1)
  - `observedDays`, `attestedDays`, `pendingDays`, `totalDays`
  - `lastCoveredDate`
- **Reconciliation:** unchanged endpoint `/api/settlement-report/reconciliation`.
- **Data sources:** the existing `/api/settlement-report/uploads` GET adds `dealsHistoryThrough: string | null`, the max `server_date` across `settlement_dh_daily` ∪ `settlement_dh_coverage`.

## 8. Data sources tab (`/dashboard/settlement-report/data`)

The upload tools move off the report. The route uses the same layout guard. Only users who can view the report see it (upload = view, as today).

1. **Source cards (5):** CRM Deposit, CRM Withdrawal, MT5 Deposit & Withdrawal, Dealing FTD list, MT5 Deals History. Each card shows "Through {date}" and a chip:
   - "Current" (success) when through ≥ yesterday (WIB)
   - "{n} days behind" (warning) otherwise
   - "No uploads yet" (neutral)
2. **Upload files:** one drop zone (also a click-to-browse `<input type="file" multiple>`, max 10 files). Each file is routed by `routeSettlementFile(firstBytes, name)`:
   - UTF-16 LE BOM (`FF FE`) **and** the decoded header contains `Deal` → Deals History (the existing chunked `ingestDealsBytes` flow, with a progress line)
   - Everything else → the existing preview/commit flow of `SettlementUploadPanel` (content-detected kind)

   The per-file list shows file, detected type, rows, new/existing, data range (WIB), a status chip and an Import button, as today.
3. **Upload history:** the existing table, newest first, paginated. Numeric columns are right-aligned.

`SettlementHome` and `DealsHistoryPanel` are folded into `SettlementDataSources`. Their upload logic is kept, not rewritten.

## 9. PDF export

- **Approach:** a print-friendly route plus the browser's "Save as PDF". There is **no new dependency** and nothing runs server-side, so it works on the VPS with no Chromium.
  - `puppeteer-core` is already in `package.json` but needs a Chromium binary on the VPS, which has not been verified. A server-side PDF stays a later option.
- **Route:** `/dashboard/settlement-report/print?preset=&anchor=`. It uses the same guard and renders `SettlementReportView` with `variant="print"`.
  - Light theme via a `.print-report` wrapper that overrides the `--mos-*` vars: white background, ink `#1A1F24`, teal accents.
  - No nav, no buttons, no sticky elements. Sections are expanded: the processing table has no max-height, and the reconciliation mismatch list shows the first 50 rows with a note.
  - Header: "Dupoin · Settlement Report", the period label, "Generated {WIB timestamp}", and the coverage chips as text.
  - `@media print`: A4 landscape (`@page { size: A4 landscape; margin: 12mm }`), `break-inside: avoid` on panels, `thead { display: table-header-group }` so headers repeat, and charts kept as SVG.
  - After data loads, it calls `window.print()` once (skipped when `?noprint=1`, which tests use).
- **Button:** `Export PDF` opens the print route in a new tab with the current period.

## 10. xlsx export

The existing workbook (`buildSettlementWorkbook`) is kept. Exact values are not rounded to 0 decimals.

- `SETTLEMENT_SHEETS` becomes `['Overview', 'Processing Time', 'Withdrawal %', 'Margin In-Out', 'Swap', 'Commission']`. Sheet names stay stable for existing users; the on-screen title is "Withdrawal timing split".
- **Overview** adds KPI rows, each with Current, Previous and Change:
  - Deposits IDR, Deposits USD
  - Withdrawals IDR, Withdrawals USD
  - Net IDR
  - Withdrawal % — row(s) per `WITHDRAWAL_PCT_KPI` mode, labelled as on screen
  - Avg deposit processing, Avg withdrawal processing
  - Commission IDR / USD (`Pending: Deals History` text when pending)
- **Commission (new sheet):**
  - A daily block with columns Date (MT5 server) and Commission USD / 10000 / 12000 / 14000. Cells are numbers, or `PENDING_DEALS_HISTORY` / `ATTESTED_EMPTY` text.
  - Then a total row (Pending text when the period is not complete).
  - Then "Commission IDR (Σ × rate)" and "Commission USD" rows.
- The export route calls `attachDealsHistory` so it has the same data as the screen.

## 11. Accessibility

- Tabs: a `<nav aria-label>` with `aria-current="page"`.
- Segmented control: `role="group"`, buttons with `aria-pressed`.
- Section nav: `<nav aria-label="Report sections">`.
- Charts: `role="img"`, `aria-label` with a short summary (e.g. "Daily deposits and withdrawals, IDR, 1–31 Oct"). Each bar or point has a `<title>`.
- Tables: `<caption className="sr-only">`, `scope="col"` on headers, `scope="row"` on the first cell. Numeric cells never rely on color alone: they carry the U+2212 sign, and chips always have text.
- Deltas: an arrow plus sign plus visible text, and an `sr-only` sentence.
- Focus: all controls are native buttons or links with the existing `focus-visible` ring. Text contrast follows the existing `--mos-text-*` tokens.

## 12. Components and files

New, under `src/components/settlement/report/`:
- `ReportTable.tsx` (table class constants, `Th`, `Td`, `NumTd`, `GroupHeader`)
- `PendingChip.tsx`
- `CoverageChips.tsx`
- `KpiStrip.tsx`
- `Sparkline.tsx`
- `FlowChart.tsx`
- `ProcessingChart.tsx`
- `SectionNav.tsx`
- `SettlementPeriodBar.tsx`
- `ReconciliationSection.tsx`
- `ProcessingSection.tsx`
- `WithdrawalTimingSection.tsx`
- `MarginSection.tsx`
- `CommissionSwapSection.tsx`
- `JisdorSection.tsx`
- `MethodologySection.tsx`
- `SettlementReportView.tsx`: a pure composition of all sections from props. Used by the Report tab and the print route, and by the render test.

Lib:
- `src/lib/settlement/format.ts`: formatters, `computeDelta`
- `src/lib/settlement/summary.ts`: `previousSettlementRange`, `periodTotals`, `dailyFlows`, `dealsHistorySummary`
- `src/lib/settlement/report-data.ts`: `attachDealsHistory`
- `src/lib/settlement/upload-route.ts`: `routeSettlementFile`

Modified:
- `report.ts` (types, builder, loader)
- `export.ts` (Overview KPIs, Commission sheet)
- the routes `report`, `export`, `uploads`
- `SettlementNav.tsx` (Report | Data sources)
- `SettlementDashboard.tsx` (becomes a container: fetch + `SettlementReportView`)
- `SettlementWorkspace.tsx` (Report tab only)
- `page.tsx`
- new pages `data/page.tsx` and `print/page.tsx`
- `globals.css` (print + `.print-report` vars)

Removed after the move: `SettlementHome.tsx`, `DealsHistoryPanel.tsx` and `JisdorPanel.tsx` are folded into the new components. The `SettlementTables.tsx` table components are replaced by the sections.

## 13. Testing

Tests use `node:test` via `npx tsx --test tests/<file>.test.ts`. Existing settlement tests must keep passing.

- `tests/settlement-format.test.ts`: `formatIdr` (0 decimals, rounding, U+2212), `formatUsd`, `formatCompact` (B/M/K boundaries, negatives), `formatDurationShort`, and `computeDelta` for relative, points and seconds, favourability tone, null and zero previous → null, flat threshold.
- `tests/settlement-conventions.test.ts` (extend): `settlementDayOf` boundaries — `D 12:00:00` → D, `D 12:00:01` → D+1, `D−1 12:00:01` → D; `resolveSettlementPeriod('day', D)` has `basis: 'noon'` and the window; week/month have `basis: 'calendar'`.
- `tests/settlement-kpi-config.test.ts`: each `WITHDRAWAL_PCT_KPI` mode yields the right card count, label, value and favourability; office-hour % uses total − 2nd.
- `tests/settlement-summary.test.ts`: `previousSettlementRange` for every preset, including Jan → Dec of the previous year and a Mon–Sun week across a month. Also `periodTotals` (completion date vs request date, unsuccessful excluded, rate 1 → USD), `dailyFlows` (one row per date, zeros where no rows), Daily-basis membership (a withdrawal at D 11:59 counts for D, at D 12:30 for D+1), and `dealsHistorySummary` (complete / pending / attested, IDR × rate, sums equal `OFFICIAL_COMMISSION_BUCKETS`).
- `tests/settlement-report.test.ts` (extend): `buildSettlementReport` returns `previousRange`, `summary.current/previous` and `daily`.
- `tests/settlement-export.test.ts` (extend): the sheet list includes `Commission`; commission cells are exact numbers or Pending text, never 0 for missing days; the Overview has KPI rows.
- `tests/settlement-upload-route.test.ts`: UTF-16 BOM + `Deal` header → `deals_history`; xlsx/csv bytes → `standard`.
- `tests/settlement-report-view.test.ts` (render test): `renderToStaticMarkup(createElement(SettlementReportView, fixtureProps))`. It asserts:
  - all six KPI labels
  - the "Withdrawal timing split" heading
  - IDR shown with 0 decimals (e.g. `48,210,770,000`, with no `.00`)
  - a `Pending` chip in Commission when a day is missing, and no `0.00` in that commission cell
  - section ids present
  - no "Access" text
- `tests/settlement-page.test.ts` (update): the Report page composes `SettlementReportView`; the Data sources page contains `Upload history` and `/api/settlement-report/uploads`; the nav has `Report` and `Data sources` and no `Access`.
- Manual check before merge: `npm run build`, then on the VPS after deploy, open Report, Data sources and Print for Oct 2026 and confirm the Oct 1–5 commission matches the audited buckets.

## 14. Sequencing

The Access-removal PRs (#136/#137) are merged; `main` is at da35c73. Implementation starts from a fresh branch `feat/settlement-report-redesign` off current `origin/main` and rebases on `main` before opening its PR. The final nav is **Report | Data sources** only.

## 15. Decisions

**Final (Bayu, 2026-11-10):**
1. **Withdrawal % KPI** = the Excel office-hour definition: office ÷ total, where office = total − 2nd withdrawal and 2nd = completed on a later WIB calendar day than requested. Same split as the weekly Withdrawal % table and `Withdrawal Percentage - 2026.xlsx`. `WITHDRAWAL_PCT_KPI = 'office-hour'`. The other modes stay in `kpi-config.ts` so a future switch is still one constant; they are not the product choice.
2. **Daily label** shows both dates of the 12:00 → 12:00 window. Window 05 Nov 12:00 → 06 Nov 12:00 (report day D = 2026-11-06) is labelled "05–06 Nov". Reconciliation uses that same label. The window math is unchanged, so phase 1 acceptance figures stay CRM 1,390 / 445 / 88 and MT5 1,306 / 445 / 2.
3. **Weekly** = Mon–Sun. **Monthly** = calendar month (existing monthly logic).
4. **Commission** is shown on the report and written to the xlsx workbook. A missing source is a Pending chip, never 0.
5. **Access** stays department-only (Account menu, #136/#137). The report nav is Report | Data sources only.
6. **Export PDF** is a print-friendly A4 route that calls the browser print dialog. No new runtime dependency.

**Confirmed earlier by Bayu:**
- Daily = 12:00 WIB → 12:00 WIB. Supersedes the earlier agent decision to keep the WIB calendar day for Daily.

**Made by the agent (unchanged):**
3. **Compare-with** is the previous period only. "Same period last year" was dropped.
4. **Commission KPI** headline is IDR (Σ × rate) with USD in the note, consistent with the other KPIs. The mockup showed USD.
5. **Net margin in–out** is never Pending, because it does not depend on the FTD list.
6. **Favourability colors:** withdrawals up and processing time up are red; Withdrawal % follows its mode (§6.1); commission deltas are neutral.
7. **xlsx sheet name** "Withdrawal %" is kept for continuity; the screen title is "Withdrawal timing split".
