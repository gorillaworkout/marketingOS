/**
 * Upload auto-detect: sniffs the header of a .xlsx/.csv file and decides
 * which parser it belongs to. Only the first rows are parsed, so this is
 * cheap; the chosen parser still validates the whole file afterwards.
 *
 * Detected kinds (auto-import):
 *  - onboarding_summary: daily obd_kyc KPI summary (Date + Total Cases Registration + TOTAL REAL ACCOUNT)
 *  - user_approved: Approver sheet (Record ID + Approver + Create Time + …)
 *  - onboarding: legacy classic event export (kept working for older months)
 * FTD stays manual (rejected here with FTD_IS_MANUAL_MESSAGE).
 */
import { FTD_COLUMNS, findHeader, findReportMonth } from './ftd-parse';
import { ONBOARDING_COLUMNS, ONBOARDING_SHEET } from './onboarding-parse';
import { SUMMARY_REQUIRED_COLUMNS } from './summary-parse';
import { USER_APPROVED_REQUIRED, USER_APPROVED_ALIASES } from './user-approved-parse';
import { mapHeaders, normalizeHeader, readSheetRows } from './xlsx-read';

export type DetectedKind = 'onboarding' | 'onboarding_summary' | 'user_approved' | 'ftd';

export const UPLOAD_KIND_LABELS: Record<DetectedKind, string> = {
  onboarding: 'Onboarding export (classic)',
  onboarding_summary: 'Onboarding daily summary (obd_kyc)',
  user_approved: 'User approved (approver report)',
  ftd: 'FTD report',
};

export type DetectResult =
  | { ok: true; kind: 'onboarding'; label: string; sheetName: string }
  | { ok: true; kind: 'onboarding_summary'; label: string; sheetName: string }
  | { ok: true; kind: 'user_approved'; label: string; sheetName: string }
  | { ok: true; kind: 'ftd'; label: string; sheetName: string; layout: 'report' | 'table' }
  | { ok: false; kind: null; error: string; hints: string[]; expected: Record<'onboarding' | 'onboarding_summary' | 'user_approved' | 'ftd', readonly string[]> };

const SNIFF_ROWS = 40;

export const EXPECTED_COLUMNS = {
  onboarding: ONBOARDING_COLUMNS,
  onboarding_summary: SUMMARY_REQUIRED_COLUMNS,
  user_approved: USER_APPROVED_REQUIRED,
  ftd: FTD_COLUMNS,
} as const;

/** Shown when an FTD file is dropped on the auto-detect upload: daily FTD is entered by hand. */
export const FTD_IS_MANUAL_MESSAGE = 'FTD is entered manually below: pick the date and type the FTD count (and amount). Only the onboarding daily summary, user_approved, or classic onboarding export is uploaded here.';

export type AutoUploadAction = 'onboarding' | 'onboarding_summary' | 'user_approved' | 'ftd-manual' | 'unknown';

/**
 * What the auto-detect upload does with a detected file. FTD files are
 * rejected with FTD_IS_MANUAL_MESSAGE (legacy FTD CSV import stays under
 * "Choose type manually", admin only).
 */
export function autoUploadAction(detected: DetectResult): AutoUploadAction {
  if (!detected.ok) return 'unknown';
  if (detected.kind === 'ftd') return 'ftd-manual';
  return detected.kind;
}

export function unknownFormatError(): string {
  return 'Unknown file format. Expected one of: '
    + `onboarding daily summary (${SUMMARY_REQUIRED_COLUMNS.join(', ')}); `
    + `user_approved (${USER_APPROVED_REQUIRED.join(', ')}, with "Finsihed Time" / "Step Astatus" typos accepted); `
    + `classic onboarding export (${ONBOARDING_COLUMNS.join(', ')}); `
    + `or an FTD report / table (${FTD_COLUMNS.join(', ')}).`;
}

function unknown(hints: string[] = [], error = unknownFormatError()): DetectResult {
  return { ok: false, kind: null, error, hints, expected: EXPECTED_COLUMNS };
}

function hasAliasedRequired(headerRow: unknown[] | undefined): { ok: boolean; missing: string[] } {
  const cells = new Set((headerRow ?? []).map(normalizeHeader));
  const missing: string[] = [];
  for (const required of USER_APPROVED_REQUIRED) {
    const aliases = USER_APPROVED_ALIASES[required] ?? [required];
    if (!aliases.some(alias => cells.has(normalizeHeader(alias)))) missing.push(required);
  }
  return { ok: missing.length === 0, missing };
}

export function detectUploadKind(buffer: Buffer | Uint8Array): DetectResult {
  if (!buffer.length) return unknown([], 'The file is empty.');
  let sheet;
  try {
    sheet = readSheetRows(buffer, ONBOARDING_SHEET, { maxRows: SNIFF_ROWS });
  } catch {
    return unknown([], 'The file could not be read as CSV or Excel.');
  }

  // Classic onboarding first: its columns are a strict superset that summary/UA never have.
  const onboarding = mapHeaders(sheet.rows[0], ONBOARDING_COLUMNS);
  if (!onboarding.missing.length) {
    return { ok: true, kind: 'onboarding', label: UPLOAD_KIND_LABELS.onboarding, sheetName: sheet.sheetName };
  }

  const summary = mapHeaders(sheet.rows[0], SUMMARY_REQUIRED_COLUMNS);
  if (!summary.missing.length) {
    return { ok: true, kind: 'onboarding_summary', label: UPLOAD_KIND_LABELS.onboarding_summary, sheetName: sheet.sheetName };
  }

  const userApproved = hasAliasedRequired(sheet.rows[0]);
  if (userApproved.ok) {
    return { ok: true, kind: 'user_approved', label: UPLOAD_KIND_LABELS.user_approved, sheetName: sheet.sheetName };
  }

  const ftdHeader = findHeader(sheet.rows);
  if (ftdHeader) {
    const layout = ftdHeader.rowIndex > 0 || findReportMonth(sheet.rows.slice(0, ftdHeader.rowIndex)) ? 'report' : 'table';
    return {
      ok: true, kind: 'ftd', layout, sheetName: sheet.sheetName,
      label: layout === 'report' ? `${UPLOAD_KIND_LABELS.ftd} (monthly report)` : `${UPLOAD_KIND_LABELS.ftd} (clean table)`,
    };
  }

  const hints: string[] = [];
  const onboardingFound = ONBOARDING_COLUMNS.length - onboarding.missing.length;
  if (onboardingFound >= 3) hints.push(`Looks like a classic onboarding export, but these columns are missing: ${onboarding.missing.join(', ')}.`);
  const summaryFound = SUMMARY_REQUIRED_COLUMNS.length - summary.missing.length;
  if (summaryFound >= 1 && summary.missing.length) hints.push(`Looks like an onboarding daily summary, but these columns are missing: ${summary.missing.join(', ')}.`);
  if (userApproved.missing.length && userApproved.missing.length <= 3) {
    hints.push(`Looks like a user_approved file, but these columns are missing: ${userApproved.missing.join(', ')}.`);
  }
  const ftdKeys = FTD_COLUMNS.map(normalizeHeader);
  for (const row of sheet.rows.slice(0, 30)) {
    const cells = new Set((row ?? []).map(normalizeHeader));
    const found = ftdKeys.filter(key => cells.has(key));
    if (found.length >= 2 && found.length < ftdKeys.length) {
      hints.push(`Looks like an FTD table, but these columns are missing: ${FTD_COLUMNS.filter(column => !cells.has(normalizeHeader(column))).join(', ')}.`);
      break;
    }
  }
  return unknown(hints);
}
