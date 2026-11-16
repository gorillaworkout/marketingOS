/**
 * Search Console data retention: keep query+page rows (seo_gsc_daily) and page
 * rows (seo_gsc_page_daily) daily only from a month-aligned cutoff on. Older
 * rows are summed per month into seo_gsc_monthly / seo_gsc_page_monthly, the
 * covered dates go to seo_gsc_rollup_months, and the daily rows are deleted.
 * seo_gsc_site_daily (site totals) is never touched.
 *
 * Boundary: the cutoff must be the first day of a month, so a month is either
 * fully daily or fully rolled up. A month never holds both, which is what keeps
 * readers (gsc-source.ts) from double counting.
 *
 * Idempotent: re-running with the same cutoff finds no daily rows older than
 * it and changes nothing. If daily rows ever reappear in a rolled-up month,
 * they are added onto the monthly row (sums add, position re-weighted).
 *
 * Never runs VACUUM; disk space comes back only after a manual VACUUM FULL
 * (see docs/seo-os/setup.md).
 */
import type { DatabaseTransaction } from '@/lib/database';
import { addMonths, pacificDate } from './gsc-sync';

export const DEFAULT_RETENTION_MONTHS = 6;
/** Lower bound used when no `from` is given (all rows before the cutoff). */
const BEGINNING = '0001-01-01';

type Db = Pick<DatabaseTransaction, 'execute' | 'queryOne' | 'queryAll'>;

export class RetentionError extends Error {}

/** First day of the month `months` months before the current month (Search Console's Pacific date). */
export function retentionCutoff(now: Date, months = DEFAULT_RETENTION_MONTHS): string {
  if (!Number.isInteger(months) || months < 1 || months > 15) throw new RetentionError('--months must be an integer between 1 and 15.');
  const monthStart = `${pacificDate(now).slice(0, 7)}-01`;
  return addMonths(monthStart, -months);
}

/** Accepts only YYYY-MM-01 so a month is never split between daily and monthly rows. */
export function parseCutoff(value: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new RetentionError(`--cutoff must be the first day of a month (YYYY-MM-01), got "${value}".`);
  }
  return value;
}

/** Month starts in [from, before), oldest first. */
export function monthsBetween(from: string, before: string): string[] {
  const months: string[] = [];
  for (let month = `${from.slice(0, 7)}-01`; month < before; month = addMonths(month, 1)) months.push(month);
  return months;
}

export interface RetentionMonth { month: string; firstDate: string; lastDate: string; days: number; queryRows: number; pageRows: number }

export interface RetentionPlan {
  siteId: string;
  cutoff: string;
  months: RetentionMonth[];
  queryRows: number;
  pageRows: number;
  clicks: number;
  impressions: number;
}

export interface RetentionResult extends RetentionPlan {
  monthlyQueryRowsUpserted: number;
  monthlyPageRowsUpserted: number;
  queryRowsDeleted: number;
  pageRowsDeleted: number;
}

const MONTHS_SQL = `WITH q AS (
  SELECT date_trunc('month', date)::DATE AS month, MIN(date) AS first_date, MAX(date) AS last_date, COUNT(*) AS rows
  FROM seo_gsc_daily WHERE site_id = ? AND date >= ?::DATE AND date < ?::DATE GROUP BY 1
), p AS (
  SELECT date_trunc('month', date)::DATE AS month, MIN(date) AS first_date, MAX(date) AS last_date, COUNT(*) AS rows
  FROM seo_gsc_page_daily WHERE site_id = ? AND date >= ?::DATE AND date < ?::DATE GROUP BY 1
), d AS (
  SELECT date_trunc('month', date)::DATE AS month, COUNT(*) AS days FROM (
    SELECT date FROM seo_gsc_daily WHERE site_id = ? AND date >= ?::DATE AND date < ?::DATE
    UNION
    SELECT date FROM seo_gsc_page_daily WHERE site_id = ? AND date >= ?::DATE AND date < ?::DATE
  ) dates GROUP BY 1
)
SELECT to_char(d.month, 'YYYY-MM-DD') AS month,
  to_char(LEAST(q.first_date, p.first_date), 'YYYY-MM-DD') AS first_date,
  to_char(GREATEST(q.last_date, p.last_date), 'YYYY-MM-DD') AS last_date,
  d.days, COALESCE(q.rows, 0) AS query_rows, COALESCE(p.rows, 0) AS page_rows
FROM d LEFT JOIN q ON q.month = d.month LEFT JOIN p ON p.month = d.month
ORDER BY d.month`;

