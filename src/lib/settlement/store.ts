/**
 * Settlement persistence. Uploads upsert into the settlement_* tables through the shared
 * upsertWithHistory (one monthly_report_uploads row per commit); report loaders read narrow
 * column lists for a period and hand plain rows to the pure functions in metrics.ts / reconcile.ts.
 */
import { queryAll, queryOne } from '@/lib/database';
import { upsertWithHistory, type UploadActor, type UploadRecord, type UpsertPlan } from '@/lib/monthly-report/store';
import { pageOffset } from '@/lib/monthly-report/upload-history';
import type { DateRange } from '@/lib/monthly-report/periods';
import type { Rate } from './conventions';
import { SETTLEMENT_UPLOAD_KINDS, type SettlementUploadKind } from './detect';
import type { FtdEntry } from './ftd-parse';
import type { CrmDirection, CrmTransaction, Mt5Deal } from './types';
import type { Mt5Kind } from './comment-parse';

export interface SaveMeta { fileName: string; actor: UploadActor; skipped: number; range: DateRange | null }

const CRM_COLUMNS = ['reference', 'ticket', 'account_no', 'uid', 'funding_method', 'requested_at', 'completed_at', 'status', 'amount_usd', 'transfer_amount', 'transfer_currency', 'rate', 'channel', 'payment_method', 'gateway_reference', 'source', 'upload_id'];
const CRM_CASTS = { requested_at: '::timestamptz', completed_at: '::timestamptz', amount_usd: '::numeric', transfer_amount: '::numeric', rate: '::integer' };

export const crmTable = (direction: CrmDirection) => (direction === 'deposit' ? 'settlement_crm_deposits' : 'settlement_crm_withdrawals');

export function crmPlan(direction: CrmDirection): UpsertPlan<CrmTransaction> {
  return {
    kind: direction === 'deposit' ? 'settlement_crm_deposit' : 'settlement_crm_withdrawal',
    table: crmTable(direction),
    key: 'reference',
    columns: CRM_COLUMNS,
    casts: CRM_CASTS,
    keyOf: row => row.reference,
    values: (row, uploadId) => [
      row.reference, row.ticket, row.accountNo, row.uid, row.fundingMethod, row.requestedAt, row.completedAt, row.status,
      row.amountUsd === null ? null : String(row.amountUsd), row.transferAmount === null ? null : String(row.transferAmount),
      row.transferCurrency, row.rate, row.channel, row.paymentMethod, row.gatewayReference, 'upload', uploadId,
    ],
  };
}

export const MT5_PLAN: UpsertPlan<Mt5Deal> = {
  kind: 'settlement_mt5_dw',
  table: 'settlement_mt5_deals',
  key: 'deal',
  columns: ['deal', 'login', 'name', 'server_time', 'occurred_at', 'comment', 'kind', 'crm_reference', 'swap_date', 'amount_usd', 'currency', 'rate', 'source', 'upload_id'],
  casts: { server_time: '::timestamp', occurred_at: '::timestamptz', swap_date: '::date', amount_usd: '::numeric', rate: '::integer' },
  keyOf: row => row.deal,
  values: (row, uploadId) => [row.deal, row.login, row.name, row.serverTime, row.occurredAt, row.comment, row.kind, row.crmReference, row.swapDate, row.amountUsd.toFixed(2), row.currency, row.rate, 'upload', uploadId],
};

export const FTD_PLAN: UpsertPlan<FtdEntry> = {
  kind: 'settlement_ftd',
  table: 'settlement_ftd',
  key: 'login',
  columns: ['login', 'account_type', 'server_time', 'ftd_at', 'balance_usd', 'rate', 'source', 'upload_id'],
  casts: { server_time: '::timestamp', ftd_at: '::timestamptz', balance_usd: '::numeric', rate: '::integer' },
  keyOf: row => row.login,
  values: (row, uploadId) => [row.login, row.accountType, row.serverTime, row.ftdAt, row.balanceUsd.toFixed(2), row.rate, 'upload', uploadId],
};

const withOffset = (meta: SaveMeta) => ({ ...meta, offset: null });
export const saveCrmTransactions = (direction: CrmDirection, rows: CrmTransaction[], meta: SaveMeta) => upsertWithHistory(crmPlan(direction), rows, withOffset(meta));
export const saveMt5Deals = (rows: Mt5Deal[], meta: SaveMeta) => upsertWithHistory(MT5_PLAN, rows, withOffset(meta));
export const saveSettlementFtd = (rows: FtdEntry[], meta: SaveMeta) => upsertWithHistory(FTD_PLAN, rows, withOffset(meta));

