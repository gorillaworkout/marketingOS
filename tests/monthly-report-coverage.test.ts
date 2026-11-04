import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticFtdReportCsv, syntheticOnboardingWorkbook } from './fixtures/monthly-report-onboarding';
import {
  coverageFromUploads, coverageOverview, coverageState, dataThrough, formatRanges, mergeRanges, missingRanges, monthsFromUploads, summarizeCoverage,
} from '../src/lib/monthly-report/coverage';
import { buildReportWorkbook, reportTableRows } from '../src/lib/monthly-report/export';
import { parseFtdFile } from '../src/lib/monthly-report/ftd-parse';
import { aggregateEventsByDay, aggregateFtdByDay, buildOnboardingReport, dateCoverage, type PeriodData } from '../src/lib/monthly-report/metrics';
import { parseOnboardingWorkbook } from '../src/lib/monthly-report/onboarding-parse';
import { resolvePeriod } from '../src/lib/monthly-report/periods';
import * as XLSX from 'xlsx';

const empty: PeriodData = { daily: [], ftd: [], ftdCoverage: null, uniqueActivated: 0, ftdCohort: { activatedWithFtd: 0, ftdFromPeriodActivations: 0 } };

test('coverage: CLI imports and web uploads both count (same upload rows with data_from/data_to)', () => {
  // The import CLI (scripts/monthly-report-import.ts) writes rows through the same store functions,
  // with range = the file's WIB summary range. Rows without a range (no valid rows) are ignored.
  const coverage = coverageFromUploads([
    { kind: 'onboarding', data_from: '2026-10-01', data_to: '2026-10-31' }, // CLI: October
    { kind: 'ftd', data_from: '2026-10-01', data_to: '2026-10-31' },
    { kind: 'onboarding', data_from: null, data_to: null },
    { kind: 'rejection_reasons', data_from: '2026-01-01', data_to: '2026-12-31' },
  ]);
  assert.deepEqual(coverage, { onboarding: [{ from: '2026-10-01', to: '2026-10-31' }], ftd: [{ from: '2026-10-01', to: '2026-10-31' }] });
  assert.equal(dataThrough(coverage.onboarding), '2026-10-31');
  assert.equal(dataThrough([]), null);
});

