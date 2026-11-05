/** .xlsx export of the Onboarding report: the summary table plus daily rows. */
import * as XLSX from 'xlsx';
import { COHORT_UNAVAILABLE_NOTE } from './definitions';
import { FTD_SOURCE_LABELS } from './ftd-daily';
import type { OnboardingReport, ReportBucket } from './metrics';

export const EXPORT_COLUMNS = [
  'Period', 'From', 'To', 'Registrations', 'KYC Rejected', 'Total Real Account', 'Real Account Activated',
  'Manual Approved Demo Not Done', 'FTD', 'FTD Amount',
  'First account', 'Additional account', 'Auto KYC approved',
] as const;

export const NO_DATA = 'No data';

type RowBucket = Pick<ReportBucket, 'label' | 'from' | 'to' | 'values'> & { coverage?: ReportBucket['coverage'] };

/**
 * One table row. With upload coverage, days no upload covers read "No data"
 * instead of 0 (onboarding columns and FTD columns separately).
 */
function bucketRow(bucket: RowBucket, markNoData = false): (string | number | null)[] {
  const v = bucket.values;
  const noOnboarding = markNoData && bucket.coverage !== undefined && (bucket.coverage.onboarding === 'none' || bucket.coverage.onboarding === 'future');
  const ob = (value: number | null) => (noOnboarding ? NO_DATA : value);
  const ftd = (value: number | null) => (markNoData && value === null ? NO_DATA : value);
  return [bucket.label, bucket.from, bucket.to, ob(v.registrations), ob(v.kycRejected), ob(v.realAccountApproved), ob(v.realAccountActivated),
    ob(v.manualKycApproved), ftd(v.ftd), ftd(v.ftdAmount), ob(v.firstAccount), ob(v.additionalAccount), ob(v.autoKycApproved)];
}

export function reportTableRows(report: OnboardingReport): (string | number | null)[][] {
  const mark = report.coverage !== null;
  return [
    ...report.buckets.map(bucket => bucketRow(bucket, mark)),
    bucketRow({ label: 'Total', from: report.range.from, to: report.range.to, values: report.total, coverage: report.totalCoverage }, mark),
  ];
}

export const FTD_DAILY_COLUMNS = ['Date (WIB)', 'FTD', 'FTD Amount (USD)', 'Source'] as const;
export const AMOUNT_NOT_ENTERED = 'Not entered';

/** "FTD daily" sheet: one row per day of the period; manual entries override the FTD file. */
export function ftdDailyRows(report: OnboardingReport): (string | number)[][] {
  return (report.ftdDays ?? []).map(day => (day.count === null
    ? [day.date, NO_DATA, NO_DATA, '']
    : [day.date, day.count, day.amount === null ? AMOUNT_NOT_ENTERED : day.amount, day.source ? FTD_SOURCE_LABELS[day.source] : '']));
}

export function exportFileName(report: OnboardingReport): string {
  return `monthly-report-onboarding_${report.range.from}_${report.range.to}.xlsx`;
}

