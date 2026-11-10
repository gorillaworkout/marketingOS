/**
 * Editable Onboarding Report .docx. Figures come from the same report object as the .xlsx export.
 * There is no Onboarding HTML generator in this repo; the sections follow the on-screen report.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LevelFormat, Packer,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
  type FileChild,
} from 'docx';
import { COHORT_UNAVAILABLE_NOTE, TOTAL_REAL_ACCOUNT_NOTE } from './definitions';
import { NO_DATA, reportTableRows } from './export';
import type { BucketCoverage, BucketValues, OnboardingReport } from './metrics';
import type { PeriodPreset } from './periods';

type Cell = string | number | null;

const A4_WIDTH = 11906;
const A4_HEIGHT = 16838;
const MARGIN = 1134;
const CONTENT = A4_WIDTH - MARGIN * 2;
const BLUE = '1D4ED8';
const INK = '1C2430';
const MUTED = '5C6B7A';
const ZEBRA = 'F4F7FB';
const TOTAL = 'E8EEF8';
const thin = { style: BorderStyle.SINGLE, size: 4, color: 'E7EDF3' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };

const PRESET_TITLE: Record<PeriodPreset, string> = {
  day: 'Daily', week: 'Weekly', month: 'Monthly', '3m': '3-month', year: 'Yearly', custom: 'Custom',
};
const PRESET_FILE: Record<PeriodPreset, string> = {
  day: 'daily', week: 'weekly', month: 'monthly', '3m': '3-month', year: 'yearly', custom: 'custom',
};

const integer = (value: number) => Math.round(value).toLocaleString('en-US');

function onboardingMissing(coverage: BucketCoverage | undefined, mark: boolean): boolean {
  return mark && !!coverage && (coverage.onboarding === 'none' || coverage.onboarding === 'future');
}

function countCell(value: number | null, missing: boolean): string {
  if (missing || value === null) return NO_DATA;
  return integer(value);
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 0 : 280, after: 120 },
    children: [new TextRun({ text, font: 'Calibri', bold: true, size: level === HeadingLevel.HEADING_1 ? 36 : 26, color: '1E3A5F' })],
  });
}

function note(text: string): Paragraph {
  return new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, font: 'Calibri', size: 20, color: MUTED })] });
}

function dataTable(rows: Cell[][], numericFrom = 1, numericTo = Number.POSITIVE_INFINITY): Table {
  const [head, ...body] = rows;
  const columns = Math.max(head?.length ?? 1, ...body.map(row => row.length), 1);
  const width = Math.floor(CONTENT / columns);
  const size = columns > 7 ? 15 : 18;
  const filled = body.filter(row => row.some(cell => cell !== null && cell !== ''));
  const cell = (value: Cell, column: number, rowIndex: number, kind: 'header' | 'body' | 'total') => new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 50, bottom: 50, left: 70, right: 70 },
    shading: { type: ShadingType.CLEAR, fill: kind === 'header' ? BLUE : kind === 'total' ? TOTAL : rowIndex % 2 === 1 ? ZEBRA : 'FFFFFF' },
    children: [new Paragraph({
      alignment: column >= numericFrom && column <= numericTo ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({
        text: value === null || value === undefined ? '—' : String(value),
        font: 'Calibri',
        size,
        bold: kind !== 'body',
        color: kind === 'header' ? 'FFFFFF' : INK,
      })],
    })],
  });
  const pad = (row: Cell[]) => Array.from({ length: columns }, (_, index) => row[index] ?? null);
  return new Table({
    width: { size: width * columns, type: WidthType.DXA },
    columnWidths: Array.from({ length: columns }, () => width),
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: pad(head ?? []).map((value, column) => cell(value, column, 0, 'header')) }),
      ...filled.map((row, rowIndex) => {
        const label = String(row[0] ?? '');
        const total = label === 'Total' || label.endsWith(' Total') || label.startsWith('Total ');
        return new TableRow({ cantSplit: true, children: pad(row).map((value, column) => cell(value, column, rowIndex, total ? 'total' : 'body')) });
      }),
    ],
  });
}

function displayRow(label: string, values: BucketValues, coverage: BucketCoverage | undefined, mark: boolean): Cell[] {
  const missing = onboardingMissing(coverage, mark);
  return [
    label,
    countCell(values.registrations, missing),
    countCell(values.kycRejected, missing),
    countCell(values.realAccountApproved, missing),
    countCell(values.realAccountActivated, missing),
    countCell(values.manualKycApproved, missing),
    countCell(values.ftd, mark && values.ftd === null),
  ];
}

function overviewTitle(granularity: OnboardingReport['granularity']): string {
  return granularity === 'day' ? 'Daily registration overview' : 'Summary';
}

function totalLabel(preset: PeriodPreset, granularity: OnboardingReport['granularity']): string {
  if (granularity !== 'day') return 'Total';
  if (preset === 'week') return 'Weekly Total';
  if (preset === 'month') return 'Monthly Total';
  if (preset === 'day') return 'Daily Total';
  if (preset === 'year') return 'Yearly Total';
  if (preset === '3m') return '3-month Total';
  return 'Total';
}

function overviewRows(report: OnboardingReport, preset: PeriodPreset): Cell[][] {
  const mark = report.coverage !== null;
  const source = report.granularity === 'day' ? report.daily : report.buckets;
  return [
    ['Period', 'Registrations', 'KYC Rejected', 'Total Real Account', 'Activated', 'Manual Approved', 'FTD'],
    ...source.map(bucket => displayRow(bucket.label, bucket.values, bucket.coverage, mark)),
    displayRow(totalLabel(preset, report.granularity), report.total, report.totalCoverage, mark),
  ];
}

function kpiRows(report: OnboardingReport): Cell[][] {
  const missingOnboarding = report.total.registrations === null;
  const rows: Cell[][] = [['Metric', 'Value', 'Previous', 'Change', 'Detail']];
  for (const kpi of report.kpis) {
    const hidden = kpi.value === null || (kpi.key !== 'ftd' && missingOnboarding);
    rows.push([
      kpi.label,
      hidden ? NO_DATA : integer(kpi.value ?? 0),
      !report.hasPreviousData || kpi.previous === null ? 'No previous data' : integer(kpi.previous),
      !report.hasPreviousData || kpi.change === null ? '—' : integer(kpi.change),
      kpi.note,
    ]);
    for (const part of kpi.parts ?? []) {
      rows.push([`  ${part.label}`, part.value === null ? NO_DATA : integer(part.value), part.previous === null ? '—' : integer(part.previous), '—', '']);
    }
  }
  return rows;
}

function highlights(report: OnboardingReport): string[] {
  const lines: string[] = [];
  if (!report.hasOnboardingData) lines.push('No onboarding entries in this period.');
  if (report.peaks.registrations) lines.push(`Busiest registration day: ${report.peaks.registrations.date} (${integer(report.peaks.registrations.value)}).`);
  if (report.peaks.activations) lines.push(`Most activations: ${report.peaks.activations.date} (${integer(report.peaks.activations.value)}).`);
  if (report.peaks.ftd) lines.push(`Peak FTD day: ${report.peaks.ftd.date} (${integer(report.peaks.ftd.value)}).`);
  if (report.hasPreviousData) {
    for (const kpi of report.kpis) {
      if (kpi.change === null || kpi.value === null) continue;
      lines.push(`${kpi.label} is ${integer(kpi.value)}, ${kpi.change >= 0 ? 'up' : 'down'} ${integer(Math.abs(kpi.change))} versus ${report.previousLabel}.`);
    }
  } else lines.push(`No onboarding data was uploaded for ${report.previousLabel}, so there is no comparison.`);
  if (report.hasFtd) lines.push(`FTD count is ${integer(report.ftd.count)}.`);
  else lines.push('FTD is No data for this period.');
  return lines;
}

function coverageLine(report: OnboardingReport): string {
  if (!report.coverage) return 'Upload coverage was not attached to this report.';
  const onboarding = report.coverage.onboarding.through ? `Onboarding through ${report.coverage.onboarding.through}` : 'Pending: Onboarding';
  const ftd = report.coverage.ftd.through ? `FTD through ${report.coverage.ftd.through}` : 'Pending: FTD';
  return `${onboarding} · ${ftd}`;
}

export function onboardingDocxFileName(report: OnboardingReport, preset: PeriodPreset): string {
  return `onboarding-report-${PRESET_FILE[preset]}-${report.range.from}_${report.range.to}.docx`;
}

export async function buildOnboardingDocx(report: OnboardingReport, preset: PeriodPreset): Promise<Buffer> {
  const title = `${PRESET_TITLE[preset]} Onboarding Report`;
  const children: FileChild[] = [
    heading(title, HeadingLevel.HEADING_1),
    new Paragraph({ spacing: { after: 80 }, children: [
      new TextRun({ text: 'REPORT PERIOD', font: 'Calibri', bold: true, size: 18, color: '1E3A5F' }),
      new TextRun({ text: `  ${report.rangeLabel} · ${report.range.from} – ${report.range.to} (WIB)`, font: 'Calibri', size: 20, color: INK }),
    ] }),
    note(coverageLine(report)),
    heading('Registration and account performance'),
    dataTable(kpiRows(report), 1, 3),
    heading(overviewTitle(report.granularity)),
    note('Total Real Account = Real Account Activated (unique) + Manual Approved Demo Not Done. Period rows count activations; the total row counts unique accounts, so it can be lower than the sum of the rows. Days with no upload are No data, not 0.'),
    dataTable(overviewRows(report, preset)),
    heading('Funnel'),
    dataTable([
      ['Step', 'Value', 'Step %', 'Overall %'],
      ...report.funnel.map(step => [
        step.label,
        step.key === 'ftd' && !report.ftd.cohortAvailable ? NO_DATA : step.value === null ? NO_DATA : integer(step.value),
        step.stepPct === null ? '—' : `${step.stepPct}`,
        step.overallPct === null ? '—' : `${step.overallPct}`,
      ]),
    ]),
    heading('First-time deposits'),
    dataTable(report.hasFtd ? [
      ['FTD count', 'Daily average', 'Amount total', 'Amount average', 'FTD ÷ Total Real Account', 'FTD ÷ Registrations'],
      [
        integer(report.ftd.count),
        report.ftd.dailyAverage === null ? NO_DATA : String(report.ftd.dailyAverage),
        String(report.ftd.amountTotal),
        report.ftd.amountAverage === null ? NO_DATA : String(report.ftd.amountAverage),
        report.ftd.ftdPerApprovedPct === null ? NO_DATA : String(report.ftd.ftdPerApprovedPct),
        report.ftd.ftdPerRegistrationPct === null ? NO_DATA : String(report.ftd.ftdPerRegistrationPct),
      ],
    ] : [['FTD', 'Status'], ['FTD', NO_DATA]]),
    heading('Total Real Account — breakdown'),
    dataTable([
      ['Item', 'Value'],
      ...report.breakdown.map(item => [item.label, integer(item.value)]),
    ]),
    heading('Data quality'),
    dataTable([
      ['Follow-up', 'Rows'],
      ['Approved, bank info / NPWP pending', integer(report.dataQuality.approvedBankInfoPending)],
      ['Pending, video verification failed', integer(report.dataQuality.pendingVideoFailed)],
      ['KYC rejected', onboardingMissing(report.totalCoverage, report.coverage !== null) || report.total.kycRejected === null ? NO_DATA : integer(report.total.kycRejected)],
    ]),
  ];
  if (report.approvers?.length) {
    children.push(
      heading('Approvers'),
      note('Deposit Robot is excluded. Final Approved uses Finished Time (else Create Time). Final Rejected is manual KYC by staff.'),
      dataTable([
        ['Approver', 'Final Approved', 'Steps Approved', 'Final Rejected'],
        ...report.approvers.map(row => [row.approver, integer(row.finalApproved), integer(row.stepsApproved), integer(row.finalRejected)]),
      ]),
    );
  }
  if (report.rejectionReasons) {
    const reasons = report.rejectionReasons;
    children.push(
      heading('KYC rejection reasons'),
      note('Staff counts only Manual + manual_kyc rows with a named approver and a human Remark. Robot keeps auto/system remarks. Rows that are neither Robot nor Staff are omitted, so the reason rows do not have to add up to every rejected row. Unmatched human remarks stay under Other.'),
      dataTable([
        ['Reason', 'Robot', 'Staff', 'Total'],
        ...reasons.reasons.filter(row => row.total > 0).map(row => [row.categoryLabel, integer(row.robot), integer(row.staff), integer(row.total)]),
        ['Total rejected rows', integer(reasons.robotRejected), integer(reasons.staffRejected), integer(reasons.totalRejected)],
      ]),
    );
  }
  children.push(
    heading(report.granularity === 'week' || preset === 'week' ? 'Weekly highlights' : 'Highlights'),
    ...highlights(report).map(text => new Paragraph({
      numbering: { reference: 'onboarding-notes', level: 0 },
      spacing: { after: 60 },
      children: [new TextRun({ text, font: 'Calibri', size: 20, color: MUTED })],
    })),
    heading('Footnotes'),
    note(report.kpis.find(kpi => kpi.key === 'registrations')?.note || 'Registrations count every onboarding entry. A user who is rejected and registers again counts twice.'),
    note(TOTAL_REAL_ACCOUNT_NOTE),
    note('Compared with the previous period of the same length.'),
    ...(report.ftd.cohortAvailable === false ? [note(COHORT_UNAVAILABLE_NOTE)] : []),
  );
  const page = {
    size: { width: A4_WIDTH, height: A4_HEIGHT },
    margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 567, footer: 567 },
  };
  const header = new Header({ children: [new Paragraph({ children: [new TextRun({ text: title, font: 'Calibri', size: 16, color: MUTED })] })] });
  const footer = new Footer({ children: [new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [
      new TextRun({ text: 'Page ', font: 'Calibri', size: 16, color: MUTED }),
      new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 16, color: MUTED }),
      new TextRun({ text: ' of ', font: 'Calibri', size: 16, color: MUTED }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', size: 16, color: MUTED }),
    ],
  })] });
  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', paragraph: { outlineLevel: 0, spacing: { before: 0, after: 160 } }, run: { font: 'Calibri', size: 36, bold: true, color: '1E3A5F' } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', paragraph: { outlineLevel: 1, spacing: { before: 280, after: 120 } }, run: { font: 'Calibri', size: 26, bold: true, color: '1E3A5F' } },
      ],
    },
    numbering: {
      config: [{
        reference: 'onboarding-notes',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 280 } } } }],
      }],
    },
    sections: [{ properties: { page }, headers: { default: header }, footers: { default: footer }, children }],
  });
  return Packer.toBuffer(doc);
}

/** The xlsx total row, used by tests to prove the Word file did not invent a figure. */
export function xlsxTotalRegistrations(report: OnboardingReport): string | number | null {
  const rows = reportTableRows(report);
  const total = rows.find(row => row[0] === 'Total');
  return total?.[3] ?? null;
}
