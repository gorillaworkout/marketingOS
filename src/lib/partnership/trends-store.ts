import { randomUUID } from 'node:crypto';
import { execute, queryAll, queryOne } from '@/lib/database';
import { expireStaleReports, type ReportStatus } from './store';
import type { TrendBrandInput, TrendsDigestResult, TrendWindowDays } from './trends';

export interface TrendBrandRow {
  id: string;
  name: string;
  website: string | null;
  newsroomUrl: string | null;
  searchTerms: string[];
  notes: string | null;
  active: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface TrendsReportRow {
  id: string;
  trigger: 'manual' | 'scheduled';
  status: ReportStatus;
  progress: number;
  message: string;
  windowDays: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  result: TrendsDigestResult | null;
  model: string | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export class TrendsInProgressError extends Error {
  constructor() { super('A Global Trends refresh is already running.'); }
}

export class DuplicateTrendBrandError extends Error {
  constructor() { super('A brand with this name is already on the watchlist.'); }
}

const isUniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505';
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

function asJson<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

function terms(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.startsWith('{')) return value.slice(1, -1).split(',').map(term => term.replace(/^"|"$/g, '')).filter(Boolean);
  return [];
}

function mapBrand(row: Record<string, unknown>): TrendBrandRow {
  return {
    id: String(row.id),
    name: String(row.name),
    website: str(row.website),
    newsroomUrl: str(row.newsroom_url),
    searchTerms: terms(row.search_terms),
    notes: str(row.notes),
    active: row.active !== false,
    sortOrder: Number(row.sort_order) || 0,
    updatedAt: String(row.updated_at),
  };
}

function mapReport(row: Record<string, unknown>, withResult = true): TrendsReportRow {
  const result = withResult ? asJson<TrendsDigestResult>(row.result) : null;
  return {
    id: String(row.id),
    trigger: row.trigger === 'scheduled' ? 'scheduled' : 'manual',
    status: row.status as ReportStatus,
    progress: Number(row.progress) || 0,
    message: String(row.message || ''),
    windowDays: row.window_days === null || row.window_days === undefined ? null : Number(row.window_days),
    windowStart: str(row.window_start),
    windowEnd: str(row.window_end),
    result,
    model: str(row.model),
    error: str(row.error),
    createdBy: str(row.created_by),
    createdAt: String(row.created_at),
    finishedAt: str(row.finished_at),
  };
}

const BRAND_COLUMNS = `id, name, website, newsroom_url, search_terms, notes, active, sort_order, updated_at::text AS updated_at`;
const REPORT_BASE = `id, trigger, status, progress, message, (result->>'windowDays')::int AS window_days, window_start::text AS window_start, window_end::text AS window_end,
  model, error, created_by, created_at::text AS created_at, finished_at::text AS finished_at`;

export async function listTrendBrands(options: { activeOnly?: boolean } = {}): Promise<TrendBrandRow[]> {
  const rows = await queryAll(`SELECT ${BRAND_COLUMNS} FROM partnership_trend_brands ${options.activeOnly ? 'WHERE active' : ''} ORDER BY sort_order, LOWER(name)`);
  return rows.map(mapBrand);
}

export async function getTrendBrand(id: string): Promise<TrendBrandRow | undefined> {
  const row = await queryOne(`SELECT ${BRAND_COLUMNS} FROM partnership_trend_brands WHERE id = ?`, [id]);
  return row ? mapBrand(row) : undefined;
}

export async function createTrendBrand(input: TrendBrandInput, userId: string): Promise<string> {
  const id = randomUUID();
  try {
    await execute(
      `INSERT INTO partnership_trend_brands (id, name, website, newsroom_url, search_terms, notes, active, sort_order, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?::text[], ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM partnership_trend_brands), ?, ?)`,
      [id, input.name, input.website, input.newsroomUrl, input.searchTerms, input.notes, input.active, userId, userId],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateTrendBrandError();
    throw error;
  }
  return id;
}

export async function updateTrendBrand(id: string, input: TrendBrandInput, userId: string): Promise<void> {
  try {
    await execute(
      `UPDATE partnership_trend_brands SET name = ?, website = ?, newsroom_url = ?, search_terms = ?::text[], notes = ?, active = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [input.name, input.website, input.newsroomUrl, input.searchTerms, input.notes, input.active, userId, id],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateTrendBrandError();
    throw error;
  }
}

export async function deleteTrendBrand(id: string): Promise<void> {
  await execute('DELETE FROM partnership_trend_brands WHERE id = ?', [id]);
}

export async function createTrendsReport(windowDays: TrendWindowDays, trigger: 'manual' | 'scheduled', userId: string | null): Promise<string> {
  await expireStaleReports();
  const id = randomUUID();
  try {
    await execute(
      `INSERT INTO partnership_reports (id, kind, competitor_id, trigger, status, progress, message, result, created_by)
       VALUES (?, 'global-trends', NULL, ?, 'queued', 0, 'Queued', ?::jsonb, ?)`,
      [id, trigger, JSON.stringify({ windowDays }), userId],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new TrendsInProgressError();
    throw error;
  }
  return id;
}

export async function getTrendsReport(id: string): Promise<TrendsReportRow | undefined> {
  const row = await queryOne(`SELECT ${REPORT_BASE}, result FROM partnership_reports WHERE id = ? AND kind = 'global-trends'`, [id]);
  if (!row) return undefined;
  const report = mapReport(row);
  // Queued runs store only { windowDays } until they finish.
  if (report.result && !Array.isArray(report.result.items)) report.result = null;
  return report;
}

/** Newest first, without results. */
export async function listTrendsReports(limit = 20): Promise<TrendsReportRow[]> {
  const rows = await queryAll(`SELECT ${REPORT_BASE}, NULL AS result FROM partnership_reports WHERE kind = 'global-trends' ORDER BY created_at DESC LIMIT ?`, [limit]);
  return rows.map(row => mapReport(row, false));
}

export async function latestSucceededTrendsReport(): Promise<TrendsReportRow | undefined> {
  const row = await queryOne(
    `SELECT ${REPORT_BASE}, result FROM partnership_reports WHERE kind = 'global-trends' AND status = 'succeeded' ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
  );
  return row ? mapReport(row) : undefined;
}

export async function finishTrendsReport(id: string, result: TrendsDigestResult, model: string | null): Promise<void> {
  await execute(
    `UPDATE partnership_reports SET status = 'succeeded', progress = 100, message = 'Done', result = ?::jsonb, model = ?,
       window_start = ?::date, window_end = ?::date, error = NULL, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND kind = 'global-trends'`,
    [JSON.stringify(result), model, result.window.start, result.window.end, id],
  );
}
