import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticFtdReportCsv, syntheticOnboardingWorkbook } from './fixtures/monthly-report-onboarding';
import { parseFtdFile } from '../src/lib/monthly-report/ftd-parse';
import { parseOnboardingWorkbook } from '../src/lib/monthly-report/onboarding-parse';
import {
  aggregateEventsByDay, aggregateFtdByDay, buildOnboardingReport, classifyEvent, dateCoverage, distinctActivatedAccounts,
  ftdCohortStats, maskIdentifier, pending, sumDaily, type PeriodData,
} from '../src/lib/monthly-report/metrics';
import { resolvePeriod } from '../src/lib/monthly-report/periods';

const rows = parseOnboardingWorkbook(syntheticOnboardingWorkbook(), { offset: '+07:00' }).rows;
const ftdRows = parseFtdFile(Buffer.from(syntheticFtdReportCsv()), { fileName: 'ftd.csv', offset: '+07:00' }).rows;
const october = { from: '2026-10-01', to: '2026-10-31' };
const empty: PeriodData = { daily: [], ftd: [], ftdCoverage: null, uniqueActivated: 0, ftdCohort: { activatedWithFtd: 0, ftdFromPeriodActivations: 0 } };
const ftdDaily = aggregateFtdByDay(ftdRows);
const ftdCoverage = dateCoverage(ftdDaily.map(d => d.date));

test('events are classified by Step Status, with conflicts flagged', () => {
  const kinds = rows.map(row => classifyEvent(row));
  assert.deepEqual(kinds, [
    'auto_kyc_approved', 'first_account', 'kyc_rejected', 'manual_kyc_approved', 'first_account',
    'additional_account', 'approved_bank_info_pending', 'pending_video_failed', 'kyc_rejected', 'other', 'first_account',
  ]);
});

