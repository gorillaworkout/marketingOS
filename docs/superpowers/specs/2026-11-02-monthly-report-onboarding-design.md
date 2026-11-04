# Monthly Report: Onboarding (design)

Date: 2026-11-02 · Branch: `feat/monthly-report-onboarding` · Migration: `041_monthly_report.sql`

## Goal
Replace the hand-made monthly Onboarding PPT with a live MarketingOS page. A new sidebar menu
**Monthly Report** has an **Onboarding** tab (real data) and a **Settlement** tab placeholder
("Coming soon — upload not available yet"). Data arrives by Excel upload today and by an API sync
later. Both write the same tables.

## Access
- New account feature `monthly-report` (label "Monthly Report"). It reuses the existing department
  mechanism, so an admin can grant it to whole departments on **Accounts**.
- Per-user grants: table `monthly_report_access (user_id, can_upload)`. Admins manage them on the
  **Access** tab of Monthly Report. A grant adds `monthly-report` to that user's enabled features
  (sidebar, route guard, API checks), whatever the department.
- View = admin, OR department has `monthly-report`, OR the user has a grant row.
- Upload = admin, OR a grant row with `can_upload = true`. A department grant alone never allows upload.
- Everyone with view access sees the same full report. Row-level drill-down masks UID and
  trading account numbers (`18***65`).


## Data model (migration 041, idempotent, forward-only, no deletes)
Every data table has `source` (`upload` | `api`) so a future API sync writes the same rows.
- `departments_permitted_features_valid` CHECK gains `monthly-report`.
- `monthly_report_access`: `user_id` PK → users (cascade), `can_upload`, `granted_by`, timestamps.
- `monthly_report_uploads`: history. `kind` (`onboarding` | `ftd` | `rejection_reasons`), `file_name`,
  `source_utc_offset`, `uploaded_by` (+ name snapshot), `rows_total/inserted/updated/skipped`, `rows_duplicate` (043),
  `data_from/data_to`, `created_at`.
- `onboarding_events`: one row per onboarding step event. PK `(document_id, event_at, step)` since
  migration 043 (was `document_id`; see "Event identity" below). `event_at timestamptz`,
  `uid`, `is_first_account`, `trading_account_no`, `approval_method`, `step`, `step_status`,
  `account_status`, `remarks`, `source`, `upload_id`, timestamps.
- `onboarding_ftd`: PK `account_no`. `account_type` (micro/standard), `join_date`, `ftd_at timestamptz`,
  `amount numeric(16,2)`, `source`, `upload_id`, timestamps.
- `onboarding_rejection_reasons`: `document_id` or `uid` (at least one), `reason_date`, `reason`,
  `source`, `upload_id`. Unique on (document_id, uid, date, reason). **No parser yet** — the UI
  shows "Rejection reasons — Coming soon".

## Upload 1: onboarding export
- Sheet `Query result` (else the first sheet), headers `Date Time, UID, Document ID, is First Account,
  Trading Account No., Approval Method, Steps, Step Status, Account Status, Remarks` (order free, case
  and spacing ignored). A missing header rejects the file.
- Source timezone: explicit choice on the form, else the default **`+07:00` (WIB)** — same default in
  the upload routes and the CLI. The `…+08_00.xlsx` suffix in CRM file names is the *export* time
  zone, not the data's: it is shown in the preview but never applied (applying it would shift every
  event by one hour and defeat the duplicate check). Times are stored as `timestamptz`; days are
  bucketed in WIB (UTC+7).
- **Preview** (parse, validate, WIB date range, invalid rows, in-file duplicates, comparison with
  stored events grouped by Step Status: new / duplicate (skipped), duplicates whose other columns
  differ with any stored→incoming Step Status change, new events of already-known Document IDs,
  masked sample) then **Commit** (same file re-sent).
- Insert-only: `INSERT … ON CONFLICT (document_id, event_at, step) DO NOTHING`. Already-stored events
  and repeats inside the file (first copy wins) are skipped and reported as *skipped as duplicate*;
  invalid rows as *invalid*. Re-uploading a file inserts 0 rows. Nothing is ever overwritten.

