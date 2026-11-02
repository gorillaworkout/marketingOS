/**
 * Monthly Report persistence. Uploads (and later the API sync) write the
 * normalized tables; the report API only reads aggregates from here.
 * Event classification itself stays in metrics.ts: SQL groups events by
 * WIB day and classification columns, then `classifyEvent` labels each group.
 */
import { v4 as uuidv4 } from 'uuid';
import { executeTransaction, queryAll, queryOne } from '@/lib/database';
import type { FtdRow } from './ftd-parse';
import {
  ACTIVATED_STATUS, ADD_ACCOUNT_STEPS, BANK_INFO_FAILED_STATUS, VIDEO_FAILED_STATUS, classifyEvent,
  type DailyFtd, type DailyOnboarding, type PeriodData,
} from './metrics';
import type { OnboardingRow } from './onboarding-parse';
import type { StoredEvent } from './conflicts';
import { REPORT_TIMEZONE, type DateRange } from './periods';

export type UploadKind = 'onboarding' | 'ftd' | 'rejection_reasons';
export type DataSource = 'upload' | 'api';

export interface UploadActor { id: string | null; name: string }

export interface UpsertCounts { total: number; inserted: number; updated: number; unchanged: number; skipped: number }

export interface UploadRecord {
  id: string;
  kind: UploadKind;
  file_name: string;
  source_utc_offset: string | null;
  uploaded_by_name: string | null;
  rows_total: number;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  data_from: string | null;
  data_to: string | null;
  created_at: string;
}

const BATCH = 500;
const TZ = `'${REPORT_TIMEZONE}'`;

/** WIB calendar day of a timestamptz column, as `YYYY-MM-DD`. */
export const wibDaySql = (column: string) => `to_char(${column} AT TIME ZONE ${TZ}, 'YYYY-MM-DD')`;
/** `column` falls on a WIB day inside [?, ?] (two date parameters). */
export const wibRangeSql = (column: string) =>
  `${column} >= ((?::date)::timestamp AT TIME ZONE ${TZ}) AND ${column} < (((?::date) + 1)::timestamp AT TIME ZONE ${TZ})`;

const quoteList = (values: readonly string[]) => values.map(value => `'${value.replace(/'/g, "''")}'`).join(', ');
/** SQL twin of `isActivation(classifyEvent(row))`. */
export const ACTIVATION_SQL = `e.step IN (${quoteList(ADD_ACCOUNT_STEPS)}) AND e.step_status = 'Approved' AND e.account_status = '${ACTIVATED_STATUS}'`;
const ACCOUNT_KEY_SQL = `COALESCE('acct:' || NULLIF(e.trading_account_no, ''), 'doc:' || e.document_id)`;

export function chunkRows<T>(rows: T[], size = BATCH): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) batches.push(rows.slice(index, index + size));
  return batches;
}

function upsertSql(table: string, columns: string[], key: string, count: number, casts: Record<string, string> = {}): string {
  const placeholders = `(${columns.map(column => `?${casts[column] ?? ''}`).join(', ')})`;
  const updatable = columns.filter(column => column !== key && column !== 'upload_id');
  return `INSERT INTO ${table} (${columns.join(', ')})
VALUES ${Array.from({ length: count }, () => placeholders).join(', ')}
ON CONFLICT (${key}) DO UPDATE SET
  ${updatable.map(column => `${column} = EXCLUDED.${column}`).join(',\n  ')},
  upload_id = EXCLUDED.upload_id,
  updated_at = CURRENT_TIMESTAMP
WHERE (${updatable.map(column => `${table}.${column}`).join(', ')}) IS DISTINCT FROM (${updatable.map(column => `EXCLUDED.${column}`).join(', ')})`;
}

interface UpsertPlan<T> {
  kind: UploadKind;
  table: string;
  key: string;
  columns: string[];
  casts?: Record<string, string>;
  keyOf: (row: T) => string;
  values: (row: T, uploadId: string) => unknown[];
}

