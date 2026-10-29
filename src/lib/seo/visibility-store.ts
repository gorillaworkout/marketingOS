import { v4 as uuidv4 } from 'uuid';
import { execute, executeTransaction, queryAll, queryOne } from '@/lib/database';
import {
  DEFAULT_SETTINGS, MAX_PROMPTS_PER_SITE, rate,
  type PromptInput, type VisibilitySettings,
} from './visibility';

/** Database access for SEO OS AI Visibility. */

export const STALE_RUN_MS = 3 * 60 * 60 * 1000;
export const STALE_RUN_ERROR = 'Marked failed: run did not finish (stale lock released).';

export class RunBusyError extends Error {
  constructor() { super('An AI Visibility run is already in progress for this site.'); }
}
export class PromptLimitError extends Error {
  constructor() { super(`A site can have at most ${MAX_PROMPTS_PER_SITE} prompts.`); }
}
export class DuplicatePromptError extends Error {
  constructor() { super('This prompt already exists for the site.'); }
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === '23505';
}

// ---------- Settings ----------

export async function getVisibilitySettings(siteId: string): Promise<VisibilitySettings & { updatedAt: string | null }> {
  const row = await queryOne<{ models: string[]; classifier_enabled: boolean; classifier_model: string; max_checks_per_run: number; updated_at: string }>(
    'SELECT models, classifier_enabled, classifier_model, max_checks_per_run, updated_at FROM seo_ai_visibility_settings WHERE site_id = ?',
    [siteId],
  );
  if (!row) return { ...DEFAULT_SETTINGS, models: [...DEFAULT_SETTINGS.models], updatedAt: null };
  return {
    models: row.models,
    classifierEnabled: row.classifier_enabled,
    classifierModel: row.classifier_model,
    maxChecksPerRun: Number(row.max_checks_per_run),
    updatedAt: row.updated_at,
  };
}

export async function saveVisibilitySettings(siteId: string, settings: VisibilitySettings, userId: string): Promise<void> {
  await execute(
    `INSERT INTO seo_ai_visibility_settings (site_id, models, classifier_enabled, classifier_model, max_checks_per_run, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (site_id) DO UPDATE SET models = EXCLUDED.models, classifier_enabled = EXCLUDED.classifier_enabled,
       classifier_model = EXCLUDED.classifier_model, max_checks_per_run = EXCLUDED.max_checks_per_run,
       updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [siteId, settings.models, settings.classifierEnabled, settings.classifierModel, settings.maxChecksPerRun, userId],
  );
}

// ---------- Prompts ----------

export interface PromptRow {
  id: string;
  site_id: string;
  prompt: string;
  brand_terms: string[];
  competitors: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  checks: number;
  mentions: number;
}

export async function listPrompts(siteId: string, onlyActive = false): Promise<PromptRow[]> {
  const rows = await queryAll<PromptRow & Record<string, unknown>>(
    `SELECT p.id, p.site_id, p.prompt, p.brand_terms, p.competitors, p.active, p.created_at, p.updated_at,
       MAX(c.created_at) AS last_checked_at,
       COUNT(c.id) FILTER (WHERE c.error IS NULL)::int AS checks,
       COUNT(c.id) FILTER (WHERE c.error IS NULL AND c.mentioned)::int AS mentions
     FROM seo_ai_prompts p
     LEFT JOIN seo_ai_checks c ON c.prompt_id = p.id
     WHERE p.site_id = ?${onlyActive ? ' AND p.active' : ''}
     GROUP BY p.id
     ORDER BY p.created_at, p.id`,
    [siteId],
  );
  return rows.map(row => ({ ...row, checks: Number(row.checks), mentions: Number(row.mentions) }));
}

async function promptCount(siteId: string): Promise<number> {
  const row = await queryOne<{ n: string }>('SELECT COUNT(*)::text AS n FROM seo_ai_prompts WHERE site_id = ?', [siteId]);
  return Number(row?.n ?? 0);
}

export async function createPrompt(siteId: string, input: PromptInput, userId: string): Promise<string> {
  if (await promptCount(siteId) >= MAX_PROMPTS_PER_SITE) throw new PromptLimitError();
  const id = uuidv4();
  try {
    await execute(
      `INSERT INTO seo_ai_prompts (id, site_id, prompt, brand_terms, competitors, active, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, siteId, input.prompt, input.brandTerms, input.competitors, input.active, userId, userId],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicatePromptError();
    throw error;
  }
  return id;
}

