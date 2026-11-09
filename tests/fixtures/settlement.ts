/**
 * Small synthetic Settlement exports for CI. No real customer data:
 * accounts are 20000xx/22000xx/24000xx/29000xx, names are "Client N".
 */
import * as XLSX from 'xlsx';

export const CRM_DEPOSIT_HEADER = ['Request', 'Reference', 'Ticket', 'Account', 'Type', 'FundingMethod', 'Complete', 'Transfer amount', 'Credited amount', 'Status', 'UID', 'Channel name', 'Payment method', 'Reference of payment gateway'];
export const CRM_WITHDRAWAL_HEADER = ['Request', 'Reference', 'Ticket', 'Account', 'Type', 'FundingMethod', 'Complete', 'Withdrawal amount', 'Transfer amount', 'Status', 'UID', 'Channel name'];

export interface CrmRowInput { request: string; reference: string; account: string; complete?: string; status?: string; usd: number; transferIdr?: number; method?: 'Auto' | 'Manual'; ticket?: string }

function xlsxBuffer(rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Report');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function crmDepositXlsx(rows: CrmRowInput[]): Buffer {
  return xlsxBuffer([CRM_DEPOSIT_HEADER, ...rows.map(r => [
    r.request, r.reference, r.ticket ?? '0', r.account, 'Deposit', r.method ?? 'Manual', r.complete ?? '--',
    r.transferIdr === undefined ? `USD ${r.usd}` : `IDR ${r.transferIdr}`, `USD ${r.usd}`, r.status ?? 'Successful', '9000001', 'BCA', 'Bank transfer', '--',
  ])]);
}

export function crmWithdrawalXlsx(rows: CrmRowInput[]): Buffer {
  return xlsxBuffer([CRM_WITHDRAWAL_HEADER, ...rows.map(r => [
    r.request, r.reference, r.ticket ?? '0', r.account, 'Withdrawal', r.method ?? 'Manual', r.complete ?? '--',
    `USD ${r.usd}`, r.transferIdr === undefined ? '--' : `IDR ${r.transferIdr}`, r.status ?? 'Successful', '9000002', 'IDR-Account',
  ])]);
}

export interface Mt5RowInput { deal: string; login: string; time: string; comment: string; amount: number }

