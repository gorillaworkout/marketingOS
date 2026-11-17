import { randomUUID } from 'node:crypto';
import { execute, queryAll, queryOne } from '@/lib/database';
import type { CompetitorInput, EvidenceInput, IntelReportResult, Region } from './intel';
import { parseSocialHandles, withInstagram, type SocialHandles } from './social';

export type ReportStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface CompetitorRow {
  id: string;
  name: string;
  region: Region;
  website: string | null;
  instagramHandle: string | null;
  /** Accounts per platform; instagram mirrors instagramHandle. */
  socialHandles: SocialHandles;
  notes: string | null;
  active: boolean;
  sortOrder: number;
  createdBy: string | null;
  updatedAt: string;
}

export interface EvidenceRow {
  id: string;
  competitorId: string;
  kind: 'link' | 'text' | 'screenshot';
  sourceUrl: string | null;
  pastedText: string | null;
  screenshotKey: string | null;
  extractedText: string | null;
  extractionStatus: 'none' | 'done' | 'failed';
  observedOn: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface ReportRow {
  id: string;
  kind: string;
  competitorId: string | null;
  trigger: 'manual' | 'scheduled';
  status: ReportStatus;
  progress: number;
  message: string;
  result: IntelReportResult | null;
  model: string | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** History rows only: the treg cost of a finished run (null = free sources). */
  tregCost?: IntelReportResult['tregCost'];
}

export class ReportInProgressError extends Error {
  constructor() { super('A refresh for this competitor is already running.'); }
}

export class DuplicateCompetitorError extends Error {
  constructor() { super('A competitor with this name already exists.'); }
}

const isUniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505';

function asJson<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

function mapCompetitor(row: Record<string, unknown>): CompetitorRow {
  return {
    id: String(row.id),
    name: String(row.name),
    region: row.region === 'international' ? 'international' : 'local',
    website: str(row.website),
    instagramHandle: str(row.instagram_handle),
    socialHandles: withInstagram(parseSocialHandles(row.social_handles), str(row.instagram_handle)),
    notes: str(row.notes),
    active: row.active !== false,
    sortOrder: Number(row.sort_order) || 0,
    createdBy: str(row.created_by),
    updatedAt: String(row.updated_at),
  };
}

function mapEvidence(row: Record<string, unknown>): EvidenceRow {
  return {
    id: String(row.id),
    competitorId: String(row.competitor_id),
    kind: row.kind as EvidenceRow['kind'],
    sourceUrl: str(row.source_url),
    pastedText: str(row.pasted_text),
    screenshotKey: str(row.screenshot_key),
    extractedText: str(row.extracted_text),
    extractionStatus: (row.extraction_status as EvidenceRow['extractionStatus']) || 'none',
    observedOn: str(row.observed_on),
    createdBy: str(row.created_by),
    createdByName: str(row.created_by_name),
    createdAt: String(row.created_at),
  };
}

function mapReport(row: Record<string, unknown>, withResult = true): ReportRow {
  return {
    id: String(row.id),
    kind: String(row.kind),
    competitorId: str(row.competitor_id),
    trigger: row.trigger === 'scheduled' ? 'scheduled' : 'manual',
    status: row.status as ReportStatus,
    progress: Number(row.progress) || 0,
    message: String(row.message || ''),
    result: withResult ? asJson<IntelReportResult>(row.result) : null,
    model: str(row.model),
    error: str(row.error),
    createdBy: str(row.created_by),
    createdAt: String(row.created_at),
    finishedAt: str(row.finished_at),
  };
}

const COMPETITOR_COLUMNS = `id, name, region, website, instagram_handle, social_handles, notes, active, sort_order, created_by, updated_at::text AS updated_at`;
const REPORT_COLUMNS = `id, kind, competitor_id, trigger, status, progress, message, result, model, error, created_by, created_at::text AS created_at, finished_at::text AS finished_at`;

export async function listCompetitors(): Promise<CompetitorRow[]> {
  const rows = await queryAll(`SELECT ${COMPETITOR_COLUMNS} FROM partnership_competitors WHERE active ORDER BY sort_order, LOWER(name)`);
  return rows.map(mapCompetitor);
}

export async function getCompetitor(id: string): Promise<CompetitorRow | undefined> {
  const row = await queryOne(`SELECT ${COMPETITOR_COLUMNS} FROM partnership_competitors WHERE id = ? AND active`, [id]);
  return row ? mapCompetitor(row) : undefined;
}

export async function createCompetitor(input: CompetitorInput, userId: string): Promise<string> {
  const id = randomUUID();
  try {
    await execute(
      `INSERT INTO partnership_competitors (id, name, region, website, instagram_handle, social_handles, notes, sort_order, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM partnership_competitors), ?, ?)`,
      [id, input.name, input.region, input.website, input.instagramHandle, JSON.stringify(input.socialHandles), input.notes, userId, userId],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCompetitorError();
    throw error;
  }
  return id;
}

export async function updateCompetitor(id: string, input: CompetitorInput, userId: string): Promise<void> {
  try {
    await execute(
      `UPDATE partnership_competitors SET name = ?, region = ?, website = ?, instagram_handle = ?, social_handles = ?::jsonb, notes = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [input.name, input.region, input.website, input.instagramHandle, JSON.stringify(input.socialHandles), input.notes, userId, id],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCompetitorError();
    throw error;
  }
}

export async function deleteCompetitor(id: string): Promise<void> {
  await execute('DELETE FROM partnership_competitors WHERE id = ?', [id]);
}

export async function listEvidence(competitorId: string): Promise<EvidenceRow[]> {
  const rows = await queryAll(
    `SELECT e.id, e.competitor_id, e.kind, e.source_url, e.pasted_text, e.screenshot_key, e.extracted_text, e.extraction_status,
            e.observed_on::text AS observed_on, e.created_by, u.name AS created_by_name, e.created_at::text AS created_at
     FROM partnership_evidence e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.competitor_id = ? ORDER BY e.created_at DESC LIMIT 100`,
    [competitorId],
  );
  return rows.map(mapEvidence);
}

export async function getEvidence(id: string): Promise<EvidenceRow | undefined> {
  const row = await queryOne(
    `SELECT id, competitor_id, kind, source_url, pasted_text, screenshot_key, extracted_text, extraction_status,
            observed_on::text AS observed_on, created_by, NULL AS created_by_name, created_at::text AS created_at
     FROM partnership_evidence WHERE id = ?`,
    [id],
  );
  return row ? mapEvidence(row) : undefined;
}

export async function createEvidence(competitorId: string, input: EvidenceInput & { screenshotKey?: string | null }, userId: string): Promise<string> {
  const id = randomUUID();
  await execute(
    `INSERT INTO partnership_evidence (id, competitor_id, kind, source_url, pasted_text, screenshot_key, observed_on, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?::date, ?)`,
    [id, competitorId, input.kind, input.sourceUrl, input.pastedText, input.screenshotKey ?? null, input.observedOn, userId],
  );
  return id;
}

export async function saveEvidenceExtraction(id: string, text: string | null): Promise<void> {
  await execute(
    'UPDATE partnership_evidence SET extracted_text = ?, extraction_status = ? WHERE id = ?',
    [text, text ? 'done' : 'failed', id],
  );
}

export async function deleteEvidence(id: string): Promise<void> {
  await execute('DELETE FROM partnership_evidence WHERE id = ?', [id]);
}

/** A run that lost its worker (for example a restart) shows as failed instead of running forever. */
export async function expireStaleReports(): Promise<void> {
  await execute(
    `UPDATE partnership_reports SET status = 'failed', error = 'The refresh timed out: no progress for 10 minutes (the server may have restarted). Refresh again.',
       progress = 100, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('queued', 'running') AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'`,
  );
}

export async function createReport(competitorId: string, trigger: 'manual' | 'scheduled', userId: string | null): Promise<string> {
  await expireStaleReports();
  const id = randomUUID();
  try {
    await execute(
      `INSERT INTO partnership_reports (id, kind, competitor_id, trigger, status, progress, message, created_by)
       VALUES (?, 'competitor-activity', ?, ?, 'queued', 0, 'Queued', ?)`,
      [id, competitorId, trigger, userId],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new ReportInProgressError();
    throw error;
  }
  return id;
}

export async function getReport(id: string): Promise<ReportRow | undefined> {
  const row = await queryOne(`SELECT ${REPORT_COLUMNS} FROM partnership_reports WHERE id = ?`, [id]);
  return row ? mapReport(row) : undefined;
}

export async function updateReportProgress(id: string, progress: number, message: string): Promise<void> {
  await execute(
    `UPDATE partnership_reports SET status = 'running', progress = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'running')`,
    [Math.max(0, Math.min(99, Math.round(progress))), message.slice(0, 300), id],
  );
}

export async function finishReport(id: string, result: IntelReportResult, model: string | null): Promise<void> {
  await execute(
    `UPDATE partnership_reports SET status = 'succeeded', progress = 100, message = 'Done', result = ?::jsonb, model = ?,
       window_start = ?::date, window_end = ?::date, error = NULL, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(result), model, result.window.start, result.window.end, id],
  );
}

export async function failReport(id: string, error: string): Promise<void> {
  await execute(
    `UPDATE partnership_reports SET status = 'failed', progress = 100, message = 'Failed', error = ?, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [error.slice(0, 1_000), id],
  );
}

/** Latest succeeded report per competitor (with result), plus the newest report of any status. */
export async function latestReports(): Promise<{ succeeded: Map<string, ReportRow>; newest: Map<string, ReportRow> }> {
  const succeededRows = await queryAll(
    `SELECT DISTINCT ON (competitor_id) ${REPORT_COLUMNS} FROM partnership_reports
     WHERE kind = 'competitor-activity' AND status = 'succeeded' AND competitor_id IS NOT NULL
     ORDER BY competitor_id, finished_at DESC NULLS LAST`,
  );
  const newestRows = await queryAll(
    `SELECT DISTINCT ON (competitor_id) id, kind, competitor_id, trigger, status, progress, message, NULL AS result, model, error, created_by,
            created_at::text AS created_at, finished_at::text AS finished_at
     FROM partnership_reports WHERE kind = 'competitor-activity' AND competitor_id IS NOT NULL
     ORDER BY competitor_id, created_at DESC`,
  );
  return {
    succeeded: new Map(succeededRows.map(row => [String(row.competitor_id), mapReport(row)])),
    newest: new Map(newestRows.map(row => [String(row.competitor_id), mapReport(row, false)])),
  };
}

export async function recentReports(competitorId: string, limit = 10): Promise<ReportRow[]> {
  const rows = await queryAll(
    `SELECT id, kind, competitor_id, trigger, status, progress, message, NULL AS result, model, error, created_by,
            created_at::text AS created_at, finished_at::text AS finished_at, result->'tregCost' AS treg_cost
     FROM partnership_reports WHERE competitor_id = ? ORDER BY created_at DESC LIMIT ?`,
    [competitorId, limit],
  );
  return rows.map(row => ({ ...mapReport(row, false), tregCost: asJson<NonNullable<IntelReportResult['tregCost']>>(row.treg_cost) }));
}