/** How many of `keys` are already stored (preview "new / existing"). */
export async function countStoredKeys(table: string, key: string, keys: string[]): Promise<number> {
  if (!keys.length) return 0;
  const row = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table} WHERE ${key} = ANY(?::text[])`, [keys]);
  return Number(row?.count ?? 0);
}

// ---------- loaders (PR 2) ----------

interface CrmDbRow {
  reference: string; ticket: string | null; account_no: string; uid: string | null; funding_method: string | null;
  requested_at: string | Date; completed_at: string | Date | null; status: string; amount_usd: string | null;
  transfer_amount: string | null; transfer_currency: string | null; rate: number | null;
}
const iso = (value: string | Date | null) => (value === null ? null : new Date(value).toISOString());
const num = (value: string | null) => (value === null ? null : Number(value));

export function toCrmTransaction(direction: CrmDirection, row: CrmDbRow): CrmTransaction {
  return {
    direction, reference: row.reference, ticket: row.ticket, accountNo: row.account_no, uid: row.uid, fundingMethod: row.funding_method ?? '',
    requestedAt: iso(row.requested_at) as string, completedAt: iso(row.completed_at), status: row.status, amountUsd: num(row.amount_usd),
    transferAmount: num(row.transfer_amount), transferCurrency: row.transfer_currency, rate: row.rate as Rate | null,
    channel: null, paymentMethod: null, gatewayReference: null,
  };
}

/** CRM rows whose request OR completion instant falls in [fromIso, toIso). */
export async function loadCrm(direction: CrmDirection, fromIso: string, toIso: string, options: { successfulOnly?: boolean } = {}): Promise<CrmTransaction[]> {
  const rows = await queryAll<CrmDbRow>(
    `SELECT reference, ticket, account_no, uid, funding_method, requested_at, completed_at, status, amount_usd::text AS amount_usd,
            transfer_amount::text AS transfer_amount, transfer_currency, rate
       FROM ${crmTable(direction)}
      WHERE ((requested_at >= ?::timestamptz AND requested_at < ?::timestamptz) OR (completed_at >= ?::timestamptz AND completed_at < ?::timestamptz))
        ${options.successfulOnly ? "AND status = 'Successful'" : ''}`,
    [fromIso, toIso, fromIso, toIso],
  );
  return rows.map(row => toCrmTransaction(direction, row));
}

interface DealDbRow { deal: string; login: string; server_time: string; occurred_at: string | Date; kind: Mt5Kind; crm_reference: string | null; swap_date: string | null; amount_usd: string; rate: number | null }

/** Server wall-clock columns are formatted in SQL so node-pg never shifts them by the process time zone. */
const SERVER_TIME_SQL = "to_char(server_time, 'YYYY-MM-DD HH24:MI:SS') AS server_time";

export async function loadMt5Deals(fromIso: string, toIso: string, kinds: Mt5Kind[]): Promise<Mt5Deal[]> {
  const rows = await queryAll<DealDbRow>(
    `SELECT deal, login, ${SERVER_TIME_SQL}, occurred_at, kind, crm_reference, to_char(swap_date, 'YYYY-MM-DD') AS swap_date, amount_usd::text AS amount_usd, rate
       FROM settlement_mt5_deals WHERE kind = ANY(?::text[]) AND occurred_at >= ?::timestamptz AND occurred_at < ?::timestamptz`,
    [kinds, fromIso, toIso],
  );
  return rows.map(row => ({
    deal: row.deal, login: row.login, name: null, serverTime: row.server_time, occurredAt: iso(row.occurred_at) as string,
    comment: null, kind: row.kind, crmReference: row.crm_reference, swapDate: row.swap_date, amountUsd: Number(row.amount_usd), currency: 'USD', rate: row.rate as Rate | null,
  }));
}

export async function loadFtd(fromServerDate: string, toServerDate: string): Promise<FtdEntry[]> {
  const rows = await queryAll<{ login: string; account_type: string | null; server_time: string; ftd_at: string | Date; balance_usd: string; rate: number | null }>(
    `SELECT login, account_type, ${SERVER_TIME_SQL}, ftd_at, balance_usd::text AS balance_usd, rate FROM settlement_ftd
      WHERE server_time >= ?::date AND server_time < (?::date + 1)`,
    [fromServerDate, toServerDate],
  );
  return rows.map(row => ({ login: row.login, accountType: row.account_type, serverTime: row.server_time, ftdAt: iso(row.ftd_at) as string, balanceUsd: Number(row.balance_usd), rate: row.rate as Rate | null }));
}

export async function loadHolidays(): Promise<Set<string>> {
  const rows = await queryAll<{ day: string }>(`SELECT to_char(holiday_date, 'YYYY-MM-DD') AS day FROM settlement_holidays`);
  return new Set(rows.map(row => row.day));
}

/** "Data through" per settlement kind = max data_to of its uploads. */
export async function loadSettlementCoverage(): Promise<Record<string, string | null>> {
  const rows = await queryAll<{ kind: string; data_to: string | null }>(
    `SELECT kind, to_char(MAX(data_to), 'YYYY-MM-DD') AS data_to FROM monthly_report_uploads WHERE kind LIKE 'settlement_%' GROUP BY kind`,
  );
  return Object.fromEntries(rows.map(row => [row.kind, row.data_to]));
}

const UPLOAD_COLUMNS = `id, kind, file_name, source_utc_offset, uploaded_by_name, rows_total, rows_inserted, rows_updated, rows_skipped, rows_duplicate,
       to_char(data_from, 'YYYY-MM-DD') AS data_from, to_char(data_to, 'YYYY-MM-DD') AS data_to, created_at`;

export interface SettlementUploadPage { uploads: UploadRecord[]; total: number; page: number; pageSize: number }

/** Upload history for Settlement kinds only, so the Onboarding history query is unchanged. */
export async function listSettlementUploadsPage(filter: { page: number; pageSize: number; kind: string | null }): Promise<SettlementUploadPage> {
  const kinds = filter.kind && (SETTLEMENT_UPLOAD_KINDS as readonly string[]).includes(filter.kind) ? [filter.kind] : [...SETTLEMENT_UPLOAD_KINDS];
  const [count, rows] = await Promise.all([
    queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM monthly_report_uploads WHERE kind = ANY(?::text[])', [kinds]),
    queryAll<UploadRecord & Record<string, unknown>>(
      `SELECT ${UPLOAD_COLUMNS} FROM monthly_report_uploads WHERE kind = ANY(?::text[]) ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [kinds, filter.pageSize, pageOffset(filter)],
    ),
  ]);
  return {
    uploads: rows.map(row => ({ ...row, created_at: new Date(row.created_at).toISOString() })),
    total: Number(count?.count ?? 0),
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

export type { SettlementUploadKind };
