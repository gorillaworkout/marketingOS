import { randomUUID } from 'node:crypto';
import { execute, queryAll, queryOne } from '@/lib/database';
import { decryptSecret, encryptSecret, maskSecret } from '@/lib/llm-crypto';
import type { GapKeyword, OurKeyword } from './keyword-gap-bucket';

export type GapProvider = 'free' | 'semrush' | 'dataforseo';
export type GapStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface GapInput {
  uploadedKeywords: OurKeyword[] | null;
  competitors: string[];
  language: 'id' | 'en';
  market: string;
}

export interface GapResult {
  provider: GapProvider;
  source: 'gsc-stored' | 'upload' | 'provider';
  methodology: string;
  ranked: boolean;
  keywords: GapKeyword[];
  counts: Record<string, number>;
  storedQueries: number;
  notes: string[];
}

export interface GapRow {
  id: string;
  site_id: string | null;
  our_domain: string;
  competitors: string;
  language: string;
  market: string;
  provider: GapProvider;
  status: GapStatus;
  progress: number;
  message: string;
  keyword_count: number | null;
  summary: string | null;
  summary_error: string | null;
  summary_model: string | null;
  input: GapInput | null;
  result: GapResult | null;
  error: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export class GapInProgressError extends Error {
  constructor() { super('A keyword gap for this domain is already running.'); }
}

function asJson<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

const LIST = `g.id, g.site_id, g.our_domain, g.competitors, g.language, g.market, g.provider, g.status, g.progress, g.message,
  g.keyword_count, g.summary, g.summary_error, g.summary_model, g.error, g.created_by, u.name AS created_by_name,
  g.created_at, g.updated_at, g.finished_at`;

function mapRow(row: Record<string, unknown>, full: boolean): GapRow {
  return {
    id: String(row.id),
    site_id: row.site_id ? String(row.site_id) : null,
    our_domain: String(row.our_domain),
    competitors: String(row.competitors || '[]'),
    language: String(row.language || 'id'),
    market: String(row.market || ''),
    provider: row.provider as GapProvider,
    status: row.status as GapStatus,
    progress: Number(row.progress) || 0,
    message: String(row.message || ''),
    keyword_count: row.keyword_count === null || row.keyword_count === undefined ? null : Number(row.keyword_count),
    summary: row.summary ? String(row.summary) : null,
    summary_error: row.summary_error ? String(row.summary_error) : null,
    summary_model: row.summary_model ? String(row.summary_model) : null,
    input: full ? asJson<GapInput>(row.input) : null,
    result: full ? asJson<GapResult>(row.result) : null,
    error: row.error ? String(row.error) : null,
    created_by: row.created_by ? String(row.created_by) : null,
    created_by_name: row.created_by_name ? String(row.created_by_name) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    finished_at: row.finished_at ? String(row.finished_at) : null,
  };
}

export async function expireStaleGaps(): Promise<void> {
  await execute(
    `UPDATE seo_keyword_gaps SET status = 'failed', error = 'The keyword gap stopped before it finished.', progress = 100,
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('queued', 'running') AND updated_at < CURRENT_TIMESTAMP - INTERVAL '20 minutes'`,
  );
}

export async function createGap(input: { siteId: string | null; ourDomain: string; provider: GapProvider; payload: GapInput; userId: string }): Promise<string> {
  await expireStaleGaps();
  const id = randomUUID();
  try {
    await execute(
      `INSERT INTO seo_keyword_gaps (id, site_id, our_domain, competitors, language, market, provider, status, progress, message, input, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, 'Queued', ?::jsonb, ?)`,
      [id, input.siteId, input.ourDomain, JSON.stringify(input.payload.competitors), input.payload.language, input.payload.market, input.provider, JSON.stringify(input.payload), input.userId],
    );
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && (error as { code: string }).code === '23505') throw new GapInProgressError();
    throw error;
  }
  return id;
}

export async function updateGapProgress(id: string, progress: number, message: string): Promise<void> {
  await execute(
    `UPDATE seo_keyword_gaps SET status = 'running', progress = ?, message = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('queued', 'running')`,
    [Math.max(0, Math.min(99, progress)), message.slice(0, 240), id],
  );
}

export async function finishGap(id: string, input: { summary: string | null; summaryError: string | null; model: string | null; result: GapResult }): Promise<void> {
  await execute(
    `UPDATE seo_keyword_gaps SET status = 'succeeded', progress = 100, message = 'Keyword gap complete', keyword_count = ?,
       summary = ?, summary_error = ?, summary_model = ?, result = ?::jsonb, error = NULL,
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('queued', 'running')`,
    [input.result.keywords.length, input.summary, input.summaryError, input.model, JSON.stringify(input.result), id],
  );
}

export async function failGap(id: string, error: string): Promise<void> {
  await execute(
    `UPDATE seo_keyword_gaps SET status = 'failed', progress = 100, message = 'Keyword gap failed', error = ?,
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('queued', 'running')`,
    [error.slice(0, 500), id],
  );
}