async function upsertWithHistory<T>(
  plan: UpsertPlan<T>,
  rows: T[],
  meta: { fileName: string; offset: string | null; actor: UploadActor; skipped: number; range: DateRange | null },
): Promise<{ uploadId: string; counts: UpsertCounts }> {
  const uploadId = uuidv4();
  const existing = rows.length
    ? await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${plan.table} WHERE ${plan.key}::text = ANY(?::text[])`, [rows.map(plan.keyOf)])
    : { count: '0' };
  const existingCount = Number(existing?.count ?? 0);
  let written = 0;
  await executeTransaction(async transaction => {
    await transaction.execute(
      `INSERT INTO monthly_report_uploads (id, kind, file_name, source_utc_offset, uploaded_by, uploaded_by_name, rows_total, rows_skipped, data_from, data_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uploadId, plan.kind, meta.fileName, meta.offset, meta.actor.id, meta.actor.name, rows.length + meta.skipped, meta.skipped, meta.range?.from ?? null, meta.range?.to ?? null],
    );
    for (const batch of chunkRows(rows)) {
      written += await transaction.execute(
        upsertSql(plan.table, plan.columns, plan.key, batch.length, plan.casts),
        batch.flatMap(row => plan.values(row, uploadId)),
      );
    }
    const inserted = rows.length - existingCount;
    await transaction.execute('UPDATE monthly_report_uploads SET rows_inserted = ?, rows_updated = ? WHERE id = ?', [inserted, Math.max(0, written - inserted), uploadId]);
  });
  const inserted = rows.length - existingCount;
  const updated = Math.max(0, written - inserted);
  return { uploadId, counts: { total: rows.length, inserted, updated, unchanged: existingCount - updated, skipped: meta.skipped } };
}

export function saveOnboardingEvents(rows: OnboardingRow[], meta: { fileName: string; offset: string; actor: UploadActor; skipped: number; range: DateRange | null }, source: DataSource = 'upload') {
  return upsertWithHistory<OnboardingRow>({
    kind: 'onboarding',
    table: 'onboarding_events',
    key: 'document_id',
    columns: ['document_id', 'event_at', 'uid', 'is_first_account', 'trading_account_no', 'approval_method', 'step', 'step_status', 'account_status', 'remarks', 'source', 'upload_id'],
    casts: { event_at: '::timestamptz' },
    keyOf: row => row.documentId,
    values: (row, uploadId) => [row.documentId, row.eventAt, row.uid, row.isFirstAccount, row.tradingAccountNo, row.approvalMethod, row.step, row.stepStatus, row.accountStatus, row.remarks, source, uploadId],
  }, rows, meta);
}

export function saveFtd(rows: FtdRow[], meta: { fileName: string; offset: string; actor: UploadActor; skipped: number; range: DateRange | null }, source: DataSource = 'upload') {
  return upsertWithHistory<FtdRow>({
    kind: 'ftd',
    table: 'onboarding_ftd',
    key: 'account_no',
    columns: ['account_no', 'account_type', 'join_date', 'ftd_at', 'amount', 'source', 'upload_id'],
    casts: { join_date: '::date', ftd_at: '::timestamptz', amount: '::numeric' },
    keyOf: row => row.accountNo,
    values: (row, uploadId) => [row.accountNo, row.accountType, row.joinDate, row.ftdAt, row.amount.toFixed(2), source, uploadId],
  }, rows, meta);
}

interface EventGroupRow {
  day: string;
  step: string;
  step_status: string;
  account_status: string | null;
  is_first_account: boolean | null;
  events: string;
}

