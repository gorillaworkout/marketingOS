/**
 * Editable CS Report .docx. Same design as the Settlement and Onboarding Word exports
 * (A4, Calibri, navy headings, blue table headers, zebra rows, header title, "Page X of Y").
 * Every figure comes from buildCsDashboard, the same aggregation the CS Report page uses;
 * the weekly rows are buildCsDashboard run on each week of the period.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LevelFormat, Packer,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
  type FileChild,
} from 'docx';
import { addDays, weekBounds, type PeriodKind } from './dates';
import { CATEGORY_FIELDS, CHANNEL_FIELDS, STATUS_LABELS } from './fields';
import { buildCsDashboard, complaintKpis, isResolvedStatus, type CsDashboard } from './metrics';
import type { Complaint, DailyEntry } from './types';

type Cell = string | number | null;

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const PRESET_TITLE: Record<PeriodKind, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', custom: 'Custom' };
const PRESET_FILE: Record<PeriodKind, string> = { day: 'daily', week: 'weekly', month: 'monthly', custom: 'custom' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const A4_WIDTH = 11906;
const A4_HEIGHT = 16838;
const MARGIN = 1134;
const CONTENT = A4_WIDTH - MARGIN * 2;
const BLUE = '1D4ED8';
const NAVY = '1E3A5F';
const INK = '1C2430';
const MUTED = '5C6B7A';
const ZEBRA = 'F4F7FB';
const TOTAL = 'E8EEF8';
const thin = { style: BorderStyle.SINGLE, size: 4, color: 'E7EDF3' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };

const integer = (value: number) => Math.round(value).toLocaleString('en-US');
const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

function longDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

function shortDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

export function csPeriodLabel(from: string, to: string): string {
  return from === to ? longDate(from) : `${longDate(from)} – ${longDate(to)}`;
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 0 : 280, after: 120 },
    children: [new TextRun({ text, font: 'Calibri', bold: true, size: level === HeadingLevel.HEADING_1 ? 36 : 26, color: NAVY })],
  });
}

function subheading(text: string): Paragraph {
  return new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text, font: 'Calibri', bold: true, size: 22, color: '334155' })] });
}

function note(text: string): Paragraph {
  return new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun({ text, font: 'Calibri', size: 20, color: MUTED })] });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: 'cs-notes', level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: 'Calibri', size: 20, color: MUTED })],
  });
}

/**
 * The Settlement/Onboarding table: blue header row, zebra body, bold Total rows.
 * `weights` sets relative column widths (equal by default) for text-heavy tables.
 */
function dataTable(rows: Cell[][], options: { numericFrom?: number; numericTo?: number; weights?: number[] } = {}): Table {
  const { numericFrom = 1, numericTo = Number.POSITIVE_INFINITY } = options;
  const [head, ...body] = rows;
  const columns = Math.max(head?.length ?? 1, ...body.map(row => row.length), 1);
  const weights = options.weights && options.weights.length === columns ? options.weights : Array.from({ length: columns }, () => 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map(w => Math.floor((CONTENT * w) / sum));
  const size = columns > 7 ? 15 : 18;
  const cell = (value: Cell, column: number, rowIndex: number, kind: 'header' | 'body' | 'total') => new TableCell({
    width: { size: widths[column], type: WidthType.DXA },
    borders,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 50, bottom: 50, left: 70, right: 70 },
    shading: { type: ShadingType.CLEAR, fill: kind === 'header' ? BLUE : kind === 'total' ? TOTAL : rowIndex % 2 === 1 ? ZEBRA : 'FFFFFF' },
    children: [new Paragraph({
      alignment: column >= numericFrom && column <= numericTo ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({
        text: value === null || value === undefined || value === '' ? '—' : typeof value === 'number' ? integer(value) : value,
        font: 'Calibri',
        size,
        bold: kind !== 'body',
        color: kind === 'header' ? 'FFFFFF' : INK,
      })],
    })],
  });
  const pad = (row: Cell[]) => Array.from({ length: columns }, (_, index) => row[index] ?? null);
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: pad(head ?? []).map((value, column) => cell(value, column, 0, 'header')) }),
      ...body.map((row, rowIndex) => {
        const label = String(row[0] ?? '');
        const total = label === 'Total';
        return new TableRow({ cantSplit: true, children: pad(row).map((value, column) => cell(value, column, rowIndex, total ? 'total' : 'body')) });
      }),
    ],
  });
}

export interface CsDocxOptions {
  kind: PeriodKind;
  /** Display name of the agent filter; null = All agents. */
  agentName: string | null;
  /** Shown in the coverage line, e.g. "2026-11-26 14:35 WIB". */
  generatedAt?: string;
}

