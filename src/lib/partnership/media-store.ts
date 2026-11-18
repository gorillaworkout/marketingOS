import { randomUUID } from 'node:crypto';
import { execute, queryAll, queryOne } from '@/lib/database';
import {
  DEFAULT_AD_VALUE, MEDIA_BRAND_KEY, isOfficialMention, normalizeMediaSettings,
  type DateRange, type MediaInsights, type MediaMention, type MediaSettings, type RawMention, type Sentiment,
} from './media';
import { linkMentionToFeeds } from './google-alerts-store';

/** Media Monitoring storage (migration 063). */

export type MediaRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface MediaRunRow {
  id: string;
  trigger: 'manual' | 'scheduled';
  mode: 'free' | 'treg';
  status: MediaRunStatus;
  progress: number;
  message: string;
  platforms: string[];
  stats: Record<string, unknown> | null;
  cost: Record<string, unknown> | null;
  notes: string[];
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export class MediaRunInProgressError extends Error {
  constructor() { super('A Media Monitoring refresh is already running.'); }
}

const isUniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505';
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null);

function asJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.startsWith('{')) return value.slice(1, -1).split(',').map(item => item.replace(/^"|"$/g, '')).filter(Boolean);
  return [];
}

/** Scheduled runs have no signed-in user; token usage is logged to the first admin (same rule as partnership/run.ts). */
export async function mediaSystemUserId(): Promise<string | null> {
  const row = await queryOne<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, username LIMIT 1`);
  return row?.id ?? null;
}

/* ---------------- settings ---------------- */

export async function getMediaSettings(brandKey = MEDIA_BRAND_KEY): Promise<MediaSettings> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM partnership_media_settings WHERE brand_key = ?', [brandKey]);
  if (!row) return normalizeMediaSettings({ keywords: [] }, { brandKey }).settings;
  return normalizeMediaSettings({
    brandName: row.brand_name, keywords: list(row.keywords), hashtags: list(row.hashtags), officialHandles: asJson(row.official_handles) ?? {},
    alertFeeds: list(row.alert_feeds), language: row.language, adValue: asJson(row.ad_value) ?? DEFAULT_AD_VALUE,
  }, { brandKey, updatedAt: iso(row.updated_at) }).settings;
}

export async function saveMediaSettings(settings: MediaSettings, userId: string | null): Promise<void> {
  await execute(
    `INSERT INTO partnership_media_settings (brand_key, brand_name, keywords, hashtags, official_handles, alert_feeds, language, ad_value, updated_by, updated_at)
     VALUES (?, ?, ?::text[], ?::text[], ?::jsonb, ?::text[], ?, ?::jsonb, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (brand_key) DO UPDATE SET brand_name = EXCLUDED.brand_name, keywords = EXCLUDED.keywords, hashtags = EXCLUDED.hashtags,
       official_handles = EXCLUDED.official_handles, alert_feeds = EXCLUDED.alert_feeds, language = EXCLUDED.language, ad_value = EXCLUDED.ad_value,
       updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [settings.brandKey, settings.brandName, settings.keywords, settings.hashtags, JSON.stringify(settings.officialHandles), settings.alertFeeds, settings.language, JSON.stringify(settings.adValue), userId],
  );
}

/* ---------------- runs ---------------- */

function mapRun(row: Record<string, unknown>): MediaRunRow {
  return {
    id: String(row.id),
    trigger: row.trigger === 'scheduled' ? 'scheduled' : 'manual',
    mode: row.mode === 'treg' ? 'treg' : 'free',
    status: row.status as MediaRunStatus,
    progress: Number(row.progress) || 0,
    message: String(row.message ?? ''),
    platforms: list(row.platforms),
    stats: asJson(row.stats),
    cost: asJson(row.cost),
    notes: asJson<string[]>(row.notes) ?? [],
    error: str(row.error),
    createdBy: str(row.created_by),
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    finishedAt: iso(row.finished_at),
  };
}

export async function expireStaleMediaRuns(): Promise<void> {
  await execute(
    `UPDATE partnership_media_runs SET status = 'failed', error = 'The refresh timed out: no progress for 15 minutes (the server may have restarted). Refresh again.',
       progress = 100, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE status IN ('queued', 'running') AND updated_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'`,
  );
}