/** Per-day onboarding counts for a WIB date range, identical to aggregateEventsByDay. */
export async function loadDailyOnboarding(range: DateRange): Promise<DailyOnboarding[]> {
  const groups = await queryAll<EventGroupRow & Record<string, unknown>>(
    `SELECT ${wibDaySql('e.event_at')} AS day, e.step, e.step_status, e.account_status, e.is_first_account, COUNT(*)::text AS events
     FROM onboarding_events e WHERE ${wibRangeSql('e.event_at')}
     GROUP BY 1, 2, 3, 4, 5`,
    [range.from, range.to],
  );
  const activated = await queryAll<{ day: string; accounts: string }>(
    `SELECT ${wibDaySql('e.event_at')} AS day, COUNT(DISTINCT ${ACCOUNT_KEY_SQL})::text AS accounts
     FROM onboarding_events e WHERE ${wibRangeSql('e.event_at')} AND ${ACTIVATION_SQL} GROUP BY 1`,
    [range.from, range.to],
  );
  const days = new Map<string, DailyOnboarding>();
  const dayOf = (date: string) => {
    let day = days.get(date);
    if (!day) {
      day = { date, kycRejected: 0, manualKycApproved: 0, autoKycApproved: 0, firstAccount: 0, additionalAccount: 0, activated: 0, approvedBankInfoPending: 0, pendingVideoFailed: 0, events: 0 };
      days.set(date, day);
    }
    return day;
  };
  for (const group of groups) {
    const day = dayOf(group.day);
    const count = Number(group.events);
    day.events += count;
    switch (classifyEvent({ step: group.step, stepStatus: group.step_status, accountStatus: group.account_status, isFirstAccount: group.is_first_account })) {
      case 'kyc_rejected': day.kycRejected += count; break;
      case 'manual_kyc_approved': day.manualKycApproved += count; break;
      case 'auto_kyc_approved': day.autoKycApproved += count; break;
      case 'first_account': day.firstAccount += count; break;
      case 'additional_account': day.additionalAccount += count; break;
      case 'approved_bank_info_pending': day.approvedBankInfoPending += count; break;
      case 'pending_video_failed': day.pendingVideoFailed += count; break;
      default: break;
    }
  }
  for (const row of activated) dayOf(row.day).activated = Number(row.accounts);
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadUniqueActivated(range: DateRange): Promise<number> {
  const row = await queryOne<{ accounts: string }>(
    `SELECT COUNT(DISTINCT ${ACCOUNT_KEY_SQL})::text AS accounts FROM onboarding_events e WHERE ${wibRangeSql('e.event_at')} AND ${ACTIVATION_SQL}`,
    [range.from, range.to],
  );
  return Number(row?.accounts ?? 0);
}

export async function loadDailyFtd(range: DateRange): Promise<DailyFtd[]> {
  const rows = await queryAll<{ date: string; count: string; cents: string; micro: string; standard: string }>(
    `SELECT ${wibDaySql('f.ftd_at')} AS date, COUNT(*)::text AS count, SUM(ROUND(f.amount * 100))::text AS cents,
       COUNT(*) FILTER (WHERE f.account_type = 'micro')::text AS micro,
       COUNT(*) FILTER (WHERE f.account_type = 'standard')::text AS standard
     FROM onboarding_ftd f WHERE ${wibRangeSql('f.ftd_at')} GROUP BY 1 ORDER BY 1`,
    [range.from, range.to],
  );
  return rows.map(row => {
    const count = Number(row.count);
    const micro = Number(row.micro);
    const standard = Number(row.standard);
    return { date: row.date, count, amount: Number(row.cents) / 100, micro, standard, other: count - micro - standard };
  });
}

export async function loadFtdCoverage(): Promise<DateRange | null> {
  const row = await queryOne<{ from: string | null; to: string | null }>(
    `SELECT MIN(${wibDaySql('f.ftd_at')}) AS "from", MAX(${wibDaySql('f.ftd_at')}) AS "to" FROM onboarding_ftd f`,
  );
  return row?.from && row.to ? { from: row.from, to: row.to } : null;
}

/** SQL twin of `ftdCohortStats` (join on trading account number). */
export async function loadFtdCohort(range: DateRange): Promise<PeriodData['ftdCohort']> {
  const row = await queryOne<{ activated_with_ftd: string; ftd_from_period: string }>(
    `WITH activated AS (
       SELECT DISTINCT e.trading_account_no AS account_no FROM onboarding_events e
       WHERE ${wibRangeSql('e.event_at')} AND ${ACTIVATION_SQL} AND NULLIF(e.trading_account_no, '') IS NOT NULL
     )
     SELECT
       (SELECT COUNT(*) FROM activated a JOIN onboarding_ftd f ON f.account_no = a.account_no)::text AS activated_with_ftd,
       (SELECT COUNT(*) FROM onboarding_ftd f JOIN activated a ON a.account_no = f.account_no WHERE ${wibRangeSql('f.ftd_at')})::text AS ftd_from_period`,
    [range.from, range.to, range.from, range.to],
  );
  return { activatedWithFtd: Number(row?.activated_with_ftd ?? 0), ftdFromPeriodActivations: Number(row?.ftd_from_period ?? 0) };
}

export async function loadPeriodData(range: DateRange, ftdCoverage?: DateRange | null): Promise<PeriodData> {
  const [daily, ftd, uniqueActivated, ftdCohort, coverage] = await Promise.all([
    loadDailyOnboarding(range),
    loadDailyFtd(range),
    loadUniqueActivated(range),
    loadFtdCohort(range),
    ftdCoverage === undefined ? loadFtdCoverage() : Promise.resolve(ftdCoverage),
  ]);
  return { daily, ftd, ftdCoverage: coverage, uniqueActivated, ftdCohort };
}

export async function hasAnyOnboardingData(): Promise<boolean> {
  return Boolean(await queryOne('SELECT 1 FROM onboarding_events LIMIT 1'));
}

export async function listUploads(limit = 50): Promise<UploadRecord[]> {
  const rows = await queryAll<UploadRecord & Record<string, unknown>>(
    `SELECT id, kind, file_name, source_utc_offset, uploaded_by_name, rows_total, rows_inserted, rows_updated, rows_skipped,
       to_char(data_from, 'YYYY-MM-DD') AS data_from, to_char(data_to, 'YYYY-MM-DD') AS data_to, created_at
     FROM monthly_report_uploads ORDER BY created_at DESC LIMIT ?`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map(row => ({ ...row, created_at: new Date(row.created_at).toISOString() }));
}

export const DETAIL_KINDS = {
  bank_info_pending: {
    label: 'Approved, bank info / NPWP pending',
    sql: `e.step IN (${quoteList(ADD_ACCOUNT_STEPS)}) AND e.step_status = 'Approved' AND e.account_status = '${BANK_INFO_FAILED_STATUS}'`,
  },
  kyc_rejected: { label: 'KYC rejected', sql: `e.step = 'manual_kyc' AND e.step_status = 'Rejected'` },
  pending_video_failed: { label: 'Pending, video verification failed', sql: `e.step_status = 'Pending' AND e.account_status = '${VIDEO_FAILED_STATUS}'` },
} as const;
export type DetailKind = keyof typeof DETAIL_KINDS;

export interface DetailRow {
  event_at: string;
  uid: string | null;
  trading_account_no: string | null;
  step: string;
  step_status: string;
  account_status: string | null;
  approval_method: string | null;
  remarks: string | null;
}

export async function listDetails(kind: DetailKind, range: DateRange, limit = 200): Promise<{ total: number; rows: DetailRow[] }> {
  const where = `${wibRangeSql('e.event_at')} AND ${DETAIL_KINDS[kind].sql}`;
  const total = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM onboarding_events e WHERE ${where}`, [range.from, range.to]);
  const rows = await queryAll<DetailRow & Record<string, unknown>>(
    `SELECT e.event_at, e.uid, e.trading_account_no, e.step, e.step_status, e.account_status, e.approval_method, e.remarks
     FROM onboarding_events e WHERE ${where} ORDER BY e.event_at DESC LIMIT ?`,
    [range.from, range.to, Math.min(Math.max(limit, 1), 500)],
  );
  return { total: Number(total?.count ?? 0), rows: rows.map(row => ({ ...row, event_at: new Date(row.event_at).toISOString() })) };
}

export interface AccessUser {
  id: string;
  username: string;
  name: string;
  role: string;
  department_name: string | null;
  via_department: boolean;
  personal_grant: boolean;
  can_upload: boolean;
}

export async function listAccessUsers(): Promise<AccessUser[]> {
  const rows = await queryAll<AccessUser & Record<string, unknown>>(
    `SELECT u.id, u.username, u.name, u.role, d.name AS department_name,
       COALESCE('monthly-report' = ANY(d.permitted_features), FALSE) AS via_department,
       (mra.user_id IS NOT NULL) AS personal_grant,
       COALESCE(mra.can_upload, FALSE) AS can_upload
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN monthly_report_access mra ON mra.user_id = u.id
     ORDER BY (u.role = 'admin') DESC, u.name`,
  );
  return rows.map(row => ({ ...row, via_department: Boolean(row.via_department), personal_grant: Boolean(row.personal_grant), can_upload: Boolean(row.can_upload) }));
}

/** view=false removes the personal grant; upload rights require a personal grant. */
export async function setUserAccess(userId: string, access: { view: boolean; upload: boolean }, grantedBy: string): Promise<boolean> {
  const user = await queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) return false;
  await executeTransaction(async transaction => {
    if (!access.view) {
      await transaction.execute('DELETE FROM monthly_report_access WHERE user_id = ?', [userId]);
      return;
    }
    await transaction.execute(
      `INSERT INTO monthly_report_access (user_id, can_upload, granted_by) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET can_upload = EXCLUDED.can_upload, granted_by = EXCLUDED.granted_by, updated_at = CURRENT_TIMESTAMP`,
      [userId, access.upload, grantedBy],
    );
  });
  return true;
}

/** Stored onboarding rows for these Document IDs, for the upload preview's conflict check. */
export async function loadStoredEvents(documentIds: string[]): Promise<StoredEvent[]> {
  const stored: StoredEvent[] = [];
  for (const batch of chunkRows(documentIds, 5000)) {
    const rows = await queryAll<{ document_id: string; event_at: string | Date; step: string; step_status: string; account_status: string | null; remarks: string | null; trading_account_no: string | null }>(
      'SELECT document_id, event_at, step, step_status, account_status, remarks, trading_account_no FROM onboarding_events WHERE document_id = ANY(?::text[])',
      [batch],
    );
    for (const row of rows) {
      stored.push({ documentId: row.document_id, eventAt: new Date(row.event_at).toISOString(), step: row.step, stepStatus: row.step_status, accountStatus: row.account_status, remarks: row.remarks, tradingAccountNo: row.trading_account_no });
    }
  }
  return stored;
}

/** How many of these FTD accounts are already stored. */
export async function countStoredFtd(accountNos: string[]): Promise<number> {
  let count = 0;
  for (const batch of chunkRows(accountNos, 5000)) {
    const row = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM onboarding_ftd WHERE account_no = ANY(?::text[])', [batch]);
    count += Number(row?.count ?? 0);
  }
  return count;
}
