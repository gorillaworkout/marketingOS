/**
 * FTD (first-time deposit) upload. Accepts the back-office report CSV/XLSX
 * (title rows, Year/Month in B1:C2, then MONTHLY / DAILY / per-date blocks
 * side by side) and a clean single table with the same headers. Only the
 * first (leftmost) block with the FTD headers — the MONTHLY block — is read;
 * the DAILY and summary blocks are derived from it and ignored.
 */
import { parseOffset, wallClockToIso, wibDate, type ParseIssue } from './onboarding-parse';
import { cellText, cellToWallClock, normalizeHeader, readSheetRows } from './xlsx-read';

export const FTD_COLUMNS = ['Account', 'Type', 'Join Date', 'FTD Time', 'Amount'] as const;

export interface FtdRow {
  accountNo: string;
  accountType: string | null;
  joinDate: string | null;
  ftdAt: string; // ISO UTC
  amount: number;
}

export interface FtdParseResult {
  layout: 'report' | 'table';
  offset: string;
  reportMonth: { year: number; month: number } | null;
  errors: string[];
  warnings: string[];
  issues: ParseIssue[];
  rows: FtdRow[];
  summary: {
    rows: number;
    invalid: number;
    duplicatesInFile: number;
    wibRange: { from: string; to: string } | null;
    amountTotal: number;
    byType: Record<string, number>;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `17-Sep-2026`, `10/22/2026` (month first), `2026-10-22` or an Excel serial → `YYYY-MM-DD`. */
export function parseFlexibleDate(value: unknown): string | null {
  const parts = cellToWallClock(typeof value === 'string' ? value.trim() : value);
  return parts ? `${parts.y}-${pad(parts.m)}-${pad(parts.d)}` : null;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  const text = cellText(value).replace(/,/g, '').replace(/^\$/, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Math.round(Number(text) * 100) / 100;
}

function findHeader(rows: unknown[][]): { rowIndex: number; columns: Record<string, number> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const normalized = row.map(normalizeHeader);
    for (let start = 0; start < normalized.length; start += 1) {
      if (normalized[start] !== 'account') continue;
      const columns: Record<string, number> = {};
      let ok = true;
      for (const header of FTD_COLUMNS) {
        const key = normalizeHeader(header);
        let found = -1;
        for (let col = start; col < Math.min(normalized.length, start + 10); col += 1) {
          if (col > start && normalized[col] === 'account') break; // next block
          if (normalized[col] === key) { found = col; break; }
        }
        if (found < 0) { ok = false; break; }
        columns[header] = found;
      }
      if (ok) return { rowIndex, columns };
    }
  }
  return null;
}

function findReportMonth(rows: unknown[][]): { year: number; month: number } | null {
  let year: number | null = null;
  let month: number | null = null;
  for (const row of rows) {
    (row ?? []).forEach((cell, index) => {
      const key = normalizeHeader(cell);
      const next = Number(cellText(row[index + 1]));
      if (key === 'year' && Number.isInteger(next) && next > 2000) year = next;
      if (key === 'month' && Number.isInteger(next) && next >= 1 && next <= 12) month = next;
    });
  }
  return year && month ? { year, month } : null;
}

export function parseFtdFile(buffer: Buffer | Uint8Array, options: { fileName: string; offset: string }): FtdParseResult {
  const base: FtdParseResult = {
    layout: 'table', offset: options.offset, reportMonth: null, errors: [], warnings: [], issues: [], rows: [],
    summary: { rows: 0, invalid: 0, duplicatesInFile: 0, wibRange: null, amountTotal: 0, byType: {} },
  };
  const offsetMinutes = parseOffset(options.offset);
  if (offsetMinutes === null) return { ...base, errors: [`Source UTC offset "${options.offset}" is not valid. Use a value like +08:00.`] };
  let sheet;
  try {
    sheet = readSheetRows(buffer);
  } catch {
    return { ...base, errors: ['The file could not be read as CSV or Excel.'] };
  }
  const header = findHeader(sheet.rows);
  if (!header) return { ...base, errors: [`Could not find the FTD table. Expected the columns: ${FTD_COLUMNS.join(', ')}.`] };

  const reportMonth = findReportMonth(sheet.rows.slice(0, header.rowIndex));
  const layout = header.rowIndex > 0 || reportMonth ? 'report' : 'table';
  const issues: ParseIssue[] = [];
  const byAccount = new Map<string, number>();
  const rows: FtdRow[] = [];
  let duplicatesInFile = 0;
  const col = header.columns;

  sheet.rows.slice(header.rowIndex + 1).forEach((row, offset) => {
    const rowNumber = header.rowIndex + offset + 2;
    const accountNo = cellText(row?.[col.Account]);
    if (!accountNo) return;
    const wallClock = cellToWallClock(typeof row[col['FTD Time']] === 'string' ? String(row[col['FTD Time']]).trim() : row[col['FTD Time']]);
    if (!wallClock) {
      issues.push({ row: rowNumber, message: 'FTD Time is missing or not a date' });
      return;
    }
    const amount = parseAmount(row[col.Amount]);
    if (amount === null) {
      issues.push({ row: rowNumber, message: 'Amount must be a number of 0 or more' });
      return;
    }
    const parsed: FtdRow = {
      accountNo,
      accountType: cellText(row[col.Type]).toLowerCase() || null,
      joinDate: parseFlexibleDate(row[col['Join Date']]),
      ftdAt: wallClockToIso(wallClock, offsetMinutes),
      amount,
    };
    const existing = byAccount.get(accountNo);
    if (existing !== undefined) {
      duplicatesInFile += 1;
      rows[existing] = parsed;
    } else {
      byAccount.set(accountNo, rows.length);
      rows.push(parsed);
    }
  });

  const summary = { ...base.summary, rows: rows.length, invalid: issues.length, duplicatesInFile };
  let cents = 0;
  for (const row of rows) {
    cents += Math.round(row.amount * 100);
    const type = row.accountType ?? 'unknown';
    summary.byType[type] = (summary.byType[type] ?? 0) + 1;
    const day = wibDate(row.ftdAt);
    if (!summary.wibRange) summary.wibRange = { from: day, to: day };
    else {
      if (day < summary.wibRange.from) summary.wibRange.from = day;
      if (day > summary.wibRange.to) summary.wibRange.to = day;
    }
  }
  summary.amountTotal = cents / 100;

  const warnings: string[] = [];
  if (reportMonth) {
    const month = `${reportMonth.year}-${pad(reportMonth.month)}`;
    const outside = rows.filter(row => wibDate(row.ftdAt).slice(0, 7) !== month).length;
    if (outside) warnings.push(`${outside} FTD row(s) fall outside ${month} (WIB), the month named in the report header.`);
  }
  const errors = rows.length === 0 && issues.length === 0 ? ['The FTD table has no data rows.'] : [];
  return { layout, offset: options.offset, reportMonth, errors, warnings, issues, rows, summary };
}