test('daily aggregation uses the WIB calendar day', () => {
  const daily = aggregateEventsByDay(rows);
  // +07:00 source = WIB, so days stay as written in the export.
  assert.deepEqual(daily.map(d => d.date), ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-12', '2026-10-13', '2026-10-19', '2026-10-26', '2026-10-31']);
  const total = sumDaily(daily);
  assert.equal(total.kycRejected, 2);
  assert.equal(total.manualKycApproved, 1);
  assert.equal(total.autoKycApproved, 1);
  assert.equal(total.firstAccount, 3);
  assert.equal(total.additionalAccount, 1);
  assert.equal(total.activated, 4);
  assert.equal(total.approvedBankInfoPending, 1);
  assert.equal(total.pendingVideoFailed, 1);
  assert.equal(distinctActivatedAccounts(rows), 4);

  const shifted = aggregateEventsByDay(parseOnboardingWorkbook(syntheticOnboardingWorkbook(), { offset: '+08:00' }).rows);
  assert.equal(shifted[0].date, '2026-09-30');
});

test('activated accounts are unique per trading account', () => {
  const duplicate = { ...rows[1], documentId: 'x-1' };
  assert.equal(distinctActivatedAccounts([...rows, duplicate]), 4);
});

test('FTDs aggregate per WIB day and join onboarding on the trading account', () => {
  assert.deepEqual(ftdDaily.map(d => [d.date, d.count, d.amount, d.micro, d.standard]), [
    ['2026-10-01', 1, 71.42, 1, 0], ['2026-10-02', 2, 1200, 1, 1], ['2026-10-12', 1, 50, 1, 0], ['2026-10-31', 1, 12345.6, 0, 1],
  ]);
  // Activated in Oct: 7000001..7000004. With an FTD: 7000001, 7000002, 7000003.
  assert.deepEqual(ftdCohortStats(rows, ftdRows, october), { activatedWithFtd: 3, ftdFromPeriodActivations: 3 });
  assert.deepEqual(ftdCohortStats(rows, ftdRows, { from: '2026-10-05', to: '2026-10-31' }), { activatedWithFtd: 1, ftdFromPeriodActivations: 1 });
});

test('the report builds KPIs, October weeks, funnel and comparison', () => {
  const period = resolvePeriod({ preset: 'month', anchor: '2026-10-15' });
  const report = buildOnboardingReport({
    period,
    granularity: 'week',
    current: {
      ...empty,
      daily: aggregateEventsByDay(rows),
      ftd: ftdDaily,
      ftdCoverage,
      uniqueActivated: 4,
      ftdCohort: ftdCohortStats(rows, ftdRows, october),
    },
    previous: { ...empty, daily: aggregateEventsByDay(rows.slice(0, 2).map(r => ({ ...r, eventAt: new Date(Date.parse(r.eventAt) - 10 * 86_400_000).toISOString() }))), ftdCoverage },
  });
  assert.deepEqual(report.buckets.map(b => [b.from, b.to]), [
    ['2026-10-01', '2026-10-11'], ['2026-10-12', '2026-10-18'], ['2026-10-19', '2026-10-25'], ['2026-10-26', '2026-10-31'],
  ]);
  // Total Real Account = activated + manual KYC approved (demo not done).
  assert.deepEqual(report.buckets.map(b => b.values.realAccountActivated), [3, 0, 0, 1]);
  assert.deepEqual(report.buckets.map(b => b.values.manualKycApproved), [1, 0, 0, 0]);
  assert.deepEqual(report.buckets.map(b => b.values.realAccountApproved), [4, 0, 0, 1]);
  assert.deepEqual(report.buckets.map(b => b.values.kycRejected), [1, 0, 1, 0]);
  // Registrations = every onboarding row (all steps), repeats counted.
  assert.deepEqual(report.buckets.map(b => b.values.registrations), [6, 2, 1, 2]);
  assert.equal(report.daily.length, 31);

  const kpi = Object.fromEntries(report.kpis.map(k => [k.key, k]));
  assert.equal(kpi.registrations.value, 11);
  assert.match(kpi.registrations.note, /all steps, repeats counted/);
  assert.equal(kpi.kycRejected.value, 2);
  assert.equal(kpi.realAccountApproved.value, 5);
  assert.equal(kpi.realAccountApproved.label, 'Total Real Account');
  assert.equal(kpi.realAccountApproved.note, 'Real accounts activated + KYC manual approved (demo not done)');
  assert.deepEqual(kpi.realAccountApproved.parts?.map(p => [p.key, p.label, p.value]), [
    ['realAccountActivated', 'Real Account Activated', 4], ['manualKycApproved', 'Manual Approved Demo Not Done', 1],
  ]);
  assert.equal(report.total.realAccountActivated, 4);
  assert.equal(kpi.ftd.value, 5);
  assert.equal(kpi.ftd.previous, null);
  assert.equal(kpi.pending.value, 11 - 5 - 2);
  assert.equal(kpi.pending.note, 'Registrations − Total Real Account − KYC Rejected');
  assert.deepEqual(report.buckets.map(b => b.values.ftd), [3, 1, 0, 1]);
  assert.deepEqual(report.ftd, {
    count: 5, amountTotal: 13667.02, amountAverage: 2733.4, byType: { micro: 3, standard: 2, other: 0 },
    fromPeriodActivations: 3, fromEarlierAccounts: 2, dailyAverage: 0.2, ftdPerApprovedPct: 100,
    ftdPerRegistrationPct: 45.5, realToFtdPct: 75, activatedWithFtd: 3,
  });
  assert.equal(kpi.registrations.previous, 2);
  assert.equal(kpi.registrations.changePct, 450);
  assert.deepEqual(report.peaks.ftd, { date: '2026-10-02', value: 2 });
  assert.equal(kpi.realAccountApproved.changePct, null);

  assert.deepEqual(report.breakdown.map(b => [b.key, b.value]), [
    ['realAccountActivated', 4], ['manualKycApproved', 1], ['firstAccount', 3], ['additionalAccount', 1], ['autoKycApproved', 1],
  ]);
  assert.equal(report.breakdown[1].label, 'Manual Approved Demo Not Done');
  assert.match(report.breakdown[2].label, /First account activation \(auto\)/);

  assert.deepEqual(report.funnel.map(s => [s.key, s.value, s.stepPct, s.overallPct]), [
    ['registrations', 11, null, 100],
    ['kycApproved', 2, 18.2, 18.2],
    // Funnel stays on unique activated accounts, not Total Real Account.
    ['realAccountActivated', 4, 200, 36.4],
    ['ftd', 3, 75, 27.3],
  ]);
  assert.equal(report.dataQuality.approvedBankInfoPending, 1);
  assert.equal(report.dataQuality.pendingVideoFailed, 1);
  assert.equal(report.hasOnboardingData, true);
  assert.equal(report.hasPreviousData, true);
  assert.equal(report.hasFtd, true);
});

test('Total Real Account adds manual KYC approved to unique activations in every view', () => {
  const day = (date: string, activated: number, manualKycApproved: number, kycRejected: number, events: number) => ({
    date, kycRejected, manualKycApproved, autoKycApproved: 0, firstAccount: activated, additionalAccount: 0, activated,
    approvedBankInfoPending: 0, pendingVideoFailed: 0, events,
  });
  const report = buildOnboardingReport({
    period: resolvePeriod({ preset: 'month', anchor: '2026-10-15' }),
    granularity: 'week',
    // The same account activated on Oct 1 and Oct 2: daily rows count 2 + 1, the period total counts it once (2).
    current: { ...empty, daily: [day('2026-10-01', 2, 3, 1, 20), day('2026-10-02', 1, 0, 0, 5), day('2026-10-20', 0, 2, 4, 10)], uniqueActivated: 2 },
    previous: { ...empty, daily: [day('2026-09-10', 5, 1, 2, 30)], uniqueActivated: 5 },
  });
  assert.deepEqual(report.daily.slice(0, 2).map(d => [d.values.realAccountActivated, d.values.manualKycApproved, d.values.realAccountApproved]), [[2, 3, 5], [1, 0, 1]]);
  assert.deepEqual(report.buckets.map(b => b.values.realAccountApproved), [6, 0, 2, 0]);
  assert.equal(report.total.realAccountActivated, 2);
  assert.equal(report.total.realAccountApproved, 2 + 5);
  assert.equal(report.previousTotal.realAccountApproved, 5 + 1);
  const kpi = Object.fromEntries(report.kpis.map(k => [k.key, k]));
  assert.deepEqual([kpi.realAccountApproved.value, kpi.realAccountApproved.previous, kpi.realAccountApproved.change], [7, 6, 1]);
  assert.deepEqual(kpi.realAccountApproved.parts?.map(p => [p.value, p.previous]), [[2, 5], [5, 1]]);
  assert.deepEqual([kpi.pending.value, kpi.pending.previous], [35 - 7 - 5, 30 - 6 - 2]);
  assert.equal(pending(report.buckets[0].values), 25 - 6 - 1);
  // Funnel compares unique activations (2) with KYC approved (5), never Total Real Account.
  assert.deepEqual(report.funnel[2], { key: 'realAccountActivated', label: 'Real account activated (unique)', value: 2, stepPct: 40, overallPct: 5.7 });
});

test('pending is hidden and FTD shows no data when nothing was uploaded', () => {
  const report = buildOnboardingReport({
    period: resolvePeriod({ preset: 'month', anchor: '2026-10-15' }),
    granularity: 'week',
    current: empty,
    previous: empty,
  });
  const pending = report.kpis.find(k => k.key === 'pending')!;
  assert.equal(pending.value, null);
  assert.equal(report.kpis.find(k => k.key === 'registrations')!.value, 0);
  assert.equal(report.funnel[1].overallPct, null);
  assert.equal(report.hasOnboardingData, false);
  assert.equal(report.hasPreviousData, false);
  assert.equal(report.hasFtd, false);
  assert.equal(report.kpis.find(k => k.key === 'ftd')!.value, null);
  assert.equal(report.ftd.ftdPerApprovedPct, null);
});

test('identifiers are masked in drill-downs', () => {
  assert.equal(maskIdentifier('2437165'), '24***65');
  assert.equal(maskIdentifier('123'), '***');
  assert.equal(maskIdentifier(null), null);
});
