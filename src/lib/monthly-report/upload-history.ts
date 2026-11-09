/**
 * Upload history paging and filters (pure: builds the SQL WHERE clause and
 * parameters; store.ts runs it). Newest first, no hard cap: the UI pages
 * through everything 25 rows at a time.
 */
export const HISTORY_KINDS = ['onboarding', 'onboarding_summary', 'user_approved', 'ftd', 'rejection_reasons',
  'settlement_crm_deposit', 'settlement_crm_withdrawal', 'settlement_mt5_dw', 'settlement_ftd'] as const;
export type HistoryKind = typeof HISTORY_KINDS[number];

export const DEFAULT_HISTORY_PAGE_SIZE = 25;
export const MAX_HISTORY_PAGE_SIZE = 100;

export interface UploadHistoryFilter {
  page: number;
  pageSize: number;
  kind: HistoryKind | null;
  /** `YYYY-MM`: uploads whose WIB data range overlaps this month. */
  month: string | null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function toInt(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Reads `page`, `pageSize`, `kind`, `month` from query params; invalid values fall back to defaults. */
export function parseUploadHistoryQuery(params: URLSearchParams): UploadHistoryFilter {
  const kind = params.get('kind');
  const month = params.get('month');
  return {
    page: Math.max(1, toInt(params.get('page'), 1)),
    pageSize: Math.min(MAX_HISTORY_PAGE_SIZE, Math.max(1, toInt(params.get('pageSize'), DEFAULT_HISTORY_PAGE_SIZE))),
    kind: kind && (HISTORY_KINDS as readonly string[]).includes(kind) ? kind as HistoryKind : null,
    month: month && MONTH_RE.test(month) ? month : null,
  };
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * WHERE clause for `monthly_report_uploads`. Uploads without a data range
 * (nothing valid in the file) fall back to their upload day in WIB for the month filter.
 */
export function uploadHistoryWhere(filter: Pick<UploadHistoryFilter, 'kind' | 'month'>): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.kind) {
    clauses.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.month) {
    const { from, to } = monthBounds(filter.month);
    const uploadDay = "(created_at AT TIME ZONE 'Asia/Jakarta')::date";
    clauses.push(`COALESCE(data_from, ${uploadDay}) <= ?::date AND COALESCE(data_to, ${uploadDay}) >= ?::date`);
    params.push(to, from);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function pageOffset(filter: Pick<UploadHistoryFilter, 'page' | 'pageSize'>): number {
  return (filter.page - 1) * filter.pageSize;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