### Event identity (migration 043)
A Document ID can appear in several monthly exports with *different* events (e.g. Pending at the end
of September, the decision in October). With PK `document_id` the file loaded last overwrote the
earlier event, so month totals depended on load order. Collision analysis of the Jun/Jul/Sep/Oct 2026
exports: inside every file Document ID alone, `+ event time`, `+ Steps` and `+ Step Status` all have 0
collisions; across files Document ID alone collides 8–95 times per month pair (226 Document IDs in
total), `document_id + event_at` collides 0 times between different months, and the two identical Sep
copies collide on every row. `document_id + event_at` is the minimal collision-free key; Steps is added
as a safety margin. Step Status is deliberately **not** in the key, so a re-export of the same event
with a changed status is skipped, not counted as a second registration.
Migration 043 swaps the primary key in one transaction (no row deleted or changed; the old key is a
subset, so existing rows are already unique), adds `monthly_report_uploads.rows_duplicate`, is
idempotent, and documents its rollback SQL in the header.
Verified with all four months loaded in three orders (plus Sep twice, and Oct first under the old key
then 043): identical results — Jun 26,506 / TRA 9,956; Jul 28,411 / 10,001; Sep 23,492 / 7,880;
Oct 24,737 / 8,098 / Pending 9,296 / Rejected 7,343; no activated account in two months.

## Upload 2: FTD report
- Accepts the monthly FTD CSV as exported (messy layout): only the **MONTHLY** block (columns B–H) is
  read; the DAILY block and the summary block are ignored; Year/Month come from B1:C2 and rows outside
  that month raise a warning. Also accepts a clean table (`Account, Type, Join Date, FTD Time, Amount`).
- Upsert by Account (one FTD per account ever, so the per-event issue above does not apply). FTD time
  uses the same offset rule as onboarding (default +07:00).
- The registrations template upload was removed (steering 2): registrations come from the export.

## Metric definitions
Day = calendar day in Asia/Jakarta (WIB) of `event_at` / `ftd_at`.

| Metric | Definition | Oct 2026 (at +07:00) |
|---|---|---|
| **Registrations** | every onboarding row in the period, all 6 steps, repeats counted (tooltip in the UI) | 24,737 |
| KYC Rejected | `manual_kyc` + `Rejected` | 7,343 |
| Manual / Auto KYC approved | `manual_kyc` / `auto_kyc` + `Approved` | 936 / 6,135 |
| **Total Real Account** | Real Account Activated + Manual KYC approved (demo not done) — see below | 8,098 |
| — Real Account Activated | distinct trading accounts with an activated add-account row | 7,162 |
| — Manual Approved Demo Not Done | `manual_kyc` + `Approved` | 936 |
| — first account / additional | activated with `is_first_account` true / false | 5,930 / 1,232 |
| **FTD** | FTD rows by `ftd_at` (micro / standard split) | 2,734 (2,303 / 431) |
| **Pending** | Registrations − Total Real Account − KYC Rejected | 9,296 |

"Activated" = `auto_add_account`/`manual_add_account`, Step Status `Approved`, Account Status
`Real Account Activated`. Step `Approved` + Account Status `Add USD Bank Info / NPWP Failed` rows are not
rejections: they show as "Approved, bank info / NPWP pending" with the CRM remark in the drill-down.

FTD panel: count is the headline (2,734, daily avg 88.2, peak 219 on Oct 30). Ratios are labelled:
- **FTD ÷ Total Real Account** — the deck method. The PPT's 33.8% = 2,734 ÷ 8,096; ours 2,734 ÷ 8,098 = 33.8%.
- **Activated → FTD (same accounts)** — accounts activated in the period that made an FTD (2,467 / 7,162 = 34.4%).
  Joined on Trading Account No.: 2,467 FTDs from period activations, 267 from earlier accounts.
