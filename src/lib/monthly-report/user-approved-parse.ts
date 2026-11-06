/**
 * user_approved Metabase export. Feeds the Approver report and KYC rejection
 * reasons — never the funnel KPIs. Approver = "Deposit Robot" is kept in
 * storage (needed for robot rejection reasons) but skipped for Approver
 * ranking. Times are WIB (+07:00).
 *
 * Header typos in the live export: "Finsihed Time", "Step Astatus". Correct
 * spellings ("Finished Time", "Step Status") are also accepted.
 */
import { cellText, cellToWallClock, normalizeHeader, readSheetRows } from './xlsx-read';
import { ONBOARDING_SHEET, wallClockToIso, parseOffset, DEFAULT_SOURCE_OFFSET } from './onboarding-parse';
import { isStaffManualKycRejection } from './rejection-reasons';

export const USER_APPROVED_REQUIRED = [
  'Record ID',
  'Create Time',
  'Approver',
  'Document ID',
  'Steps',
] as const;

/** Canonical name → accepted header aliases (first match wins). */
export const USER_APPROVED_ALIASES: Record<string, readonly string[]> = {
  'Record ID': ['Record ID'],
  'Create Time': ['Create Time'],
  'Approver': ['Approver'],
  'Document ID': ['Document ID'],
  'Steps': ['Steps'],
  'Step Status': ['Step Astatus', 'Step Status'],
  'Finished Time': ['Finsihed Time', 'Finished Time'],
  'Success Status': ['Success Status'],
  'Approved Status': ['Approved Status'],
  'Approval Method': ['Approval Method'],
  'Applicant UID': ['Applicant UID'],
  'Approver UID': ['Approver UID'],
  'Account': ['Account'],
  'Processing Time': ['Processing Time'],
  'Remark': ['Remark'],
  'Rejected Reason': ['Rejected Reason']};

export const DEPOSIT_ROBOT = 'Deposit Robot';

export interface UserApprovedRow {
  recordId: string;
  documentId: string | null;
  createTime: string; // ISO UTC
  finishedTime: string | null;
  applicantUid: string | null;
  approverUid: string | null;
  approver: string;
  approvalMethod: string | null;
  step: string | null;
  stepStatus: string | null;
  approvedStatus: string | null;
  successStatus: string | null;
  account: string | null;
  processingTime: string | null;
  remark: string | null;
  rejectedReason: string | null;
}

export interface UserApprovedParseIssue { row: number; message: string }

export interface UserApprovedParseSummary {
  rows: number;
  invalid: number;
  skippedRobot: number; // Deposit Robot rows kept in `rows` but excluded from Approver ranking
  /** Empty Approver = KYC not finished yet; not stored, excluded from ranking + rejection reasons. */
  skippedBlankApprover: number;
  duplicatesInFile: number;
  wibRange: { from: string; to: string } | null;
}

export interface UserApprovedParseResult {
  sheetName: string;
  offset: string;
  errors: string[];
  issues: UserApprovedParseIssue[];
  rows: UserApprovedRow[];
  summary: UserApprovedParseSummary;
}

function mapAliasedHeaders(headerRow: unknown[] | undefined) {
  const positions = new Map<string, number>();
  (headerRow ?? []).forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (key && !positions.has(key)) positions.set(key, index);
  });
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const [canonical, aliases] of Object.entries(USER_APPROVED_ALIASES)) {
    let found: number | undefined;
    for (const alias of aliases) {
      const pos = positions.get(normalizeHeader(alias));
      if (pos !== undefined) { found = pos; break; }
    }
    if (found === undefined) {
      if ((USER_APPROVED_REQUIRED as readonly string[]).includes(canonical)) missing.push(canonical);
    } else {
      index[canonical] = found;
    }
  }
  return { index, missing };
}

function cellIso(value: unknown, offsetMinutes: number): string | null {
  const wall = cellToWallClock(value);
  if (!wall) return null;
  return wallClockToIso(wall, offsetMinutes);
}

