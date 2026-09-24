import { v4 as uuidv4 } from 'uuid';
import { execute, queryAll, queryOne } from './database';
import { searchWatchTopic } from './ai-research-watch-search';
import {
  AI_RESEARCH_MAX_WATCHES,
  AI_RESEARCH_WATCH_BATCH_LIMIT,
  AI_RESEARCH_WATCH_DUE_HOURS,
  AI_RESEARCH_WATCH_MIN_INTERVAL_MS,
  buildWatchDigest,
  buildWatchQuery,
  normalizeWatchKeywords,
  normalizeWatchStatus,
  normalizeWatchTopic,
  parseWatchKeywords,
  parseWatchSnapshot,
  snapshotFromHits,
  type ResearchWatchSnapshot,
  type ResearchWatchStatus,
} from './ai-research-watches';

type WatchRow = {
  id: string;
  user_id: string;
  topic: string;
  keywords: string;
  status: ResearchWatchStatus;
  last_snapshot: string | null;
  last_digest: string | null;
  last_checked_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type ResearchWatchView = {
  id: string;
  topic: string;
  keywords: string[];
  status: ResearchWatchStatus;
  lastDigest: string;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function asIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function presentResearchWatch(row: WatchRow): ResearchWatchView {
  return {
    id: row.id,
    topic: row.topic,
    keywords: parseWatchKeywords(row.keywords),
    status: row.status,
    lastDigest: row.last_digest || '',
    lastCheckedAt: asIso(row.last_checked_at),
    createdAt: asIso(row.created_at) || new Date(0).toISOString(),
    updatedAt: asIso(row.updated_at) || new Date(0).toISOString(),
  };
}

const WATCH_COLUMNS = `id, user_id, topic, keywords, status, last_snapshot, last_digest, last_checked_at, created_at, updated_at`;

async function watchForUser(userId: string, watchId: string): Promise<WatchRow | undefined> {
  return queryOne<WatchRow>(
    `SELECT ${WATCH_COLUMNS} FROM ai_research_watches WHERE id = ? AND user_id = ?`,
    [watchId, userId],
  );
}

export async function listResearchWatches(userId: string): Promise<ResearchWatchView[]> {
  const rows = await queryAll<WatchRow>(
    `SELECT ${WATCH_COLUMNS} FROM ai_research_watches WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
    [userId, AI_RESEARCH_MAX_WATCHES],
  );
  return rows.map(presentResearchWatch);
}

export async function createResearchWatch(userId: string, body: { topic?: unknown; keywords?: unknown }): Promise<{ status: number; body: Record<string, unknown> }> {
  let topic = '';
  let keywords: string[] = [];
  try {
    topic = normalizeWatchTopic(body.topic);
    keywords = normalizeWatchKeywords(body.keywords, topic);
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : 'Watch is not valid.' } };
  }
  const count = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM ai_research_watches WHERE user_id = ?',
    [userId],
  );
  if (Number(count?.count ?? 0) >= AI_RESEARCH_MAX_WATCHES) {
    return { status: 400, body: { error: `At most ${AI_RESEARCH_MAX_WATCHES} watches per user.` } };
  }
  const duplicate = await queryOne<{ id: string }>(
    'SELECT id FROM ai_research_watches WHERE user_id = ? AND lower(topic) = lower(?)',
    [userId, topic],
  );
  if (duplicate) return { status: 400, body: { error: 'This topic is already being watched.' } };

  const id = uuidv4();
  await execute(
    `INSERT INTO ai_research_watches (id, user_id, topic, keywords, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
    [id, userId, topic, JSON.stringify(keywords)],
  );
  const row = await watchForUser(userId, id);
  return { status: 201, body: { watch: row ? presentResearchWatch(row) : { id, topic, keywords, status: 'active', lastDigest: '', lastCheckedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } };
}

export async function setResearchWatchStatus(userId: string, watchId: string, status: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  let next: ResearchWatchStatus;
  try {
    next = normalizeWatchStatus(status);
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : 'Watch status is not valid.' } };
  }
  const existing = await watchForUser(userId, watchId);
  if (!existing) return { status: 404, body: { error: 'Watch was not found.' } };
  await execute(
    'UPDATE ai_research_watches SET status = ?, updated_at = NOW() WHERE id = ? AND user_id = ?',
    [next, watchId, userId],
  );
  const row = await watchForUser(userId, watchId);
  return { status: 200, body: { watch: row ? presentResearchWatch(row) : presentResearchWatch({ ...existing, status: next }) } };
}

export async function deleteResearchWatch(userId: string, watchId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const removed = await execute('DELETE FROM ai_research_watches WHERE id = ? AND user_id = ?', [watchId, userId]);
  if (!removed) return { status: 404, body: { error: 'Watch was not found.' } };
  return { status: 200, body: { ok: true } };
}

async function writeWatchCheck(row: WatchRow, digest: string, snapshot: ResearchWatchSnapshot | null): Promise<WatchRow | undefined> {
  if (snapshot) {
    await execute(
      `UPDATE ai_research_watches
       SET last_snapshot = ?, last_digest = ?, last_checked_at = NOW(), updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [JSON.stringify(snapshot), digest, row.id, row.user_id],
    );
  } else {
    await execute(
      `UPDATE ai_research_watches
       SET last_digest = ?, last_checked_at = NOW(), updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [digest, row.id, row.user_id],
    );
  }
  return queryOne<WatchRow>(`SELECT ${WATCH_COLUMNS} FROM ai_research_watches WHERE id = ? AND user_id = ?`, [row.id, row.user_id]);
}

export async function checkStoredWatch(
  row: WatchRow,
  options: { minIntervalMs?: number; now?: Date } = {},
): Promise<{ watch: ResearchWatchView; skipped: boolean; message?: string }> {
  const now = options.now || new Date();
  const minIntervalMs = options.minIntervalMs ?? 0;
  const checkedAt = row.last_checked_at ? new Date(row.last_checked_at).getTime() : 0;
  if (minIntervalMs > 0 && checkedAt && now.getTime() - checkedAt < minIntervalMs) {
    return {
      watch: presentResearchWatch(row),
      skipped: true,
      message: 'Checked just now. Try again in a moment.',
    };
  }

  const keywords = parseWatchKeywords(row.keywords);
  const previous = parseWatchSnapshot(row.last_snapshot);
  try {
    const result = await searchWatchTopic(buildWatchQuery(row.topic, keywords), { enrichThinSnippets: true });
    if (!result.ok) {
      const digest = `Check failed for “${row.topic}”: ${result.warning || 'search is unavailable'}. The previous snapshot was not changed.`;
      const saved = await writeWatchCheck(row, digest, null);
      return { watch: presentResearchWatch(saved || { ...row, last_digest: digest, last_checked_at: now }), skipped: false };
    }
    const snapshot = snapshotFromHits(result.hits, result.provider, now);
    const digest = buildWatchDigest({
      topic: row.topic,
      keywords,
      previous,
      next: snapshot,
      checkedAt: now,
      warning: result.warning,
    });
    const saved = await writeWatchCheck(row, digest, snapshot);
    return { watch: presentResearchWatch(saved || { ...row, last_digest: digest, last_snapshot: JSON.stringify(snapshot), last_checked_at: now }), skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'search failed';
    const digest = `Check failed for “${row.topic}”: ${message}. The previous snapshot was not changed.`;
    const saved = await writeWatchCheck(row, digest, null);
    return { watch: presentResearchWatch(saved || { ...row, last_digest: digest, last_checked_at: now }), skipped: false };
  }
}

export async function checkResearchWatch(userId: string, watchId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const row = await watchForUser(userId, watchId);
  if (!row) return { status: 404, body: { error: 'Watch was not found.' } };
  const result = await checkStoredWatch(row, { minIntervalMs: AI_RESEARCH_WATCH_MIN_INTERVAL_MS });
  return { status: 200, body: result };
}

export async function runDueResearchWatches(options: { limit?: number } = {}): Promise<{ checked: number; failed: number; ids: string[] }> {
  const limit = Math.min(Math.max(options.limit ?? AI_RESEARCH_WATCH_BATCH_LIMIT, 1), AI_RESEARCH_WATCH_BATCH_LIMIT);
  const rows = await queryAll<WatchRow>(
    `SELECT ${WATCH_COLUMNS}
     FROM ai_research_watches
     WHERE status = 'active'
       AND (last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '${AI_RESEARCH_WATCH_DUE_HOURS} hours')
     ORDER BY last_checked_at ASC NULLS FIRST
     LIMIT ?`,
    [limit],
  );
  let checked = 0;
  let failed = 0;
  const ids: string[] = [];
  for (const row of rows) {
    const result = await checkStoredWatch(row, { minIntervalMs: 0 });
    ids.push(row.id);
    checked += 1;
    if (/Pemeriksaan gagal/.test(result.watch.lastDigest)) failed += 1;
  }
  return { checked, failed, ids };
}