export function csDocxFileName(dashboard: Pick<CsDashboard, 'from' | 'to'>, options: Pick<CsDocxOptions, 'kind' | 'agentName'>): string {
  const agent = options.agentName ? `-${options.agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
  return `cs-report-${PRESET_FILE[options.kind]}-${dashboard.from}_${dashboard.to}${agent}.docx`;
}

function allEntries(dashboard: CsDashboard): DailyEntry[] {
  return dashboard.recap.flatMap(day => day.rows);
}

function kpiRows(dashboard: CsDashboard): Cell[][] {
  const k = dashboard.kpis;
  const c = k.complaints;
  const minutes = k.followUpMinutes.length ? `within ${k.followUpMinutes.join(' / ')} minutes` : 'No follow-up data';
  return [
    ['Metric', 'Value', 'Detail'],
    ['Total conversations', integer(k.conversations), `${integer(k.entries)} agent-days, ${k.sickDays} sick, ${k.annualLeaveDays} annual leave`],
    ['Not followed up', integer(k.notFollowedUp), minutes],
    ['Unsolved issues', integer(k.unsolvedIssues), `${integer(k.unsolvedCompleted)} completed`],
    ['Complaints', integer(c.total), `${integer(c.open)} open`],
    ['Complaints resolved', integer(c.resolved), 'Status Solved / Resolved / Closed / Done / Completed'],
    ['Resolved within SLA', integer(c.resolvedWithinSla), c.slaUnknown ? `${c.slaUnknown} without an SLA flag counted as met` : 'Resolved and SLA met'],
    ['Closed rate', percent(c.closedRate), 'resolved / total'],
    ['SLA met rate', percent(c.resolved ? c.resolvedWithinSla / c.resolved : null), 'resolved within SLA / resolved'],
  ];
}

function attendanceRows(dashboard: CsDashboard): Cell[][] {
  const present = dashboard.agents.reduce((sum, a) => sum + a.present, 0);
  return [
    ['Status', 'Agent-days', 'Share'],
    [STATUS_LABELS.present, present, percent(dashboard.kpis.entries ? present / dashboard.kpis.entries : null)],
    [STATUS_LABELS.sick, dashboard.kpis.sickDays, percent(dashboard.kpis.entries ? dashboard.kpis.sickDays / dashboard.kpis.entries : null)],
    [STATUS_LABELS.annual_leave, dashboard.kpis.annualLeaveDays, percent(dashboard.kpis.entries ? dashboard.kpis.annualLeaveDays / dashboard.kpis.entries : null)],
    ['Total', dashboard.kpis.entries, dashboard.kpis.entries ? '100.0%' : '—'],
  ];
}

function channelRows(dashboard: CsDashboard): Cell[][] {
  const total = dashboard.kpis.conversations;
  return [
    ['Channel', 'Conversations', 'Share'],
    ...CHANNEL_FIELDS.map(f => [f.label, dashboard.kpis.channels[f.key], percent(total ? dashboard.kpis.channels[f.key] / total : null)]),
    ['Total', total, total ? '100.0%' : '—'],
  ];
}

function categoryRows(dashboard: CsDashboard): Cell[][] {
  const total = CATEGORY_FIELDS.reduce((sum, f) => sum + dashboard.kpis.categories[f.key], 0);
  return [
    ['Category', 'Count', 'Share'],
    ...CATEGORY_FIELDS.map(f => [f.label, dashboard.kpis.categories[f.key], percent(total ? dashboard.kpis.categories[f.key] / total : null)]),
    ['Total', total, total ? '100.0%' : '—'],
  ];
}

function agentRows(dashboard: CsDashboard): Cell[][] {
  const a = dashboard.agents;
  const sum = (pick: (row: CsDashboard['agents'][number]) => number) => a.reduce((s, row) => s + pick(row), 0);
  return [
    ['Agent', 'Present', 'Sick', 'Leave', 'Conversations', 'Unsolved', 'Not followed up', 'Complaints'],
    ...a.map(row => [row.agentName, row.present, row.sick, row.annualLeave, row.conversations, row.unsolvedIssues, row.notFollowedUp, row.complaints]),
    ...(a.length > 1 ? [['Total', sum(r => r.present), sum(r => r.sick), sum(r => r.annualLeave), sum(r => r.conversations), sum(r => r.unsolvedIssues), sum(r => r.notFollowedUp), sum(r => r.complaints)]] : []),
  ];
}

function agentChannelRows(dashboard: CsDashboard): Cell[][] {
  return [
    ['Agent', ...CHANNEL_FIELDS.map(f => f.short), 'Total'],
    ...dashboard.agents.map(row => [row.agentName, ...CHANNEL_FIELDS.map(f => row.channels[f.key]), row.conversations]),
  ];
}

/** One buildCsDashboard per Monday–Sunday week, clipped to the period. */
export function weeklyBreakdown(dashboard: CsDashboard): CsDashboard[] {
  const entries = allEntries(dashboard);
  const weeks: CsDashboard[] = [];
  for (let start = weekBounds(dashboard.from).from; start <= dashboard.to; start = addDays(start, 7)) {
    const from = start < dashboard.from ? dashboard.from : start;
    const end = addDays(start, 6);
    const to = end > dashboard.to ? dashboard.to : end;
    weeks.push(buildCsDashboard({ from, to, entries, complaints: dashboard.complaints, notes: [] }));
  }
  return weeks;
}

function weeklyRows(dashboard: CsDashboard): Cell[][] {
  const weeks = weeklyBreakdown(dashboard);
  return [
    ['Week', 'Agent-days', 'Sick / leave', 'Conversations', 'Unsolved', 'Not followed up', 'Complaints', 'Closed rate'],
    ...weeks.map(w => [
      w.from === w.to ? shortDate(w.from) : `${shortDate(w.from)} – ${shortDate(w.to)}`,
      w.kpis.entries, `${w.kpis.sickDays} / ${w.kpis.annualLeaveDays}`, w.kpis.conversations, w.kpis.unsolvedIssues, w.kpis.notFollowedUp,
      w.kpis.complaints.total, percent(w.kpis.complaints.closedRate),
    ]),
    ['Total', dashboard.kpis.entries, `${dashboard.kpis.sickDays} / ${dashboard.kpis.annualLeaveDays}`, dashboard.kpis.conversations, dashboard.kpis.unsolvedIssues,
      dashboard.kpis.notFollowedUp, dashboard.kpis.complaints.total, percent(dashboard.kpis.complaints.closedRate)],
  ];
}

function dailyRows(dashboard: CsDashboard): Cell[][] {
  return [
    ['Date', ...CHANNEL_FIELDS.map(f => f.short), 'Conversations', 'Not followed up', 'Present', 'On leave'],
    ...dashboard.trend.filter(d => d.agentsPresent + d.agentsOnLeave > 0).map(d => [
      d.date, ...CHANNEL_FIELDS.map(f => d.channels[f.key]), d.conversations, d.notFollowedUp, d.agentsPresent, d.agentsOnLeave,
    ]),
  ];
}

/** Complaints grouped by a field, with the same resolved / SLA rule as the page (complaintKpis). */
export function complaintGroupRows(complaints: Complaint[], label: string, pick: (c: Complaint) => string): Cell[][] {
  const groups = new Map<string, Complaint[]>();
  for (const c of complaints) {
    const key = pick(c).trim() || 'Not set';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const rows: Cell[][] = [[label, 'Cases', 'Resolved', 'Within SLA', 'Open', 'Closed rate']];
  for (const [key, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    const k = complaintKpis(list);
    rows.push([key, k.total, k.resolved, k.resolvedWithinSla, k.open, percent(k.closedRate)]);
  }
  if (groups.size > 1) {
    const k = complaintKpis(complaints);
    rows.push(['Total', k.total, k.resolved, k.resolvedWithinSla, k.open, percent(k.closedRate)]);
  }
  return rows;
}

function complaintCaseRows(complaints: Complaint[]): Cell[][] {
  return [
    ['Date', 'Client', 'UID', 'Category', 'Description', 'Status', 'SLA', 'Completed', 'Agent'],
    ...[...complaints].sort((a, b) => a.date.localeCompare(b.date)).map(c => [
      c.date, c.clientName, c.uid, c.category, c.description, c.status, c.slaMet === null ? '' : c.slaMet ? 'Yes' : 'No', c.completionDate ?? '', c.agentName ?? '',
    ]),
  ];
}

function highlights(dashboard: CsDashboard): string[] {
  const k = dashboard.kpis;
  const lines: string[] = [];
  if (!k.entries && !k.complaints.total) return ['No CS data in this period.'];
  const busiest = [...dashboard.trend].sort((a, b) => b.conversations - a.conversations)[0];
  if (busiest && busiest.conversations > 0) lines.push(`Busiest day: ${longDate(busiest.date)} with ${integer(busiest.conversations)} conversations.`);
  const topChannel = [...CHANNEL_FIELDS].sort((a, b) => k.channels[b.key] - k.channels[a.key])[0];
  if (k.conversations > 0) lines.push(`${topChannel.label} is the top channel: ${integer(k.channels[topChannel.key])} of ${integer(k.conversations)} conversations (${percent(k.channels[topChannel.key] / k.conversations)}).`);
  const topCategory = [...CATEGORY_FIELDS].sort((a, b) => k.categories[b.key] - k.categories[a.key])[0];
  if (k.categories[topCategory.key] > 0) lines.push(`Most common category: ${topCategory.label} (${integer(k.categories[topCategory.key])}).`);
  if (k.entries) lines.push(`${integer(k.entries)} agent-days recorded: ${k.sickDays} sick and ${k.annualLeaveDays} annual leave.`);
  lines.push(k.followUpMinutes.length
    ? `${integer(k.notFollowedUp)} conversations were not followed up within ${k.followUpMinutes.join(' / ')} minutes.`
    : 'No follow-up figures were recorded.');
  const c = k.complaints;
  lines.push(c.total
    ? `${integer(c.total)} complaints: ${integer(c.resolved)} resolved (${percent(c.closedRate)}), ${integer(c.resolvedWithinSla)} within SLA, ${integer(c.open)} open.`
    : 'No complaints in this period.');
  return lines;
}

function questionRows(dashboard: CsDashboard, kind: 'frequent' | 'difficult'): Cell[][] | null {
  const items = dashboard.questions.filter(q => q.kind === kind);
  if (!items.length) return null;
  return [
    ['Date', 'Agent / channel', 'Question'],
    ...items.map(q => [q.dateTo ? `${shortDate(q.date)} – ${shortDate(q.dateTo)}` : q.date, q.who, q.text]),
  ];
}

function unsolvedRows(dashboard: CsDashboard): Cell[][] | null {
  const rows = allEntries(dashboard).filter(e => e.unsolvedUids.trim()).sort((a, b) => a.date.localeCompare(b.date) || a.agentName.localeCompare(b.agentName));
  if (!rows.length) return null;
  return [['Date', 'Agent', 'Unsolved', 'Customer UIDs'], ...rows.map(e => [e.date, e.agentName, e.unsolvedIssues ?? 0, e.unsolvedUids.trim()])];
}

export async function buildCsDocx(dashboard: CsDashboard, options: CsDocxOptions): Promise<Buffer> {
  const title = `${PRESET_TITLE[options.kind]} CS Report`;
  const k = dashboard.kpis;
  const scope = options.agentName ? `Agent: ${options.agentName}` : 'All agents';
  const children: FileChild[] = [
    heading(title, HeadingLevel.HEADING_1),
    new Paragraph({ spacing: { after: 80 }, children: [
      new TextRun({ text: 'REPORT PERIOD', font: 'Calibri', bold: true, size: 18, color: NAVY }),
      new TextRun({ text: `  ${csPeriodLabel(dashboard.from, dashboard.to)} · ${dashboard.from} – ${dashboard.to} (WIB)`, font: 'Calibri', size: 20, color: INK }),
    ] }),
    new Paragraph({ spacing: { after: 80 }, children: [
      new TextRun({ text: 'SCOPE', font: 'Calibri', bold: true, size: 18, color: NAVY }),
      new TextRun({ text: `  Customer Service · ${scope}`, font: 'Calibri', size: 20, color: INK }),
    ] }),
    note(`${integer(k.entries)} daily entries · ${integer(k.complaints.total)} complaint cases${options.generatedAt ? ` · Generated ${options.generatedAt}` : ''}`),
    heading('KPI summary'),
    dataTable(kpiRows(dashboard), { numericFrom: 1, numericTo: 1, weights: [3, 2, 5] }),
    heading('Highlights'),
    ...highlights(dashboard).map(bullet),
    heading('Attendance'),
    dataTable(attendanceRows(dashboard)),
    heading('Channels'),
    dataTable(channelRows(dashboard)),
    heading('Inquiry categories'),
    dataTable(categoryRows(dashboard)),
    heading('Per agent'),
  ];
  if (dashboard.agents.length) {
    children.push(
      dataTable(agentRows(dashboard), { weights: [3, 1.3, 1.1, 1.1, 1.8, 1.4, 1.8, 1.6] }),
      subheading('Conversations by channel'),
      dataTable(agentChannelRows(dashboard), { weights: [3, 1.2, 1.2, 1.6, 1.6, 1.2, 1.4] }),
    );
  } else children.push(note('No daily entries in this period.'));

  if (options.kind !== 'day') {
    children.push(heading('Weekly breakdown'), note('Monday–Sunday weeks, clipped to the report period.'),
      dataTable(weeklyRows(dashboard), { weights: [2.4, 1.3, 1.3, 1.6, 1.2, 1.6, 1.4, 1.4] }));
    const daily = dailyRows(dashboard);
    if (daily.length > 1) children.push(heading('Daily breakdown'), dataTable(daily, { weights: [1.8, 1, 1, 1.3, 1.3, 1, 1.5, 1.4, 1.1, 1.1] }));
  }

  const complaints = dashboard.complaints;
  children.push(heading('Complaints'));
  if (!complaints.length) children.push(note('No complaints in this period.'));
  else {
    const c = k.complaints;
    children.push(
      dataTable([
        ['Total', 'Resolved', 'Within SLA', 'Open', 'Closed rate', 'SLA met rate'],
        [c.total, c.resolved, c.resolvedWithinSla, c.open, percent(c.closedRate), percent(c.resolved ? c.resolvedWithinSla / c.resolved : null)],
      ], { numericFrom: 0 }),
      ...(c.slaUnknown ? [note(`${c.slaUnknown} resolved case${c.slaUnknown === 1 ? ' has' : 's have'} no SLA flag and count${c.slaUnknown === 1 ? 's' : ''} as met.`)] : []),
      subheading('By category'),
      dataTable(complaintGroupRows(complaints, 'Category', x => x.category), { weights: [3, 1, 1, 1.2, 1, 1.2] }),
      subheading('By urgency'),
      dataTable(complaintGroupRows(complaints, 'Urgency', x => x.urgency), { weights: [3, 1, 1, 1.2, 1, 1.2] }),
      subheading('By status'),
      dataTable(complaintGroupRows(complaints, 'Status', x => x.status), { weights: [3, 1, 1, 1.2, 1, 1.2] }),
      subheading('Complaint cases'),
      dataTable(complaintCaseRows(complaints), { numericFrom: 99, weights: [1.5, 1.5, 1.6, 1.6, 3.3, 1.3, 0.8, 1.5, 1.4] }),
    );
    const open = complaints.filter(x => !isResolvedStatus(x.status));
    if (open.length) children.push(note(`Open cases: ${open.length}. Follow up on ${open.slice(0, 5).map(x => `${x.clientName || x.uid || 'unnamed'} (${x.date})`).join(', ')}${open.length > 5 ? ', …' : ''}.`));
  }

  children.push(heading('Notes'));
  const frequent = questionRows(dashboard, 'frequent');
  const difficult = questionRows(dashboard, 'difficult');
  const unsolved = unsolvedRows(dashboard);
  if (!frequent && !difficult && !unsolved) children.push(note('No questions or unsolved UIDs were recorded in this period.'));
  if (frequent) children.push(subheading('Most frequently asked questions'), dataTable(frequent, { numericFrom: 99, weights: [1.6, 1.8, 6] }));
  if (difficult) children.push(subheading('Most difficult questions'), dataTable(difficult, { numericFrom: 99, weights: [1.6, 1.8, 6] }));
  if (unsolved) children.push(subheading('Unsolved issues and customer UIDs'), dataTable(unsolved, { numericFrom: 2, numericTo: 2, weights: [1.5, 2, 1.2, 5] }));

  children.push(
    heading('Footnotes'),
    note('Empty counts in a daily entry are summed as 0. Sick and annual leave days come from the attendance status of each daily entry.'),
    note('Resolved = status Solved, Resolved, Closed, Done or Completed. Resolved within SLA = resolved and the SLA flag is not No; resolved cases without an SLA flag count as met.'),
    note('Figures match the CS Report dashboard for the same period and agent filter.'),
  );

  const page = {
    size: { width: A4_WIDTH, height: A4_HEIGHT },
    margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 567, footer: 567 },
  };
  const header = new Header({ children: [new Paragraph({ children: [new TextRun({ text: `${title} · ${csPeriodLabel(dashboard.from, dashboard.to)}`, font: 'Calibri', size: 16, color: MUTED })] })] });
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
    creator: 'MarketingOS',
    title,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', paragraph: { outlineLevel: 0, spacing: { before: 0, after: 160 } }, run: { font: 'Calibri', size: 36, bold: true, color: NAVY } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', paragraph: { outlineLevel: 1, spacing: { before: 280, after: 120 } }, run: { font: 'Calibri', size: 26, bold: true, color: NAVY } },
      ],
    },
    numbering: {
      config: [{
        reference: 'cs-notes',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 280 } } } }],
      }],
    },
    sections: [{ properties: { page }, headers: { default: header }, footers: { default: footer }, children }],
  });
  return Packer.toBuffer(doc);
}
