import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { canUploadMonthlyReport, monthlyReportApiAccess } from '../src/lib/monthly-report/access';
import { coverageOverview } from '../src/lib/monthly-report/coverage';
import { AMOUNT_NOT_ENTERED, FTD_DAILY_COLUMNS, buildReportWorkbook, ftdDailyRows, NO_DATA } from '../src/lib/monthly-report/export';
import {
  combinedSpan, manualCoverage, mergeDailyFtd, validateManualFtd, withManualFtdCoverage, type ManualFtdEntry,
} from '../src/lib/monthly-report/ftd-daily';
import { buildOnboardingReport, cohortAvailable, type DailyFtd, type PeriodData } from '../src/lib/monthly-report/metrics';
import { resolvePeriod } from '../src/lib/monthly-report/periods';
import { UPSERT_MANUAL_FTD_SQL } from '../src/lib/monthly-report/store';

// Synthetic values only (no client data).
const TODAY = '2026-11-04';
const empty: PeriodData = { daily: [], ftd: [], ftdCoverage: null, uniqueActivated: 0, ftdCohort: { activatedWithFtd: 0, ftdFromPeriodActivations: 0 } };
const derived = (date: string, count: number, amount: number, micro = count, standard = 0): DailyFtd => ({ date, count, amount, micro, standard, other: count - micro - standard });
const manual = (date: string, count: number, amount: number | null): ManualFtdEntry => ({ date, count, amount, updatedByName: 'Test User', updatedAt: '2026-11-04T03:00:00.000Z' });

test('ftd-daily: validation of date, count and amount', () => {
  assert.deepEqual(validateManualFtd({ date: '2026-11-03', count: 12, amount: '1,234.50' }, TODAY), { ok: true, value: { date: '2026-11-03', count: 12, amount: 1234.5 } });
  assert.deepEqual(validateManualFtd({ date: '2026-11-03', count: '0' }, TODAY), { ok: true, value: { date: '2026-11-03', count: 0, amount: null } });
  assert.deepEqual(validateManualFtd({ date: '2026-11-04', count: 3, amount: '' }, TODAY), { ok: true, value: { date: '2026-11-04', count: 3, amount: null } });
  const bad: Array<[unknown, RegExp]> = [
    [{ date: '2026-11-05', count: 1 }, /future/],
    [{ date: '2026-02-30', count: 1 }, /valid date/],
    [{ date: '03/11/2026', count: 1 }, /valid date/],
    [{ date: '2026-11-03' }, /required/],
    [{ date: '2026-11-03', count: '' }, /required/],
    [{ date: '2026-11-03', count: -1 }, /whole number/],
    [{ date: '2026-11-03', count: 2.5 }, /whole number/],
    [{ date: '2026-11-03', count: 'abc' }, /whole number/],
    [{ date: '2026-11-03', count: 1, amount: -5 }, /amount/],
    [{ date: '2026-11-03', count: 1, amount: '1.234' }, /2 decimals/],
    [null, /valid date/],
  ];
  for (const [body, error] of bad) {
    const result = validateManualFtd(body, TODAY);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.match(!result.ok ? result.error : '', error);
  }
});

test('ftd-daily: upsert per day — saving a date again replaces count and amount (edit)', () => {
  assert.match(UPSERT_MANUAL_FTD_SQL, /ON CONFLICT \(ftd_date\) DO UPDATE SET/);
  for (const column of ['ftd_count', 'ftd_amount', 'updated_by', 'updated_by_name']) assert.match(UPSERT_MANUAL_FTD_SQL, new RegExp(`${column} = EXCLUDED\\.${column}`));
  assert.match(UPSERT_MANUAL_FTD_SQL, /updated_at = CURRENT_TIMESTAMP/);
  // Store semantics modelled as a map by date: the last save of a date wins.
  const table = new Map<string, ManualFtdEntry>();
  for (const entry of [manual('2026-11-01', 10, 500), manual('2026-11-02', 4, null), manual('2026-11-01', 12, null)]) table.set(entry.date, entry);
  const merged = mergeDailyFtd([], [...table.values()]);
  assert.deepEqual(merged.map(day => [day.date, day.count, day.amount, day.amountEntered]), [['2026-11-01', 12, 0, false], ['2026-11-02', 4, 0, false]]);
});

test('ftd-daily: precedence — manual overrides the account-derived value of its day, other days stay derived', () => {
  const merged = mergeDailyFtd(
    [derived('2026-10-01', 90, 9000.5, 60, 30), derived('2026-10-02', 80, 8000)],
    [manual('2026-10-02', 100, 12000), manual('2026-10-03', 5, null), manual('2026-10-04', 0, 0)],
  );
  assert.deepEqual(merged.map(day => [day.date, day.count, day.amount, day.source, day.amountEntered]), [
    ['2026-10-01', 90, 9000.5, 'accounts', true],
    ['2026-10-02', 100, 12000, 'manual', true],
    ['2026-10-03', 5, 0, 'manual', false],
    ['2026-10-04', 0, 0, 'manual', true],
  ]);
  // Manual days carry no account types.
  assert.deepEqual([merged[1].micro, merged[1].standard], [0, 0]);
});

