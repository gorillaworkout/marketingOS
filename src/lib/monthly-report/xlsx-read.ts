import * as XLSX from 'xlsx';

export interface SheetRows {
  sheetName: string;
  rows: unknown[][];
}

export function isZipWorkbook(buffer: Buffer | Uint8Array): boolean {
  return buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Reads one sheet as raw cell values (numbers stay numbers, dates stay serials).
 * CSV files are read as text (`raw`) so dates like 10/1/2026 are never guessed.
 */
export function readSheetRows(buffer: Buffer | Uint8Array, preferredSheet?: string, options: { maxRows?: number } = {}): SheetRows {
  // `maxRows` limits parsing to the first rows (cheap header sniffing for auto-detect).
  const limit = options.maxRows ? { sheetRows: options.maxRows } : {};
  const workbook = isZipWorkbook(buffer)
    ? XLSX.read(buffer, { type: 'buffer', cellDates: false, dense: false, ...limit })
    : XLSX.read(Buffer.from(buffer).toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true, cellDates: false, ...limit });
  const sheetName = preferredSheet && workbook.SheetNames.includes(preferredSheet)
    ? preferredSheet
    : workbook.SheetNames[0];
  if (!sheetName) return { sheetName: '', rows: [] };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: false });
  return { sheetName, rows };
}

export function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Maps each required header to its column index; returns the missing ones. */
export function mapHeaders(headerRow: unknown[] | undefined, required: readonly string[]) {
  const positions = new Map<string, number>();
  (headerRow ?? []).forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (key && !positions.has(key)) positions.set(key, index);
  });
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const header of required) {
    const position = positions.get(normalizeHeader(header));
    if (position === undefined) missing.push(header);
    else index[header] = position;
  }
  return { index, missing };
}

export interface WallClock { y: number; m: number; d: number; hh: number; mm: number; ss: number }

/** Excel serial → wall-clock parts, rounded to the second, independent of process TZ. */
export function serialToWallClock(serial: number): WallClock | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Math.round(serial * 86_400) * 1000 + Date.UTC(1899, 11, 30);
  const date = new Date(ms);
  return {
    y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(),
    hh: date.getUTCHours(), mm: date.getUTCMinutes(), ss: date.getUTCSeconds(),
  };
}

const TIME = '(?:[ T,]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?$';
const ISO_DATE_RE = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${TIME}`);
const US_DATE_RE = new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{4})${TIME}`);
const NAMED_MONTH_RE = new RegExp(`^(\\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\\d{4})${TIME}`);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Accepts `2026-10-01 00:10:23`, `10/1/2026 02:41:59` (month first) and `17-Sep-2026`. */
export function textToWallClock(text: string): WallClock | null {
  const value = text.trim();
  let ymd: [number, number, number] | null = null;
  let time: Array<string | undefined> = [];
  let match = ISO_DATE_RE.exec(value);
  if (match) { ymd = [+match[1], +match[2], +match[3]]; time = match.slice(4); }
  else if ((match = US_DATE_RE.exec(value))) { ymd = [+match[3], +match[1], +match[2]]; time = match.slice(4); }
  else if ((match = NAMED_MONTH_RE.exec(value))) {
    const month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    if (month > 0) { ymd = [+match[3], month, +match[1]]; time = match.slice(4); }
  }
  if (!ymd) return null;
  const parts = { y: ymd[0], m: ymd[1], d: ymd[2], hh: +(time[0] ?? 0), mm: +(time[1] ?? 0), ss: +(time[2] ?? 0) };
  const check = new Date(Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm, parts.ss));
  if (check.getUTCMonth() !== parts.m - 1 || check.getUTCDate() !== parts.d || parts.hh > 23 || parts.mm > 59 || parts.ss > 59) return null;
  return parts;
}

export function cellToWallClock(value: unknown): WallClock | null {
  if (typeof value === 'number') return serialToWallClock(value);
  if (typeof value === 'string') return textToWallClock(value);
  return null;
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
  return String(value).trim();
}
