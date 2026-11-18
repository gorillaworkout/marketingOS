import { createHash } from 'node:crypto';
import { execute, queryAll } from '@/lib/database';
import { MEDIA_BRAND_KEY, isGoogleAlertsFeedUrl, type Sentiment } from './media';
import type { AlertFeedRef, AlertFeedResult } from './media-sources';

/**
 * Partnership > Google Alerts storage (migration 064). Feeds live in
 * partnership_google_alert_feeds; articles stay in partnership_media_mentions (the
 * Media Monitoring table, deduplicated by URL) and are linked to the feed that
 * delivered them. partnership_media_settings.alert_feeds mirrors the feed URLs.
 */

export const MAX_ALERT_FEEDS = 20;
export const MAX_ALERT_LABEL = 80;

export interface AlertFeedRow {
  id: string;
  url: string;
  label: string;
  feedTitle: string | null;
  lastFetchedAt: string | null;
  lastItemCount: number | null;
  lastError: string | null;
  articleCount: number;
  createdAt: string;
}

export interface AlertArticle {
  id: string;
  url: string;
  title: string;
  snippet: string;
  sourceName: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  sentiment: Sentiment | null;
  feedIds: string[];
}

export class AlertFeedError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null);
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.startsWith('{')) return value.slice(1, -1).split(',').map(item => item.replace(/^"|"$/g, '')).filter(Boolean);
  return [];
}

/** Same id the migration uses when it carries feeds over: md5(brand|url). */
export const alertFeedId = (url: string, brandKey = MEDIA_BRAND_KEY) => createHash('md5').update(`${brandKey}|${url}`).digest('hex');

export function cleanAlertLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ALERT_LABEL);
}

export function cleanAlertFeedUrl(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!isGoogleAlertsFeedUrl(text)) throw new AlertFeedError('That is not a Google Alerts RSS link. It should look like https://www.google.com/alerts/feeds/123…/456….');
  const url = new URL(text);
  return `https://www.google.com${url.pathname.replace(/\/+$/, '')}`;
}

function mapFeed(row: Record<string, unknown>): AlertFeedRow {
  return {
    id: String(row.id), url: String(row.url), label: String(row.label ?? ''), feedTitle: str(row.feed_title),
    lastFetchedAt: iso(row.last_fetched_at), lastItemCount: row.last_item_count === null || row.last_item_count === undefined ? null : Number(row.last_item_count),
    lastError: str(row.last_error), articleCount: Number(row.article_count ?? 0) || 0, createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
  };
}

export async function listAlertFeeds(brandKey = MEDIA_BRAND_KEY): Promise<AlertFeedRow[]> {
  const rows = await queryAll<Record<string, unknown>>(
    `SELECT f.*, (SELECT COUNT(*) FROM partnership_media_mention_alerts l WHERE l.feed_id = f.id)::int AS article_count
       FROM partnership_google_alert_feeds f WHERE f.brand_key = ? ORDER BY f.created_at, f.url`,
    [brandKey],
  );
  return rows.map(mapFeed);
}

export async function getAlertFeed(id: string, brandKey = MEDIA_BRAND_KEY): Promise<AlertFeedRow | null> {
  return (await listAlertFeeds(brandKey)).find(feed => feed.id === id) ?? null;
}

/** Feeds as the collector wants them. */
export async function alertFeedRefs(brandKey = MEDIA_BRAND_KEY): Promise<AlertFeedRef[]> {
  return (await listAlertFeeds(brandKey)).map(feed => ({ id: feed.id, url: feed.url, label: feed.label || feed.feedTitle || '' }));
}

/** Keeps partnership_media_settings.alert_feeds equal to the feed URLs (so a rollback keeps them). */
async function syncSettingsFeeds(brandKey: string): Promise<void> {
  await execute(
    `UPDATE partnership_media_settings SET alert_feeds = COALESCE((SELECT array_agg(url ORDER BY created_at, url) FROM partnership_google_alert_feeds WHERE brand_key = ?), ARRAY[]::TEXT[]),
       updated_at = CURRENT_TIMESTAMP WHERE brand_key = ?`,
    [brandKey, brandKey],
  );
}

export async function addAlertFeed(input: { url: unknown; label?: unknown; userId: string | null; brandKey?: string }): Promise<AlertFeedRow> {
  const brandKey = input.brandKey ?? MEDIA_BRAND_KEY;
  const url = cleanAlertFeedUrl(input.url);
  const existing = await listAlertFeeds(brandKey);
  if (existing.some(feed => feed.url === url)) throw new AlertFeedError('This Google Alerts feed is already added.', 409);
  if (existing.length >= MAX_ALERT_FEEDS) throw new AlertFeedError(`You can add up to ${MAX_ALERT_FEEDS} feeds. Remove one first.`);
  const id = alertFeedId(url, brandKey);
  await execute(
    `INSERT INTO partnership_google_alert_feeds (id, brand_key, url, label, created_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (brand_key, url) DO NOTHING`,
    [id, brandKey, url, cleanAlertLabel(input.label), input.userId],
  );
  await syncSettingsFeeds(brandKey);
  return (await getAlertFeed(id, brandKey))!;
}

