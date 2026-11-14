import { randomUUID } from 'node:crypto';
import { execute, queryAll, queryOne } from '@/lib/database';
import { decryptSecret, encryptSecret, maskSecret } from '@/lib/llm-crypto';
import type { AuditResult } from './audit-types';

export type AuditStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface AuditRow {
  id: string;
  site_id: string | null;
  site_name: string | null;
  start_url: string;
  status: AuditStatus;
  progress: number;
  message: string;
  max_pages: number;
  health_score: number | null;
  summary: string | null;
  summary_error: string | null;
  summary_model: string | null;
  result: AuditResult | null;
  error: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export class AuditInProgressError extends Error {
  constructor() { super('An audit of this URL is already running.'); }
}

const LIST_COLUMNS = `a.id, a.site_id, s.name AS site_name, a.start_url, a.status, a.progress, a.message, a.max_pages,
  a.health_score, a.summary, a.summary_error, a.summary_model, a.error, u.name AS created_by_name,
  a.created_at, a.updated_at, a.finished_at`;

function asResult(value: unknown): AuditResult | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as AuditResult; } catch { return null; }
  }
  return value as AuditResult;
}

function mapRow(row: Record<string, unknown>, withResult: boolean): AuditRow {
  return {
    id: String(row.id),
    site_id: row.site_id ? String(row.site_id) : null,
    site_name: row.site_name ? String(row.site_name) : null,
    start_url: String(row.start_url),
    status: row.status as AuditStatus,
    progress: Number(row.progress) || 0,
    message: String(row.message || ''),
    max_pages: Number(row.max_pages) || 100,
    health_score: row.health_score === null || row.health_score === undefined ? null : Number(row.health_score),
    summary: row.summary ? String(row.summary) : null,
    summary_error: row.summary_error ? String(row.summary_error) : null,
    summary_model: row.summary_model ? String(row.summary_model) : null,
    result: withResult ? asResult(row.result) : null,
    error: row.error ? String(row.error) : null,
    created_by_name: row.created_by_name ? String(row.created_by_name) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    finished_at: row.finished_at ? String(row.finished_at) : null,
  };
}

export async function expireStaleAudits(): Promise<void> {
  await execute(
    `UPDATE seo_audits SET status = 'failed', error = 'The audit stopped before it finished.', progress = 100,
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('queued', 'running') AND updated_at < CURRENT_TIMESTAMP - INTERVAL '20 minutes'`,
  );
}

export async function createAudit(input: { startUrl: string; siteId: string | null; maxPages: number; userId: string }): Promise<string> {
  await expireStaleAudits();
  const id = randomUUID();
  try {
    await execute(
      `INSERT INTO seo_audits (id, site_id, start_url, status, progress, message, max_pages, created_by)
       VALUES (?, ?, ?, 'queued', 0, 'Queued', ?, ?)`,
      [id, input.siteId, input.startUrl, input.maxPages, input.userId],
    );
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && (error as { code: string }).code === '23505') throw new AuditInProgressError();
    throw error;
  }
  return id;
}

export async function updateAuditProgress(id: string, progress: number, message: string): Promise<void> {
  await execute(
    `UPDATE seo_audits SET status = 'running', progress = ?, message = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('queued', 'running')`,
    [Math.max(0, Math.min(99, progress)), message.slice(0, 240), id],
  );
}

export async function finishAudit(id: string, input: { score: number; summary: string | null; summaryError: string | null; model: string | null; result: AuditResult }): Promise<void> {
  await execute(
    `UPDATE seo_audits SET status = 'succeeded', progress = 100, message = 'Audit complete', health_score = ?,
       summary = ?, summary_error = ?, summary_model = ?, result = ?::jsonb, error = NULL,
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('queued', 'running')`,
    [input.score, input.summary, input.summaryError, input.model, JSON.stringify(input.result), id],
  );
}

export async function failAudit(id: string, error: string): Promise<void> {
  await execute(
    `UPDATE seo_audits SET status = 'failed', progress = 100, message = 'Audit failed', error = ?,
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('queued', 'running')`,
    [error.slice(0, 500), id],
  );
}

export async function listAudits(limit = 20): Promise<AuditRow[]> {
  await expireStaleAudits();
  const rows = await queryAll<Record<string, unknown>>(
    `SELECT ${LIST_COLUMNS} FROM seo_audits a
     LEFT JOIN seo_sites s ON s.id = a.site_id
     LEFT JOIN users u ON u.id = a.created_by
     ORDER BY a.created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(row => mapRow(row, false));
}

export async function getAudit(id: string): Promise<AuditRow | undefined> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${LIST_COLUMNS}, a.result FROM seo_audits a
     LEFT JOIN seo_sites s ON s.id = a.site_id
     LEFT JOIN users u ON u.id = a.created_by
     WHERE a.id = ?`,
    [id],
  );
  return row ? mapRow(row, true) : undefined;
}

export async function pagespeedKeyStatus(): Promise<{ configured: boolean; hint: string | null }> {
  const row = await queryOne<{ pagespeed_key_hint: string | null }>('SELECT pagespeed_key_hint FROM seo_audit_settings WHERE id = ?', ['default']);
  return { configured: Boolean(row?.pagespeed_key_hint), hint: row?.pagespeed_key_hint ?? null };
}

export async function readPagespeedKey(): Promise<string | null> {
  const row = await queryOne<{ pagespeed_key_ciphertext: string | null }>('SELECT pagespeed_key_ciphertext FROM seo_audit_settings WHERE id = ?', ['default']);
  if (!row?.pagespeed_key_ciphertext) return null;
  try { return decryptSecret(row.pagespeed_key_ciphertext); } catch { return null; }
}

export async function savePagespeedKey(secret: string | null): Promise<{ configured: boolean; hint: string | null }> {
  if (!secret) {
    await execute(
      `INSERT INTO seo_audit_settings (id, pagespeed_key_ciphertext, pagespeed_key_hint, updated_at)
       VALUES ('default', NULL, NULL, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET pagespeed_key_ciphertext = NULL, pagespeed_key_hint = NULL, updated_at = CURRENT_TIMESTAMP`,
    );
    return { configured: false, hint: null };
  }
  const hint = maskSecret(secret);
  await execute(
    `INSERT INTO seo_audit_settings (id, pagespeed_key_ciphertext, pagespeed_key_hint, updated_at)
     VALUES ('default', ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET pagespeed_key_ciphertext = EXCLUDED.pagespeed_key_ciphertext,
       pagespeed_key_hint = EXCLUDED.pagespeed_key_hint, updated_at = CURRENT_TIMESTAMP`,
    [encryptSecret(secret), hint],
  );
  return { configured: true, hint };
}
