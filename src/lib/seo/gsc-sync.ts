/**
 * Search Console -> PostgreSQL sync for SEO OS.
 *
 * Each run walks dates one day at a time and, per day, stores three views:
 * site totals (dimension date), pages (page) and query+page rows. Rows are
 * upserted; rows for that day that Google no longer returns are removed.
 * Incremental runs re-pull the last 5 days because recent data is provisional
 * (dataState=all) and final data lags about 2-3 days. Backfill covers the 16
 * months Search Console keeps.
 */
import { fetchAllRows, SeoConfigError, type GscClient, type SearchAnalyticsRow, type SleepFn } from './gsc-client';

export const INCREMENTAL_DAYS = 5;
export const BACKFILL_MONTHS = 16;
export const MAX_QUERY_LENGTH = 500;
export const MAX_PAGE_LENGTH = 1000;
/** A run still "running" after this long is treated as crashed and released. */
export const STALE_RUN_MS = 3 * 60 * 60 * 1000;

export type SyncMode = 'incremental' | 'backfill';

export interface MetricRow { clicks: number; impressions: number; ctr: number; position: number }
export interface SiteDayRow extends MetricRow { date: string }
export interface PageDayRow extends MetricRow { date: string; page: string }
export interface QueryPageDayRow extends MetricRow { date: string; query: string; page: string }

export interface DaySnapshot {
  site: SiteDayRow[];
  pages: PageDayRow[];
  queryPages: QueryPageDayRow[];
}

export interface SeoSiteRecord {
  id: string;
  name: string;
  site_url: string;
  gsc_property: string | null;
  active: boolean;
}

export interface SeoSyncStore {
  getSite(siteId: string): Promise<SeoSiteRecord | undefined>;
  /** Inserts a running row; resolves false when another run holds the lock. */
  startRun(run: { id: string; siteId: string; mode: SyncMode; rangeStart: string | null; rangeEnd: string | null; triggeredBy: string | null }): Promise<boolean>;
  releaseStaleRuns(siteId: string, olderThan: Date): Promise<void>;
  replaceDay(siteId: string, date: string, snapshot: DaySnapshot, syncedAt: Date): Promise<number>;
  finishRun(runId: string, result: { status: 'succeeded' | 'failed'; daysSynced: number; rowsUpserted: number; error: string | null }): Promise<void>;
  markSiteSynced(siteId: string, at: Date): Promise<void>;
}

/** Today's date in Search Console's reporting time zone (Pacific Time). */
export function pacificDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

