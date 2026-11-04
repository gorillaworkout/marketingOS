/** .xlsx export of the Onboarding report: the summary table plus daily rows. */
import * as XLSX from 'xlsx';
import { pending } from './definitions';
import type { OnboardingReport, ReportBucket } from './metrics';

export const EXPORT_COLUMNS = [
  'Period', 'From', 'To', 'Registrations', 'KYC Rejected', 'Total Real Account', 'Real Account Activated',
  'Manual Approved Demo Not Done', 'Pending', 'FTD', 'FTD Amount',
  'First account', 'Additional account', 'Auto KYC approved',
] as const;

function bucketRow(bucket: Pick<ReportBucket, 'label' | 'from' | 'to' | 'values'>): (string | number | null)[] {
  const v = bucket.values;
  return [bucket.label, bucket.from, bucket.to, v.registrations, v.kycRejected, v.realAccountApproved, v.realAccountActivated,
    v.manualKycApproved, pending(v), v.ftd, v.ftdAmount, v.firstAccount, v.additionalAccount, v.autoKycApproved];
}

export function reportTableRows(report: OnboardingReport): (string | number | null)[][] {
  return [
    ...report.buckets.map(bucketRow),
    bucketRow({ label: 'Total', from: report.range.from, to: report.range.to, values: report.total }),
  ];
}

export function exportFileName(report: OnboardingReport): string {
  return `monthly-report-onboarding_${report.range.from}_${report.range.to}.xlsx`;
}

export function buildReportWorkbook(report: OnboardingReport): Buffer {
  const workbook = XLSX.utils.book_new();
  const header = [...EXPORT_COLUMNS];
  const summary = XLSX.utils.aoa_to_sheet([
    [`Monthly Report — Onboarding, ${report.rangeLabel} (WIB)`],
    [],
    header,
    ...reportTableRows(report),
    [],
    ['Total Real Account', report.kpis.find(k => k.key === 'realAccountApproved')?.note ?? ''],
    ['Note', 'Real Account Activated in the Total row counts unique accounts; period rows count activations. The Total can be lower than the sum of the rows.'],
    ['Registrations', report.kpis.find(k => k.key === 'registrations')?.note ?? ''],
    ['Pending', report.kpis.find(k => k.key === 'pending')?.note ?? ''],
  ]);
  summary['!cols'] = header.map((_, i) => ({ wch: i === 0 ? 22 : 14 }));
  XLSX.utils.book_append_sheet(workbook, summary, 'Summary');
  const daily = XLSX.utils.aoa_to_sheet([header, ...report.daily.map(bucketRow)]);
  XLSX.utils.book_append_sheet(workbook, daily, 'Daily');
  const kpis = XLSX.utils.aoa_to_sheet([
    ['KPI', 'Value', `Previous (${report.previousLabel})`, 'Change', 'Change %', 'Definition'],
    ...report.kpis.flatMap(k => [
      [k.label, k.value, k.previous, k.change, k.changePct, k.note],
      ...(k.parts ?? []).map(part => [`  of which ${part.label}`, part.value, part.previous, null, null, '']),
    ]),
    [],
    ['Funnel step', 'Value', 'Step %', 'Overall %'],
    ...report.funnel.map(s => [s.label, s.value, s.stepPct, s.overallPct]),
    [],
    [`Previous (${report.previousLabel})`],
    header,
    bucketRow({ label: 'Previous', from: report.previousRange.from, to: report.previousRange.to, values: report.previousTotal }),
  ]);
  XLSX.utils.book_append_sheet(workbook, kpis, 'KPIs');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
