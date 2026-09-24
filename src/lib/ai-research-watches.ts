import { timingSafeEqual } from 'node:crypto';

export const AI_RESEARCH_MAX_WATCHES = 20;
export const AI_RESEARCH_WATCH_TOPIC_MAX = 120;
export const AI_RESEARCH_WATCH_KEYWORD_MAX = 40;
export const AI_RESEARCH_WATCH_KEYWORDS_MAX = 8;
export const AI_RESEARCH_WATCH_SNAPSHOT_LIMIT = 8;
export const AI_RESEARCH_WATCH_BATCH_LIMIT = 25;
export const AI_RESEARCH_WATCH_MIN_INTERVAL_MS = 45_000;
export const AI_RESEARCH_WATCH_DUE_HOURS = 20;
export const AI_RESEARCH_WATCH_DIGEST_MAX = 1_800;

export type ResearchWatchStatus = 'active' | 'paused';

export type ResearchWatchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type ResearchWatchProvider = 'serper' | 'news-rss' | 'none';

export type ResearchWatchSnapshot = {
  checkedAt: string;
  provider: ResearchWatchProvider;
  hits: ResearchWatchHit[];
};

export type ResearchWatchDiff = {
  firstCheck: boolean;
  added: ResearchWatchHit[];
  removed: ResearchWatchHit[];
  updated: Array<{ previous: ResearchWatchHit; next: ResearchWatchHit }>;
  unchanged: number;
};

export function suggestWatchTopic(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.slice(0, AI_RESEARCH_WATCH_TOPIC_MAX);
}

export function normalizeWatchTopic(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Topic is required.');
  const topic = value.replace(/\s+/g, ' ').trim();
  if (topic.length < 2) throw new Error('Topic is required.');
  if (topic.length > AI_RESEARCH_WATCH_TOPIC_MAX) throw new Error('Topic is too long.');
  return topic;
}

export function normalizeWatchKeywords(value: unknown, topic = ''): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : value == null || value === ''
        ? []
        : null;
  if (!raw) throw new Error('Keywords are not valid.');
  const topicKey = topic.replace(/\s+/g, ' ').trim().toLowerCase();
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') throw new Error('Keywords are not valid.');
    const keyword = item.replace(/\s+/g, ' ').trim();
    if (!keyword) continue;
    if (keyword.length > AI_RESEARCH_WATCH_KEYWORD_MAX) throw new Error('A keyword is too long.');
    const key = keyword.toLowerCase();
    if (key === topicKey || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length > AI_RESEARCH_WATCH_KEYWORDS_MAX) throw new Error('Too many keywords.');
  }
  return keywords;
}

export function normalizeWatchStatus(value: unknown): ResearchWatchStatus {
  if (value === 'active' || value === 'paused') return value;
  throw new Error('Watch status is not valid.');
}

export function buildWatchQuery(topic: string, keywords: string[]): string {
  return [topic, ...keywords].join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function watchUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/$/, '') || '/';
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function snapshotFromHits(
  hits: ResearchWatchHit[],
  provider: ResearchWatchProvider,
  checkedAt: Date,
): ResearchWatchSnapshot {
  const seen = new Set<string>();
  const unique: ResearchWatchHit[] = [];
  for (const hit of hits) {
    const key = watchUrlKey(hit.url);
    if (!hit.title.trim() || !hit.url.trim() || seen.has(key)) continue;
    seen.add(key);
    unique.push({
      title: hit.title.replace(/\s+/g, ' ').trim().slice(0, 180),
      url: hit.url.trim(),
      snippet: hit.snippet.replace(/\s+/g, ' ').trim().slice(0, 280),
    });
    if (unique.length >= AI_RESEARCH_WATCH_SNAPSHOT_LIMIT) break;
  }
  return { checkedAt: checkedAt.toISOString(), provider, hits: unique };
}

export function parseWatchSnapshot(value: unknown): ResearchWatchSnapshot | null {
  let raw = value;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { checkedAt?: unknown; provider?: unknown; hits?: unknown };
  if (!Array.isArray(row.hits)) return null;
  const provider: ResearchWatchProvider = row.provider === 'serper' || row.provider === 'news-rss' || row.provider === 'none'
    ? row.provider
    : 'none';
  const checkedAt = typeof row.checkedAt === 'string' ? row.checkedAt : new Date(0).toISOString();
  return snapshotFromHits(
    row.hits.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const hit = item as { title?: unknown; url?: unknown; snippet?: unknown };
      if (typeof hit.title !== 'string' || typeof hit.url !== 'string') return [];
      return [{ title: hit.title, url: hit.url, snippet: typeof hit.snippet === 'string' ? hit.snippet : '' }];
    }),
    provider,
    new Date(checkedAt),
  );
}