/** MT5 Manager export: UTF-16LE with BOM, CRLF, tab separated, title line + header + Total footer. */
export function mt5DwText(rows: Mt5RowInput[], options: { encoding?: 'utf16le' | 'utf8'; separator?: '\t' | ';'; total?: number } = {}): Buffer {
  const sep = options.separator ?? '\t';
  const total = options.total ?? rows.reduce((acc, r) => acc + r.amount, 0);
  const lines = [
    "Trades\\Deposit and Withdrawal Report for '*' from '2026.11.01' to '2026.11.08'",
    ['Deal', 'Login', 'Name', 'Time', 'Comment', 'Amount', 'Currency'].join(sep),
    ...rows.map((r, i) => [r.deal, r.login, `Client ${i + 1}`, r.time, r.comment, r.amount.toFixed(2), 'USD'].join(sep)),
    ['Total', '', '', '', '', total.toFixed(2), ''].join(sep),
  ];
  const text = `${lines.join('\r\n')}\r\n`;
  if (options.encoding === 'utf8') return Buffer.from(text, 'utf8');
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

/**
 * One reconciliation day, report date 2026-11-06 (window 11-05 12:00:01 → 11-06 12:00:00 WIB).
 * MT5 times are server time EET (UTC+2) = WIB − 5h.
 */
export const DAY = '2026-11-06';
export const dayDeposits: CrmRowInput[] = [
  { reference: '1001', account: '2000011', request: '05/11/2026 11:50:00', complete: '05/11/2026 12:00:00', usd: 10 }, // completed at the edge: previous window
  { reference: '1002', account: '2000011', request: '05/11/2026 11:59:00', complete: '05/11/2026 12:00:01', usd: 20, transferIdr: 200000 }, // first second of the window
  { reference: '1003', account: '2400022', request: '06/11/2026 09:00:00', complete: '06/11/2026 09:00:30', usd: 30, method: 'Auto' },
  { reference: '1004', account: '2400022', request: '06/11/2026 10:00:00', complete: '06/11/2026 10:05:00', usd: 40, status: 'Unsuccessful' }, // reject, counted
  { reference: '1005', account: '2900033', request: '06/11/2026 11:00:00', complete: '06/11/2026 12:00:00', usd: 50 }, // last second of the window
  { reference: '1006', account: '2200044', request: '06/11/2026 11:30:00', complete: '06/11/2026 12:00:01', usd: 60 }, // next window
];
export const dayWithdrawals: CrmRowInput[] = [
  { reference: '1001', account: '2000011', request: '05/11/2026 12:00:01', complete: '05/11/2026 12:10:01', usd: 15 }, // same Reference as a deposit: separate table
  { reference: '2002', account: '2400022', request: '06/11/2026 08:00:00', complete: '07/11/2026 09:00:00', usd: 25 }, // WD-2
  { reference: '2003', account: '2400022', request: '06/11/2026 09:30:00', complete: '06/11/2026 09:40:00', usd: 35, status: 'Unsuccessful' }, // WD reject
  { reference: '2004', account: '2900033', request: '06/11/2026 12:00:01', complete: '06/11/2026 12:05:00', usd: 45 }, // next window
];
export const dayDeals: Mt5RowInput[] = [
  { deal: '501', login: '2000011', time: '2026.11.05 07:00:01', comment: 'CRM-D-1002', amount: 20 },
  { deal: '502', login: '2400022', time: '2026.11.06 04:00:30', comment: 'CRM-D-1003', amount: 30 },
  { deal: '503', login: '2900033', time: '2026.11.06 07:00:00', comment: 'CRM-D-1005', amount: 50 },
  { deal: '504', login: '2000011', time: '2026.11.05 07:10:01', comment: 'CRM-W-1001', amount: -15 },
  { deal: '505', login: '2400022', time: '2026.11.06 03:00:00', comment: 'CRM-W-2002', amount: -25 },
  { deal: '506', login: '2400022', time: '2026.11.06 04:30:00', comment: 'CRM-W-2003', amount: -35 },
  { deal: '507', login: '2400022', time: '2026.11.06 04:40:00', comment: 'CRM-WC-2003', amount: 35 },
  { deal: '508', login: '2400022', time: '2026.11.06 05:00:00', comment: 'CRM-D-9999', amount: 5 }, // MT5 only
  { deal: '509', login: '2000011', time: '2026.11.06 00:05:07', comment: 'CRM-S-2360776,261105,Swap', amount: -1.5 },
  { deal: '510', login: '2000011', time: '2026.11.06 00:05:08', comment: 'CRM-SR-Swap-Refund', amount: 0.5 },
  { deal: '511', login: '2400022', time: '2026.11.06 06:00:00', comment: 'CRM-TO-77', amount: -3 },
];

/** Dealing FTD list layout: title, "Total FTD" row, blank rows, header on row 6. FTD Time = MT5 server time. */
export function ftdXlsx(rows: Array<{ login: string; type: 'micro' | 'standard'; serverTime: string; balance: number }>): Buffer {
  const book = XLSX.utils.book_new();
  const aoa: unknown[][] = [['FTD Oktober 2026'], [], [], ['Total FTD :', rows.length], [], ['No', 'Login', 'Type', 'FTD Time', 'Balance'],
    ...rows.map((r, i) => [i + 1, Number(r.login), r.type, r.serverTime, r.balance])];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
export const ftdRows = [
  { login: '2400022', type: 'micro' as const, serverTime: '2026-11-06 04:00:30', balance: 50 },
  { login: '2000011', type: 'standard' as const, serverTime: '2026-11-05 07:00:01', balance: 20 },
  { login: '2900033', type: 'standard' as const, serverTime: '2026-11-06 07:00:00', balance: 50 },
];