test('ftd-daily: coverage = account uploads OR manual days; span covers both', () => {
  assert.deepEqual(manualCoverage(['2026-11-03', '2026-11-01', '2026-11-02', 'bad']), [{ from: '2026-11-01', to: '2026-11-03' }]);
  const coverage = withManualFtdCoverage(
    { onboarding: [{ from: '2026-10-01', to: '2026-11-03' }], ftd: [{ from: '2026-10-01', to: '2026-10-31' }] },
    ['2026-11-01', '2026-11-02'],
  );
  assert.deepEqual(coverage.ftd, [{ from: '2026-10-01', to: '2026-11-02' }]);
  assert.deepEqual(coverage.ftdAccounts, [{ from: '2026-10-01', to: '2026-10-31' }]);
  const overview = coverageOverview(coverage, TODAY, { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(overview.ftd.through, '2026-11-02');
  assert.deepEqual(overview.ftd.missing, [{ from: '2026-11-03', to: '2026-11-04' }]);
  // Manual-only (no FTD file at all).
  assert.deepEqual(withManualFtdCoverage({ onboarding: [], ftd: [] }, ['2026-11-01']).ftd, [{ from: '2026-11-01', to: '2026-11-01' }]);
  assert.deepEqual(combinedSpan({ from: '2026-10-01', to: '2026-10-31' }, ['2026-11-02']), { from: '2026-10-01', to: '2026-11-02' });
  assert.deepEqual(combinedSpan(null, ['2026-11-02', '2026-11-01']), { from: '2026-11-01', to: '2026-11-02' });
  assert.equal(combinedSpan(null, []), null);
});

const novemberReport = (options: { accountUploads: boolean }) => {
  const period = resolvePeriod({ preset: 'custom', from: '2026-11-01', to: '2026-11-03' });
  const derivedDays = options.accountUploads ? [derived('2026-11-01', 7, 700), derived('2026-11-02', 3, 300)] : [];
  const manualDays = [manual('2026-11-02', 5, null), manual('2026-11-03', 4, 400)];
  const accountRanges = options.accountUploads ? [{ from: '2026-11-01', to: '2026-11-03' }] : [];
  const current: PeriodData = {
    ...empty,
    daily: ['2026-11-01', '2026-11-02', '2026-11-03'].map(date => ({ date, kycRejected: 1, manualKycApproved: 1, autoKycApproved: 2, firstAccount: 4, additionalAccount: 1, activated: 5, approvedBankInfoPending: 0, pendingVideoFailed: 0, events: 10 })),
    ftd: mergeDailyFtd(derivedDays, manualDays),
    ftdCoverage: { from: '2026-11-01', to: '2026-11-03' },
    uniqueActivated: 15,
    ftdCohort: { activatedWithFtd: 6, ftdFromPeriodActivations: 6 },
  };
  return buildOnboardingReport({
    period, granularity: 'day', current, previous: empty, today: TODAY,
    coverage: withManualFtdCoverage({ onboarding: [{ from: '2026-10-01', to: '2026-11-03' }], ftd: accountRanges }, manualDays.map(day => day.date)),
  });
};

test('ftd-daily: report totals use merged counts; FTD ÷ Total Real Account uses counts', () => {
  const report = novemberReport({ accountUploads: true });
  assert.deepEqual(report.daily.map(bucket => bucket.values.ftd), [7, 5, 4]);
  assert.equal(report.ftd.count, 16);
  assert.equal(report.ftd.amountTotal, 1100); // 700 + (manual, not entered) + 400
  assert.equal(report.ftd.amountAverage, 100); // over the 11 FTDs with a known amount
  assert.equal(report.ftd.manualDays, 2);
  assert.equal(report.ftd.accountDays, 1);
  assert.equal(report.ftd.daysWithoutAmount, 1);
  assert.equal(report.ftd.byTypeComplete, false);
  assert.ok(report.total.realAccountApproved! > 0);
  assert.equal(report.ftd.ftdPerApprovedPct, Math.round((16 / report.total.realAccountApproved!) * 1000) / 10);
  assert.deepEqual(report.ftdDays, [
    { date: '2026-11-01', count: 7, amount: 700, source: 'accounts' },
    { date: '2026-11-02', count: 5, amount: null, source: 'manual' },
    { date: '2026-11-03', count: 4, amount: 400, source: 'manual' },
  ]);
  // Account-level file covers the whole period → cohort shown.
  assert.equal(report.ftd.cohortAvailable, true);
  assert.equal(report.ftd.activatedWithFtd, 6);
  assert.equal(report.funnel.find(step => step.key === 'ftd')?.value, 6);
});

test('ftd-daily: cohort (Activated → FTD same accounts) is "No data" without full account-level coverage', () => {
  const report = novemberReport({ accountUploads: false });
  assert.equal(report.ftd.count, 9);
  assert.equal(report.hasFtd, true);
  assert.equal(report.ftd.cohortAvailable, false);
  assert.equal(report.ftd.realToFtdPct, null);
  assert.equal(report.ftd.activatedWithFtd, null);
  assert.equal(report.ftd.fromPeriodActivations, null);
  assert.equal(report.ftd.fromEarlierAccounts, null);
  assert.equal(report.funnel.find(step => step.key === 'ftd')?.value, null);
  assert.notEqual(report.ftd.ftdPerApprovedPct, null);
  assert.deepEqual(report.daily.map(bucket => bucket.values.ftd), [null, 5, 4]); // 1 Nov: nothing entered → No data
  assert.deepEqual(report.coverage?.ftd.missing, [{ from: '2026-11-01', to: '2026-11-01' }]); // within the period: 1 Nov
  // Range helper: partial account coverage is not enough.
  assert.equal(cohortAvailable({ from: '2026-10-01', to: '2026-10-31' }, { coverage: { onboarding: [], ftd: [{ from: '2026-10-01', to: '2026-10-31' }], ftdAccounts: [{ from: '2026-10-01', to: '2026-10-20' }] }, today: TODAY }), false);
  assert.equal(cohortAvailable({ from: '2026-10-01', to: '2026-10-31' }, { coverage: { onboarding: [], ftd: [{ from: '2026-10-01', to: '2026-10-31' }] }, today: TODAY }), true);
  assert.equal(cohortAvailable({ from: '2026-10-01', to: '2026-10-31' }, { coverage: null, today: TODAY }), true);
});

test('ftd-daily: Excel export has an "FTD daily" sheet with values, sources and No data', () => {
  const report = novemberReport({ accountUploads: false });
  assert.deepEqual(ftdDailyRows(report), [
    ['2026-11-01', NO_DATA, NO_DATA, ''],
    ['2026-11-02', 5, AMOUNT_NOT_ENTERED, 'Manual entry'],
    ['2026-11-03', 4, 400, 'Manual entry'],
  ]);
  const workbook = XLSX.read(buildReportWorkbook(report), { type: 'buffer' });
  assert.ok(workbook.SheetNames.includes('FTD daily'));
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets['FTD daily'], { header: 1 });
  assert.deepEqual(rows[0], [...FTD_DAILY_COLUMNS]);
  assert.deepEqual(rows[2], ['2026-11-02', 5, AMOUNT_NOT_ENTERED, 'Manual entry']);
  // The Daily sheet carries the merged count too.
  const daily = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets.Daily, { header: 1 });
  const ftdColumn = (daily[0] as string[]).indexOf('FTD');
  assert.deepEqual(daily.slice(1).map(row => row[ftdColumn]), [NO_DATA, 5, 4]);
  // Cohort step reads No data in the KPIs sheet.
  const kpis = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets.KPIs, { header: 1 });
  assert.ok(kpis.some(row => row[0] === 'FTD (same accounts)' && row[1] === NO_DATA));
});

