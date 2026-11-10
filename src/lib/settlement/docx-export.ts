/**
 * Editable Settlement Report .docx. Same figures as the HTML export and the workbook.
 * Native headings and tables only; charts are left out so the file stays text Word can edit.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LevelFormat, Packer,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
  type FileChild,
} from 'docx';
import { PENDING_DEALS_HISTORY } from './deals-report';
import { commissionRows, jisdorSheetRows, marginRows, overviewRows, processingRows, swapRows, withdrawalRows } from './export';
import { formatDurationShort, formatIdr, formatUsd } from './format';
import { settlementHtmlFileName } from './html-export';
import { buildKpis } from './kpis';
import { JISDOR_MONTH_UNAVAILABLE } from './jisdor';
import { formatDuration } from './metrics';
import type { DailyReconciliation } from './reconcile';
import type { SettlementReport } from './report';

type Cell = string | number | null;

const PRESET_TITLE: Record<string, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', custom: 'Custom' };
const MISMATCH_LABELS = [
  ['crm_only', 'CRM only'],
  ['mt5_only', 'MT5 only'],
  ['amount_diff', 'Amount differs'],
  ['account_diff', 'Account differs'],
] as const;
const COVERAGE = [
  ['settlement_crm_deposit', 'CRM Deposit'],
  ['settlement_crm_withdrawal', 'CRM Withdrawal'],
  ['settlement_mt5_dw', 'MT5 D&W'],
  ['settlement_ftd', 'Dealing FTD'],
] as const;

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

function showNumber(value: number): string {
  if (Number.isInteger(value)) return formatIdr(value);
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cellText(value: Cell): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return showNumber(value);
  return value;
}

function periodPill(report: SettlementReport): string {
  return report.period.window ? report.period.window.label : `${report.period.range.from} – ${report.period.range.to} · 12:00–12:00 WIB`;
}

function coverageLine(report: SettlementReport): string {
  const parts = COVERAGE.map(([key, label]) => {
    const through = report.coverage[key];
    return through ? `${label} through ${through}` : `Pending: ${label}`;
  });
  const commission = report.summary.current.commission;
  parts.push(!commission || commission.status !== 'complete' ? PENDING_DEALS_HISTORY : `Deals History through ${commission.lastCoveredDate ?? report.period.range.to}`);
  return parts.join(' · ');
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 0 : 280, after: 120 },
    children: [new TextRun({ text, font: 'Calibri', bold: true, size: level === HeadingLevel.HEADING_1 ? 36 : 26, color: level === HeadingLevel.HEADING_1 ? '1E3A5F' : '1E3A5F' })],
  });
}

function note(text: string): Paragraph {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, font: 'Calibri', size: 20, color: MUTED })] });
}

function dataTable(rows: Cell[][], numericFrom = 1, numericTo = Number.POSITIVE_INFINITY): Table {
  const [head, ...body] = rows;
  const columns = Math.max(head?.length ?? 1, ...body.map(row => row.length));
  const width = Math.floor(CONTENT / columns);
  const wide = columns > 7;
  const size = wide ? 15 : 18;
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
        text: cellText(value),
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
        const total = String(row[0] ?? '') === 'Total' || String(row[0] ?? '').startsWith('Total');
        return new TableRow({ cantSplit: true, children: pad(row).map((value, column) => cell(value, column, rowIndex, total ? 'total' : 'body')) });
      }),
    ],
  });
}

function kpiTable(report: SettlementReport): Table {
  const cards = buildKpis(report.summary);
  const swapPending = !report.coverage.settlement_mt5_dw && report.swap.days.length === 0;
  const rows: Cell[][] = [
    ['Metric', 'Value', 'Detail'],
    ...cards.map(card => {
      const value = card.pending ? PENDING_DEALS_HISTORY : card.kind === 'idr' ? formatIdr(card.value) : card.kind === 'duration' ? formatDurationShort(card.value) : card.value === null ? '—' : `${card.value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
      return [card.label, value, card.note];
    }),
    ['Swap (CRM-S)', swapPending ? 'Pending: MT5 D&W' : formatIdr(report.swap.idrSwap), swapPending ? 'CRM-S is not counted as 0' : `CRM-SR ${formatIdr(report.swap.idrRefund)}`],
  ];
  return dataTable(rows, 1, 1);
}

function dailyRows(report: SettlementReport): Cell[][] {
  const totals = report.summary.current.totals;
  return [
    ['Date', 'Deposits IDR', 'Withdrawals IDR', 'Net IDR', 'Deposit requests', 'Withdrawal requests', 'Office-hour %'],
    ...report.daily.map(day => [day.date, day.depositIdr, day.withdrawalIdr, day.netIdr, day.depositCount, day.withdrawalCount, day.officeHourPct]),
    ['Total', totals.deposit.idr, totals.withdrawal.idr, totals.netIdr, totals.deposit.count, totals.withdrawal.count, totals.withdrawalPct.officeHourPct],
  ];
}

function reconciliationRows(recon: DailyReconciliation | null): Cell[][] | null {
  if (!recon) return null;
  const counts = { crm_only: 0, mt5_only: 0, amount_diff: 0, account_diff: 0 };
  for (const item of recon.mismatches) counts[item.reason] += 1;
  return [
    ['Category', 'Count'],
    ...MISMATCH_LABELS.map(([key, label]) => [label, counts[key]]),
    ['Total', counts.crm_only + counts.mt5_only + counts.amount_diff + counts.account_diff],
  ];
}

function commissionTableRows(report: SettlementReport): Cell[][] {
  const attached = report.dealsHistory !== undefined && report.summary.current.commission !== undefined;
  if (!attached || report.summary.current.commission?.status !== 'complete') {
    const rows: Cell[][] = attached ? commissionRows(report) : [
      ['Date (MT5 server)', 'USD', '10000', '12000', '14000'],
      ['Total', PENDING_DEALS_HISTORY, PENDING_DEALS_HISTORY, PENDING_DEALS_HISTORY, PENDING_DEALS_HISTORY],
      ['Commission IDR (Σ × rate)', PENDING_DEALS_HISTORY],
      ['Commission USD', PENDING_DEALS_HISTORY],
    ];
    return rows.map(row => (row[0] === 'Total' || String(row[0]).startsWith('Commission')
      ? [row[0], ...row.slice(1).map(cell => (typeof cell === 'number' ? PENDING_DEALS_HISTORY : cell))]
      : row));
  }
  return commissionRows(report);
}

function noteLines(report: SettlementReport, recon: DailyReconciliation | null): string[] {
  const totals = report.summary.current.totals;
  const commission = overviewRows(report).find(row => row[0] === 'Commission IDR')?.[1];
  const lines = [
    `Successful deposits are ${formatIdr(totals.deposit.idr)} IDR (${formatUsd(totals.deposit.usd)} USD, ${totals.deposit.count} requests).`,
    `Successful withdrawals are ${formatIdr(totals.withdrawal.idr)} IDR (${totals.withdrawal.count} requests). Net margin in–out is ${formatIdr(totals.netIdr)} IDR.`,
  ];
  if (totals.withdrawalPct.officeHourPct === null) lines.push('Office-hour withdrawal % is Pending: withdrawals.');
  else lines.push(`Office-hour withdrawals are ${totals.withdrawalPct.office} of ${totals.withdrawalPct.total} requests (${totals.withdrawalPct.officeHourPct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%).`);
  lines.push(typeof commission === 'string' ? `Commission is ${commission}.` : `Commission is ${formatIdr(typeof commission === 'number' ? commission : null)} IDR.`);
  if (!recon) lines.push('Reconciliation is Pending: reconciliation.');
  else {
    const count = recon.mismatches.length;
    lines.push(count === 0 ? `Reconciliation on ${recon.date} has no mismatches.` : `Reconciliation on ${recon.date} has ${count} mismatch${count === 1 ? '' : 'es'}.`);
  }
  const jisdor = jisdorSheetRows(report);
  if (jisdor.length <= 2 && jisdor.some(row => row.includes(JISDOR_MONTH_UNAVAILABLE))) lines.push(JISDOR_MONTH_UNAVAILABLE);
  else if (jisdor[2]) lines.push(`Latest JISDOR fixing in ${report.period.anchor.slice(0, 7)} is ${jisdor[2][0]} at ${formatUsd(typeof jisdor[2][1] === 'number' ? jisdor[2][1] : null)} IDR per USD.`);
  const depositAvg = report.summary.current.processing.deposit;
  lines.push(`Average office-hour deposit processing is ${depositAvg === null ? '—' : formatDuration(depositAvg)}.`);
  return lines;
}

export function settlementDocxFileName(report: SettlementReport): string {
  return settlementHtmlFileName(report).replace(/\.html$/, '.docx');
}

export async function buildSettlementDocx(report: SettlementReport, options: { reconciliation?: DailyReconciliation | null } = {}): Promise<Buffer> {
  const title = `${PRESET_TITLE[report.period.preset] ?? 'Settlement'} Settlement Report`;
  const recon = options.reconciliation ?? null;
  const processing = processingRows(report);
  const splitAt = processing.findIndex((row, index) => index > 0 && row[0] === 'Withdrawal');
  const depositRows = (splitAt > 0 ? processing.slice(0, splitAt) : processing).filter(row => row.length > 1 && !String(row[0] ?? '').startsWith('Summary'));
  const withdrawalPart = splitAt > 0 ? processing.slice(splitAt).filter(row => row.length > 1 && !String(row[0] ?? '').startsWith('Summary')) : [];
  const summary = processing.find(row => String(row[0] ?? '').startsWith('Summary'));
  const children: FileChild[] = [
    heading(title, HeadingLevel.HEADING_1),
    new Paragraph({ spacing: { after: 80 }, children: [
      new TextRun({ text: 'REPORT PERIOD', font: 'Calibri', bold: true, size: 18, color: '1E3A5F' }),
      new TextRun({ text: `  ${periodPill(report)}`, font: 'Calibri', size: 20, color: INK }),
    ] }),
    note(coverageLine(report)),
    heading('KPI summary'),
    kpiTable(report),
  ];
  if (report.period.preset !== 'day') {
    children.push(heading('Daily breakdown'), dataTable(dailyRows(report)));
  }
  const reconRows = reconciliationRows(recon);
  children.push(heading('01 CRM vs MT5'));
  if (recon && reconRows) children.push(note(recon.window.label), dataTable(reconRows));
  else children.push(note('Pending: reconciliation'));
  children.push(heading('02 Processing time'), dataTable(depositRows));
  if (withdrawalPart.length) children.push(dataTable(withdrawalPart));
  if (summary) children.push(note(summary.map(cell => cellText(cell)).join(' · ')));
  children.push(
    heading('Withdrawal %'),
    dataTable(withdrawalRows(report)),
    heading('Margin in–out'),
    dataTable(marginRows(report).filter(row => row.length > 1)),
    heading('03 Commission and swap'),
    note(report.swapLabel),
    new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun({ text: 'Commission', font: 'Calibri', bold: true, size: 22, color: '334155' })] }),
    dataTable(commissionTableRows(report)),
    new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: 'Swap', font: 'Calibri', bold: true, size: 22, color: '334155' })] }),
    dataTable(swapRows(report).filter(row => row.length > 1)),
    heading('JISDOR'),
    ...(() => {
      const rows = jisdorSheetRows(report);
      if (rows[1]?.[0] === 'Date') return [note(String(rows[0]?.[1] ?? '')), dataTable(rows.slice(1))];
      return [dataTable(rows)];
    })(),
    heading('Notes'),
    ...noteLines(report, recon).map(text => new Paragraph({
      numbering: { reference: 'settlement-notes', level: 0 },
      spacing: { after: 60 },
      children: [new TextRun({ text, font: 'Calibri', size: 20, color: MUTED })],
    })),
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
        reference: 'settlement-notes',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 280 } } } }],
      }],
    },
    sections: [{ properties: { page }, headers: { default: header }, footers: { default: footer }, children }],
  });
  return Packer.toBuffer(doc);
}