export async function createMediaRun(input: { trigger: 'manual' | 'scheduled'; mode: 'free' | 'treg'; platforms: string[]; userId: string | null; brandKey?: string }): Promise<string> {
  await expireStaleMediaRuns();
  const id = randomUUID();
  try {
    await execute(
      `INSERT INTO partnership_media_runs (id, brand_key, trigger, mode, status, progress, message, platforms, created_by) VALUES (?, ?, ?, ?, 'queued', 0, 'Queued.', ?::text[], ?)`,
      [id, input.brandKey ?? MEDIA_BRAND_KEY, input.trigger, input.mode, input.platforms, input.userId],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new MediaRunInProgressError();
    throw error;
  }
  return id;
}

export async function updateMediaRunProgress(id: string, progress: number, message: string): Promise<void> {
  await execute(`UPDATE partnership_media_runs SET status = 'running', progress = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'running')`, [Math.max(0, Math.min(99, Math.round(progress))), message.slice(0, 300), id]);
}

export async function finishMediaRun(id: string, input: { stats: Record<string, unknown>; notes: string[]; cost?: Record<string, unknown> | null }): Promise<void> {
  await execute(
    `UPDATE partnership_media_runs SET status = 'succeeded', progress = 100, message = 'Done.', stats = ?::jsonb, notes = ?::jsonb, cost = COALESCE(?::jsonb, cost),
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify(input.stats), JSON.stringify(input.notes.slice(0, 80)), input.cost ? JSON.stringify(input.cost) : null, id],
  );
}

export async function failMediaRun(id: string, error: string, notes: string[] = []): Promise<void> {
  await execute(
    `UPDATE partnership_media_runs SET status = 'failed', progress = 100, error = ?, notes = ?::jsonb, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [error.slice(0, 500), JSON.stringify(notes.slice(0, 80)), id],
  );
}

export async function setMediaRunCost(id: string, cost: Record<string, unknown>): Promise<void> {
  await execute('UPDATE partnership_media_runs SET cost = ?::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(cost), id]);
}

export async function getMediaRun(id: string): Promise<MediaRunRow | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM partnership_media_runs WHERE id = ?', [id]);
  return row ? mapRun(row) : null;
}

export async function listMediaRuns(limit = 20, brandKey = MEDIA_BRAND_KEY): Promise<MediaRunRow[]> {
  const rows = await queryAll<Record<string, unknown>>('SELECT * FROM partnership_media_runs WHERE brand_key = ? ORDER BY created_at DESC LIMIT ?', [brandKey, limit]);
  return rows.map(mapRun);
}

export async function latestSucceededMediaRun(brandKey = MEDIA_BRAND_KEY): Promise<MediaRunRow | null> {
  const row = await queryOne<Record<string, unknown>>(`SELECT * FROM partnership_media_runs WHERE brand_key = ? AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1`, [brandKey]);
  return row ? mapRun(row) : null;
}

/* ---------------- mentions ---------------- */

function mapMention(row: Record<string, unknown>): MediaMention {
  return {
    id: String(row.id), urlKey: String(row.url_key), url: String(row.url), channel: row.channel as MediaMention['channel'], source: row.source as MediaMention['source'],
    sourceName: str(row.source_name), author: str(row.author), title: String(row.title ?? ''), snippet: String(row.snippet ?? ''), publishedAt: iso(row.published_at),
    likes: Number(row.likes) || 0, comments: Number(row.comments) || 0, shares: Number(row.shares) || 0, views: Number(row.views) || 0, followers: Number(row.followers) || 0,
    isOfficial: row.is_official === true, matchedTerm: str(row.matched_term), sentiment: (row.sentiment as Sentiment | null) ?? null, sentimentReason: str(row.sentiment_reason),
    firstSeenAt: iso(row.first_seen_at) ?? new Date(0).toISOString(),
  };
}

/** Insert new mentions; refresh metrics on ones already stored (dedupe by normalized URL). */
export async function upsertMentions(mentions: Array<RawMention & { urlKey: string }>, settings: MediaSettings, runId: string | null): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const mention of mentions) {
    const official = isOfficialMention(mention, settings.officialHandles);
    const row = await queryOne<{ id: string; inserted: boolean }>(
      `INSERT INTO partnership_media_mentions (id, brand_key, url_key, url, channel, source, source_name, author, title, snippet, published_at,
         likes, comments, shares, views, followers, is_official, matched_term, first_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (brand_key, url_key) DO UPDATE SET
         likes = GREATEST(partnership_media_mentions.likes, EXCLUDED.likes),
         comments = GREATEST(partnership_media_mentions.comments, EXCLUDED.comments),
         shares = GREATEST(partnership_media_mentions.shares, EXCLUDED.shares),
         views = GREATEST(partnership_media_mentions.views, EXCLUDED.views),
         followers = GREATEST(partnership_media_mentions.followers, EXCLUDED.followers),
         published_at = COALESCE(partnership_media_mentions.published_at, EXCLUDED.published_at),
         snippet = CASE WHEN length(EXCLUDED.snippet) > length(partnership_media_mentions.snippet) THEN EXCLUDED.snippet ELSE partnership_media_mentions.snippet END,
         is_official = partnership_media_mentions.is_official OR EXCLUDED.is_official,
         last_seen_at = CURRENT_TIMESTAMP
       RETURNING id, (xmax = 0) AS inserted`,
      [randomUUID(), settings.brandKey, mention.urlKey, mention.url.slice(0, 2000), mention.channel, mention.source, mention.sourceName?.slice(0, 200) ?? null, mention.author?.slice(0, 200) ?? null,
        mention.title.slice(0, 300), mention.snippet.slice(0, 1000), mention.publishedAt, mention.likes, mention.comments, mention.shares, mention.views, mention.followers, official,
        mention.matchedTerm?.slice(0, 120) ?? null, runId],
    );
    if (row?.inserted) inserted += 1; else updated += 1;
    // Google Alerts page: remember which feed(s) delivered it (same row, deduped by URL).
    if (row?.id && mention.alertFeedIds?.length) await linkMentionToFeeds(String(row.id), mention.alertFeedIds);
  }
  return { inserted, updated };
}