test('ftd-daily: permissions — same as upload (admin or "Can upload"); legacy FTD file import is admin only', async () => {
  const admin = { role: 'admin', features: [] };
  const uploader = { role: 'user', features: ['monthly-report'], monthlyReportUpload: true };
  const viewer = { role: 'user', features: ['monthly-report'], monthlyReportUpload: false };
  const outsider = { role: 'user', features: [] };
  assert.equal(canUploadMonthlyReport(admin), true);
  assert.equal(canUploadMonthlyReport(uploader), true);
  assert.equal(monthlyReportApiAccess(admin, { upload: true }), null);
  assert.equal(monthlyReportApiAccess(uploader, { upload: true }), null);
  assert.equal(monthlyReportApiAccess(viewer, { upload: true })?.status, 403);
  assert.equal(monthlyReportApiAccess(outsider, { upload: true })?.status, 403);
  assert.equal(monthlyReportApiAccess(uploader, { adminOnly: true })?.status, 403);
  const route = await readFile('src/app/api/monthly-report/ftd-daily/route.ts', 'utf8');
  for (const method of ['GET', 'POST', 'DELETE']) assert.match(route, new RegExp(`export async function ${method}\\(`));
  assert.equal(route.match(/requireMonthlyReport\(request, \{ upload: true \}\)/g)?.length, 3);
  assert.match(route, /validateManualFtd\(body, todayWib\(\)\)/);
  const ftdUpload = await readFile('src/app/api/monthly-report/uploads/ftd/route.ts', 'utf8');
  assert.match(ftdUpload, /requireMonthlyReport\(request, \{ adminOnly: true \}\)/);
});

test('ftd-daily: migration 044 is additive and documents its rollback', async () => {
  const sql = await readFile('db/migrations/044_onboarding_ftd_daily.sql', 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS onboarding_ftd_daily/);
  assert.match(sql, /ftd_date\s+DATE PRIMARY KEY/);
  assert.match(sql, /ROLLBACK/i);
  const statements = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /\bDROP\b|\bTRUNCATE\b|DELETE FROM|ALTER TABLE onboarding_ftd\b/i);
});
