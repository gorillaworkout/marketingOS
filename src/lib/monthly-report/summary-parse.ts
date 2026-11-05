/**
 * Daily onboarding KPI summary (obd_kyc Metabase "Query result").
 * One data row per WIB Date; a trailing "Total" aggregate row is skipped.
 *
 * Column → dashboard metric (Bayu 2026-11-04 / 2026-11-05):
 *  - Registrations            = Total Cases Registration
 *  - Real Account Activated   = TOTAL REAL ACCOUNT
 *      (equals First Account Auto Add Done + Not The First Account Auto Add Done
 *       when those columns are present; it does NOT include Manual Approved)
 *  - Manual Approved Demo Not Done = KYC Manual Approved Demo Not Done
 *  - Total Real Account       = TOTAL REAL ACCOUNT + Manual Approved Demo Not Done
 *      (do not add twice: if TOTAL REAL ACCOUNT already equals activated+manual,
 *       treat it as already inclusive and use it as Total Real Account)
 *  - KYC Rejected             = KYC Manual Rejected
 *  - First / Additional acct  = First Account Auto Add Done / Not The First…
 *  - Auto KYC approved        = KYC Auto Approved Demo Not Done + Demo Done
 */
import { cellText, cellToWallClock, mapHeaders, normalizeHeader, readSheetRows } from './xlsx-read';
import { ONBOARDING_SHEET } from './onboarding-parse';
import type { DailyOnboarding } from './metrics';

export const SUMMARY_REQUIRED_COLUMNS = [
  'Date',
  'Total Cases Registration',
  'TOTAL REAL ACCOUNT',
] as const;

export const SUMMARY_OPTIONAL_COLUMNS = [
  'KYC Manual Approved Demo Not Done',
  'KYC Manual Rejected',
  'First Account Auto Add Done',
  'Not The First Account Auto Add Done',
  'KYC Auto Approved Demo Not Done',
  'KYC Auto Approved Demo Done',
] as const;

export interface SummaryRow {
  date: string; // YYYY-MM-DD WIB
  registrations: number;
  totalRealAccount: number;
  manualKycApproved: number;
  kycRejected: number;
  firstAccount: number;
  additionalAccount: number;
  autoKycApproved: number;
  /** True when TOTAL REAL ACCOUNT already equals activated + manual (don't add again). */
  totalIncludesManual: boolean;
}

export interface SummaryParseIssue { row: number; message: string }

export interface SummaryParseSummary {
  rows: number;
  invalid: number;
  skippedTotal: number;
  wibRange: { from: string; to: string } | null;
}

export interface SummaryParseResult {
  sheetName: string;
  errors: string[];
  issues: SummaryParseIssue[];
  rows: SummaryRow[];
  summary: SummaryParseSummary;
}

