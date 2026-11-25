/**
 * Excel export in the current CS workbook layout (ExcelJS): one sheet per month,
 * weekly blocks (Date line, Weekly Work List, agent rows per date, recomputed
 * Total row, Notes block, leave legend), then the Report Complaint table with the
 * recomputed summary rows. Leave days are a red/yellow fill on the name cell.
 */
import ExcelJS from 'exceljs';
import { CHANNEL_FIELDS, COUNT_FIELDS, DEFAULT_FOLLOW_UP_MINUTES } from './fields';
import { addDays, weekBounds } from './dates';
import { LEAVE_FILLS } from './leave';
import { complaintKpis } from './metrics';
import type { Complaint, DailyEntry, WeeklyNote } from './types';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FILL_TITLE = 'FF2EA121';
const FILL_HEADER = 'FFA8D08D';
const FILL_TOTAL = 'FFD9EAD3';
const FILL_WHITE = 'FFFFFFFF';

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`;
}

function dayLabel(date: string): string {
  return `${ordinal(Number(date.slice(8, 10)))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]}`;
}

function sheetName(monthKey: string): string {
  return `${MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1]} ${monthKey.slice(0, 4)}`;
}

function toDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** A week belongs to the month of its Thursday (ISO rule), so 31 Aug to 4 Sep is in September. */
function weekMonth(weekStart: string): string {
  return addDays(weekStart, 3).slice(0, 7);
}

function mostCommon(values: number[], fallback: number): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = fallback; let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}

export async function buildCsWorkbook(input: { entries: DailyEntry[]; complaints: Complaint[]; notes: WeeklyNote[] }): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MarketingOS';
  const weeks = new Map<string, DailyEntry[]>();
  for (const entry of input.entries) {
    const start = weekBounds(entry.date).from;
    weeks.set(start, [...(weeks.get(start) ?? []), entry]);
  }
  const months = new Set<string>([...weeks.keys()].map(weekMonth));
  for (const c of input.complaints) months.add(c.date.slice(0, 7));
  if (!months.size) months.add(new Date().toISOString().slice(0, 7));

  for (const month of [...months].sort()) {
    const ws = workbook.addWorksheet(sheetName(month));
    ws.columns = [
      { width: 12 }, { width: 24 }, ...COUNT_FIELDS.map(() => ({ width: 13 })),
    ];
    let r = 1;
    const monthWeeks = [...weeks.entries()].filter(([start]) => weekMonth(start) === month).sort(([a], [b]) => a.localeCompare(b));
    for (const [weekStart, rows] of monthWeeks) {
      const dates = [...new Set(rows.map(row => row.date))].sort();
      ws.getCell(r, 1).value = `Date: ${dayLabel(dates[0])} to ${dayLabel(dates.at(-1)!)}`;
      ws.getCell(r, 1).font = { bold: true };
      r += 1;
      ws.getCell(r, 1).value = 'Weekly Work List';
      ws.getCell(r, 1).fill = fill(FILL_TITLE);
      ws.getCell(r, 1).font = { bold: true, color: { argb: FILL_WHITE } };
      r += 1;
      const minutes = mostCommon(rows.map(row => row.followUpMinutes), DEFAULT_FOLLOW_UP_MINUTES);
      const header = ['Date', 'Name', ...COUNT_FIELDS.map(field => field.key === 'notFollowedUp' ? `Conversations not followed up within ${minutes} minutes` : field.excel)];
      header.forEach((text, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = text; cell.fill = fill(FILL_HEADER); cell.font = { bold: true }; cell.alignment = { wrapText: true, vertical: 'middle' };
      });
      r += 1;
      for (const date of dates) {
        const dayRows = rows.filter(row => row.date === date).sort((a, b) => a.agentName.localeCompare(b.agentName));
        dayRows.forEach((row, index) => {
          if (index === 0) { ws.getCell(r, 1).value = toDate(date); ws.getCell(r, 1).numFmt = 'yyyy-mm-dd'; }
          const name = ws.getCell(r, 2);
          name.value = row.agentName;
          name.fill = fill(row.status === 'present' ? FILL_WHITE : LEAVE_FILLS[row.status]);
          COUNT_FIELDS.forEach((field, i) => { const v = row[field.key]; if (v !== null) ws.getCell(r, i + 3).value = v; });
          r += 1;
        });
        ws.getCell(r, 1).value = 'Total:';
        for (let c = 1; c <= 2 + COUNT_FIELDS.length; c++) ws.getCell(r, c).fill = fill(FILL_TOTAL);
        COUNT_FIELDS.forEach((field, i) => { ws.getCell(r, i + 3).value = dayRows.reduce((sum, row) => sum + (row[field.key] ?? 0), 0); });
        ws.getRow(r).font = { bold: true };
        r += 1;
      }
      r += 1;
      // Notes block: recomputed channel totals plus the questions of the week.
      ws.getCell(r, 1).value = 'Notes:';
      [['Channel', 3], ['Total', 4], ['Most frequently asked questions', 5], ['The most difficult question', 10]].forEach(([text, col]) => {
        const cell = ws.getCell(r, col as number); cell.value = text as string; cell.fill = fill(FILL_HEADER); cell.font = { bold: true };
      });
      r += 1;
      const weekNotes = input.notes.filter(note => note.weekStart >= weekStart && note.weekStart <= addDays(weekStart, 6));
      const daily = (kind: 'frequentQuestion' | 'difficultQuestion') => [...new Set(rows.map(row => row[kind]).filter(Boolean))].join('; ');
      CHANNEL_FIELDS.forEach((field, i) => {
        if (i === 0) { ws.getCell(r, 1).value = 'Red : Sick Leave'; ws.getCell(r, 1).fill = fill(LEAVE_FILLS.sick); }
        if (i === 1) { ws.getCell(r, 1).value = 'Yellow : Annual Leave'; ws.getCell(r, 1).fill = fill(LEAVE_FILLS.annual_leave); }
        const note = weekNotes.find(n => n.channel.toLowerCase() === field.notesChannel.toLowerCase());
        ws.getCell(r, 3).value = field.notesChannel;
        ws.getCell(r, 4).value = rows.reduce((sum, row) => sum + (row[field.key] ?? 0), 0);
        ws.getCell(r, 5).value = note?.frequentQuestion || (i === 0 ? daily('frequentQuestion') : '') || '-';
        ws.getCell(r, 10).value = note?.difficultQuestion || (i === 0 ? daily('difficultQuestion') : '') || '-';
        r += 1;
      });
      r += 1;
    }

    // Report Complaint
    const complaints = input.complaints.filter(c => c.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date));
    ws.getCell(r, 1).value = 'Report Complaint';
    ws.getCell(r, 1).fill = fill(FILL_TITLE);
    ws.getCell(r, 1).font = { bold: true, color: { argb: FILL_WHITE } };
    r += 1;
    const cHeader = ['Date', 'Client Name', 'UID', 'Account', 'Platform', 'Complaint Description', 'Cause Analysis', 'Complaint Resolution Actions', 'Completion Date', 'Status', 'SLA Met', 'Category', 'Agent'];
    cHeader.forEach((text, i) => { const cell = ws.getCell(r, i + 1); cell.value = text; cell.fill = fill(FILL_HEADER); cell.font = { bold: true }; });
    r += 1;
    for (const c of complaints) {
      const values: Array<string | Date> = [toDate(c.date), c.clientName, c.uid, c.account, c.platform, c.description, c.cause, c.resolution, c.completionDate ? toDate(c.completionDate) : '', c.status, c.slaMet === null ? '' : c.slaMet ? 'Yes' : 'No', c.category, c.agentName ?? ''];
      values.forEach((value, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = value;
        if (value instanceof Date) cell.numFmt = 'yyyy-mm-dd';
        cell.alignment = { wrapText: true, vertical: 'top' };
      });
      r += 1;
    }
    r += 1;
    const k = complaintKpis(complaints);
    const summary: Array<[string, number | string]> = [
      ['Total Complaint', k.total], ['Complaint resolved', k.resolved], ['Complaints resolved as per SLA', k.resolvedWithinSla],
      ['Complaint Closed Rate', k.closedRate === null ? '-' : k.closedRate],
    ];
    for (const [label, value] of summary) {
      ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 3).value = value;
      if (label === 'Complaint Closed Rate' && typeof value === 'number') ws.getCell(r, 3).numFmt = '0.00%';
      r += 1;
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
