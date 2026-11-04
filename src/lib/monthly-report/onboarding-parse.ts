import { cellText, cellToWallClock, mapHeaders, readSheetRows, type WallClock } from './xlsx-read';

export const ONBOARDING_COLUMNS = [
  'Date Time', 'UID', 'Document ID', 'is First Account', 'Trading Account No.',
  'Approval Method', 'Steps', 'Step Status', 'Account Status', 'Remarks',
] as const;

export const ONBOARDING_SHEET = 'Query result';
/**
 * The exports' wall-clock times are WIB: the owner's confirmed figures only
 * match at +07:00. The `+08_00` suffix in CRM export file names is the export
 * timestamp's zone, not the data's, so it is never used to pick the offset.
 */
export const DEFAULT_SOURCE_OFFSET = '+07:00';
export const KNOWN_STEPS = ['auto_kyc', 'manual_kyc', 'auto_video_verify', 'manual_video_verify', 'auto_add_account', 'manual_add_account'];
export const KNOWN_STEP_STATUSES = ['Approved', 'Rejected', 'Pending'];
export const KNOWN_APPROVAL_METHODS = ['Auto', 'Manual'];
export const KNOWN_ACCOUNT_STATUSES = [
  'Registration Failed', 'Real Account Activated', 'KYC Done', 'Video Done',
  'Add USD Bank Info / NPWP Failed', 'Video Verification Failed', 'Add Account Failed',
];

export interface OnboardingRow {
  documentId: string;
  eventAt: string; // ISO UTC
  uid: string | null;
  isFirstAccount: boolean | null;
  tradingAccountNo: string | null;
  approvalMethod: string | null;
  step: string;
  stepStatus: string;
  accountStatus: string | null;
  remarks: string | null;
}

/**
 * Natural key of an onboarding event (migration 043): the same Document ID can
 * appear in several monthly exports with different events (e.g. auto_kyc
 * Pending at the end of September, manual_kyc decision in October), so a
 * Document ID alone is not an event. Document ID + event time + Steps has no
 * collisions inside any export and makes identical rows in two exports collide.
 * Step Status is deliberately not part of the key: a re-export of the same
 * event with a changed status must not count as a second registration.
 */
export function eventKey(row: Pick<OnboardingRow, 'documentId' | 'eventAt' | 'step'>): string {
  return `${row.documentId}|${new Date(row.eventAt).toISOString()}|${row.step}`;
}

const COMPARED_FIELDS = ['uid', 'isFirstAccount', 'tradingAccountNo', 'approvalMethod', 'stepStatus', 'accountStatus', 'remarks'] as const;

/** True when two rows with the same event key also agree on every other column. */
export function sameEventValues(a: OnboardingRow, b: OnboardingRow): boolean {
  return COMPARED_FIELDS.every(field => (a[field] ?? null) === (b[field] ?? null));
}

export interface ParseIssue { row: number; message: string }

export interface OnboardingParseSummary {
  rows: number;
  invalid: number;
  /** Rows dropped because an earlier row in the same file has the same event key (first one wins). */
  duplicatesInFile: number;
  /** Of `duplicatesInFile`: same event key but some other column differs. */
  conflictingDuplicatesInFile: number;
  wibRange: { from: string; to: string } | null;
  byStep: Record<string, number>;
  byStepStatus: Record<string, number>;
  unknownValues: Record<string, string[]>;
}

export interface OnboardingParseResult {
  sheetName: string;
  offset: string;
  errors: string[];
  issues: ParseIssue[];
  rows: OnboardingRow[];
  summary: OnboardingParseSummary;
}

const OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

/** `+08:00` → 480 minutes. Returns null for anything that is not a valid offset. */
export function parseOffset(value: string): number | null {
  const match = OFFSET_RE.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes > 0)) return null;
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

/** Reads `…+08_00.xlsx` / `…+08:00.xlsx` style suffixes from export file names. */
export function offsetFromFileName(fileName: string): string | null {
  const match = /\d([+-])(\d{2})[_:]?(\d{2})\.(xlsx?|csv)$/i.exec(fileName.trim());
  if (!match) return null;
  const offset = `${match[1]}${match[2]}:${match[3]}`;
  return parseOffset(offset) === null ? null : offset;
}

export function wallClockToIso(parts: WallClock, offsetMinutes: number): string {
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm, parts.ss) - offsetMinutes * 60_000).toISOString();
}

/** Calendar day in WIB (UTC+7, no DST) for an ISO UTC timestamp. */
export function wibDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function parseBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = cellText(value).toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no') return false;
  return null;
}

function optional(value: unknown): string | null {
  const text = cellText(value);
  return text ? text : null;
}