export function diffWatchSnapshots(
  previous: ResearchWatchSnapshot | null,
  next: ResearchWatchSnapshot,
): ResearchWatchDiff {
  if (!previous) {
    return { firstCheck: true, added: next.hits, removed: [], updated: [], unchanged: 0 };
  }
  const previousByUrl = new Map(previous.hits.map(hit => [watchUrlKey(hit.url), hit]));
  const nextByUrl = new Map(next.hits.map(hit => [watchUrlKey(hit.url), hit]));
  const added = next.hits.filter(hit => !previousByUrl.has(watchUrlKey(hit.url)));
  const removed = previous.hits.filter(hit => !nextByUrl.has(watchUrlKey(hit.url)));
  const updated: ResearchWatchDiff['updated'] = [];
  let unchanged = 0;
  for (const hit of next.hits) {
    const prior = previousByUrl.get(watchUrlKey(hit.url));
    if (!prior) continue;
    if (prior.title.trim() !== hit.title.trim()) updated.push({ previous: prior, next: hit });
    else unchanged += 1;
  }
  return { firstCheck: false, added, removed, updated, unchanged };
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function formatWatchCheckedAt(date: Date): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${formatted} WIB`;
}

function bullet(hit: ResearchWatchHit): string {
  return `• ${hit.title} (${hostLabel(hit.url)})\n  ${hit.url}`;
}

export function buildWatchDigest(input: {
  topic: string;
  keywords: string[];
  previous: ResearchWatchSnapshot | null;
  next: ResearchWatchSnapshot;
  checkedAt: Date;
  warning?: string;
}): string {
  const diff = diffWatchSnapshots(input.previous, input.next);
  const lines = [
    `Watch “${input.topic}” · ${formatWatchCheckedAt(input.checkedAt)}`,
  ];
  if (input.keywords.length) lines.push(`Keywords: ${input.keywords.join(', ')}`);
  lines.push('');
  if (input.warning) lines.push(`Note: ${input.warning}`, '');

  if (!input.next.hits.length) {
    lines.push(`No search results for “${input.topic}” on this check.`);
  } else if (diff.firstCheck) {
    lines.push(`First check for “${input.topic}”. ${input.next.hits.length} findings were saved as the baseline.`);
    lines.push('');
    for (const hit of input.next.hits.slice(0, 5)) lines.push(bullet(hit));
  } else if (!diff.added.length && !diff.removed.length && !diff.updated.length) {
    lines.push(`No title or link changes since the last check (${diff.unchanged} findings unchanged).`);
  } else {
    const parts = [
      diff.added.length ? `${diff.added.length} new findings` : '',
      diff.removed.length ? `${diff.removed.length} no longer listed` : '',
      diff.updated.length ? `${diff.updated.length} titles updated` : '',
    ].filter(Boolean);
    lines.push(`${parts.join(', ')}.`);
    if (diff.added.length) {
      lines.push('', 'New:');
      for (const hit of diff.added.slice(0, 5)) lines.push(bullet(hit));
    }
    if (diff.removed.length) {
      lines.push('', 'No longer listed:');
      for (const hit of diff.removed.slice(0, 3)) lines.push(`• ${hit.title} (${hostLabel(hit.url)})`);
    }
    if (diff.updated.length) {
      lines.push('', 'Titles updated:');
      for (const item of diff.updated.slice(0, 3)) lines.push(`• ${item.previous.title} → ${item.next.title}`);
    }
  }

  const digest = lines.join('\n').trim();
  if (digest.length <= AI_RESEARCH_WATCH_DIGEST_MAX) return digest;
  return `${digest.slice(0, AI_RESEARCH_WATCH_DIGEST_MAX - 1).trimEnd()}…`;
}

export function watchCronAuthorization(
  provided: string | null | undefined,
  expected = process.env.AI_RESEARCH_WATCH_CRON_SECRET || '',
): 'ok' | 'missing' | 'rejected' {
  const secret = expected.trim();
  if (!secret) return 'missing';
  const header = (provided || '').trim();
  const left = Buffer.from(header);
  const right = Buffer.from(secret);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return 'rejected';
  return 'ok';
}

export function parseWatchKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
