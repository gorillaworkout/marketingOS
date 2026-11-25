/**
 * Parser for the current CS workbook (one sheet per month, weekly blocks).
 * See docs/superpowers/specs/2026-11-24-cs-report-design.md for the layout.
 * Pure: takes the file bytes, returns rows, per-sheet counts and warnings.
 * Total rows and the complaint summary rows are ignored (recomputed later).
 */
import ExcelJS from 'exceljs';
import { COUNT_FIELDS, DEFAULT_FOLLOW_UP_MINUTES, type CountKey, type CsStatus } from './fields';
import { addDays, dateToIso, daysBetween, isIsoDate, weekdayIndex } from './dates';

const daysIn = (range: { from: string; to: string }) => daysBetween(range.from, range.to);
import { statusFromFill } from './leave';
import { complaintDedupeKey, normalizeText } from './dedupe';
import type { ComplaintInput, Counts, WeeklyNote } from './types';

export interface ParsedEntry extends Counts {
  sheet: string;
  row: number;
  date: string;
  name: string;
  status: CsStatus;
  followUpMinutes: number;
}

export interface ParsedComplaint extends ComplaintInput {
  sheet: string;
  row: number;
  dedupeKey: string;
}

export interface SheetSummary {
  sheet: string;
  weeks: number;
  agentDays: number;
  presentDays: number;
  sickDays: number;
  annualLeaveDays: number;
  complaints: number;
  notes: number;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface ParsedWorkbook {
  sheets: SheetSummary[];
  entries: ParsedEntry[];
  complaints: ParsedComplaint[];
  notes: WeeklyNote[];
  names: string[];
  warnings: string[];
  dateFrom: string | null;
  dateTo: string | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthIndex(word: string | undefined): number {
  if (!word) return -1;
  return MONTHS.indexOf(word.trim().slice(0, 3).toLowerCase());
}

type Raw = string | number | boolean | Date | null;

/** Plain value of an ExcelJS cell: rich text joined, formula result, hyperlink text. */
export function plainValue(value: ExcelJS.CellValue): Raw {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) return (v.richText as Array<{ text: string }>).map(part => part.text).join('');
    if ('result' in v) return plainValue(v.result as ExcelJS.CellValue);
    if ('formula' in v || 'sharedFormula' in v) return null;
    if (typeof v.text === 'string') return v.text;
    if ('error' in v) return null;
  }
  return null;
}

function asText(value: Raw): string {
  if (value === null) return '';
  if (value instanceof Date) return dateToIso(value);
  return String(value).trim();
}

function asCount(value: Raw): number | null | 'invalid' {
  if (value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : 'invalid';
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '' || t === '-') return null;
    const n = Number(t.replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 'invalid';
  }
  return 'invalid';
}

/** Date cell → YYYY-MM-DD. Accepts JS Dates, Excel serials, ISO and D/M/YYYY strings. */
export function asDate(value: Raw): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : dateToIso(value);
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return dateToIso(new Date(Math.round((value - 25569) * 86400_000)));
  }
  if (typeof value === 'string') {
    const t = value.trim();
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso && isIsoDate(`${iso[1]}-${iso[2]}-${iso[3]}`)) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmy) {
      const out = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
      return isIsoDate(out) ? out : null;
    }
  }
  return null;
}

/** Sheet title "Dec 2025" → { year: 2025, month: 11 }. */
export function sheetMonth(title: string): { year: number; month: number } | null {
  const m = title.match(/([A-Za-z]{3,})\s*(\d{4})/);
  if (!m) return null;
  const month = monthIndex(m[1]);
  return month < 0 ? null : { year: Number(m[2]), month };
}

function yearFor(month: number, sheet: { year: number; month: number } | null): number {
  if (!sheet) return new Date().getUTCFullYear();
  if (month - sheet.month > 6) return sheet.year - 1;
  if (sheet.month - month > 6) return sheet.year + 1;
  return sheet.year;
}

function iso(year: number, month: number, day: number): string | null {
  const out = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isIsoDate(out) ? out : null;
}

/** "Date: 1th Dec to 5th Dec" / "29th June to 3th July" → { from, to } using the sheet's year. */
export function parseBlockRange(text: string, sheet: { year: number; month: number } | null): { from: string; to: string } | null {
  const m = text.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*([A-Za-z]+)?\s*(?:to|-|–|s\.?d\.?)\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s*([A-Za-z]+)/i);
  if (!m) return null;
  const toMonth = monthIndex(m[4]);
  const fromMonth = monthIndex(m[2]) >= 0 ? monthIndex(m[2]) : toMonth;
  if (toMonth < 0 || fromMonth < 0) return null;
  let from = iso(yearFor(fromMonth, sheet), fromMonth, Number(m[1]));
  const to = iso(yearFor(toMonth, sheet), toMonth, Number(m[3]));
  if (!from || !to) return null;
  if (from > to) from = iso(Number(to.slice(0, 4)) - (fromMonth > toMonth ? 1 : 0), fromMonth, Number(m[1]));
  return from && from <= to ? { from, to } : null;
}

