/**
 * Synthetic Monthly Report fixtures. Every UID, Document ID, account number
 * and remark is made up; the real export is never committed.
 */
import * as XLSX from 'xlsx';

export const ONBOARDING_HEADERS = [
  'Date Time', 'UID', 'Document ID', 'is First Account', 'Trading Account No.',
  'Approval Method', 'Steps', 'Step Status', 'Account Status', 'Remarks',
] as const;

export type FixtureRow = [string, number, number, string, string, string, string, string, string, string];

/** `[wall-clock time, uid, document id, first, account no, method, step, status, account status, remarks]` */
export const SYNTHETIC_ROWS: FixtureRow[] = [
  ['2026-10-01 00:10:23', 900001, 5000001, '', '', 'Auto', 'auto_kyc', 'Approved', 'KYC Done', 'Ekyc Status:Success;'],
  ['2026-10-01 00:15:01', 900001, 5000002, 'True', '7000001', 'Auto', 'auto_add_account', 'Approved', 'Real Account Activated', 'Completed'],
  ['2026-10-01 09:30:00', 900002, 5000003, '', '', 'Manual', 'manual_kyc', 'Rejected', 'Registration Failed', 'Invalid ID Document'],
  ['2026-10-02 10:00:00', 900002, 5000004, '', '', 'Manual', 'manual_kyc', 'Approved', 'KYC Done', 'OK'],
  ['2026-10-02 10:05:00', 900002, 5000005, 'True', '7000002', 'Auto', 'auto_add_account', 'Approved', 'Real Account Activated', 'Completed'],
  ['2026-10-05 13:00:00', 900001, 5000006, 'False', '7000003', 'Auto', 'auto_add_account', 'Approved', 'Real Account Activated', 'Completed'],
  ['2026-10-12 08:00:00', 900003, 5000007, '', '', 'Auto', 'auto_add_account', 'Approved', 'Add USD Bank Info / NPWP Failed', 'NPWP Failed'],
  ['2026-10-13 11:00:00', 900004, 5000008, '', '', 'Manual', 'manual_video_verify', 'Pending', 'Video Verification Failed', 'Please add a verification video'],
  ['2026-10-19 15:00:00', 900005, 5000009, '', '', 'Manual', 'manual_kyc', 'Rejected', 'Registration Failed', 'Invalid ID Document'],
  ['2026-10-26 23:30:00', 900006, 5000010, '', '', 'Auto', 'auto_video_verify', 'Approved', 'Video Done', 'Matched'],
  ['2026-10-31 23:39:35', 900006, 5000011, 'True', '7000004', 'Manual', 'manual_add_account', 'Approved', 'Real Account Activated', 'ok\n'],
];

export function excelSerial(wallClock: string): number {
  const [date, time = '00:00:00'] = wallClock.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  return (Date.UTC(y, m - 1, d, hh, mm, ss) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

export function buildWorkbookBuffer(
  rows: unknown[][],
  options: { headers?: readonly string[]; sheetName?: string; dateAsText?: boolean } = {},
): Buffer {
  const headers = options.headers ?? ONBOARDING_HEADERS;
  const sheet = XLSX.utils.aoa_to_sheet([headers as unknown as string[]]);
  rows.forEach((row, index) => {
    row.forEach((value, column) => {
      const address = XLSX.utils.encode_cell({ r: index + 1, c: column });
      if (column === 0 && typeof value === 'string' && !options.dateAsText) {
        sheet[address] = { t: 'n', v: excelSerial(value), z: 'yyyy-mm-dd hh:mm:ss' };
      } else if (typeof value === 'number') {
        sheet[address] = { t: 'n', v: value };
      } else if (value !== null && value !== undefined) {
        sheet[address] = { t: 's', v: String(value) };
      }
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, options.sheetName ?? 'Query result');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function syntheticOnboardingWorkbook(): Buffer {
  return buildWorkbookBuffer(SYNTHETIC_ROWS);
}

/** `[account, type, join date, FTD time, amount]` — synthetic accounts only. */
export const SYNTHETIC_FTD: Array<[string, string, string, string, string]> = [
  ['7000001', 'micro', '1-Oct-2026', '10/1/2026 02:41:59', '71.42'],
  ['7000002', 'standard', '2-Oct-2026', '10/2/2026 03:27:35', '1,000.00'],
  ['6900001', 'micro', '17-Sep-2026', '10/2/2026 00:30:00', '200.00'],
  ['7000003', 'micro', '5-Oct-2026', '10/12/2026 10:00:00', '50.00'],
  ['6900002', 'standard', '30-Jan-2026', '10/31/2026 14:50:05', '12,345.60'],
];

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * Mirrors the real report layout: a title row, Year/Month in B1:C2, then three
 * side-by-side blocks (MONTHLY B–H, DAILY J–O, per-date summary Q–S).
 */
export function syntheticFtdReportCsv(rows = SYNTHETIC_FTD): string {
  const width = 19;
  const line = (cells: Record<number, string>) => Array.from({ length: width }, (_, i) => csvCell(cells[i] ?? '')).join(',');
  const lines = [
    line({ 1: 'MONTHLY', 9: 'DAILY', 16: 'FTD per Date\n(MONTHLY)' }),
    line({ 0: '1', 1: 'Year', 2: '2026', 9: 'Date', 10: '10/2/2026' }),
    line({ 0: '2', 1: 'Month', 2: '10' }),
    line({ 0: '3' }),
    line({ 0: '4', 1: 'No', 2: 'Account', 3: 'Type', 4: 'Join Date', 5: 'FTD Time', 6: 'Amount', 7: 'Date', 9: 'No', 10: 'Account', 11: 'Type', 12: 'Join Date', 13: 'FTD Time', 14: 'Amount', 16: 'No', 17: 'Tanggal', 18: 'Jumlah' }),
  ];
  rows.forEach((row, index) => {
    const [account, type, join, time, amount] = row;
    const cells: Record<number, string> = { 1: String(index + 1), 2: account, 3: type, 4: join, 5: time, 6: amount, 7: time.split(' ')[0] };
    if (index < 2) Object.assign(cells, { 9: String(index + 1), 10: `99${index}`, 11: 'micro', 12: '10/2/2026', 13: '10/2/2026 05:00:00', 14: '9.99' });
    if (index < 3) Object.assign(cells, { 16: String(index + 1), 17: `${index + 1}-Oct-2026`, 18: '1' });
    if (index < 4) cells[0] = String(index + 5);
    lines.push(line(cells));
  });
  return `${lines.join('\n')}\n`;
}

export function cleanFtdWorkbook(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([['Account', 'Type', 'Join Date', 'FTD Time', 'Amount'], ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'FTD');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