test('coverage: the parsed WIB range of a file is what the upload records', () => {
  const onboarding = parseOnboardingWorkbook(syntheticOnboardingWorkbook(), { offset: '+07:00' });
  const ftd = parseFtdFile(Buffer.from(syntheticFtdReportCsv()), { fileName: 'ftd.csv', offset: '+07:00' });
  assert.deepEqual(onboarding.summary.wibRange, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(ftd.summary.wibRange, { from: '2026-10-01', to: '2026-10-31' });
});

test('coverage: overlapping and adjacent uploads merge; separate ones leave a gap', () => {
  assert.deepEqual(mergeRanges([
    { from: '2026-10-10', to: '2026-10-20' },
    { from: '2026-10-01', to: '2026-10-12' }, // overlaps
    { from: '2026-10-21', to: '2026-10-25' }, // adjacent (next day)
    { from: '2026-10-28', to: '2026-10-31' }, // gap 26–27
    { from: '2026-10-29', to: '2026-10-30' }, // inside
    { from: '2026-11-05', to: '2026-11-01' }, // inverted: dropped
  ]), [{ from: '2026-10-01', to: '2026-10-25' }, { from: '2026-10-28', to: '2026-10-31' }]);
});

test('coverage: missing ranges inside a filter range, merged, never after today', () => {
  const ranges = [{ from: '2026-10-01', to: '2026-10-02' }, { from: '2026-10-05', to: '2026-10-05' }, { from: '2026-10-08', to: '2026-10-31' }];
  assert.deepEqual(missingRanges({ from: '2026-10-01', to: '2026-10-31' }, ranges, '2026-11-04'), [
    { from: '2026-10-03', to: '2026-10-04' }, { from: '2026-10-06', to: '2026-10-07' },
  ]);
  // November: only up to today (4 Nov) is missing; 5–30 Nov are future, not flagged.
  assert.deepEqual(missingRanges({ from: '2026-11-01', to: '2026-11-30' }, ranges, '2026-11-04'), [{ from: '2026-11-01', to: '2026-11-04' }]);
  assert.deepEqual(missingRanges({ from: '2026-12-01', to: '2026-12-31' }, ranges, '2026-11-04'), []);
  // Nothing uploaded at all: the whole past part is missing.
  assert.deepEqual(missingRanges({ from: '2026-09-01', to: '2026-09-30' }, [], '2026-11-04'), [{ from: '2026-09-01', to: '2026-09-30' }]);
  // Gap at the start and the end.
  assert.deepEqual(missingRanges({ from: '2026-09-28', to: '2026-11-02' }, ranges, '2026-11-04'), [
    { from: '2026-09-28', to: '2026-09-30' }, { from: '2026-10-03', to: '2026-10-04' }, { from: '2026-10-06', to: '2026-10-07' }, { from: '2026-11-01', to: '2026-11-02' },
  ]);
  const summary = summarizeCoverage({ from: '2026-10-01', to: '2026-10-31' }, ranges, '2026-11-04');
  assert.equal(summary.through, '2026-10-31');
  assert.equal(summary.missingDays, 4);
  assert.equal(formatRanges(summary.missing), '3 Oct 2026 – 4 Oct 2026, 6 Oct 2026 – 7 Oct 2026');
});

test('coverage: bucket states full / partial / none / future', () => {
  const ranges = [{ from: '2026-10-01', to: '2026-10-31' }];
  const today = '2026-11-04';
  assert.equal(coverageState({ from: '2026-10-05', to: '2026-10-11' }, ranges, today), 'full');
  assert.equal(coverageState({ from: '2026-10-26', to: '2026-11-01' }, ranges, today), 'partial');
  assert.equal(coverageState({ from: '2026-11-02', to: '2026-11-08' }, ranges, today), 'none');
  assert.equal(coverageState({ from: '2026-11-09', to: '2026-11-15' }, ranges, today), 'future');
  // The current week: covered past days + future days = full (future days are not missing).
  assert.equal(coverageState({ from: '2026-10-29', to: '2026-11-04' }, [{ from: '2026-10-01', to: '2026-11-04' }], today), 'full');
});

test('coverage: overview without a filter checks from the first upload to today', () => {
  const coverage = {
    onboarding: [{ from: '2026-10-01', to: '2026-10-31' }],
    ftd: [{ from: '2026-09-01', to: '2026-10-31' }],
  };
  const overview = coverageOverview(coverage, '2026-11-04');
  assert.deepEqual(overview.range, { from: '2026-09-01', to: '2026-11-04' });
  assert.deepEqual(overview.onboarding.missing, [{ from: '2026-09-01', to: '2026-09-30' }, { from: '2026-11-01', to: '2026-11-04' }]);
  assert.deepEqual(overview.ftd.missing, [{ from: '2026-11-01', to: '2026-11-04' }]);
  const october = coverageOverview(coverage, '2026-11-04', { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(october.onboarding.missingDays, 0);
  assert.equal(october.ftd.missingDays, 0);
  assert.deepEqual(coverageOverview({ onboarding: [], ftd: [] }, '2026-11-04').range, null);
});

test('coverage: months touched by uploads, newest first', () => {
  assert.deepEqual(monthsFromUploads([
    { kind: 'onboarding', data_from: '2026-06-01', data_to: '2026-07-31' },
    { kind: 'ftd', data_from: '2026-09-30', data_to: '2026-10-01' },
    { kind: 'ftd', data_from: '2025-12-31', data_to: '2026-01-01' },
    { kind: 'ftd', data_from: null, data_to: null },
  ]), ['2026-10', '2026-09', '2026-07', '2026-06', '2026-01', '2025-12']);
});

test('report: uncovered days are "No data" (null), not 0, and gaps are listed', () => {
  const rows = parseOnboardingWorkbook(syntheticOnboardingWorkbook(), { offset: '+07:00' }).rows;
  const ftdRows = parseFtdFile(Buffer.from(syntheticFtdReportCsv()), { fileName: 'ftd.csv', offset: '+07:00' }).rows;
  const ftdDaily = aggregateFtdByDay(ftdRows);
  const period = resolvePeriod({ preset: 'custom', from: '2026-10-26', to: '2026-11-08' });
  const current: PeriodData = { ...empty, daily: aggregateEventsByDay(rows), ftd: ftdDaily, ftdCoverage: dateCoverage(ftdDaily.map(d => d.date)) };
  const report = buildOnboardingReport({
    period, granularity: 'day', current, previous: empty, today: '2026-11-04',
    // Onboarding through 31 Oct, FTD only through 28 Oct (CLI import).
    coverage: { onboarding: [{ from: '2026-10-01', to: '2026-10-31' }], ftd: [{ from: '2026-10-01', to: '2026-10-28' }] },
  });
  const byDay = new Map(report.buckets.map(bucket => [bucket.from, bucket]));
  assert.equal(byDay.get('2026-10-27')?.values.registrations, 0); // covered, nothing happened: a real 0
  assert.equal(byDay.get('2026-10-31')?.values.registrations, 1);
  assert.equal(byDay.get('2026-11-02')?.values.registrations, null); // not covered: No data
  assert.equal(byDay.get('2026-11-02')?.coverage.onboarding, 'none');
  assert.equal(byDay.get('2026-11-06')?.coverage.onboarding, 'future');
  assert.equal(byDay.get('2026-10-28')?.values.ftd, 0);
  assert.equal(byDay.get('2026-10-29')?.values.ftd, null);
  assert.equal(byDay.get('2026-10-31')?.values.ftd, null); // FTD import stops at 28 Oct
  assert.equal(report.totalCoverage.onboarding, 'partial');
  assert.equal(report.total.registrations, 2);
  assert.deepEqual(report.coverage?.onboarding, { through: '2026-10-31', missing: [{ from: '2026-11-01', to: '2026-11-04' }], missingDays: 4 });
  assert.deepEqual(report.coverage?.ftd, { through: '2026-10-28', missing: [{ from: '2026-10-29', to: '2026-11-04' }], missingDays: 7 });

  // Weekly: a week with no covered day is No data; a mixed week is partial.
  const weekly = buildOnboardingReport({
    period: resolvePeriod({ preset: 'custom', from: '2026-10-19', to: '2026-11-15' }), granularity: 'week', current, previous: empty, today: '2026-11-04',
    // Weeks split at month ends: 19–25 Oct, 26–31 Oct, 1–8 Nov, 9–15 Nov. Data through 28 Oct.
    coverage: { onboarding: [{ from: '2026-10-01', to: '2026-10-28' }], ftd: [{ from: '2026-10-01', to: '2026-10-28' }] },
  });
  assert.deepEqual(weekly.buckets.map(b => b.from), ['2026-10-19', '2026-10-26', '2026-11-01', '2026-11-09']);
  assert.deepEqual(weekly.buckets.map(b => b.coverage.onboarding), ['full', 'partial', 'none', 'future']);
  assert.deepEqual(weekly.buckets.map(b => b.values.registrations === null), [false, false, true, true]);
  assert.deepEqual(weekly.buckets.map(b => b.values.ftd === null), [false, false, true, true]);

  // Export marks the same cells "No data".
  const table = reportTableRows(weekly);
  assert.equal(table[2][3], 'No data');
  assert.equal(table[2][9], 'No data');
  assert.notEqual(table[0][3], 'No data');
  const sheet = XLSX.read(buildReportWorkbook(weekly)).Sheets.Summary;
  assert.ok(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }).some(row => row[0] === 'Onboarding data through' && row[1] === '2026-10-28'));
});

test('report: without coverage input the legacy behaviour is unchanged', () => {
  const period = resolvePeriod({ preset: 'month', anchor: '2026-10-15' });
  const report = buildOnboardingReport({ period, granularity: 'week', current: empty, previous: empty });
  assert.equal(report.coverage, null);
  assert.ok(report.buckets.every(bucket => bucket.values.registrations === 0 && bucket.values.ftd === null));
  assert.equal(reportTableRows(report)[0][3], 0);
});