- **FTD ÷ Registrations** — PPT 10.8% = 2,734 ÷ 25,283; ours 11.1%.
- Amount ("Amount", currency not stated in the source) is a secondary line only, never a KPI card.

### Total Real Account (owner definition, Nov 2026)
Total Real Account = TOTAL REAL ACCOUNT (unique activated, 7,162) + "KYC Manual Approved Demo Not Done"
(`manual_kyc` + `Approved`, 936) = 8,098 for October. Checked per WIB day against the owner's reference
sheet: activated, manual KYC approved and KYC rejected match on all 31 days. The reference sheet's
"Total Cases Registration" (24,712) leaves out its "KYC Auto Rejected" column (25 rows: `auto_kyc` +
`Pending` + `Registration Failed`; 1 on Oct 30, 24 on Oct 31); its category columns add up to our 24,737.
We keep the owner's registrations definition (every row).

### Known gap vs the PPT (documented, not forced)
Our registrations come from the export: 24,737 vs the deck's 25,283 (−2.2%). Per day: Oct 1 815 vs
822, Oct 5 856 vs 860, Oct 30 994 vs 994. Tests assert our numbers. The FTD daily array matches the
deck exactly at +07:00.

### Timezone finding
At +07:00 the FTD daily array and the per-day registrations above match the deck; at the default
+08:00 six FTD days shift (total unchanged) and registrations become 24,724. Resolved (2026-11-04):
the exports are in WIB and the default is now +07:00.

Funnel: Registration → KYC approved → Real account activated (unique) → FTD (same accounts), step % and overall %.
The funnel and the FTD cohort use unique activated accounts, not Total Real Account, so manual KYC
approvals are not counted twice against "KYC approved".
Comparison: every KPI shows the change vs the previous period of the same length.

## Periods and navigation
Presets **Day, Week, Month, 3 Months, Year, Custom**. Prev/next moves one period (custom: by its own
length). The page opens on the previous calendar month.
- Week = the report week (below) containing the anchor. 3 Months = anchor month + two before.
- Granularity: Day/Week → daily; Month/3 Months/Custom → weekly (switchable); Year → monthly.

### Report weeks
Built **inside each calendar month**; weeks end on Sunday.
1. The first partial week merges forward (Oct 2026: 1–4 + 5–11 → **1–11**).
2. Tail rule: a last partial week of **4+ days stays** (Oct 2026: **26–31**); shorter tails merge
   back into the previous week (Nov 2026 ends Monday 30 → 23–30).
3. A week never crosses a month boundary. Cross-month ranges (3 Months, Year weekly, Custom) get
   each month's own weeks, clipped to the range (custom from Oct 15 → first bucket 15–18).

Oct 2026 → I 1–11, II 12–18, III 19–25, IV 26–31.

## Upload auto-detect (Nov 2026)
- The Uploads page has one primary **Upload file** drop zone (`POST uploads/auto`, same raw body,
  `mode`, `fileName`, `offset`). The server sniffs only the first 40 rows (`readSheetRows` with
  `sheetRows`) and routes the file:
  - all onboarding columns in the first row (preferred sheet "Query result") → onboarding parser;
  - otherwise the FTD header (`Account · Type · Join Date · FTD Time · Amount`) anywhere in the first
    rows → FTD parser, labelled "FTD report (monthly report)" (title rows / side-by-side blocks) or
    "FTD report (clean table)".
  - anything else → 400 with a plain error listing the expected columns of both types, plus a hint
    when a file looks like a near miss (names the missing columns).
- The preview shows "Detected: <type>" before Save. Commit sends `expect=<previewed kind>`; if the
  file now detects as another type the server answers 409 and saves nothing.
- Preview/commit, duplicate counts, conflicts and the WIB (+07:00) default are the same as before:
  both routes share `upload-handlers.ts`. The two type-specific cards remain as a manual override
  under a collapsed "Choose type manually".

