/**
 * Free Media Monitoring sources (allowed in cron): Google Alerts RSS, Google News RSS,
 * the GDELT DOC API, and the YouTube Data API when YOUTUBE_API_KEY is set.
 * Parsers are pure; collectFreeMentions takes injected fetchers so tests run offline.
 *
 * THIS MODULE MUST NEVER IMPORT OR CALL treg. Scheduled refreshes only use it.
 * (tests/partnership-media-no-treg-cron.test.ts enforces this.)
 */
import { parseNewsRssWithDates } from './intel';
import { channelFromUrl, rawMention, unwrapGoogleRedirect, type MediaLanguage, type MediaSettings, type RawMention } from './media';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z#0-9]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

/** Entity-decode, then drop tags (Google Alerts wraps the keyword in <b>…</b>), then entity-decode again. */
export function plainText(value: string): string {
  return decodeEntities(decodeEntities(value).replace(/<\/?(b|i|em|strong|span)\b[^>]*>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value.trim());
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export interface AlertsFeed { feedTitle: string; items: RawMention[] }

/**
 * Google Alerts "Deliver to: RSS feed" is an Atom feed. Each <entry> has an HTML
 * <title>, a <link href="https://www.google.com/url?rct=j&sa=t&url=<article>&…">,
 * <published>/<updated>, and an HTML <content> snippet.
 */
export function parseGoogleAlertsAtom(xml: string): AlertsFeed {
  const head = xml.split(/<entry\b/)[0] ?? '';
  const feedTitle = plainText(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/^Google Alert\s*-\s*/i, '');
  const items: RawMention[] = [];
  for (const entry of xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []) {
    const href = decodeEntities(entry.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? '');
    const url = unwrapGoogleRedirect(href);
    if (!/^https?:\/\//i.test(url)) continue;
    const title = plainText(entry.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const snippet = plainText(entry.match(/<content\b[^>]*>([\s\S]*?)<\/content>/i)?.[1] ?? '');
    const publishedAt = isoOrNull(entry.match(/<published>([^<]+)<\/published>/i)?.[1] ?? entry.match(/<updated>([^<]+)<\/updated>/i)?.[1]);
    let sourceName: string | null = null;
    try { sourceName = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    items.push(rawMention({ url, channel: channelFromUrl(url), source: 'google_alerts', sourceName, title: title.slice(0, 300), snippet: snippet.slice(0, 1000), publishedAt, matchedTerm: feedTitle || null }));
  }
  return { feedTitle, items };
}

/** Google News RSS for a keyword, in the configured language(s). */
export function googleNewsRssUrls(query: string, language: MediaLanguage, days = 30): string[] {
  const q = encodeURIComponent(`"${query}" when:${days}d`);
  const id = `https://news.google.com/rss/search?q=${q}&hl=id&gl=ID&ceid=ID:id`;
  const en = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  return language === 'both' ? [id, en] : language === 'en' ? [en] : [id];
}

export function parseGoogleNewsMentions(xml: string, term: string): RawMention[] {
  return parseNewsRssWithDates(xml, 100).map(hit => {
    const suffix = hit.publisher ? ` - ${hit.publisher}` : '';
    const title = suffix && hit.title.endsWith(suffix) ? hit.title.slice(0, -suffix.length) : hit.title;
    return rawMention({ url: hit.url, channel: 'online_media', source: 'google_news', sourceName: hit.publisher || null, title, publishedAt: isoOrNull(hit.publishedAt), matchedTerm: term });
  });
}

/** GDELT DOC 2.0 article list (free, no key). */
export function gdeltUrl(query: string, days = 30, max = 75): string {
  const q = encodeURIComponent(query.includes(' ') ? `"${query}"` : query);
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&maxrecords=${max}&timespan=${days}d&sort=datedesc`;
}

/** seendate is "20261117T103000Z". */
export function gdeltDate(value: unknown): string | null {
  const match = typeof value === 'string' ? value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z` : null;
}

export function parseGdelt(body: unknown, term: string): RawMention[] {
  const articles = body && typeof body === 'object' && Array.isArray((body as { articles?: unknown }).articles) ? (body as { articles: unknown[] }).articles : [];
  const out: RawMention[] = [];
  for (const article of articles) {
    if (!article || typeof article !== 'object') continue;
    const record = article as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url : '';
    if (!/^https?:\/\//i.test(url)) continue;
    out.push(rawMention({ url, channel: channelFromUrl(url), source: 'gdelt', sourceName: typeof record.domain === 'string' ? record.domain : null, title: plainText(String(record.title ?? '')).slice(0, 300), publishedAt: gdeltDate(record.seendate), matchedTerm: term }));
  }
  return out;
}

export function youtubeSearchUrl(query: string, key: string, publishedAfter: string): string {
  const params = new URLSearchParams({ part: 'snippet', q: query, type: 'video', order: 'date', maxResults: '25', publishedAfter, key });
  return `https://www.googleapis.com/youtube/v3/search?${params}`;
}

export function youtubeStatsUrl(ids: string[], key: string): string {
  return `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'statistics', id: ids.join(','), key })}`;
}

export function parseYoutubeSearch(body: unknown, term: string): RawMention[] {
  const items = body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items) ? (body as { items: unknown[] }).items : [];
  const out: RawMention[] = [];
  for (const item of items) {
    const record = (item ?? {}) as { id?: { videoId?: string }; snippet?: Record<string, unknown> };
    const id = record.id?.videoId;
    if (!id || !/^[\w-]{6,20}$/.test(id)) continue;
    const snippet = record.snippet ?? {};
    out.push(rawMention({
      url: `https://www.youtube.com/watch?v=${id}`, channel: 'youtube', source: 'youtube_api',
      author: typeof snippet.channelTitle === 'string' ? snippet.channelTitle : null, sourceName: 'YouTube',
      title: plainText(String(snippet.title ?? '')).slice(0, 300), snippet: plainText(String(snippet.description ?? '')).slice(0, 1000),
      publishedAt: isoOrNull(typeof snippet.publishedAt === 'string' ? snippet.publishedAt : null), matchedTerm: term,
    }));
  }
  return out;
}

export function applyYoutubeStats(mentions: RawMention[], body: unknown): void {
  const items = body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items) ? (body as { items: unknown[] }).items : [];
  const stats = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const record = (item ?? {}) as { id?: string; statistics?: Record<string, unknown> };
    if (record.id && record.statistics) stats.set(record.id, record.statistics);
  }
  for (const mention of mentions) {
    const id = new URL(mention.url).searchParams.get('v') ?? '';
    const stat = stats.get(id);
    if (!stat) continue;
    mention.views = Number(stat.viewCount) || 0;
    mention.likes = Number(stat.likeCount) || 0;
    mention.comments = Number(stat.commentCount) || 0;
  }
}

/* ---------------- collector ---------------- */

export interface FreeSourceDeps {
  now(): Date;
  fetchText(url: string): Promise<string>;
  fetchJson(url: string): Promise<unknown>;
  /** YOUTUBE_API_KEY, or null to skip YouTube. */
  youtubeKey: string | null;
  /** GDELT asks for one request every 5 seconds. */
  sleep(ms: number): Promise<void>;
  onProgress?(progress: number, message: string): Promise<void> | void;
}

export interface FreeCollectResult {
  mentions: RawMention[];
  notes: string[];
  counts: Record<'google_alerts' | 'google_news' | 'gdelt' | 'youtube_api', number>;
}

export const GDELT_DELAY_MS = 5_500;
export const MAX_FREE_TERMS = 6;

/** Search terms for news/GDELT/YouTube: keywords first, then hashtags as words. */
export function searchTerms(settings: Pick<MediaSettings, 'keywords' | 'hashtags'>, max = MAX_FREE_TERMS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of [...settings.keywords, ...settings.hashtags.map(tag => tag.replace(/^#/, ''))]) {
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

export async function collectFreeMentions(settings: MediaSettings, deps: FreeSourceDeps, days = 30): Promise<FreeCollectResult> {
  const notes: string[] = [];
  const mentions: RawMention[] = [];
  const counts = { google_alerts: 0, google_news: 0, gdelt: 0, youtube_api: 0 };
  const terms = searchTerms(settings);

  if (!settings.alertFeeds.length) notes.push('Google Alerts: no RSS feed in Settings yet. Create an alert at google.com/alerts with "Deliver to: RSS feed" and paste the feed URL.');
  for (const [index, feed] of settings.alertFeeds.entries()) {
    try {
      const parsed = parseGoogleAlertsAtom(await deps.fetchText(feed));
      mentions.push(...parsed.items);
      counts.google_alerts += parsed.items.length;
      notes.push(`Google Alerts "${parsed.feedTitle || `feed ${index + 1}`}": ${parsed.items.length} item(s).`);
    } catch (error) {
      notes.push(`Google Alerts feed ${index + 1} could not be read (${error instanceof Error ? error.message : 'error'}).`);
    }
  }
  await deps.onProgress?.(15, 'Google Alerts read.');

  for (const term of terms) {
    for (const url of googleNewsRssUrls(term, settings.language, days)) {
      try {
        const found = parseGoogleNewsMentions(await deps.fetchText(url), term);
        mentions.push(...found);
        counts.google_news += found.length;
      } catch {
        notes.push(`Google News search failed for "${term}".`);
      }
    }
  }
  await deps.onProgress?.(30, 'Google News read.');

  for (const [index, term] of terms.entries()) {
    if (index > 0) await deps.sleep(GDELT_DELAY_MS);
    try {
      // GDELT answers 429 when called more than once every 5 seconds: wait and retry once.
      const body = await deps.fetchJson(gdeltUrl(term, days)).catch(async () => { await deps.sleep(GDELT_DELAY_MS); return deps.fetchJson(gdeltUrl(term, days)); });
      const found = parseGdelt(body, term);
      mentions.push(...found);
      counts.gdelt += found.length;
    } catch {
      notes.push(`GDELT search failed for "${term}" (GDELT rate-limits; it is retried on the next refresh).`);
    }
  }
  await deps.onProgress?.(45, 'GDELT read.');

  if (!deps.youtubeKey) {
    notes.push('YouTube skipped: YOUTUBE_API_KEY is not set on the server.');
  } else {
    const after = new Date(deps.now().getTime() - days * 86_400_000).toISOString();
    for (const term of terms.slice(0, 3)) {
      try {
        const found = parseYoutubeSearch(await deps.fetchJson(youtubeSearchUrl(term, deps.youtubeKey, after)), term);
        if (found.length) {
          const ids = found.map(item => new URL(item.url).searchParams.get('v')!).slice(0, 50);
          try { applyYoutubeStats(found, await deps.fetchJson(youtubeStatsUrl(ids, deps.youtubeKey))); } catch { notes.push('YouTube statistics could not be read; views are 0.'); }
        }
        mentions.push(...found);
        counts.youtube_api += found.length;
      } catch {
        notes.push(`YouTube search failed for "${term}".`);
      }
    }
  }
  await deps.onProgress?.(55, 'Free sources read.');
  return { mentions, notes, counts };
}
