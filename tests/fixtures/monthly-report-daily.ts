/**
 * Synthetic daily-upload fixtures. Header shapes match the real Metabase
 * exports; every number / name / id is made up — real client data is never
 * committed.
 */
import * as XLSX from 'xlsx';
import { buildWorkbookBuffer, excelSerial } from './monthly-report-onboarding';

export const SUMMARY_HEADERS = [
  'Date', 'Total Cases Registration', 'TOTAL REAL ACCOUNT',
  'KYC Manual Approved Demo Not Done', 'KYC Manual Rejected',
  'First Account Manual Add Done', 'Manual Video Verify Failed', 'Manual Video Verify Done',
  'Not The First Account Manual Add Failed', 'Not The First Account Manual Add Done',
  'KYC Auto Approved Demo Not Done', 'KYC Auto Approved Demo Done', 'KYC Auto Rejected',
  'First Account Auto Add Done', 'Auto Video Verify Failed', 'Auto Video Verify Done',
  'Not The First Account Auto Add Failed', 'Not The First Account Auto Add Done',
] as const;

/** One synthetic summary day: registrations 100, TOTAL REAL 40 (= 25+15 auto-add), manual approved 5 → TRA 45. */
export const SYNTHETIC_SUMMARY_ROW = [
  '2026-11-01', 100, 40, 5, 20, 0, 1, 0, 0, 0, 2, 3, 1, 25, 0, 4, 0, 15,
];

export function syntheticSummaryWorkbook(rows: unknown[][] = [SYNTHETIC_SUMMARY_ROW], withTotal = true): Buffer {
  const data = withTotal
    ? [...rows, ['Total', 100, 40, 5, 20, 0, 1, 0, 0, 0, 2, 3, 1, 25, 0, 4, 0, 15]]
    : rows;
  return buildWorkbookBuffer(data, { headers: SUMMARY_HEADERS, dateAsText: true });
}

export const USER_APPROVED_HEADERS_TYPO = [
  'Success Status', 'Record ID', 'Create Time', 'Applicant UID', 'Approver UID', 'Approver',
  'Approval Method', 'Document ID', 'Steps', 'Step Astatus', 'Approved Status', 'Account',
  'Finsihed Time', 'Processing Time', 'Remark', 'Rejected Reason',
] as const;

export const USER_APPROVED_HEADERS_CORRECT = [
  'Success Status', 'Record ID', 'Create Time', 'Applicant UID', 'Approver UID', 'Approver',
  'Approval Method', 'Document ID', 'Steps', 'Step Status', 'Approved Status', 'Account',
  'Finished Time', 'Processing Time', 'Remark', 'Rejected Reason',
] as const;

type UaRow = [
  string | null, number | string, string, number, number, string,
  string, number, string, string, string, string,
  string, string, string, string,
];

/** Synthetic user_approved rows (WIB wall clocks). Includes Deposit Robot (kept in storage, skipped for ranking) and Failed/Rejected remarks. */
export const SYNTHETIC_UA_ROWS: UaRow[] = [
  ['Approved', 900001, '2026-11-01 09:00:00', 1001, 501, 'Ayu Pratama', 'Manual', 700001, 'manual_kyc', 'Approved', 'Approved', '', '2026-11-01 09:30:00', '00:30:00', 'ok', ''],
  ['Approved', 900002, '2026-11-01 10:00:00', 1002, 502, 'Budi Santoso', 'Manual', 700002, 'manual_video_verify', 'Approved', 'Approved', '', '2026-11-01 10:20:00', '00:20:00', 'ok', ''],
  ['Approved', 900003, '2026-11-01 11:00:00', 1003, 501, 'Ayu Pratama', 'Manual', 700003, 'manual_kyc', 'Approved', 'Approved', '', '2026-11-01 11:15:00', '00:15:00', 'ok', ''],
  [null, 900004, '2026-11-01 08:00:00', 1004, 258, 'Deposit Robot', 'Auto', 700004, 'auto_add_account', 'Approved', 'Approved', '7100001', '2026-11-01 08:01:00', '00:01:00', '', ''],
  // Staff rejection — Remark is the reason; Rejected Reason left empty (live Metabase pattern)
  ['Failed', 900005, '2026-11-01 12:00:00', 1005, 502, 'Budi Santoso', 'Manual', 700005, 'manual_kyc', 'Failed', 'Failed', '', '2026-11-01 12:10:00', '00:10:00', 'Mohon unggah foto KTP asli yang jelas', ''],
  ['Approved', 900006, '2026-11-02 09:00:00', 1006, 501, 'Ayu Pratama', 'Manual', 700006, 'manual_kyc', 'Approved', 'Approved', '', '2026-11-02 09:25:00', '00:25:00', 'ok', ''],
  // Robot (auto_kyc) machine remark
  [null, 900007, '2026-11-01 13:00:00', 1007, 0, 'System', 'Auto', 700007, 'auto_kyc', 'Failed', 'Failed', '', '2026-11-01 13:01:00', '00:01:00', 'Ekyc Status: HasSameIdentity:1 occupation:False', ''],
  // Deposit Robot video-verify failure — included under Robot rejection reasons
  [null, 900008, '2026-11-01 14:00:00', 1008, 258, 'Deposit Robot', 'Auto', 700008, 'auto_video_verify', 'Failed', 'Failed', '', '2026-11-01 14:05:00', '00:05:00', 'Speech Script Matching: false. Face consistency: low', ''],
  // Staff unmatched → Other
  ['Failed', 900009, '2026-11-02 10:00:00', 1009, 502, 'Budi Santoso', 'Manual', 700009, 'manual_kyc', 'Failed', 'Failed', '', '2026-11-02 10:15:00', '00:15:00', 'Custom staff note not in guide', ''],
  // Staff selfie
  ['Failed', 900010, '2026-11-02 11:00:00', 1010, 501, 'Ayu Pratama', 'Manual', 700010, 'manual_kyc', 'Failed', 'Failed', '', '2026-11-02 11:20:00', '00:20:00', 'Mohon unggah foto selfie memegang KTP', ''],
];

function uaWorkbook(headers: readonly string[], rows: UaRow[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([headers as unknown as string[]]);
  rows.forEach((row, index) => {
    row.forEach((value, column) => {
      const address = XLSX.utils.encode_cell({ r: index + 1, c: column });
      if ((column === 2 || column === 12) && typeof value === 'string' && value.includes('-')) {
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
  XLSX.utils.book_append_sheet(workbook, sheet, 'Query result');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function syntheticUserApprovedWorkbook(options: { correctSpelling?: boolean; rows?: UaRow[] } = {}): Buffer {
  return uaWorkbook(
    options.correctSpelling ? USER_APPROVED_HEADERS_CORRECT : USER_APPROVED_HEADERS_TYPO,
    options.rows ?? SYNTHETIC_UA_ROWS,
  );
}
