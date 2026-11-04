/**
 * Upload auto-detect: sniffs the header of a .xlsx/.csv file and decides
 * which parser it belongs to. Only the first rows are parsed, so this is
 * cheap; the chosen parser still validates the whole file afterwards.
 *
 *  - Onboarding export: the "Query result" sheet (or the first sheet) has all
 *    onboarding columns in its first row.
 *  - FTD: a block starting with "Account" with the FTD columns within the first
 *    30 rows, either the monthly FTD report (title/month rows above, side-by-side
 *    blocks) or a clean table (header in the first row).
 */
import { FTD_COLUMNS, findHeader, findReportMonth } from './ftd-parse';
import { ONBOARDING_COLUMNS, ONBOARDING_SHEET } from './onboarding-parse';
import { mapHeaders, normalizeHeader, readSheetRows } from './xlsx-read';

export type DetectedKind = 'onboarding' | 'ftd';

export const UPLOAD_KIND_LABELS: Record<DetectedKind, string> = {
  onboarding: 'Onboarding export',
  ftd: 'FTD report',
};

export type DetectResult =
  | { ok: true; kind: 'onboarding'; label: string; sheetName: string }
  | { ok: true; kind: 'ftd'; label: string; sheetName: string; layout: 'report' | 'table' }
  | { ok: false; kind: null; error: string; hints: string[]; expected: Record<DetectedKind, readonly string[]> };

const SNIFF_ROWS = 40;

export const EXPECTED_COLUMNS: Record<DetectedKind, readonly string[]> = {
  onboarding: ONBOARDING_COLUMNS,
  ftd: FTD_COLUMNS,
};

/** Shown when an FTD file is dropped on the auto-detect upload: daily FTD is entered by hand. */
export const FTD_IS_MANUAL_MESSAGE = 'FTD is entered manually below: pick the date and type the FTD count (and amount). Only the onboarding export is uploaded here.';

/**
 * What the auto-detect upload does with a detected file. Only onboarding
 * exports are imported; an FTD file is rejected with FTD_IS_MANUAL_MESSAGE
 * (the legacy FTD CSV import stays under "Choose type manually", admin only).
 */
export function autoUploadAction(detected: DetectResult): 'onboarding' | 'ftd-manual' | 'unknown' {
  if (!detected.ok) return 'unknown';
  return detected.kind === 'onboarding' ? 'onboarding' : 'ftd-manual';
}

export function unknownFormatError(): string {
  return 'Unknown file format. Expected an onboarding export with the columns: '
    + `${ONBOARDING_COLUMNS.join(', ')}; or an FTD report / table with the columns: ${FTD_COLUMNS.join(', ')}.`;
}

function unknown(hints: string[] = [], error = unknownFormatError()): DetectResult {
  return { ok: false, kind: null, error, hints, expected: EXPECTED_COLUMNS };
}

export function detectUploadKind(buffer: Buffer | Uint8Array): DetectResult {
  if (!buffer.length) return unknown([], 'The file is empty.');
  let sheet;
  try {
    sheet = readSheetRows(buffer, ONBOARDING_SHEET, { maxRows: SNIFF_ROWS });
  } catch {
    return unknown([], 'The file could not be read as CSV or Excel.');
  }

  const onboarding = mapHeaders(sheet.rows[0], ONBOARDING_COLUMNS);
  if (!onboarding.missing.length) {
    return { ok: true, kind: 'onboarding', label: UPLOAD_KIND_LABELS.onboarding, sheetName: sheet.sheetName };
  }

  const ftdHeader = findHeader(sheet.rows);
  if (ftdHeader) {
    const layout = ftdHeader.rowIndex > 0 || findReportMonth(sheet.rows.slice(0, ftdHeader.rowIndex)) ? 'report' : 'table';
    return {
      ok: true, kind: 'ftd', layout, sheetName: sheet.sheetName,
      label: layout === 'report' ? `${UPLOAD_KIND_LABELS.ftd} (monthly report)` : `${UPLOAD_KIND_LABELS.ftd} (clean table)`,
    };
  }

  // Near misses: say which columns are missing so the uploader can fix the export.
  const hints: string[] = [];
  const onboardingFound = ONBOARDING_COLUMNS.length - onboarding.missing.length;
  if (onboardingFound >= 3) hints.push(`Looks like an onboarding export, but these columns are missing: ${onboarding.missing.join(', ')}.`);
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
