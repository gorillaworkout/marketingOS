/** Settlement upload kind detection by content (never by file name alone). */
import { cellText, readSheetRows } from '@/lib/monthly-report/xlsx-read';
import { CRM_SHEET } from './crm-parse';
import { findFtdHeader } from './ftd-parse';
import { decodeText, isZipOrXlsx } from './text-read';

export type SettlementUploadKind = 'settlement_crm_deposit' | 'settlement_crm_withdrawal' | 'settlement_mt5_dw' | 'settlement_ftd';
export const SETTLEMENT_UPLOAD_KINDS: readonly SettlementUploadKind[] = ['settlement_crm_deposit', 'settlement_crm_withdrawal', 'settlement_mt5_dw', 'settlement_ftd'];

export const SETTLEMENT_KIND_LABELS: Record<SettlementUploadKind, string> = {
  settlement_crm_deposit: 'CRM deposits',
  settlement_crm_withdrawal: 'CRM withdrawals',
  settlement_mt5_dw: 'MT5 Deposit & Withdrawal',
  settlement_ftd: 'Dealing FTD list (Initial Margin)',
};

export function detectSettlementKind(buffer: Buffer | Uint8Array): SettlementUploadKind | null {
  if (isZipOrXlsx(buffer)) {
    let rows: unknown[][];
    try { rows = readSheetRows(buffer, CRM_SHEET).rows; } catch { return null; }
    const header = (rows[0] ?? []).map(cellText);
    const type = cellText(rows[1]?.[header.indexOf('Type')]);
    if (header.includes('Credited amount') && type === 'Deposit') return 'settlement_crm_deposit';
    if (header.includes('Withdrawal amount') && type === 'Withdrawal') return 'settlement_crm_withdrawal';
    if (header.includes('Credited amount') && rows.length === 1) return 'settlement_crm_deposit';
    if (header.includes('Withdrawal amount') && rows.length === 1) return 'settlement_crm_withdrawal';
    const first = readSheetRows(buffer, undefined, { maxRows: 20 }).rows;
    if (findFtdHeader(first)) return 'settlement_ftd';
    return null;
  }
  const head = decodeText(Buffer.from(buffer).subarray(0, 4096)).split(/\r?\n/).slice(0, 3).join('\n');
  if (/Deposit and Withdrawal Report/i.test(head) && /(^|[\t;])Deal([\t;]|$)/m.test(head)) return 'settlement_mt5_dw';
  return null;
}
