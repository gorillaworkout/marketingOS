/**
 * Dealing "FTD <Bulan> <Tahun>.xlsx" (Initial Margin list): title "FTD Oktober 2026", a "Total FTD" row,
 * then header No | Login | Type | FTD Time | Balance. FTD Time is MT5 server time (EET/EEST);
 * Balance (USD) = cumulative deposits when the account first reached the minimum (micro 50, standard 200).
 * Key = Login (one FTD per account).
 */
import { cellText, readSheetRows, serialToWallClock } from '@/lib/monthly-report/xlsx-read';
import { mt5ServerTimestamp, mt5ServerToUtc, rateFromAccount, wibDateOf, type Rate } from './conventions';
import { emptySummary, widenRange, type ParseResult } from './types';

export interface FtdEntry { login: string; accountType: string | null; serverTime: string; ftdAt: string; balanceUsd: number; rate: Rate | null }

export const FTD_COLUMNS = ['Login', 'Type', 'FTD Time', 'Balance'] as const;
const pad = (n: number) => String(n).padStart(2, '0');

/** Excel serial or "2026-10-01 02:41:59" / "2026.10.01 02:41:59" → MT5 server text "YYYY.MM.DD HH:MM:SS". */
function serverText(value: unknown): string | null {
  if (typeof value === 'number') {
    const p = serialToWallClock(value);
    return p ? `${p.y}.${pad(p.m)}.${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}` : null;
  }
  const match = /^(\d{4})[-.](\d{2})[-.](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(cellText(value));
  return match ? `${match[1]}.${match[2]}.${match[3]} ${match[4]}:${match[5]}:${match[6] ?? '00'}` : null;
}

export function findFtdHeader(rows: unknown[][]): { rowIndex: number; columns: Record<string, number> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
    const cells = (rows[rowIndex] ?? []).map(cell => cellText(cell).toLowerCase());
    const columns: Record<string, number> = {};
    for (const name of FTD_COLUMNS) { const at = cells.indexOf(name.toLowerCase()); if (at >= 0) columns[name] = at; }
    if (Object.keys(columns).length === FTD_COLUMNS.length) return { rowIndex, columns };
  }
  return null;
}

export function parseSettlementFtd(buffer: Buffer | Uint8Array): ParseResult<FtdEntry> {
  const result: ParseResult<FtdEntry> = { rows: [], issues: [], errors: [], warnings: [], summary: emptySummary() };
  const { rows } = readSheetRows(buffer);
  const header = findFtdHeader(rows);
  if (!header) {
    result.errors.push(`No header with ${FTD_COLUMNS.join(', ')} in the first 20 rows: expected the Dealing FTD list.`);
    return result;
  }
  const byLogin = new Map<string, FtdEntry>();
  rows.slice(header.rowIndex + 1).forEach((row, offset) => {
    const line = header.rowIndex + offset + 2;
    const get = (name: string) => row[header.columns[name]];
    const login = cellText(get('Login'));
    if (!login) return; // trailing blank / total rows
    if (!/^\d+$/.test(login)) return void result.issues.push({ row: line, message: `Login "${login}" is not a number` });
    const text = serverText(get('FTD Time'));
    const ftdAt = mt5ServerToUtc(text);
    const serverTime = mt5ServerTimestamp(text);
    if (!ftdAt || !serverTime) return void result.issues.push({ row: line, message: `FTD Time "${cellText(get('FTD Time'))}" is not a date-time` });
    const balance = Number(cellText(get('Balance')).replace(/,/g, ''));
    if (!Number.isFinite(balance) || balance < 0) return void result.issues.push({ row: line, message: `Balance "${cellText(get('Balance'))}" is not a number` });
    const rate = rateFromAccount(login);
    if (rate === null) result.summary.unknownRate += 1;
    if (byLogin.has(login)) result.summary.duplicatesInFile += 1;
    byLogin.set(login, { login, ftdAt, serverTime, rate, accountType: cellText(get('Type')).toLowerCase() || null, balanceUsd: Math.round(balance * 100) / 100 });
  });
  result.rows = [...byLogin.values()];
  result.summary.rows = result.rows.length;
  result.summary.invalid = result.issues.length;
  for (const entry of result.rows) {
    const type = entry.accountType ?? 'unknown';
    result.summary.byStatus[type] = (result.summary.byStatus[type] ?? 0) + 1;
    widenRange(result.summary, wibDateOf(entry.ftdAt));
  }
  return result;
}