function intCell(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = cellText(value).replace(/,/g, '');
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function dateCell(value: unknown): string | null {
  const text = cellText(value);
  if (/^total$/i.test(text)) return null;
  const wall = cellToWallClock(value);
  if (!wall) return null;
  return `${wall.y}-${String(wall.m).padStart(2, '0')}-${String(wall.d).padStart(2, '0')}`;
}

function optionalIndex(headerRow: unknown[] | undefined, name: string): number | undefined {
  const want = normalizeHeader(name);
  for (let i = 0; i < (headerRow ?? []).length; i += 1) {
    if (normalizeHeader(headerRow![i]) === want) return i;
  }
  return undefined;
}

/**
 * Maps a parsed summary row onto the DailyOnboarding shape used by the report.
 * Activated = TOTAL REAL ACCOUNT when it does not already include manual, else
 * TOTAL − manual (clamped). Total Real Account on the dashboard = activated + manual.
 */
export function summaryToDaily(row: SummaryRow): DailyOnboarding {
  const activated = row.totalIncludesManual
    ? Math.max(0, row.totalRealAccount - row.manualKycApproved)
    : row.totalRealAccount;
  return {
    date: row.date,
    events: row.registrations,
    kycRejected: row.kycRejected,
    manualKycApproved: row.manualKycApproved,
    autoKycApproved: row.autoKycApproved,
    firstAccount: row.firstAccount,
    additionalAccount: row.additionalAccount,
    activated,
    approvedBankInfoPending: 0,
    pendingVideoFailed: 0,
  };
}

/** Pure helper: decide whether TOTAL REAL ACCOUNT already includes manual approved. */
export function totalRealAccountIncludesManual(
  totalRealAccount: number,
  activatedParts: number | null,
  manual: number,
): boolean {
  if (manual <= 0) return false;
  if (activatedParts !== null && totalRealAccount === activatedParts + manual) return true;
  if (activatedParts !== null && totalRealAccount === activatedParts) return false;
  // No add-done columns: if TOTAL looks like it already absorbed manual, don't double.
  return false;
}

export function parseOnboardingSummary(buffer: Buffer | Uint8Array): SummaryParseResult {
  const sheet = readSheetRows(buffer, ONBOARDING_SHEET);
  const required = mapHeaders(sheet.rows[0], SUMMARY_REQUIRED_COLUMNS);
  if (required.missing.length) {
    return {
      sheetName: sheet.sheetName,
      errors: [`Missing required columns: ${required.missing.join(', ')}.`],
      issues: [],
      rows: [],
      summary: { rows: 0, invalid: 0, skippedTotal: 0, wibRange: null },
    };
  }
  const opt: Record<string, number | undefined> = {};
  for (const name of SUMMARY_OPTIONAL_COLUMNS) opt[name] = optionalIndex(sheet.rows[0], name);

  const rows: SummaryRow[] = [];
  const issues: SummaryParseIssue[] = [];
  let skippedTotal = 0;
  const seen = new Set<string>();

  for (let i = 1; i < sheet.rows.length; i += 1) {
    const raw = sheet.rows[i] ?? [];
    const dateRaw = raw[required.index['Date']];
    if (/^total$/i.test(cellText(dateRaw))) { skippedTotal += 1; continue; }
    if (raw.every(cell => cell === null || cell === undefined || cellText(cell) === '')) continue;

    const date = dateCell(dateRaw);
    if (!date) {
      issues.push({ row: i + 1, message: 'Date is missing or invalid' });
      continue;
    }
    const registrations = intCell(raw[required.index['Total Cases Registration']]);
    const totalRealAccount = intCell(raw[required.index['TOTAL REAL ACCOUNT']]);
    if (registrations === null || totalRealAccount === null) {
      issues.push({ row: i + 1, message: 'Registrations or TOTAL REAL ACCOUNT is not a number' });
      continue;
    }
    const get = (name: string) => (opt[name] === undefined ? 0 : intCell(raw[opt[name]!]));
    const manual = get('KYC Manual Approved Demo Not Done') ?? 0;
    const rejected = get('KYC Manual Rejected') ?? 0;
    const first = get('First Account Auto Add Done') ?? 0;
    const additional = get('Not The First Account Auto Add Done') ?? 0;
    const autoNotDone = get('KYC Auto Approved Demo Not Done') ?? 0;
    const autoDone = get('KYC Auto Approved Demo Done') ?? 0;
    if ([manual, rejected, first, additional, autoNotDone, autoDone].some(v => v === null)) {
      issues.push({ row: i + 1, message: 'A numeric KPI column is not a number' });
      continue;
    }
    const activatedParts = (opt['First Account Auto Add Done'] !== undefined || opt['Not The First Account Auto Add Done'] !== undefined)
      ? (first as number) + (additional as number)
      : null;
    if (seen.has(date)) {
      issues.push({ row: i + 1, message: `Duplicate Date ${date} in file (first row wins)` });
      continue;
    }
    seen.add(date);
    rows.push({
      date,
      registrations,
      totalRealAccount,
      manualKycApproved: manual as number,
      kycRejected: rejected as number,
      firstAccount: first as number,
      additionalAccount: additional as number,
      autoKycApproved: (autoNotDone as number) + (autoDone as number),
      totalIncludesManual: totalRealAccountIncludesManual(totalRealAccount, activatedParts, manual as number),
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return {
    sheetName: sheet.sheetName,
    errors: [],
    issues,
    rows,
    summary: {
      rows: rows.length,
      invalid: issues.length,
      skippedTotal,
      wibRange: rows.length ? { from: rows[0].date, to: rows[rows.length - 1].date } : null,
    },
  };
}

/** Fingerprint used to decide identical re-upload vs replace. */
export function summaryFingerprint(row: SummaryRow): string {
  return [
    row.registrations, row.totalRealAccount, row.manualKycApproved, row.kycRejected,
    row.firstAccount, row.additionalAccount, row.autoKycApproved,
  ].join('|');
}
