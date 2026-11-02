/**
 * Checks against the real October 2026 exports. The files contain personal
 * data and are never committed: point MONTHLY_REPORT_DATA_DIR at a folder with
 * source.xlsx and ftd.csv to run these; otherwise they are skipped.
 *
 * PPT gap (documented, not force-matched): the PPT shows 25,283 registrations
 * for October; the onboarding export has 24,737 rows (−2.2%), most likely a
 * different export. Day-level counts agree closely (Oct 1 815 vs 822, Oct 5
 * 856 vs 860, Oct 30 994 vs 994).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseFtdFile } from '../src/lib/monthly-report/ftd-parse';
import { aggregateEventsByDay, aggregateFtdByDay, distinctActivatedAccounts, ftdCohortStats, sumDaily } from '../src/lib/monthly-report/metrics';
import { parseOnboardingWorkbook, wibDate } from '../src/lib/monthly-report/onboarding-parse';

const dir = process.env.MONTHLY_REPORT_DATA_DIR ?? '/workspace/monthly-report';
const onboardingFile = path.join(dir, 'source.xlsx');
const ftdFile = path.join(dir, 'ftd.csv');
const skip = !existsSync(onboardingFile) || !existsSync(ftdFile) ? 'real export files not available' : false;
const october = { from: '2026-10-01', to: '2026-10-31' };

/** PPT slide 5, FTD per day, Oct 1 → Oct 31. */
const PPT_FTD_PER_DAY = [66, 69, 0, 6, 71, 54, 70, 98, 88, 1, 9, 101, 112, 135, 147, 114, 0, 7, 121, 113, 141, 151, 133, 0, 15, 171, 156, 172, 193, 219, 1];

function perDay(daily: { date: string; count: number }[]): number[] {
  const byDate = new Map(daily.map(d => [d.date, d.count]));
  return Array.from({ length: 31 }, (_, i) => byDate.get(`2026-10-${String(i + 1).padStart(2, '0')}`) ?? 0);
}

test('FTD report CSV: October totals and the PPT daily series', { skip }, () => {
  for (const offset of ['+07:00', '+08:00']) {
    const ftd = parseFtdFile(readFileSync(ftdFile), { fileName: 'ftd.csv', offset });
    assert.equal(ftd.layout, 'report');
    assert.deepEqual(ftd.reportMonth, { year: 2026, month: 10 });
    assert.equal(ftd.issues.length, 0);
    assert.equal(ftd.rows.length, 2734);
    assert.equal(ftd.summary.amountTotal, 1192465.8);
    assert.deepEqual(ftd.summary.byType, { micro: 2303, standard: 431 });
  }
  // The PPT's daily series matches exactly when FTD Time is read as WIB (+07:00) wall clock.
  const wib = parseFtdFile(readFileSync(ftdFile), { fileName: 'ftd.csv', offset: '+07:00' });
  assert.deepEqual(perDay(aggregateFtdByDay(wib.rows)), PPT_FTD_PER_DAY);
  // At the +08:00 default a few FTDs just after midnight move one WIB day earlier (6 days differ by 1–2).
  const utc8 = parseFtdFile(readFileSync(ftdFile), { fileName: 'ftd.csv', offset: '+08:00' });
  const shifted = perDay(aggregateFtdByDay(utc8.rows));
  assert.equal(shifted.reduce((a, b) => a + b, 0), 2734);
  assert.equal(shifted.filter((n, i) => n !== PPT_FTD_PER_DAY[i]).length, 6);
});

test('onboarding export: October numbers (computed, PPT gap documented)', { skip }, () => {
  const ftd = parseFtdFile(readFileSync(ftdFile), { fileName: 'ftd.csv', offset: '+07:00' }).rows;
  const rows = parseOnboardingWorkbook(readFileSync(onboardingFile), { offset: '+07:00' }).rows;
  const inOctober = rows.filter(row => wibDate(row.eventAt).startsWith('2026-10'));
  const daily = aggregateEventsByDay(inOctober);
  const sum = sumDaily(daily);
  const byDate = new Map(daily.map(d => [d.date, d.events]));
  assert.equal(sum.events, 24737); // Registrations (all steps, repeats counted); PPT 25,283
  assert.deepEqual([byDate.get('2026-10-01'), byDate.get('2026-10-05'), byDate.get('2026-10-30')], [815, 856, 994]);
  assert.equal(sum.kycRejected, 7343);
  assert.equal(sum.manualKycApproved, 936);
  assert.equal(sum.firstAccount, 5930);
  assert.equal(sum.additionalAccount, 1232);
  const approved = distinctActivatedAccounts(inOctober);
  assert.equal(approved, 7162);
  assert.equal(sum.events - approved - sum.kycRejected, 10232); // Pending
  assert.deepEqual(ftdCohortStats(inOctober, ftd, october), { activatedWithFtd: 2467, ftdFromPeriodActivations: 2467 });
});