## Data coverage ("data through" and gaps)
- Coverage per kind = the merged `data_from`–`data_to` (WIB dates) of all `monthly_report_uploads`
  rows of that kind. Web uploads and the import CLI write the same rows (the CLI passes
  `range: parsed.summary.wibRange` to the same store functions), so both count. Uploads with no valid
  rows (null range) do not count. If a kind has stored data but no ranged upload rows (older
  imports), the stored data span is used instead, so old data is never flagged as missing.
- Onboarding and FTD are tracked separately. The dashboard and the Uploads page show
  "Onboarding data through <date> · FTD data through <date> (WIB)".
- Within the selected range (dashboard) or data month / overall span (Uploads page) a
  "Missing data in …" notice lists uncovered dates/ranges per kind. Days after today (WIB) are never
  flagged.
- Buckets carry `coverage: {onboarding, ftd}` = `full | partial | none | future`. Daily/weekly charts,
  the summary table, KPIs and the .xlsx export show **No data** (null) for a bucket with no covered
  day instead of 0; partially covered buckets keep their numbers with a "partial" tag. Without
  coverage input (`buildOnboardingReport` called without `coverage`) the old behaviour is unchanged.
- Pure logic in `coverage.ts` (merge, missing ranges, states, overview).

## Upload history
`GET uploads?page=&pageSize=&kind=&month=` — 25 per page (max 100), newest first
(`created_at DESC, id DESC`), no hard cap. Filters: type (`onboarding | ftd | rejection_reasons`)
and data month (`YYYY-MM`, overlaps the upload's `data_from`–`data_to`; uploads without a range use
their WIB upload date). Each row shows inserted / updated / duplicate / invalid counts and the WIB
data range. Pure query parsing in `upload-history.ts`. Response also returns the months that have
data (filter options) and the coverage overview.

No migration: `data_from`, `data_to`, `rows_duplicate` and the other counters already exist (041/043).

## Architecture
- Pure functions in `src/lib/monthly-report/`: `periods.ts`, `xlsx-read.ts`, `onboarding-parse.ts`,
  `ftd-parse.ts`, `metrics.ts`, `conflicts.ts`, `export.ts`, `access.ts`, `upload-offset.ts`,
  `detect.ts`, `coverage.ts`, `upload-history.ts`; shared upload route bodies in `upload-handlers.ts`.
  DB in `store.ts`; route glue in `service.ts`.
- API (`/api/monthly-report/*`); the UI reads only aggregation routes:
  - `GET report` · `GET details?kind=` (masked drill-down) · `GET export` (.xlsx: Summary, Daily, KPIs)
  - `POST uploads/auto` (detects the type), `POST uploads/onboarding`, `POST uploads/ftd` (raw body, `mode=preview|commit`, `fileName`, `offset`)
  - `GET uploads` (paged history with filters, coverage, upload rights) · `GET/PUT access` (admin only)
- UI: `/dashboard/monthly-report` (Onboarding), `/settlement` (Coming soon), `/uploads`, `/access`.
  Sidebar section "Reports". Dupoin teal `#2EB5C4` / `#1A8A96` inside these pages.

## Import CLI (admin)
`npx tsx scripts/monthly-report-import.ts --onboarding=<xlsx> --ftd=<csv> [--offset=+07:00]`
Same parsers and inserts as the upload routes (default offset +07:00), writes upload history,
idempotent (a rerun reports 0 inserted, every row skipped as duplicate). Production load only after the deploy is approved.

## Tests
- `tests/monthly-report-*.test.ts` with synthetic fixtures (`tests/fixtures/`), no real personal data.
- `tests/monthly-report-real-files.test.ts` runs only when `MONTHLY_REPORT_DATA_DIR` holds the real
  files (never committed) and asserts the October numbers above.
- `scripts/verify-monthly-report-migration.ts` (needs `TEST_DATABASE_URL`) applies 041 twice and checks
  SQL aggregations against the pure functions.

## Out of scope / later
Settlement data, rejection-reason parser, API sync, per-user data scoping.
