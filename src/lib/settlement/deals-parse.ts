/**
 * MT5 Deals History text export: UTF-16LE stream, title, footer, and one deal row.
 * Name and Comment are ignored so they are never stored.
 */
import { rateFromAccount, type Rate } from './conventions';

export const MAX_CHUNK_DEALS = 2000;
export const MAX_CHUNK_BYTES = 25 * 1024 * 1024;

const TITLE_RE = /Deals History Report for '([^']*)' from '(\d{4})\.(\d{2})\.(\d{2})' to '(\d{4})\.(\d{2})\.(\d{2})'/;
const TIME_RE = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

export interface Utf16LineState { pendingByte: number | null; partial: string; bomPending: boolean }

export function emptyUtf16LineState(): Utf16LineState {
  return { pendingByte: null, partial: '', bomPending: true };
}

/** Push the next bytes of a UTF-16LE file. An odd trailing byte and a partial line are kept. */
export function pushUtf16LeLines(state: Utf16LineState, bytes: Uint8Array): { state: Utf16LineState; lines: string[] } {
  const codes: number[] = [];
  let pending = state.pendingByte;
  for (const byte of bytes) {
    if (pending === null) pending = byte;
    else {
      codes.push(pending | (byte << 8));
      pending = null;
    }
  }
  let bomPending = state.bomPending;
  let text = '';
  for (const code of codes) {
    if (bomPending) {
      bomPending = false;
      if (code === 0xfeff) continue;
    }
    text += String.fromCharCode(code);
  }
  const combined = state.partial + text;
  const pieces = combined.split(/\r?\n/);
  const partial = pieces.pop() ?? '';
  return { state: { pendingByte: pending, partial, bomPending }, lines: pieces };
}

export function finishUtf16LeLines(state: Utf16LineState): string[] {
  const last = state.partial.replace(/\r$/, '');
  return last ? [last] : [];
}

export interface DealsTitle { filter: string; from: string; to: string; star: boolean }

export function parseDealsTitle(line: string): DealsTitle | null {
  const match = TITLE_RE.exec(line);
  if (!match) return null;
  const from = `${match[2]}-${match[3]}-${match[4]}`;
  const to = `${match[5]}-${match[6]}-${match[7]}`;
  return { filter: match[1], from, to, star: match[1] === '*' };
}

export interface DealsHeader { index: Record<string, number> }

const REQUIRED = ['deal', 'login', 'time', 'entry', 'volume', 'commission', 'fee', 'swap', 'profit', 'currency'] as const;

export function parseDealsHeader(line: string): DealsHeader | null {
  const cells = line.split('\t').map(cell => cell.trim().toLowerCase());
  const index: Record<string, number> = {};
  cells.forEach((name, at) => { if (name && index[name] === undefined) index[name] = at; });
  if (REQUIRED.some(name => index[name] === undefined)) return null;
  return { index };
}

export interface ParsedDeal {
  deal: string;
  login: string;
  serverTime: string;
  serverDate: string;
  entry: string;
  volume: number;
  commission: number;
  fee: number;
  swap: number;
  profit: number;
  currency: string;
  rate: Rate | null;
}

const num = (value: string) => {
  const text = value.trim().replace(/\s/g, '');
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Wall-clock server date. Not converted to WIB, so the October DST hour stays on that server date. */
export function serverDateOf(raw: string): { serverTime: string; serverDate: string } | null {
  const match = TIME_RE.exec(raw.trim());
  if (!match) return null;
  const serverDate = `${match[1]}-${match[2]}-${match[3]}`;
  return { serverDate, serverTime: `${serverDate} ${match[4]}:${match[5]}:${match[6]}` };
}

export function parseDealsRow(header: DealsHeader, line: string): ParsedDeal | null {
  const cells = line.split('\t');
  const at = (name: string) => cells[header.index[name]] ?? '';
  const deal = at('deal').trim();
  const login = at('login').trim();
  const when = serverDateOf(at('time'));
  if (!/^\d+$/.test(deal) || !/^\d+$/.test(login) || !when) return null;
  const volume = num(at('volume'));
  const commission = num(at('commission'));
  const fee = num(at('fee'));
  const swap = num(at('swap'));
  const profit = num(at('profit'));
  if (volume === null || commission === null || fee === null || swap === null || profit === null) return null;
  return {
    deal, login, ...when, entry: at('entry').trim().toLowerCase(),
    volume, commission, fee, swap, profit,
    currency: at('currency').trim() || 'USD',
    rate: rateFromAccount(login),
  };
}

export function parseDealsFooter(header: DealsHeader, line: string): { commission: number; swap: number } | null {
  const cells = line.split('\t');
  if (cells[0]?.trim().toLowerCase() !== 'total') return null;
  const commission = num(cells[header.index.commission] ?? '');
  const swap = num(cells[header.index.swap] ?? '');
  if (commission === null || swap === null) return null;
  return { commission, swap };
}

export function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