function monthsValues(siteId: string, from: string, before: string): unknown[] {
  return Array.from({ length: 4 }, () => [siteId, from, before]).flat();
}

type MonthRow = { month: string; first_date: string; last_date: string; days: string | number; query_rows: string | number; page_rows: string | number };

/** Read-only: what --apply would roll up and delete for one site. */
export async function planRetention(db: Db, siteId: string, cutoff: string, from = BEGINNING): Promise<RetentionPlan> {
  parseCutoff(cutoff);
  const months = (await db.queryAll<MonthRow>(MONTHS_SQL, monthsValues(siteId, from, cutoff))).map(row => ({
    month: row.month, firstDate: row.first_date, lastDate: row.last_date,
    days: Number(row.days), queryRows: Number(row.query_rows), pageRows: Number(row.page_rows),
  }));
  const totals = await db.queryOne<{ clicks: string | null; impressions: string | null }>(
    `SELECT COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(impressions), 0) AS impressions FROM seo_gsc_daily WHERE site_id = ? AND date >= ?::DATE AND date < ?::DATE`,
    [siteId, from, cutoff],
  );
  return {
    siteId, cutoff, months,
    queryRows: months.reduce((sum, month) => sum + month.queryRows, 0),
    pageRows: months.reduce((sum, month) => sum + month.pageRows, 0),
    clicks: Number(totals?.clicks ?? 0),
    impressions: Number(totals?.impressions ?? 0),
  };
}

/** Sums of position-independent metrics, to prove nothing is lost in the move. */
async function sums(db: Db, table: string, column: 'date' | 'month', siteId: string, from: string, before: string) {
  const row = await db.queryOne<{ rows: string; clicks: string; impressions: string }>(
    `SELECT COUNT(*) AS rows, COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(impressions), 0) AS impressions
     FROM ${table} WHERE site_id = ? AND ${column} >= ?::DATE AND ${column} < ?::DATE`,
    [siteId, column === 'month' ? `${from.slice(0, 7)}-01` : from, before],
  );
  return { rows: Number(row?.rows ?? 0), clicks: Number(row?.clicks ?? 0), impressions: Number(row?.impressions ?? 0) };
}

function upsertMonthlySql(source: string, target: string, keys: string[]): string {
  const keyList = keys.join(', ');
  const t = target;
  const impressions = `${t}.impressions + EXCLUDED.impressions`;
  return `INSERT INTO ${target} (site_id, month, ${keyList}, clicks, impressions, ctr, position, days_present, synced_at)
SELECT site_id, date_trunc('month', date)::DATE, ${keyList}, SUM(clicks), SUM(impressions),
  CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::DOUBLE PRECISION / SUM(impressions) ELSE 0 END,
  COALESCE(SUM(position * impressions) / NULLIF(SUM(impressions), 0), AVG(position)),
  COUNT(*), ?
FROM ${source}
WHERE site_id = ? AND date >= ?::DATE AND date < ?::DATE
GROUP BY site_id, date_trunc('month', date)::DATE, ${keyList}
ON CONFLICT (site_id, month, ${keyList}) DO UPDATE SET
  clicks = ${t}.clicks + EXCLUDED.clicks,
  impressions = ${impressions},
  ctr = CASE WHEN ${impressions} > 0 THEN (${t}.clicks + EXCLUDED.clicks)::DOUBLE PRECISION / (${impressions}) ELSE 0 END,
  position = CASE WHEN ${impressions} > 0
    THEN (${t}.position * ${t}.impressions + EXCLUDED.position * EXCLUDED.impressions) / (${impressions})
    ELSE LEAST(${t}.position, EXCLUDED.position) END,
  days_present = ${t}.days_present + EXCLUDED.days_present,
  synced_at = EXCLUDED.synced_at`;
}

export const UPSERT_MONTHLY_QUERY_SQL = upsertMonthlySql('seo_gsc_daily', 'seo_gsc_monthly', ['query', 'page']);
export const UPSERT_MONTHLY_PAGE_SQL = upsertMonthlySql('seo_gsc_page_daily', 'seo_gsc_page_monthly', ['page']);

