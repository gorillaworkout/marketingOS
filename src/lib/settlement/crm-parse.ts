/**
 * CRM "Reports_funds_deposit_*.xlsx" / "Reports_funds_withdrawal_*.xlsx" (sheet "Report").
 * Request / Complete are WIB "dd/mm/yyyy HH:MM:SS"; "--" = empty. Key = Reference.
 * Last occurrence of a Reference in the file wins (counted in duplicatesInFile).
 */
import { cellText, mapHeaders, readSheetRows } from '@/lib/monthly-report/xlsx-read';
import { parseCrmDate, parseMoney, rateFromAccount, wibDateOf } from './conventions';
import { emptySummary, widenRange, type CrmDirection, type CrmTransaction, type ParseResult } from './types';

export const CRM_SHEET = 'Report';
export const CRM_DEPOSIT_COLUMNS = ['Request', 'Reference', 'Ticket', 'Account', 'Type', 'FundingMethod', 'Complete', 'Transfer amount', 'Credited amount', 'Status', 'UID'] as const;
export const CRM_WITHDRAWAL_COLUMNS = ['Request', 'Reference', 'Ticket', 'Account', 'Type', 'FundingMethod', 'Complete', 'Withdrawal amount', 'Transfer amount', 'Status', 'UID'] as const;
const OPTIONAL_COLUMNS = ['Channel name', 'Payment method', 'Reference of payment gateway'] as const;
const STATUSES = new Set(['Successful', 'Unsuccessful', 'Processing']);

const blankToNull = (value: string) => (value === '' || value === '--' || value === '0' ? null : value);

function parseCrm(buffer: Buffer | Uint8Array, direction: CrmDirection): ParseResult<CrmTransaction> {
  const required = direction === 'deposit' ? CRM_DEPOSIT_COLUMNS : CRM_WITHDRAWAL_COLUMNS;
  const expectedType = direction === 'deposit' ? 'Deposit' : 'Withdrawal';
  const { rows } = readSheetRows(buffer, CRM_SHEET);
  const result: ParseResult<CrmTransaction> = { rows: [], issues: [], errors: [], warnings: [], summary: emptySummary() };
  const { index, missing } = mapHeaders(rows[0], required);
  if (missing.length) {
    result.errors.push(`Missing columns: ${missing.join(', ')}`);
    return result;
  }
  const optional = mapHeaders(rows[0], OPTIONAL_COLUMNS).index;
  const byReference = new Map<string, CrmTransaction>();
  rows.slice(1).forEach((row, offset) => {
    const line = offset + 2;
    const cell = (name: string, map: Record<string, number> = index) => (map[name] === undefined ? '' : cellText(row[map[name]]));
    const reference = cell('Reference');
    const type = cell('Type');
    const requestedAt = parseCrmDate(row[index.Request]);
    const status = cell('Status');
    const accountNo = cell('Account');
    if (!reference) return void result.issues.push({ row: line, message: 'Reference is empty' });
    if (type !== expectedType) return void result.issues.push({ row: line, message: `Type is "${type}", expected ${expectedType}` });
    if (!requestedAt) return void result.issues.push({ row: line, message: `Request "${cell('Request')}" is not dd/mm/yyyy HH:MM:SS` });
    if (!STATUSES.has(status)) return void result.issues.push({ row: line, message: `Unknown Status "${status}"` });
    if (!accountNo) return void result.issues.push({ row: line, message: 'Account is empty' });
    const amount = parseMoney(cell(direction === 'deposit' ? 'Credited amount' : 'Withdrawal amount'));
    const transfer = parseMoney(cell('Transfer amount'));
    const completeText = cell('Complete');
    const completedAt = completeText === '--' || completeText === '' ? null : parseCrmDate(row[index.Complete]);
    if (completeText !== '--' && completeText !== '' && !completedAt) return void result.issues.push({ row: line, message: `Complete "${completeText}" is not dd/mm/yyyy HH:MM:SS` });
    const rate = rateFromAccount(accountNo);
    if (rate === null) result.summary.unknownRate += 1;
    if (byReference.has(reference)) result.summary.duplicatesInFile += 1;
    byReference.set(reference, {
      direction, reference, accountNo, requestedAt, completedAt, status, rate,
      ticket: blankToNull(cell('Ticket')),
      uid: blankToNull(cell('UID')),
      fundingMethod: cell('FundingMethod'),
      amountUsd: amount && amount.currency === 'USD' ? amount.value : null,
      transferAmount: transfer?.value ?? null,
      transferCurrency: transfer?.currency ?? null,
      channel: blankToNull(cell('Channel name', optional)),
      paymentMethod: blankToNull(cell('Payment method', optional)),
      gatewayReference: blankToNull(cell('Reference of payment gateway', optional)),
    });
  });
  result.rows = [...byReference.values()];
  result.summary.rows = result.rows.length;
  result.summary.invalid = result.issues.length;
  for (const tx of result.rows) {
    result.summary.byStatus[tx.status] = (result.summary.byStatus[tx.status] ?? 0) + 1;
    widenRange(result.summary, wibDateOf(tx.requestedAt));
  }
  if (result.summary.unknownRate) result.warnings.push(`${result.summary.unknownRate} rows have an account number whose rate is unknown (2nd digit not 0/2/4/9).`);
  return result;
}

export const parseCrmDeposits = (buffer: Buffer | Uint8Array) => parseCrm(buffer, 'deposit');
export const parseCrmWithdrawals = (buffer: Buffer | Uint8Array) => parseCrm(buffer, 'withdrawal');
