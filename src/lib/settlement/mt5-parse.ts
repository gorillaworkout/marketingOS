/**
 * MT5 Manager "Deposit and Withdrawal Report" text export (UTF-16, tab or ';').
 * Key = Deal. The "Total" footer is checked against the row sum (warning only).
 */
import { parseMt5Comment } from './comment-parse';
import { mt5ServerTimestamp, mt5ServerToUtc, rateFromAccount, wibDateOf } from './conventions';
import { readTextTable } from './text-read';
import { emptySummary, widenRange, type Mt5Deal, type ParseResult } from './types';

export const MT5_DW_COLUMNS = ['Deal', 'Login', 'Name', 'Time', 'Comment', 'Amount', 'Currency'] as const;
export const MT5_DW_TITLE = 'Deposit and Withdrawal Report';

const toNumber = (value: string | undefined) => {
  const text = String(value ?? '').trim().replace(/\s/g, '');
  return text !== '' && Number.isFinite(Number(text)) ? Number(text) : null;
};

export function parseMt5DepositWithdrawal(buffer: Buffer | Uint8Array): ParseResult<Mt5Deal> {
  const result: ParseResult<Mt5Deal> = { rows: [], issues: [], errors: [], warnings: [], summary: emptySummary() };
  const table = readTextTable(buffer, 'Deal');
  if (!table) {
    result.errors.push('No "Deal" header found: expected the MT5 "Deposit and Withdrawal Report" export.');
    return result;
  }
  const position = Object.fromEntries(table.header.map((name, i) => [name.toLowerCase(), i]));
  const missing = MT5_DW_COLUMNS.filter(name => position[name.toLowerCase()] === undefined);
  if (missing.length) {
    result.errors.push(`Missing columns: ${missing.join(', ')}`);
    return result;
  }
  const cell = (row: string[], name: string) => String(row[position[name.toLowerCase()]] ?? '').trim();
  const byDeal = new Map<string, Mt5Deal>();
  let sum = 0;
  table.rows.forEach((row, offset) => {
    const line = offset + 3; // title + header
    const deal = cell(row, 'Deal');
    const login = cell(row, 'Login');
    const occurredAt = mt5ServerToUtc(cell(row, 'Time'));
    const serverTime = mt5ServerTimestamp(cell(row, 'Time'));
    const amount = toNumber(cell(row, 'Amount'));
    if (!/^\d+$/.test(deal)) return void result.issues.push({ row: line, message: `Deal "${deal}" is not a number` });
    if (!/^\d+$/.test(login)) return void result.issues.push({ row: line, message: `Login "${login}" is not a number` });
    if (!occurredAt || !serverTime) return void result.issues.push({ row: line, message: `Time "${cell(row, 'Time')}" is not yyyy.mm.dd HH:MM:SS` });
    if (amount === null) return void result.issues.push({ row: line, message: `Amount "${cell(row, 'Amount')}" is not a number` });
    const comment = cell(row, 'Comment') || null;
    const parsed = parseMt5Comment(comment);
    const rate = rateFromAccount(login);
    if (rate === null) result.summary.unknownRate += 1;
    if (byDeal.has(deal)) result.summary.duplicatesInFile += 1;
    sum += amount;
    byDeal.set(deal, {
      deal, login, occurredAt, serverTime, comment, rate,
      name: cell(row, 'Name') || null,
      kind: parsed.kind, crmReference: parsed.crmReference, swapDate: parsed.swapDate,
      amountUsd: amount, currency: cell(row, 'Currency') || null,
    });
  });
  result.rows = [...byDeal.values()];
  result.summary.rows = result.rows.length;
  result.summary.invalid = result.issues.length;
  for (const deal of result.rows) {
    result.summary.byStatus[deal.kind] = (result.summary.byStatus[deal.kind] ?? 0) + 1;
    widenRange(result.summary, wibDateOf(deal.occurredAt));
  }
  const footerAmount = table.footer ? toNumber(table.footer[position.amount]) : null;
  if (footerAmount !== null && Math.abs(footerAmount - sum) > 0.01 * Math.max(1, table.rows.length)) {
    result.warnings.push(`Footer Total ${footerAmount.toFixed(2)} differs from the row sum ${sum.toFixed(2)}.`);
  }
  if (result.summary.unknownRate) result.warnings.push(`${result.summary.unknownRate} deals have a login whose rate is unknown.`);
  return result;
}