/** Mentions whose publish day (or first-seen day when undated) falls in the range, Asia/Jakarta days. */
export async function listMentionsInRange(range: DateRange, brandKey = MEDIA_BRAND_KEY, limit = 5_000): Promise<MediaMention[]> {
  const rows = await queryAll<Record<string, unknown>>(
    `SELECT * FROM partnership_media_mentions
      WHERE brand_key = ?
        AND (COALESCE(published_at, first_seen_at) AT TIME ZONE 'Asia/Jakarta')::date BETWEEN ?::date AND ?::date
      ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`,
    [brandKey, range.from, range.to, limit],
  );
  return rows.map(mapMention);
}

export async function unscoredMentions(limit: number, brandKey = MEDIA_BRAND_KEY): Promise<MediaMention[]> {
  const rows = await queryAll<Record<string, unknown>>(
    'SELECT * FROM partnership_media_mentions WHERE brand_key = ? AND sentiment IS NULL ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?',
    [brandKey, limit],
  );
  return rows.map(mapMention);
}

export async function saveSentiments(items: Array<{ id: string; sentiment: Sentiment; reason: string }>): Promise<void> {
  for (const item of items) {
    await execute('UPDATE partnership_media_mentions SET sentiment = ?, sentiment_reason = ? WHERE id = ?', [item.sentiment, item.reason || null, item.id]);
  }
}

export async function setMentionSentiment(id: string, sentiment: Sentiment): Promise<boolean> {
  return (await execute(`UPDATE partnership_media_mentions SET sentiment = ?, sentiment_reason = 'Set by a team member.' WHERE id = ?`, [sentiment, id])) > 0;
}

/* ---------------- insights ---------------- */

export interface MediaInsightsRow { id: string; range: DateRange; result: MediaInsights; model: string | null; createdAt: string }

export async function saveMediaInsights(range: DateRange, result: MediaInsights, model: string | null, userId: string | null, brandKey = MEDIA_BRAND_KEY): Promise<string> {
  const id = randomUUID();
  await execute(
    'INSERT INTO partnership_media_insights (id, brand_key, range_start, range_end, result, model, created_by) VALUES (?, ?, ?::date, ?::date, ?::jsonb, ?, ?)',
    [id, brandKey, range.from, range.to, JSON.stringify(result), model, userId],
  );
  return id;
}

export async function latestMediaInsights(range: DateRange, brandKey = MEDIA_BRAND_KEY): Promise<MediaInsightsRow | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT id, to_char(range_start, 'YYYY-MM-DD') AS range_start, to_char(range_end, 'YYYY-MM-DD') AS range_end, result, model, created_at
       FROM partnership_media_insights WHERE brand_key = ? AND range_start = ?::date AND range_end = ?::date ORDER BY created_at DESC LIMIT 1`,
    [brandKey, range.from, range.to],
  );
  if (!row) return null;
  return { id: String(row.id), range: { from: String(row.range_start), to: String(row.range_end) }, result: asJson<MediaInsights>(row.result)!, model: str(row.model), createdAt: iso(row.created_at)! };
}