/** Inclusive list of dates, oldest first. */
export function dateList(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * Dates to sync, ending yesterday (Pacific Time).
 * Incremental: the last 5 days. Backfill: 16 months back, day by day.
 */
export function datesForMode(mode: SyncMode, now: Date): string[] {
  const end = addDays(pacificDate(now), -1);
  const start = mode === 'backfill' ? addDays(addMonths(end, -BACKFILL_MONTHS), 1) : addDays(end, -(INCREMENTAL_DAYS - 1));
  return dateList(start, end);
}

function metrics(row: SearchAnalyticsRow): MetricRow {
  return {
    clicks: Math.round(row.clicks ?? 0),
    impressions: Math.round(row.impressions ?? 0),
    ctr: Number(row.ctr ?? 0),
    position: Number(row.position ?? 0),
  };
}

/**
 * Merges rows that collide after truncation so one upsert batch never touches
 * the same key twice. Clicks and impressions add up; position is
 * impression-weighted; CTR is recomputed.
 */
export function mergeRows<T extends MetricRow>(rows: T[], key: (row: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    const existing = merged.get(id);
    if (!existing) { merged.set(id, { ...row }); continue; }
    const impressions = existing.impressions + row.impressions;
    const position = impressions > 0
      ? (existing.position * existing.impressions + row.position * row.impressions) / impressions
      : Math.min(existing.position, row.position);
    const clicks = existing.clicks + row.clicks;
    merged.set(id, { ...existing, clicks, impressions, position, ctr: impressions > 0 ? clicks / impressions : 0 });
  }
  return [...merged.values()];
}

/** Fetches every row for one day (all pages of results) for the three views. */
export async function fetchDaySnapshot(client: GscClient, property: string, date: string, rowLimit?: number): Promise<DaySnapshot> {
  const base = { startDate: date, endDate: date };
  const [siteRows, pageRows, queryPageRows] = [
    await fetchAllRows(client, property, { ...base, dimensions: ['date'] }, rowLimit),
    await fetchAllRows(client, property, { ...base, dimensions: ['page'] }, rowLimit),
    await fetchAllRows(client, property, { ...base, dimensions: ['query', 'page'] }, rowLimit),
  ];
  return {
    site: siteRows.map(row => ({ date, ...metrics(row) })),
    pages: mergeRows(
      pageRows.map(row => ({ date, page: (row.keys?.[0] ?? '').slice(0, MAX_PAGE_LENGTH), ...metrics(row) })),
      row => row.page,
    ),
    queryPages: mergeRows(
      queryPageRows.map(row => ({
        date,
        query: (row.keys?.[0] ?? '').slice(0, MAX_QUERY_LENGTH),
        page: (row.keys?.[1] ?? '').slice(0, MAX_PAGE_LENGTH),
        ...metrics(row),
      })),
      row => `${row.query}\u0000${row.page}`,
    ),
  };
}

export interface RunSeoSyncOptions {
  siteId: string;
  mode: SyncMode;
  triggeredBy?: string | null;
  /** Explicit dates (tests or a one-off range). Defaults to datesForMode(mode). */
  dates?: string[];
  rowLimit?: number;
  /** Pause between days, to stay well under Search Analytics quotas on long backfills. */
  pauseMs?: number;
  onDay?: (date: string, rows: number) => void;
}

export interface RunSeoSyncDeps {
  store: SeoSyncStore;
  /** Builds a GSC client; throws SeoConfigError when the key is missing or invalid. */
  createClient: () => Promise<GscClient>;
  newId: () => string;
  now?: () => Date;
  sleep?: SleepFn;
}

export type SeoSyncResult =
  | { status: 'succeeded'; runId: string; daysSynced: number; rowsUpserted: number; rangeStart: string | null; rangeEnd: string | null }
  | { status: 'failed'; runId: string | null; daysSynced: number; rowsUpserted: number; error: string; configError: boolean }
  | { status: 'busy'; error: string };

/** Runs one sync for one site with an overlap lock (one running run per site). */
export async function runSeoSync(options: RunSeoSyncOptions, deps: RunSeoSyncDeps): Promise<SeoSyncResult> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const site = await deps.store.getSite(options.siteId);
  if (!site) return { status: 'failed', runId: null, daysSynced: 0, rowsUpserted: 0, error: 'SEO site not found.', configError: true };

  const dates = options.dates ?? datesForMode(options.mode, now());
  const rangeStart = dates[0] ?? null;
  const rangeEnd = dates[dates.length - 1] ?? null;

  await deps.store.releaseStaleRuns(site.id, new Date(now().getTime() - STALE_RUN_MS));
  const runId = deps.newId();
  const started = await deps.store.startRun({ id: runId, siteId: site.id, mode: options.mode, rangeStart, rangeEnd, triggeredBy: options.triggeredBy ?? null });
  if (!started) return { status: 'busy', error: `A Search Console sync is already running for ${site.name}.` };

  let daysSynced = 0;
  let rowsUpserted = 0;
  try {
    if (!site.gsc_property) {
      throw new SeoConfigError(`Search Console is not connected for ${site.name}: set its GSC property in SEO OS settings.`, 'missing-property');
    }
    const client = await deps.createClient();
    for (const [index, date] of dates.entries()) {
      const snapshot = await fetchDaySnapshot(client, site.gsc_property, date, options.rowLimit);
      const rows = await deps.store.replaceDay(site.id, date, snapshot, now());
      rowsUpserted += rows;
      daysSynced += 1;
      options.onDay?.(date, rows);
      if (options.pauseMs && index < dates.length - 1) await sleep(options.pauseMs);
    }
    await deps.store.finishRun(runId, { status: 'succeeded', daysSynced, rowsUpserted, error: null });
    await deps.store.markSiteSynced(site.id, now());
    return { status: 'succeeded', runId, daysSynced, rowsUpserted, rangeStart, rangeEnd };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.store.finishRun(runId, { status: 'failed', daysSynced, rowsUpserted, error: message.slice(0, 2000) });
    return { status: 'failed', runId, daysSynced, rowsUpserted, error: message, configError: error instanceof SeoConfigError };
  }
}