export async function listGaps(limit = 20): Promise<GapRow[]> {
  await expireStaleGaps();
  const rows = await queryAll<Record<string, unknown>>(
    `SELECT ${LIST} FROM seo_keyword_gaps g LEFT JOIN users u ON u.id = g.created_by ORDER BY g.created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(row => mapRow(row, false));
}

export async function getGap(id: string): Promise<GapRow | undefined> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${LIST}, g.input, g.result FROM seo_keyword_gaps g LEFT JOIN users u ON u.id = g.created_by WHERE g.id = ?`,
    [id],
  );
  return row ? mapRow(row, true) : undefined;
}

type SecretRow = {
  semrush_key_ciphertext: string | null;
  semrush_key_hint: string | null;
  dataforseo_login_ciphertext: string | null;
  dataforseo_login_hint: string | null;
  dataforseo_password_ciphertext: string | null;
  dataforseo_password_hint: string | null;
};

async function secretRow(): Promise<SecretRow | undefined> {
  return queryOne<SecretRow>('SELECT semrush_key_ciphertext, semrush_key_hint, dataforseo_login_ciphertext, dataforseo_login_hint, dataforseo_password_ciphertext, dataforseo_password_hint FROM seo_keyword_gap_settings WHERE id = ?', ['default']);
}

function readStored(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try { return decryptSecret(ciphertext); } catch { return null; }
}

export async function providerFlags(): Promise<{ semrush: boolean; dataforseo: boolean }> {
  const row = await secretRow().catch(() => undefined);
  const semrush = Boolean(process.env.SEMRUSH_API_KEY?.trim() || row?.semrush_key_hint);
  const dataforseo = Boolean((process.env.DATAFORSEO_LOGIN?.trim() && process.env.DATAFORSEO_PASSWORD?.trim()) || (row?.dataforseo_login_hint && row?.dataforseo_password_hint));
  return { semrush, dataforseo };
}

export async function providerKeyStatus(): Promise<{ semrush: { configured: boolean; hint: string | null; source: string }; dataforseo: { configured: boolean; hint: string | null; source: string } }> {
  const row = await secretRow().catch(() => undefined);
  const semrushEnv = Boolean(process.env.SEMRUSH_API_KEY?.trim());
  const dataEnv = Boolean(process.env.DATAFORSEO_LOGIN?.trim() && process.env.DATAFORSEO_PASSWORD?.trim());
  return {
    semrush: { configured: semrushEnv || Boolean(row?.semrush_key_hint), hint: semrushEnv ? 'Server environment' : row?.semrush_key_hint ?? null, source: semrushEnv ? 'environment' : row?.semrush_key_hint ? 'settings' : 'none' },
    dataforseo: { configured: dataEnv || Boolean(row?.dataforseo_login_hint && row?.dataforseo_password_hint), hint: dataEnv ? 'Server environment' : row?.dataforseo_login_hint ?? null, source: dataEnv ? 'environment' : row?.dataforseo_password_hint ? 'settings' : 'none' },
  };
}

export async function readSemrushKey(): Promise<string | null> {
  const envKey = process.env.SEMRUSH_API_KEY?.trim();
  if (envKey) return envKey;
  const row = await secretRow().catch(() => undefined);
  return readStored(row?.semrush_key_ciphertext ?? null);
}

export async function readDataForSeo(): Promise<{ login: string; password: string } | null> {
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  if (login && password) return { login, password };
  const row = await secretRow().catch(() => undefined);
  const storedLogin = readStored(row?.dataforseo_login_ciphertext ?? null);
  const storedPassword = readStored(row?.dataforseo_password_ciphertext ?? null);
  if (!storedLogin || !storedPassword) return null;
  return { login: storedLogin, password: storedPassword };
}

export async function saveSemrushKey(secret: string | null): Promise<void> {
  const hint = secret ? maskSecret(secret) : null;
  const ciphertext = secret ? encryptSecret(secret) : null;
  await execute(
    `INSERT INTO seo_keyword_gap_settings (id, semrush_key_ciphertext, semrush_key_hint, updated_at)
     VALUES ('default', ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET semrush_key_ciphertext = EXCLUDED.semrush_key_ciphertext, semrush_key_hint = EXCLUDED.semrush_key_hint, updated_at = CURRENT_TIMESTAMP`,
    [ciphertext, hint],
  );
}

export async function saveDataForSeo(login: string | null, password: string | null): Promise<void> {
  await execute(
    `INSERT INTO seo_keyword_gap_settings (id, dataforseo_login_ciphertext, dataforseo_login_hint, dataforseo_password_ciphertext, dataforseo_password_hint, updated_at)
     VALUES ('default', ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET dataforseo_login_ciphertext = EXCLUDED.dataforseo_login_ciphertext,
       dataforseo_login_hint = EXCLUDED.dataforseo_login_hint,
       dataforseo_password_ciphertext = EXCLUDED.dataforseo_password_ciphertext,
       dataforseo_password_hint = EXCLUDED.dataforseo_password_hint,
       updated_at = CURRENT_TIMESTAMP`,
    [login ? encryptSecret(login) : null, login ? maskSecret(login) : null, password ? encryptSecret(password) : null, password ? maskSecret(password) : null],
  );
}