export async function updatePrompt(siteId: string, id: string, input: PromptInput, userId: string): Promise<boolean> {
  try {
    const changed = await execute(
      `UPDATE seo_ai_prompts SET prompt = ?, brand_terms = ?, competitors = ?, active = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND site_id = ?`,
      [input.prompt, input.brandTerms, input.competitors, input.active, userId, id, siteId],
    );
    return changed > 0;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicatePromptError();
    throw error;
  }
}

export async function deletePrompt(siteId: string, id: string): Promise<boolean> {
  return (await execute('DELETE FROM seo_ai_prompts WHERE id = ? AND site_id = ?', [id, siteId])) > 0;
}

/** Upsert by prompt text (case-insensitive). Existing prompts get the file's terms and active flag. */
export async function importPrompts(siteId: string, rows: PromptInput[], userId: string): Promise<{ inserted: number; updated: number }> {
  const existing = new Set((await queryAll<{ key: string }>(
    'SELECT lower(btrim(prompt)) AS key FROM seo_ai_prompts WHERE site_id = ?', [siteId])).map(row => row.key));
  const fresh = rows.filter(row => !existing.has(row.prompt.toLowerCase())).length;
  if (existing.size + fresh > MAX_PROMPTS_PER_SITE) throw new PromptLimitError();
  let inserted = 0;
  let updated = 0;
  await executeTransaction(async tx => {
    for (const row of rows) {
      const isNew = !existing.has(row.prompt.toLowerCase());
      await tx.execute(
        `INSERT INTO seo_ai_prompts (id, site_id, prompt, brand_terms, competitors, active, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (site_id, (lower(btrim(prompt)))) DO UPDATE SET brand_terms = EXCLUDED.brand_terms,
           competitors = EXCLUDED.competitors, active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [uuidv4(), siteId, row.prompt, row.brandTerms, row.competitors, row.active, userId, userId],
      );
      if (isNew) inserted += 1; else updated += 1;
    }
  });
  return { inserted, updated };
}

// ---------- Runs ----------

export interface RunRow {
  id: string;
  site_id: string;
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  models: string[];
  classifier_enabled: boolean;
  checks_planned: number;
  checks_done: number;
  checks_failed: number;
  prompts_skipped: number;
  cost: number;
  error: string | null;
  trigger: 'manual' | 'cron';
  triggered_by: string | null;
  triggered_by_name: string | null;
  started_at: string;
  finished_at: string | null;
}

const RUN_COLUMNS = `r.id, r.site_id, r.status, r.models, r.classifier_enabled, r.checks_planned, r.checks_done, r.checks_failed,
  r.prompts_skipped, r.cost, r.error, r.trigger, r.triggered_by, u.name AS triggered_by_name, r.started_at, r.finished_at`;

function toRun(row: RunRow): RunRow {
  return {
    ...row,
    checks_planned: Number(row.checks_planned),
    checks_done: Number(row.checks_done),
    checks_failed: Number(row.checks_failed),
    prompts_skipped: Number(row.prompts_skipped),
    cost: Number(row.cost),
  };
}

export async function listRuns(siteId: string, limit = 20): Promise<RunRow[]> {
  const rows = await queryAll<RunRow & Record<string, unknown>>(
    `SELECT ${RUN_COLUMNS} FROM seo_ai_runs r LEFT JOIN users u ON u.id = r.triggered_by
     WHERE r.site_id = ? ORDER BY r.started_at DESC LIMIT ?`,
    [siteId, limit],
  );
  return rows.map(toRun);
}

export async function getRun(id: string): Promise<RunRow | undefined> {
  const row = await queryOne<RunRow & Record<string, unknown>>(
    `SELECT ${RUN_COLUMNS} FROM seo_ai_runs r LEFT JOIN users u ON u.id = r.triggered_by WHERE r.id = ?`, [id]);
  return row ? toRun(row) : undefined;
}

export interface NewRun {
  siteId: string;
  models: string[];
  classifierEnabled: boolean;
  checksPlanned: number;
  promptsSkipped: number;
  trigger: 'manual' | 'cron';
  triggeredBy: string | null;
}

/** Takes the per-site lock (releasing a stale one first). Throws RunBusyError when a run is active. */
export async function startRun(input: NewRun, now = new Date()): Promise<string> {
  await execute(
    `UPDATE seo_ai_runs SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP
     WHERE site_id = ? AND status = 'running' AND started_at < ?`,
    [STALE_RUN_ERROR, input.siteId, new Date(now.getTime() - STALE_RUN_MS)],
  );
  const id = uuidv4();
  try {
    await execute(
      `INSERT INTO seo_ai_runs (id, site_id, status, models, classifier_enabled, checks_planned, prompts_skipped, trigger, triggered_by)
       VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
      [id, input.siteId, input.models, input.classifierEnabled, input.checksPlanned, input.promptsSkipped, input.trigger, input.triggeredBy],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new RunBusyError();
    throw error;
  }
  return id;
}

export async function updateRunProgress(runId: string, progress: { done: number; failed: number; cost: number }): Promise<void> {
  await execute(
    `UPDATE seo_ai_runs SET checks_done = ?, checks_failed = ?, cost = ? WHERE id = ? AND status = 'running'`,
    [progress.done, progress.failed, progress.cost, runId],
  );
}

export async function finishRun(runId: string, status: 'succeeded' | 'partial' | 'failed', progress: { done: number; failed: number; cost: number }, error: string | null): Promise<void> {
  await execute(
    `UPDATE seo_ai_runs SET status = ?, checks_done = ?, checks_failed = ?, cost = ?, error = ?, finished_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'running'`,
    [status, progress.done, progress.failed, progress.cost, error, runId],
  );
}

// ---------- Checks ----------

export interface NewCheck {
  runId: string;
  siteId: string;
  promptId: string;
  promptText: string;
  model: string;
  answeredModel: string | null;
  fallbackLabel: string | null;
  response: string | null;
  mentioned: boolean | null;
  rankInAnswer: number | null;
  citedUrls: string[];
  siteCited: boolean;
  competitorsMentioned: string[];
  detection: 'terms' | 'classifier' | null;
  classifierEvidence: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  error: string | null;
}

export async function insertCheck(check: NewCheck): Promise<string> {
  const id = uuidv4();
  await execute(
    `INSERT INTO seo_ai_checks (id, run_id, site_id, prompt_id, prompt_text, model, answered_model, fallback_label, response, mentioned,
       rank_in_answer, cited_urls, site_cited, competitors_mentioned, detection, classifier_evidence, input_tokens, output_tokens, cost, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, check.runId, check.siteId, check.promptId, check.promptText, check.model, check.answeredModel, check.fallbackLabel, check.response,
      check.mentioned, check.rankInAnswer, check.citedUrls, check.siteCited, check.competitorsMentioned, check.detection,
      check.classifierEvidence, check.inputTokens, check.outputTokens, check.cost, check.error],
  );
  return id;
}

export interface CheckRow {
  id: string;
  run_id: string;
  prompt_id: string | null;
  prompt_text: string;
  model: string;
  answered_model: string | null;
  fallback_label: string | null;
  response: string | null;
  mentioned: boolean | null;
  rank_in_answer: number | null;
  cited_urls: string[];
  site_cited: boolean;
  competitors_mentioned: string[];
  detection: string | null;
  classifier_evidence: string | null;
  cost: number;
  error: string | null;
  created_at: string;
}

export async function getCheck(siteId: string, id: string): Promise<CheckRow | undefined> {
  return queryOne<CheckRow & Record<string, unknown>>(
    `SELECT id, run_id, prompt_id, prompt_text, model, answered_model, fallback_label, response, mentioned, rank_in_answer, cited_urls,
       site_cited, competitors_mentioned, detection, classifier_evidence, cost, error, created_at
     FROM seo_ai_checks WHERE site_id = ? AND id = ?`,
    [siteId, id],
  );
}

// ---------- Report ----------

export interface WeeklyModelRate { week: string; model: string; answers: number; mentions: number; rate: number | null }
export interface ShareRow { name: string; isBrand: boolean; answers: number; share: number | null }
export interface LatestCell {
  check_id: string; prompt_id: string; model: string; mentioned: boolean | null; rank_in_answer: number | null;
  site_cited: boolean; fallback: boolean; error: string | null; created_at: string;
}
export interface VisibilityReport {
  weeks: number;
  weekly: WeeklyModelRate[];
  byModel: Array<{ model: string; answers: number; mentions: number; rate: number | null; fallbacks: number; errors: number }>;
  share: ShareRow[];
  totalAnswers: number;
  latest: LatestCell[];
}

/** A comparable answer = no error and answered by the model that was asked (no fallback). */
const COMPARABLE = 'c.error IS NULL AND c.answered_model = c.model';

export async function visibilityReport(siteId: string, siteName: string, weeks = 12): Promise<VisibilityReport> {
  const span = Math.max(1, Math.min(104, Math.floor(weeks)));
  const since = `c.created_at >= CURRENT_TIMESTAMP - make_interval(weeks => ?::int)`;
  const weeklyRows = await queryAll<{ week: string; model: string; answers: number; mentions: number }>(
    `SELECT to_char(date_trunc('week', c.created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS week, c.model,
       COUNT(*)::int AS answers, COUNT(*) FILTER (WHERE c.mentioned)::int AS mentions
     FROM seo_ai_checks c WHERE c.site_id = ? AND ${since} AND ${COMPARABLE}
     GROUP BY 1, 2 ORDER BY 1, 2`,
    [siteId, span],
  );
  const modelRows = await queryAll<{ model: string; answers: number; mentions: number; fallbacks: number; errors: number }>(
    `SELECT c.model,
       COUNT(*) FILTER (WHERE ${COMPARABLE})::int AS answers,
       COUNT(*) FILTER (WHERE ${COMPARABLE} AND c.mentioned)::int AS mentions,
       COUNT(*) FILTER (WHERE c.error IS NULL AND c.answered_model IS DISTINCT FROM c.model)::int AS fallbacks,
       COUNT(*) FILTER (WHERE c.error IS NOT NULL)::int AS errors
     FROM seo_ai_checks c WHERE c.site_id = ? AND ${since}
     GROUP BY 1 ORDER BY 1`,
    [siteId, span],
  );
  const totals = await queryOne<{ answers: number; mentions: number }>(
    `SELECT COUNT(*)::int AS answers, COUNT(*) FILTER (WHERE c.mentioned)::int AS mentions
     FROM seo_ai_checks c WHERE c.site_id = ? AND ${since} AND ${COMPARABLE}`,
    [siteId, span],
  );
  const competitorRows = await queryAll<{ name: string; answers: number }>(
    `SELECT name, COUNT(*)::int AS answers
     FROM seo_ai_checks c CROSS JOIN LATERAL unnest(c.competitors_mentioned) AS name
     WHERE c.site_id = ? AND ${since} AND ${COMPARABLE}
     GROUP BY name ORDER BY answers DESC, name LIMIT 30`,
    [siteId, span],
  );
  const latest = await queryAll<LatestCell & Record<string, unknown>>(
    `SELECT DISTINCT ON (c.prompt_id, c.model) c.id AS check_id, c.prompt_id, c.model, c.mentioned, c.rank_in_answer, c.site_cited,
       (c.answered_model IS DISTINCT FROM c.model AND c.error IS NULL) AS fallback, c.error, c.created_at
     FROM seo_ai_checks c WHERE c.site_id = ? AND c.prompt_id IS NOT NULL
     ORDER BY c.prompt_id, c.model, c.created_at DESC`,
    [siteId],
  );

  const totalAnswers = Number(totals?.answers ?? 0);
  const share: ShareRow[] = [
    { name: siteName, isBrand: true, answers: Number(totals?.mentions ?? 0), share: null },
    ...competitorRows.map(row => ({ name: row.name, isBrand: false, answers: Number(row.answers), share: null })),
  ];
  const mentionSum = share.reduce((sum, row) => sum + row.answers, 0);
  for (const row of share) row.share = rate(row.answers, mentionSum);

  return {
    weeks: span,
    weekly: weeklyRows.map(row => ({ ...row, answers: Number(row.answers), mentions: Number(row.mentions), rate: rate(Number(row.mentions), Number(row.answers)) })),
    byModel: modelRows.map(row => ({
      model: row.model, answers: Number(row.answers), mentions: Number(row.mentions),
      rate: rate(Number(row.mentions), Number(row.answers)), fallbacks: Number(row.fallbacks), errors: Number(row.errors),
    })),
    share,
    totalAnswers,
    latest,
  };
}

/** token_logs.user_id must be a real user: the explicit id when valid, else the oldest admin. */
export async function resolveRunUserId(explicit: string | null | undefined): Promise<string | null> {
  if (explicit) {
    const row = await queryOne<{ id: string }>('SELECT id FROM users WHERE id = ? OR username = ?', [explicit, explicit]);
    if (row) return row.id;
    return null;
  }
  const admin = await queryOne<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1`, []);
  return admin?.id ?? null;
}