function headerKey(text: string): string {
  return normalizeText(text).replace(/[^a-z0-9]+/g, '');
}

const COUNT_HEADER_KEYS = COUNT_FIELDS.map(field => ({ key: field.key, header: headerKey(field.excel) }));

const COMPLAINT_HEADERS: Record<string, keyof ComplaintInput> = {
  date: 'date',
  clientname: 'clientName',
  uid: 'uid',
  account: 'account',
  platform: 'platform',
  complaintdescription: 'description',
  urgencylevel: 'urgency',
  causeanalysis: 'cause',
  complaintresolutionactions: 'resolution',
  completiondate: 'completionDate',
  status: 'status',
  category: 'category',
  slamet: 'slaMet',
};

/** Tidies the free-text statuses of the old files ("Solved ", "on Progress"). */
export function normalizeComplaintStatus(value: string): string {
  const t = value.replace(/\s+/g, ' ').trim();
  const key = t.toLowerCase();
  if (key === 'solved') return 'Solved';
  if (key === 'on progress' || key === 'in progress') return 'On Progress';
  if (key === 'on hold') return 'On Hold';
  return t;
}

export function parseYesNo(value: string): boolean | null {
  const t = value.trim().toLowerCase();
  if (['yes', 'y', 'ya', 'true', 'met'].includes(t)) return true;
  if (['no', 'n', 'tidak', 'false', 'not met'].includes(t)) return false;
  return null;
}

export function normalizePlatform(value: string): string {
  const t = value.trim();
  if (t.toLowerCase() === 'mt5') return 'MT5';
  if (t.toLowerCase() === 'apps' || t.toLowerCase() === 'app') return 'Apps';
  return t;
}

function rowValues(row: ExcelJS.Row, maxCol: number): Raw[] {
  const out: Raw[] = [null];
  for (let c = 1; c <= maxCol; c++) {
    const cell = row.getCell(c);
    // A merged range repeats its master value in every cell. Only column A (the
    // date, merged over the agent rows) may use it; elsewhere a merged slave is
    // empty, so a merged "CHRISTMAS HOLIDAY" row is not read as an agent.
    const slave = cell.isMerged && cell.master && cell.master.address !== cell.address;
    out.push(slave && c !== 1 ? null : plainValue(cell.value));
  }
  return out;
}

function fillArgb(cell: ExcelJS.Cell): string | null {
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (!fill || fill.type !== 'pattern' || fill.pattern === 'none') return null;
  return fill.fgColor?.argb ?? null;
}

type Mode = 'none' | 'worklist' | 'notes' | 'complaint-title' | 'complaint' | 'done';