function wibDayFromIso(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Fallback key when Record ID is blank: document_id + create_time + step. */
export function userApprovedKey(row: Pick<UserApprovedRow, 'recordId' | 'documentId' | 'createTime' | 'step'>): string {
  if (row.recordId) return row.recordId;
  return `${row.documentId ?? ''}|${new Date(row.createTime).toISOString()}|${row.step ?? ''}`;
}

export function parseUserApproved(
  buffer: Buffer | Uint8Array,
  options: { offset?: string } = {},
): UserApprovedParseResult {
  const offset = options.offset ?? DEFAULT_SOURCE_OFFSET;
  const offsetMinutes = parseOffset(offset);
  if (offsetMinutes === null) {
    return {
      sheetName: '', offset, errors: [`Invalid timezone offset: ${offset}`], issues: [], rows: [],
      summary: { rows: 0, invalid: 0, skippedRobot: 0, skippedBlankApprover: 0, duplicatesInFile: 0, wibRange: null }};
  }
  const sheet = readSheetRows(buffer, ONBOARDING_SHEET);
  const mapped = mapAliasedHeaders(sheet.rows[0]);
  if (mapped.missing.length) {
    return {
      sheetName: sheet.sheetName, offset,
      errors: [`Missing required columns: ${mapped.missing.join(', ')}.`],
      issues: [], rows: [],
      summary: { rows: 0, invalid: 0, skippedRobot: 0, skippedBlankApprover: 0, duplicatesInFile: 0, wibRange: null }};
  }

  const rows: UserApprovedRow[] = [];
  const issues: UserApprovedParseIssue[] = [];
  let skippedRobot = 0;
  let skippedBlankApprover = 0;
  const seen = new Set<string>();
  let duplicatesInFile = 0;
  const idx = mapped.index;
  const at = (raw: unknown[], name: string) => (idx[name] === undefined ? null : raw[idx[name]]);

  for (let i = 1; i < sheet.rows.length; i += 1) {
    const raw = sheet.rows[i] ?? [];
    if (raw.every(cell => cell === null || cell === undefined || cellText(cell) === '')) continue;

    const approver = cellText(at(raw, 'Approver'));
    // Empty Approver means KYC is not finished yet — skip (do not store, do not count as invalid).
    if (!approver) {
      skippedBlankApprover += 1;
      continue;
    }
    // Deposit Robot rows are stored (rejection reasons) but excluded from Approver ranking.
    if (approver === DEPOSIT_ROBOT) skippedRobot += 1;

    const createTime = cellIso(at(raw, 'Create Time'), offsetMinutes);
    if (!createTime) {
      issues.push({ row: i + 1, message: 'Create Time is missing or invalid' });
      continue;
    }
    const finishedRaw = at(raw, 'Finished Time');
    const finishedTime = finishedRaw === null || finishedRaw === undefined || cellText(finishedRaw) === ''
      ? null
      : cellIso(finishedRaw, offsetMinutes);

    const recordIdRaw = cellText(at(raw, 'Record ID'));
    const documentId = cellText(at(raw, 'Document ID')) || null;
    const step = cellText(at(raw, 'Steps')) || null;
    const recordId = recordIdRaw || `${documentId ?? ''}|${createTime}|${step ?? ''}`;
    if (!recordIdRaw && !documentId) {
      issues.push({ row: i + 1, message: 'Record ID and Document ID are both blank' });
      continue;
    }

    const row: UserApprovedRow = {
      recordId,
      documentId,
      createTime,
      finishedTime,
      applicantUid: cellText(at(raw, 'Applicant UID')) || null,
      approverUid: cellText(at(raw, 'Approver UID')) || null,
      approver,
      approvalMethod: cellText(at(raw, 'Approval Method')) || null,
      step,
      stepStatus: cellText(at(raw, 'Step Status')) || null,
      approvedStatus: cellText(at(raw, 'Approved Status')) || null,
      successStatus: cellText(at(raw, 'Success Status')) || null,
      account: cellText(at(raw, 'Account')) || null,
      processingTime: cellText(at(raw, 'Processing Time')) || null,
      remark: cellText(at(raw, 'Remark')) || null,
      rejectedReason: cellText(at(raw, 'Rejected Reason')) || null};
    const key = userApprovedKey(row);
    if (seen.has(key)) { duplicatesInFile += 1; continue; }
    seen.add(key);
    rows.push(row);
  }

  let wibRange: { from: string; to: string } | null = null;
  if (rows.length) {
    const days = rows.map(row => wibDayFromIso(row.finishedTime ?? row.createTime)).sort();
    wibRange = { from: days[0], to: days[days.length - 1] };
  }

  return {
    sheetName: sheet.sheetName,
    offset,
    errors: [],
    issues,
    rows,
    summary: {
      rows: rows.length,
      invalid: issues.length,
      skippedRobot,
      skippedBlankApprover,
      duplicatesInFile,
      wibRange}};
}

export interface ApproverStat {
  approver: string;
  /** Final approvals (Success Status = Approved), bucketed by Finished Time (else Create Time). */
  finalApproved: number;
  /** Approved steps (Approved Status = Approved), bucketed by Create Time. */
  stepsApproved: number;
  /**
   * Staff manual KYC rejections (Manual + manual_kyc, Failed/Rejected on
   * Approved Status or Success Status), same finished-time bucket as finalApproved.
   */
  finalRejected: number;
}

/**
 * Aggregates approver counts for a WIB date range. Pure: pass already-filtered rows.
 * Main sort key = finalApproved descending.
 */
export function aggregateApproverStats(rows: UserApprovedRow[]): ApproverStat[] {
  const by = new Map<string, ApproverStat>();
  const bump = (name: string) => {
    let row = by.get(name);
    if (!row) { row = { approver: name, finalApproved: 0, stepsApproved: 0, finalRejected: 0 }; by.set(name, row); }
    return row;
  };
  for (const row of rows) {
    if (!row.approver?.trim() || row.approver === DEPOSIT_ROBOT) continue;
    const stat = bump(row.approver);
    if (/^approved$/i.test(row.successStatus ?? '')) stat.finalApproved += 1;
    if (isStaffManualKycRejection(row)) stat.finalRejected += 1;
    if (/^approved$/i.test(row.approvedStatus ?? '')) stat.stepsApproved += 1;
  }
  return [...by.values()].sort((a, b) => b.finalApproved - a.finalApproved || a.approver.localeCompare(b.approver));
}

/** Keep rows whose attribution day (finished else create) falls in [from, to] inclusive. */
export function filterUserApprovedByFinishedDay(rows: UserApprovedRow[], from: string, to: string): UserApprovedRow[] {
  return rows.filter(row => {
    const day = wibDayFromIso(row.finishedTime ?? row.createTime);
    return day >= from && day <= to;
  });
}

/** Keep rows whose Create Time WIB day falls in range (for the steps-approved secondary). */
export function filterUserApprovedByCreateDay(rows: UserApprovedRow[], from: string, to: string): UserApprovedRow[] {
  return rows.filter(row => {
    const day = wibDayFromIso(row.createTime);
    return day >= from && day <= to;
  });
}

/**
 * Builds ApproverStats with the dual bucketing rule:
 * finalApproved and finalRejected (staff manual KYC) by Finished (else Create); stepsApproved by Create Time.
 * An approver with only rejections still appears.
 */
export function buildApproverReport(rows: UserApprovedRow[], range: { from: string; to: string }): ApproverStat[] {
  const by = new Map<string, ApproverStat>();
  const bump = (name: string) => {
    let row = by.get(name);
    if (!row) { row = { approver: name, finalApproved: 0, stepsApproved: 0, finalRejected: 0 }; by.set(name, row); }
    return row;
  };
  for (const row of rows) {
    if (!row.approver?.trim() || row.approver === DEPOSIT_ROBOT) continue;
    const finishedDay = wibDayFromIso(row.finishedTime ?? row.createTime);
    const createDay = wibDayFromIso(row.createTime);
    if (finishedDay >= range.from && finishedDay <= range.to) {
      const stat = bump(row.approver);
      if (/^approved$/i.test(row.successStatus ?? '')) stat.finalApproved += 1;
      if (isStaffManualKycRejection(row)) stat.finalRejected += 1;
    }
    if (createDay >= range.from && createDay <= range.to) {
      if (/^approved$/i.test(row.approvedStatus ?? '')) bump(row.approver).stepsApproved += 1;
    }
  }
  return [...by.values()].sort((a, b) => b.finalApproved - a.finalApproved || a.approver.localeCompare(b.approver));
}