function emptySummary(): OnboardingParseSummary {
  return { rows: 0, invalid: 0, duplicatesInFile: 0, conflictingDuplicatesInFile: 0, wibRange: null, byStep: {}, byStepStatus: {}, unknownValues: {} };
}

export function parseOnboardingWorkbook(buffer: Buffer | Uint8Array, options: { offset: string }): OnboardingParseResult {
  const offsetMinutes = parseOffset(options.offset);
  const base = { offset: options.offset, issues: [] as ParseIssue[], rows: [] as OnboardingRow[], summary: emptySummary() };
  if (offsetMinutes === null) return { ...base, sheetName: '', errors: [`Source UTC offset "${options.offset}" is not valid. Use a value like +07:00.`] };

  let sheet;
  try {
    sheet = readSheetRows(buffer, ONBOARDING_SHEET);
  } catch {
    return { ...base, sheetName: '', errors: ['The file could not be read as an Excel workbook.'] };
  }
  const [headerRow, ...dataRows] = sheet.rows;
  const { index, missing } = mapHeaders(headerRow, ONBOARDING_COLUMNS);
  if (missing.length) {
    return { ...base, sheetName: sheet.sheetName, errors: missing.map(header => `Missing column: ${header}`) };
  }

  const issues: ParseIssue[] = [];
  const byKey = new Map<string, number>();
  const rows: OnboardingRow[] = [];
  const summary = emptySummary();
  const unknown: Record<string, Set<string>> = {};
  const noteUnknown = (column: string, value: string | null, known: string[]) => {
    if (value && !known.includes(value)) (unknown[column] ??= new Set()).add(value);
  };
  const cell = (row: unknown[], column: typeof ONBOARDING_COLUMNS[number]) => row[index[column]];

  dataRows.forEach((row, offset) => {
    const rowNumber = offset + 2;
    if (!row || row.every(value => cellText(value) === '')) return;
    const wallClock = cellToWallClock(cell(row, 'Date Time'));
    if (!wallClock) {
      issues.push({ row: rowNumber, message: 'Date Time is missing or not a date' });
      return;
    }
    const documentId = cellText(cell(row, 'Document ID'));
    if (!documentId) {
      issues.push({ row: rowNumber, message: 'Document ID is missing' });
      return;
    }
    const step = cellText(cell(row, 'Steps'));
    const stepStatus = cellText(cell(row, 'Step Status'));
    if (!step || !stepStatus) {
      issues.push({ row: rowNumber, message: 'Steps or Step Status is missing' });
      return;
    }
    const parsed: OnboardingRow = {
      documentId,
      eventAt: wallClockToIso(wallClock, offsetMinutes),
      uid: optional(cell(row, 'UID')),
      isFirstAccount: parseBool(cell(row, 'is First Account')),
      tradingAccountNo: optional(cell(row, 'Trading Account No.')),
      approvalMethod: optional(cell(row, 'Approval Method')),
      step,
      stepStatus,
      accountStatus: optional(cell(row, 'Account Status')),
      remarks: optional(cell(row, 'Remarks')),
    };
    noteUnknown('Approval Method', parsed.approvalMethod, KNOWN_APPROVAL_METHODS);
    noteUnknown('Steps', parsed.step, KNOWN_STEPS);
    noteUnknown('Step Status', parsed.stepStatus, KNOWN_STEP_STATUSES);
    noteUnknown('Account Status', parsed.accountStatus, KNOWN_ACCOUNT_STATUSES);
    const key = eventKey(parsed);
    const existing = byKey.get(key);
    if (existing !== undefined) {
      summary.duplicatesInFile += 1;
      if (!sameEventValues(rows[existing], parsed)) summary.conflictingDuplicatesInFile += 1;
    } else {
      byKey.set(key, rows.length);
      rows.push(parsed);
    }
  });

  for (const row of rows) {
    summary.byStep[row.step] = (summary.byStep[row.step] ?? 0) + 1;
    summary.byStepStatus[row.stepStatus] = (summary.byStepStatus[row.stepStatus] ?? 0) + 1;
    const day = wibDate(row.eventAt);
    if (!summary.wibRange) summary.wibRange = { from: day, to: day };
    else {
      if (day < summary.wibRange.from) summary.wibRange.from = day;
      if (day > summary.wibRange.to) summary.wibRange.to = day;
    }
  }
  summary.rows = rows.length;
  summary.invalid = issues.length;
  summary.unknownValues = Object.fromEntries(Object.entries(unknown).map(([key, values]) => [key, [...values].sort()]));
  const errors = rows.length === 0 && issues.length === 0 ? ['The sheet has no data rows.'] : [];
  return { sheetName: sheet.sheetName, offset: options.offset, errors, issues, rows, summary };
}
