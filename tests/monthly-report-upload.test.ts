import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { syntheticFtdReportCsv, syntheticOnboardingWorkbook } from './fixtures/monthly-report-onboarding';
import { classifyConflicts } from '../src/lib/monthly-report/conflicts';
import { buildReportWorkbook, EXPORT_COLUMNS, exportFileName } from '../src/lib/monthly-report/export';
import { parseFtdFile } from '../src/lib/monthly-report/ftd-parse';
import { aggregateEventsByDay, aggregateFtdByDay, buildOnboardingReport, dateCoverage, distinctActivatedAccounts, ftdCohortStats } from '../src/lib/monthly-report/metrics';
import { parseOnboardingWorkbook } from '../src/lib/monthly-report/onboarding-parse';
import { resolvePeriod } from '../src/lib/monthly-report/periods';

const rows = parseOnboardingWorkbook(syntheticOnboardingWorkbook(), { offset: '+07:00' }).rows;
const ftd = parseFtdFile(Buffer.from(syntheticFtdReportCsv()), { fileName: 'ftd.csv', offset: '+07:00' }).rows;

test('upload preview classifies new, changed and unchanged rows by Step Status', () => {
  const stored = rows.slice(0, 4).map(row => ({ ...row }));
  stored[2] = { ...stored[2], stepStatus: 'Pending', accountStatus: 'KYC Pending' };
  stored[3] = { ...stored[3], eventAt: new Date(stored[3].eventAt).toISOString().replace('.000Z', 'Z') };
  const summary = classifyConflicts(rows, stored);
  assert.deepEqual([summary.new, summary.changed, summary.unchanged], [7, 1, 3]);
  assert.deepEqual(summary.statusChanges, [{ from: 'Pending', to: 'Rejected', count: 1 }]);
  assert.deepEqual(summary.byStepStatus.find(g => g.stepStatus === 'Rejected'), { stepStatus: 'Rejected', new: 1, changed: 1, unchanged: 0 });
  assert.equal(classifyConflicts(rows, rows).unchanged, rows.length);
});

test('report export has the summary table, daily rows and KPI definitions', () => {
  const period = resolvePeriod({ preset: 'month', anchor: '2026-10-01' });
  const ftdDaily = aggregateFtdByDay(ftd);
  const report = buildOnboardingReport({
    period, granularity: 'week',
    current: { daily: aggregateEventsByDay(rows), ftd: ftdDaily, ftdCoverage: dateCoverage(ftdDaily.map(d => d.date)), uniqueActivated: distinctActivatedAccounts(rows), ftdCohort: ftdCohortStats(rows, ftd, period.range) },
    previous: { daily: [], ftd: [], ftdCoverage: null, uniqueActivated: 0, ftdCohort: { activatedWithFtd: 0, ftdFromPeriodActivations: 0 } },
  });
  assert.equal(exportFileName(report), 'monthly-report-onboarding_2026-10-01_2026-10-31.xlsx');
  const workbook = XLSX.read(buildReportWorkbook(report), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Summary', 'Daily', 'KPIs']);
  const summary = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Summary, { header: 1, defval: null });
  assert.deepEqual(summary[2], [...EXPORT_COLUMNS]);
  assert.deepEqual(summary.slice(3, 8).map(r => r[0]), ['Week I (01-11)', 'Week II (12-18)', 'Week III (19-25)', 'Week IV (26-31)', 'Total']);
  assert.equal(summary[7][3], rows.length);
  const col = (name: string) => EXPORT_COLUMNS.indexOf(name as typeof EXPORT_COLUMNS[number]);
  // Total row: Total Real Account = unique activated (4) + manual KYC approved (1); Pending = 11 − 5 − 2.
  assert.deepEqual([summary[7][col('Total Real Account')], summary[7][col('Real Account Activated')], summary[7][col('Manual Approved Demo Not Done')], summary[7][col('Pending')]], [5, 4, 1, 4]);
  const kpiSheet = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.KPIs, { header: 1, defval: null });
  assert.deepEqual(kpiSheet.find(r => r[0] === 'Total Real Account')?.slice(0, 2), ['Total Real Account', 5]);
  assert.deepEqual(kpiSheet.filter(r => String(r[0]).includes('of which')).map(r => [String(r[0]).trim(), r[1]]), [
    ['of which Real Account Activated', 4], ['of which Manual Approved Demo Not Done', 1],
  ]);
  const daily = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Daily, { header: 1 });
  assert.equal(daily.length, 32);
  // FTD per day is zero-filled across the covered month, so the series has a value for every day.
  assert.deepEqual(report.daily.map(d => d.values.ftd).filter(v => v === null), []);
  assert.equal(report.daily.reduce((n, d) => n + (d.values.ftd ?? 0), 0), ftd.length);
});