export async function parseCsWorkbook(buffer: Buffer | ArrayBuffer | Uint8Array): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  const bytes = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : Buffer.from(buffer as Uint8Array);
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const result: ParsedWorkbook = { sheets: [], entries: [], complaints: [], notes: [], names: [], warnings: [], dateFrom: null, dateTo: null };
  const names = new Map<string, string>();
  const seenComplaints = new Set<string>();
  const seenNotes = new Set<string>();

  // agent|date -> sheet and value signature of the first row stored, to skip
  // weeks that appear in two monthly sheets (e.g. 29 Jun to 3 Jul).
  const firstSeen = new Map<string, { sheet: string; signature: string }>();

  for (const ws of workbook.worksheets) {
    const sheet = ws.name;
    const month = sheetMonth(sheet);
    const maxCol = Math.max(ws.columnCount, 16);
    const summary: SheetSummary = { sheet, weeks: 0, agentDays: 0, presentDays: 0, sickDays: 0, annualLeaveDays: 0, complaints: 0, notes: 0, dateFrom: null, dateTo: null };
    let mode: Mode = 'none';
    let blockLabel = '';
    let block: { from: string; to: string } | null = null;
    let pending: ParsedEntry[] = [];
    let blockRange: { from: string; to: string } | null = null;
    const usedDates = new Set<string>();
    let overlapSame = 0;
    let overlapDiff = 0;
    let countCols: Partial<Record<CountKey, number>> = {};
    let minutes = DEFAULT_FOLLOW_UP_MINUTES;
    let currentDate: string | null = null;
    let notesCols: { channel: number; frequent: number; difficult: number } | null = null;
    let complaintCols: Partial<Record<keyof ComplaintInput, number>> = {};
    const touch = (date: string) => {
      if (!summary.dateFrom || date < summary.dateFrom) summary.dateFrom = date;
      if (!summary.dateTo || date > summary.dateTo) summary.dateTo = date;
    };

    /**
     * Ends a weekly block. Row dates win over the "Date: … to …" label (the
     * label is often copied from another week). Exception: when the row dates
     * repeat dates already used by an earlier block of this sheet (a copied
     * block) and the label's range is still free, the rows are moved to the
     * same weekday inside the label's range.
     */
    const flushBlock = () => {
      if (!pending.length) return;
      const dates = [...new Set(pending.map(entry => entry.date))].sort();
      const collides = dates.some(date => usedDates.has(date));
      const range = block as { from: string; to: string } | null;
      if (collides && range && !daysIn(range).some(date => usedDates.has(date))) {
        const moved = pending.map(entry => addDays(range.from, weekdayIndex(entry.date) - weekdayIndex(range.from)));
        if (moved.every(date => date >= range.from && date <= range.to)) {
          pending.forEach((entry, index) => { entry.date = moved[index]; });
          result.warnings.push(`${sheet}: the week labelled "${blockLabel}" repeats the dates ${dates[0]} to ${dates.at(-1)} of an earlier week; its rows were moved to ${range.from} to ${range.to}.`);
        }
      }
      for (const entry of pending) {
        const normalized = normalizeText(entry.name);
        const key = `${normalized}|${entry.date}`;
        const signature = JSON.stringify([entry.status, ...COUNT_FIELDS.map(field => entry[field.key])]);
        const earlier = firstSeen.get(key);
        if (earlier && earlier.sheet !== sheet) {
          if (earlier.signature === signature) overlapSame += 1; else overlapDiff += 1;
          continue;
        }
        if (earlier) { result.warnings.push(`${sheet} row ${entry.row}: a second row for the same agent and date ${entry.date} was skipped.`); continue; }
        firstSeen.set(key, { sheet, signature });
        usedDates.add(entry.date);
        result.entries.push(entry);
        summary.agentDays += 1;
        if (entry.status === 'sick') summary.sickDays += 1;
        else if (entry.status === 'annual_leave') summary.annualLeaveDays += 1;
        else summary.presentDays += 1;
        touch(entry.date);
      }
      const finalDates = pending.map(entry => entry.date).sort();
      blockRange = { from: finalDates[0], to: finalDates.at(-1)! };
      pending = [];
    };

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const v = rowValues(row, maxCol);
      const a = asText(v[1]);
      const aKey = a.toLowerCase();

      if (/^date\s*:/i.test(a)) {
        flushBlock();
        blockLabel = a.replace(/^date\s*:\s*/i, '').trim();
        block = parseBlockRange(a, month);
        blockRange = null;
        mode = 'none';
        return;
      }
      if (aKey === 'date' && asText(v[2]).toLowerCase() === 'name') {
        flushBlock();
        countCols = {};
        for (let c = 3; c <= maxCol; c++) {
          const key = headerKey(asText(v[c]));
          if (!key) continue;
          const field = COUNT_HEADER_KEYS.find(f => key.startsWith(f.header));
          if (field && countCols[field.key] === undefined) countCols[field.key] = c;
          const m = asText(v[c]).match(/within\s+(\d+)\s*min/i);
          if (m) minutes = Number(m[1]);
        }
        const missing = COUNT_HEADER_KEYS.filter(f => countCols[f.key] === undefined);
        if (missing.length) result.warnings.push(`${sheet} row ${rowNumber}: header is missing ${missing.map(f => f.key).join(', ')}; those values are left empty.`);
        summary.weeks += 1;
        currentDate = null;
        mode = 'worklist';
        return;
      }
      if (aKey.includes('report complaint')) {
        flushBlock();
        mode = 'complaint-title';
        return;
      }
      if (aKey.startsWith('notes')) {
        flushBlock();
        notesCols = null;
        const cols: Record<string, number> = {};
        for (let c = 2; c <= maxCol; c++) {
          const t = asText(v[c]).toLowerCase();
          if (t === 'channel' && cols.channel === undefined) cols.channel = c;
          else if (t.startsWith('most frequently') && cols.frequent === undefined) cols.frequent = c;
          else if (t.includes('most difficult') && cols.difficult === undefined) cols.difficult = c;
        }
        if (cols.channel !== undefined) notesCols = { channel: cols.channel, frequent: cols.frequent ?? 0, difficult: cols.difficult ?? 0 };
        mode = 'notes';
        return;
      }

      if (mode === 'worklist') {
        if (aKey.startsWith('total')) return;
        const date = asDate(v[1]);
        if (date) currentDate = date;
        else if (a) { currentDate = null; return; } // e.g. a merged "CHRISTMAS HOLIDAY" row
        const name = asText(v[2]);
        if (!name) return;
        if (!currentDate) { result.warnings.push(`${sheet} row ${rowNumber}: agent row without a date was skipped.`); return; }
        const normalized = normalizeText(name);
        if (!names.has(normalized)) names.set(normalized, name.replace(/\s+/g, ' ').trim());
        const counts = {} as Counts;
        for (const field of COUNT_FIELDS) {
          const col = countCols[field.key];
          const parsed = col ? asCount(v[col]) : null;
          if (parsed === 'invalid') result.warnings.push(`${sheet} row ${rowNumber}: ${field.label} is not a number; left empty.`);
          counts[field.key] = parsed === 'invalid' ? null : parsed;
        }
        const status = statusFromFill(fillArgb(row.getCell(2)));
        pending.push({ sheet, row: rowNumber, date: currentDate, name: names.get(normalized)!, status, followUpMinutes: minutes, ...counts });
        return;
      }

      if (mode === 'notes' && notesCols) {
        const channel = asText(v[notesCols.channel]);
        if (!channel || channel.toLowerCase() === 'channel') return;
        const range = (blockRange as { from: string; to: string } | null) ?? (block as { from: string; to: string } | null);
        if (!range) return;
        const clean = (value: Raw) => { const t = asText(value); return t === '-' ? '' : t; };
        const note: WeeklyNote = {
          weekStart: range.from, weekEnd: range.to, channel,
          frequentQuestion: notesCols.frequent ? clean(v[notesCols.frequent]) : '',
          difficultQuestion: notesCols.difficult ? clean(v[notesCols.difficult]) : '',
        };
        const key = `${note.weekStart}|${normalizeText(channel)}`;
        if (seenNotes.has(key)) return;
        seenNotes.add(key);
        result.notes.push(note);
        summary.notes += 1;
        return;
      }

      if (mode === 'complaint-title') {
        if (aKey === 'date') {
          complaintCols = {};
          for (let c = 1; c <= maxCol; c++) {
            const field = COMPLAINT_HEADERS[headerKey(asText(v[c]))];
            if (field && complaintCols[field] === undefined) complaintCols[field] = c;
          }
          mode = 'complaint';
        }
        return;
      }

      if (mode === 'complaint') {
        if (/^(total complaint|complaint resolved|complaints resolved|complaint closed)/i.test(a)) { mode = 'done'; return; }
        const date = asDate(v[1]);
        if (!date) return;
        const get = (field: keyof ComplaintInput) => { const c = complaintCols[field]; return c ? v[c] : null; };
        const description = asText(get('description'));
        const uid = asText(get('uid'));
        if (!description && !uid) return;
        const complaint: ComplaintInput = {
          date,
          clientName: asText(get('clientName')),
          uid,
          account: asText(get('account')),
          platform: normalizePlatform(asText(get('platform'))),
          description,
          cause: asText(get('cause')),
          resolution: asText(get('resolution')),
          completionDate: asDate(get('completionDate')),
          status: normalizeComplaintStatus(asText(get('status'))),
          slaMet: parseYesNo(asText(get('slaMet'))),
          urgency: asText(get('urgency')),
          category: asText(get('category')),
        };
        const dedupeKey = complaintDedupeKey(complaint);
        if (seenComplaints.has(dedupeKey)) { result.warnings.push(`${sheet} row ${rowNumber}: duplicate complaint (same date, UID, account and description) skipped.`); return; }
        seenComplaints.add(dedupeKey);
        result.complaints.push({ ...complaint, sheet, row: rowNumber, dedupeKey });
        summary.complaints += 1;
        touch(date);
      }
    });
    flushBlock();
    if (overlapSame) result.warnings.push(`${sheet}: ${overlapSame} agent-day(s) were already in an earlier sheet with the same values (the week appears in both sheets) and were skipped.`);
    if (overlapDiff) result.warnings.push(`${sheet}: ${overlapDiff} agent-day(s) were already in an earlier sheet with different values; the earlier sheet was kept. Check these days.`);
    result.sheets.push(summary);
    for (const d of [summary.dateFrom, summary.dateTo]) {
      if (!d) continue;
      if (!result.dateFrom || d < result.dateFrom) result.dateFrom = d;
      if (!result.dateTo || d > result.dateTo) result.dateTo = d;
    }
  }
  result.names = [...names.values()];
  return result;
}