export function buildReportWorkbook(report: OnboardingReport): Buffer {
  const workbook = XLSX.utils.book_new();
  const header = [...EXPORT_COLUMNS];
  const summary = XLSX.utils.aoa_to_sheet([
    [`Onboarding Reports — ${report.rangeLabel} (WIB)`],
    [],
    header,
    ...reportTableRows(report),
    [],
    ['Total Real Account', report.kpis.find(k => k.key === 'realAccountApproved')?.note ?? ''],
    ['Note', 'Real Account Activated in the Total row counts unique accounts; period rows count activations. The Total can be lower than the sum of the rows.'],
    ['Registrations', report.kpis.find(k => k.key === 'registrations')?.note ?? ''],
    ...(report.coverage ? [
      ['No data', 'No upload covers these days (onboarding and FTD are tracked separately), so they are not counted as 0.'],
      ['Onboarding data through', report.coverage.onboarding.through ?? '—'],
      ['FTD data through', report.coverage.ftd.through ?? '—'],
    ] : []),
  ]);
  summary['!cols'] = header.map((_, i) => ({ wch: i === 0 ? 22 : 14 }));
  XLSX.utils.book_append_sheet(workbook, summary, 'Summary');
  const mark = report.coverage !== null;
  const daily = XLSX.utils.aoa_to_sheet([header, ...report.daily.map(bucket => bucketRow(bucket, mark))]);
  XLSX.utils.book_append_sheet(workbook, daily, 'Daily');
  const ftdDaily = XLSX.utils.aoa_to_sheet([
    [...FTD_DAILY_COLUMNS],
    ...ftdDailyRows(report),
    [],
    ['Total FTD', report.ftd.count],
    ['Manual entry days', report.ftd.manualDays],
    ['FTD file days', report.ftd.accountDays],
    ['Note', 'A manual daily entry replaces the FTD-file value of its day (count and amount). "Not entered" = manual entry without an amount.'],
  ]);
  ftdDaily['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, ftdDaily, 'FTD daily');
  const kpis = XLSX.utils.aoa_to_sheet([
    ['KPI', 'Value', `Previous (${report.previousLabel})`, 'Change', 'Change %', 'Definition'],
    ...report.kpis.flatMap(k => [
      [k.label, k.value, k.previous, k.change, k.changePct, k.note],
      ...(k.parts ?? []).map(part => [`  of which ${part.label}`, part.value, part.previous, null, null, '']),
    ]),
    [],
    ['Funnel step', 'Value', 'Step %', 'Overall %'],
    ...report.funnel.map(s => (s.key === 'ftd' && !report.ftd.cohortAvailable
      ? [s.label, NO_DATA, null, null, COHORT_UNAVAILABLE_NOTE]
      : [s.label, s.value, s.stepPct, s.overallPct])),
    [],
    [`Previous (${report.previousLabel})`],
    header,
    bucketRow({ label: 'Previous', from: report.previousRange.from, to: report.previousRange.to, values: report.previousTotal }),
  ]);
  XLSX.utils.book_append_sheet(workbook, kpis, 'KPIs');
  if (report.approvers?.length) {
    const approvers = XLSX.utils.aoa_to_sheet([
      ['Approver', 'Final Approved (by Finished Time)', 'Steps Approved (by Create Time)', 'Final Rejected'],
      ...report.approvers.map(a => [a.approver, a.finalApproved, a.stepsApproved, a.finalRejected]),
      [],
      ['Note', 'Deposit Robot is excluded from this ranking. Final Approved uses Success Status = Approved bucketed by Finished Time (else Create Time).'],
    ]);
    XLSX.utils.book_append_sheet(workbook, approvers, 'Approvers');
  }
  if (report.rejectionReasons) {
    const rr = report.rejectionReasons;
    const reasons = XLSX.utils.aoa_to_sheet([
      ['Category', 'Robot', 'Staff', 'Total', 'Sample remarks (admin)'],
      ...rr.reasons.map(r => [r.categoryLabel, r.robot, r.staff, r.total, r.samples.join(' | ').slice(0, 500)]),
      [],
      ['Total rejected rows', rr.totalRejected],
      ['Robot rejected', rr.robotRejected],
      ['Staff rejected', rr.staffRejected],
      ['Rejected Reason column filled', rr.rejectedReasonColumnFilled],
      ['Rejected Reason equals Remark', rr.rejectedReasonMatchesRemark],
      ['Classification rule', rr.robotRule],
      ['Note', 'Remark is the rejection reason. Staff counts only Manual + manual_kyc rows with a named approver and a human Remark (not Ekyc, E-Kyc, Speech Script Matching, HasSameIdentity, Face consistency, or similar program flags). manual_video_verify and auto_* are not Staff. Rows that are neither Robot nor Staff are omitted. Rejected Reason is usually empty in the Metabase export. Unmatched human remarks are listed under Other with raw text.'],
    ]);
    XLSX.utils.book_append_sheet(workbook, reasons, 'Rejection reasons');
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