export async function updateAlertFeedLabel(id: string, label: unknown, brandKey = MEDIA_BRAND_KEY): Promise<AlertFeedRow | null> {
  const changed = await execute('UPDATE partnership_google_alert_feeds SET label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND brand_key = ?', [cleanAlertLabel(label), id, brandKey]);
  return changed ? getAlertFeed(id, brandKey) : null;
}

/** Removes the feed and its links. Its articles stay in Media Monitoring (they are still mentions). */
export async function deleteAlertFeed(id: string, brandKey = MEDIA_BRAND_KEY): Promise<boolean> {
  const changed = await execute('DELETE FROM partnership_google_alert_feeds WHERE id = ? AND brand_key = ?', [id, brandKey]);
  if (changed) await syncSettingsFeeds(brandKey);
  return changed > 0;
}

/** Saves when each feed was read, how many items it had, and any error. */
export async function recordAlertFeedResults(results: AlertFeedResult[], brandKey = MEDIA_BRAND_KEY): Promise<void> {
  for (const result of results) {
    if (!result.feed.id) continue;
    await execute(
      `UPDATE partnership_google_alert_feeds SET last_fetched_at = CURRENT_TIMESTAMP, last_item_count = ?, last_error = ?,
         feed_title = COALESCE(NULLIF(?, ''), feed_title), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND brand_key = ?`,
      [result.ok ? result.items.length : null, result.ok ? null : (result.error || 'Could not read the feed.').slice(0, 300), result.feedTitle.slice(0, 200), result.feed.id, brandKey],
    );
  }
}

/** Links stored mentions to the feed(s) that delivered them. Unknown feed ids are skipped. */
export async function linkMentionToFeeds(mentionId: string, feedIds: string[]): Promise<void> {
  for (const feedId of new Set(feedIds)) {
    await execute(
      `INSERT INTO partnership_media_mention_alerts (mention_id, feed_id)
       SELECT ?, id FROM partnership_google_alert_feeds WHERE id = ? ON CONFLICT DO NOTHING`,
      [mentionId, feedId],
    );
  }
}

/**
 * Latest Google Alerts articles, newest first. With a feed id: only that feed.
 * Without: every linked article plus older Google Alerts mentions saved before feeds had ids.
 */
export async function listAlertArticles(input: { feedId?: string | null; limit?: number; brandKey?: string } = {}): Promise<AlertArticle[]> {
  const brandKey = input.brandKey ?? MEDIA_BRAND_KEY;
  const limit = Math.max(1, Math.min(500, input.limit ?? 200));
  const filter = input.feedId
    ? 'EXISTS (SELECT 1 FROM partnership_media_mention_alerts l WHERE l.mention_id = m.id AND l.feed_id = ?)'
    : `(m.source = 'google_alerts' OR EXISTS (SELECT 1 FROM partnership_media_mention_alerts l WHERE l.mention_id = m.id))`;
  const rows = await queryAll<Record<string, unknown>>(
    `SELECT m.id, m.url, m.title, m.snippet, m.source_name, m.published_at, m.first_seen_at, m.sentiment,
            ARRAY(SELECT l.feed_id FROM partnership_media_mention_alerts l WHERE l.mention_id = m.id ORDER BY l.feed_id) AS feed_ids
       FROM partnership_media_mentions m
      WHERE m.brand_key = ? AND ${filter}
      ORDER BY COALESCE(m.published_at, m.first_seen_at) DESC LIMIT ?`,
    input.feedId ? [brandKey, input.feedId, limit] : [brandKey, limit],
  );
  return rows.map(row => ({
    id: String(row.id), url: String(row.url), title: String(row.title ?? ''), snippet: String(row.snippet ?? ''), sourceName: str(row.source_name),
    publishedAt: iso(row.published_at), firstSeenAt: iso(row.first_seen_at) ?? new Date(0).toISOString(),
    sentiment: (row.sentiment as Sentiment | null) ?? null, feedIds: list(row.feed_ids),
  }));
}

/** Latest fetch time across feeds and the item count of that pass (for the Media Monitoring sources strip). */
export function alertFeedsSummary(feeds: AlertFeedRow[]): { count: number; lastFetchedAt: string | null; lastItems: number; failing: number } {
  const lastFetchedAt = feeds.reduce<string | null>((latest, feed) => (feed.lastFetchedAt && (!latest || feed.lastFetchedAt > latest) ? feed.lastFetchedAt : latest), null);
  return {
    count: feeds.length,
    lastFetchedAt,
    lastItems: feeds.reduce((sum, feed) => sum + (feed.lastItemCount ?? 0), 0),
    failing: feeds.filter(feed => feed.lastError).length,
  };
}