const UPSERT_ROLLUP_MONTH_SQL = `INSERT INTO seo_gsc_rollup_months (site_id, month, first_date, last_date, days, query_rows, page_rows, rolled_up_at)
VALUES (?, ?::DATE, ?::DATE, ?::DATE, ?, ?, ?, ?)
ON CONFLICT (site_id, month) DO UPDATE SET
  first_date = LEAST(seo_gsc_rollup_months.first_date, EXCLUDED.first_date),
  last_date = GREATEST(seo_gsc_rollup_months.last_date, EXCLUDED.last_date),
  days = seo_gsc_rollup_months.days + EXCLUDED.days,
  query_rows = seo_gsc_rollup_months.query_rows + EXCLUDED.query_rows,
  page_rows = seo_gsc_rollup_months.page_rows + EXCLUDED.page_rows,
  rolled_up_at = EXCLUDED.rolled_up_at`;

/**
 * Rolls up and deletes one site's daily rows in [from, cutoff). Run it inside
 * one transaction (executeTransaction): any mismatch throws and rolls back.
 */
export async function applyRetention(db: Db, siteId: string, cutoff: string, options: { from?: string; now?: Date } = {}): Promise<RetentionResult> {
  parseCutoff(cutoff);
  const from = options.from ?? BEGINNING;
  if (from !== BEGINNING && !/^\d{4}-\d{2}-01$/.test(from)) throw new RetentionError('from must be the first day of a month.');
  const now = options.now ?? new Date();

  // One retention run per site at a time; and never while a sync is writing.
  await db.queryOne(`SELECT pg_advisory_xact_lock(hashtext(?))`, [`seo-gsc-retention:${siteId}`]);
  const running = await db.queryOne(`SELECT id FROM seo_sync_runs WHERE site_id = ? AND status = 'running'`, [siteId]);
  if (running) throw new RetentionError(`A Search Console sync is running for site ${siteId}; try again when it finishes.`);

  const plan = await planRetention(db, siteId, cutoff, from);
  const empty = { monthlyQueryRowsUpserted: 0, monthlyPageRowsUpserted: 0, queryRowsDeleted: 0, pageRowsDeleted: 0 };
  if (!plan.months.length) return { ...plan, ...empty };

  const dailyQuery = await sums(db, 'seo_gsc_daily', 'date', siteId, from, cutoff);
  const dailyPage = await sums(db, 'seo_gsc_page_daily', 'date', siteId, from, cutoff);
  const monthlyQueryBefore = await sums(db, 'seo_gsc_monthly', 'month', siteId, from, cutoff);
  const monthlyPageBefore = await sums(db, 'seo_gsc_page_monthly', 'month', siteId, from, cutoff);

  for (const month of plan.months) {
    await db.execute(UPSERT_ROLLUP_MONTH_SQL, [siteId, month.month, month.firstDate, month.lastDate, month.days, month.queryRows, month.pageRows, now]);
  }
  const monthlyQueryRowsUpserted = await db.execute(UPSERT_MONTHLY_QUERY_SQL, [now, siteId, from, cutoff]);
  const monthlyPageRowsUpserted = await db.execute(UPSERT_MONTHLY_PAGE_SQL, [now, siteId, from, cutoff]);

  const monthlyQueryAfter = await sums(db, 'seo_gsc_monthly', 'month', siteId, from, cutoff);
  const monthlyPageAfter = await sums(db, 'seo_gsc_page_monthly', 'month', siteId, from, cutoff);
  for (const [label, daily, before, after] of [
    ['query+page', dailyQuery, monthlyQueryBefore, monthlyQueryAfter],
    ['page', dailyPage, monthlyPageBefore, monthlyPageAfter],
  ] as const) {
    if (after.clicks - before.clicks !== daily.clicks || after.impressions - before.impressions !== daily.impressions) {
      throw new RetentionError(`${label} monthly sums do not match the daily rows (clicks ${daily.clicks} vs ${after.clicks - before.clicks}, impressions ${daily.impressions} vs ${after.impressions - before.impressions}); rolled back.`);
    }
  }

  const queryRowsDeleted = await db.execute(`DELETE FROM seo_gsc_daily WHERE site_id = ? AND date >= ?::DATE AND date < ?::DATE`, [siteId, from, cutoff]);
  const pageRowsDeleted = await db.execute(`DELETE FROM seo_gsc_page_daily WHERE site_id = ? AND date >= ?::DATE AND date < ?::DATE`, [siteId, from, cutoff]);
  if (queryRowsDeleted !== dailyQuery.rows || pageRowsDeleted !== dailyPage.rows) {
    throw new RetentionError(`Deleted row counts changed during the run (query+page ${queryRowsDeleted}/${dailyQuery.rows}, page ${pageRowsDeleted}/${dailyPage.rows}); rolled back.`);
  }
  return { ...plan, monthlyQueryRowsUpserted, monthlyPageRowsUpserted, queryRowsDeleted, pageRowsDeleted };
}
