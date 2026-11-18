/**
 * Partnership > Media Monitoring (Dataxet/DXT360-style report), pure and browser-safe:
 * types, settings normalization, URL dedupe keys, the ad-value estimate, and the
 * dashboard aggregation shared by the page, the API and the PDF export.
 */

export const MEDIA_BRAND_KEY = 'dupoin';

export const MEDIA_CHANNELS = ['online_media', 'instagram', 'tiktok', 'x', 'threads', 'youtube', 'facebook'] as const;
export type MediaChannel = typeof MEDIA_CHANNELS[number];
export const MEDIA_CHANNEL_LABELS: Record<MediaChannel, string> = {
  online_media: 'Online Media', instagram: 'Instagram', tiktok: 'TikTok', x: 'X (Twitter)', threads: 'Threads', youtube: 'YouTube', facebook: 'Facebook',
};

export const MEDIA_SOURCES = ['google_alerts', 'google_news', 'gdelt', 'youtube_api', 'treg'] as const;
export type MediaSource = typeof MEDIA_SOURCES[number];
export const MEDIA_SOURCE_LABELS: Record<MediaSource, string> = {
  google_alerts: 'Google Alerts', google_news: 'Google News', gdelt: 'GDELT', youtube_api: 'YouTube Data API', treg: 'treg (paid)',
};

export type Sentiment = 'positive' | 'neutral' | 'negative';
export const SENTIMENTS: Sentiment[] = ['positive', 'neutral', 'negative'];

export const HANDLE_PLATFORMS = ['instagram', 'tiktok', 'x', 'threads', 'youtube', 'facebook'] as const;
export type HandlePlatform = typeof HANDLE_PLATFORMS[number];
export type OfficialHandles = Partial<Record<HandlePlatform | 'website', string>>;

export type MediaLanguage = 'id' | 'en' | 'both';

/** Ad value is an ESTIMATE: reach / 1000 x CPM for the channel. Every number is editable in Settings. */
export interface AdValueConfig {
  currency: string;
  /** Cost per 1,000 impressions, per channel, in `currency`. */
  cpm: Record<MediaChannel, number>;
  /** Assumed readers per online article when no traffic figure is known. */
  onlineMediaReach: number;
  /** When a post has no view or follower count: reach = engagement x this multiplier. */
  engagementToReach: number;
}

/** Placeholder assumptions (not agency rates). The UI labels them as estimates; replace with real media-buying rates. */
export const DEFAULT_AD_VALUE: AdValueConfig = {
  currency: 'IDR',
  cpm: { online_media: 50_000, instagram: 30_000, tiktok: 25_000, x: 20_000, threads: 20_000, youtube: 35_000, facebook: 25_000 },
  onlineMediaReach: 5_000,
  engagementToReach: 10,
};

export const AD_VALUE_FORMULA = 'Ad value (estimate) = estimated reach ÷ 1,000 × CPM of the channel. Estimated reach = views, else followers, else (online media) the assumed readers per article, else engagement × the multiplier.';

export interface MediaSettings {
  brandKey: string;
  brandName: string;
  keywords: string[];
  hashtags: string[];
  officialHandles: OfficialHandles;
  alertFeeds: string[];
  language: MediaLanguage;
  adValue: AdValueConfig;
  updatedAt: string | null;
}

const clampList = (value: unknown, max: number, maxLen: number): string[] => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]/) : [];
  const out: string[] = [];
  for (const item of list) {
    const text = String(item ?? '').trim().slice(0, maxLen);
    if (text && !out.some(existing => existing.toLowerCase() === text.toLowerCase())) out.push(text);
    if (out.length >= max) break;
  }
  return out;
};

const num = (value: unknown, fallback: number, max = 1e12) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
};

/** Google Alerts RSS feeds look like https://www.google.com/alerts/feeds/<user>/<alert>. Anything else is refused. */
export function isGoogleAlertsFeedUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && (url.hostname === 'www.google.com' || url.hostname === 'google.com') && /^\/alerts\/feeds\/\d+\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function normalizeHandle(value: unknown): string {
  let text = String(value ?? '').trim();
  if (!text) return '';
  const fromUrl = text.match(/^https?:\/\/(?:www\.|m\.)?(?:instagram\.com|tiktok\.com|x\.com|twitter\.com|threads\.net|threads\.com|youtube\.com|facebook\.com)\/(.+)$/i);
  if (fromUrl) text = fromUrl[1];
  return text.replace(/^@/, '').replace(/[/?#].*$/, '').slice(0, 100);
}

function normalizeWebsite(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
  } catch {
    return '';
  }
}

export interface SettingsValidation { settings: MediaSettings; errors: string[] }

/** Cleans what the UI (or the DB) sends. Invalid feed URLs are reported, never stored. */
export function normalizeMediaSettings(input: Record<string, unknown> | null | undefined, base?: Partial<MediaSettings>): SettingsValidation {
  const raw = input ?? {};
  const errors: string[] = [];
  const brandName = String(raw.brandName ?? base?.brandName ?? 'Dupoin Futures Indonesia').trim().slice(0, 120) || 'Dupoin Futures Indonesia';
  const keywords = clampList(raw.keywords ?? base?.keywords, 20, 80);
  const hashtags = clampList(raw.hashtags ?? base?.hashtags, 20, 60).map(tag => `#${tag.replace(/^#+/, '').replace(/\s+/g, '')}`).filter(tag => tag.length > 1);
  const feedsIn = clampList(raw.alertFeeds ?? base?.alertFeeds, 20, 300);
  const alertFeeds = feedsIn.filter(feed => {
    if (isGoogleAlertsFeedUrl(feed)) return true;
    errors.push(`Not a Google Alerts RSS feed URL: ${feed.slice(0, 120)}`);
    return false;
  });
  const handlesIn = (raw.officialHandles && typeof raw.officialHandles === 'object' ? raw.officialHandles : base?.officialHandles ?? {}) as Record<string, unknown>;
  const officialHandles: OfficialHandles = {};
  for (const platform of HANDLE_PLATFORMS) {
    const handle = normalizeHandle(handlesIn[platform]);
    if (handle) officialHandles[platform] = handle;
  }
  const website = normalizeWebsite(handlesIn.website);
  if (website) officialHandles.website = website;
  const languageIn = String(raw.language ?? base?.language ?? 'id');
  const language: MediaLanguage = languageIn === 'en' || languageIn === 'both' ? languageIn : 'id';
  const adIn = (raw.adValue && typeof raw.adValue === 'object' ? raw.adValue : base?.adValue ?? {}) as Partial<AdValueConfig> & { cpm?: Partial<Record<MediaChannel, unknown>> };
  const adValue: AdValueConfig = {
    currency: String(adIn.currency ?? DEFAULT_AD_VALUE.currency).trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || DEFAULT_AD_VALUE.currency,
    cpm: Object.fromEntries(MEDIA_CHANNELS.map(channel => [channel, num(adIn.cpm?.[channel], DEFAULT_AD_VALUE.cpm[channel])])) as Record<MediaChannel, number>,
    onlineMediaReach: num(adIn.onlineMediaReach, DEFAULT_AD_VALUE.onlineMediaReach),
    engagementToReach: num(adIn.engagementToReach, DEFAULT_AD_VALUE.engagementToReach, 10_000),
  };
  if (!keywords.length && !hashtags.length) errors.push('Add at least one keyword or hashtag.');
  return {
    settings: { brandKey: base?.brandKey ?? MEDIA_BRAND_KEY, brandName, keywords, hashtags, officialHandles, alertFeeds, language, adValue, updatedAt: base?.updatedAt ?? null },
    errors,
  };
}

/* ---------------- mentions ---------------- */

/** One mention as collected, before it is stored. */
export interface RawMention {
  url: string;
  channel: MediaChannel;
  source: MediaSource;
  sourceName: string | null;
  author: string | null;
  title: string;
  snippet: string;
  publishedAt: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  followers: number;
  matchedTerm: string | null;
  /** Google Alerts feed id(s) (partnership_google_alert_feeds) that delivered this item. */
  alertFeedIds?: string[];
}

export interface MediaMention extends RawMention {
  id: string;
  urlKey: string;
  isOfficial: boolean;
  sentiment: Sentiment | null;
  sentimentReason: string | null;
  firstSeenAt: string;
}

export function rawMention(partial: Partial<RawMention> & Pick<RawMention, 'url' | 'channel' | 'source'>): RawMention {
  return {
    sourceName: null, author: null, title: '', snippet: '', publishedAt: null, likes: 0, comments: 0, shares: 0, views: 0, followers: 0, matchedTerm: null,
    ...partial,
  };
}

/** google.com/url?url=… and google.com/url?q=… redirect links (Google Alerts) → the article URL. */
export function unwrapGoogleRedirect(value: string): string {
  try {
    const url = new URL(value);
    if (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname === '/url') {
      const target = url.searchParams.get('url') || url.searchParams.get('q');
      if (target && /^https?:\/\//i.test(target)) return target;
    }
    return value;
  } catch {
    return value;
  }
}

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|igshid|igsh|si|ref_src|ref_url)$/i;

/** Dedupe key: same article/post = same key regardless of www, tracking params, fragment or trailing slash. */
export function mentionUrlKey(value: string): string {
  const unwrapped = unwrapGoogleRedirect(value.trim());
  try {
    const url = new URL(unwrapped);
    url.hash = '';
    const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '').replace(/^twitter\.com$/, 'x.com').replace(/^threads\.com$/, 'threads.net');
    const keep = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM.test(key) || (host === 'youtube.com' && key === 'v'));
    keep.sort(([a], [b]) => a.localeCompare(b));
    const query = keep.length ? `?${keep.map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`).join('&')}` : '';
    const path = url.pathname.replace(/\/+$/, '') || '';
    return `${host}${path}${query}`;
  } catch {
    return unwrapped.toLowerCase();
  }
}

const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);

/** Merges duplicates (same URL key): highest metrics, earliest date, first non-empty text. */
export function dedupeMentions(mentions: RawMention[]): Array<RawMention & { urlKey: string }> {
  const byKey = new Map<string, RawMention & { urlKey: string }>();
  for (const mention of mentions) {
    const url = unwrapGoogleRedirect(mention.url);
    if (!/^https?:\/\//i.test(url)) continue;
    const urlKey = mentionUrlKey(url);
    const existing = byKey.get(urlKey);
    if (!existing) {
      byKey.set(urlKey, { ...mention, url, urlKey, ...(mention.alertFeedIds ? { alertFeedIds: [...mention.alertFeedIds] } : {}) });
      continue;
    }
    if (mention.alertFeedIds?.length) existing.alertFeedIds = [...new Set([...(existing.alertFeedIds ?? []), ...mention.alertFeedIds])];
    existing.title ||= mention.title;
    existing.snippet = existing.snippet.length >= mention.snippet.length ? existing.snippet : mention.snippet;
    existing.sourceName ||= mention.sourceName;
    existing.author ||= mention.author;
    existing.matchedTerm ||= mention.matchedTerm;
    existing.publishedAt = later(existing.publishedAt, mention.publishedAt);
    existing.likes = Math.max(existing.likes, mention.likes);
    existing.comments = Math.max(existing.comments, mention.comments);
    existing.shares = Math.max(existing.shares, mention.shares);
    existing.views = Math.max(existing.views, mention.views);
    existing.followers = Math.max(existing.followers, mention.followers);
    // A social channel beats the generic online-media guess.
    if (existing.channel === 'online_media' && mention.channel !== 'online_media') existing.channel = mention.channel;
  }
  return [...byKey.values()];
}

/** Social channel from the URL host; everything else is online media. */
export function channelFromUrl(value: string): MediaChannel {
  let host = '';
  try { host = new URL(value).hostname.toLowerCase(); } catch { return 'online_media'; }
  const is = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (is('instagram.com')) return 'instagram';
  if (is('tiktok.com')) return 'tiktok';
  if (is('x.com') || is('twitter.com')) return 'x';
  if (is('threads.net') || is('threads.com')) return 'threads';
  if (is('youtube.com') || is('youtu.be')) return 'youtube';
  if (is('facebook.com') || is('fb.watch')) return 'facebook';
  return 'online_media';
}

const HANDLE_URL_PATTERNS: Record<HandlePlatform, (handle: string) => RegExp> = {
  instagram: handle => new RegExp(`instagram\\.com/${handle}(/|$)`, 'i'),
  tiktok: handle => new RegExp(`tiktok\\.com/@${handle}(/|$)`, 'i'),
  x: handle => new RegExp(`(x|twitter)\\.com/${handle}(/|$)`, 'i'),
  threads: handle => new RegExp(`threads\\.(net|com)/@${handle}(/|$)`, 'i'),
  youtube: handle => new RegExp(`youtube\\.com/(@|c/|channel/|user/)?${handle.replace(/^@/, '')}(/|$)`, 'i'),
  facebook: handle => new RegExp(`facebook\\.com/${handle}(/|$)`, 'i'),
};

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Owned (official) vs earned: posted by one of the brand's own accounts or on its own website. */
export function isOfficialMention(mention: Pick<RawMention, 'url' | 'channel' | 'author'>, handles: OfficialHandles): boolean {
  const author = (mention.author || '').trim().replace(/^@/, '').toLowerCase();
  for (const platform of HANDLE_PLATFORMS) {
    const handle = handles[platform]?.trim();
    if (!handle) continue;
    if (mention.channel === platform && author && author === handle.replace(/^@/, '').toLowerCase()) return true;
    if (HANDLE_URL_PATTERNS[platform](escapeRe(handle.replace(/^@/, ''))).test(mention.url)) return true;
  }
  if (handles.website) {
    try {
      const own = new URL(handles.website).hostname.replace(/^www\./, '').toLowerCase();
      const host = new URL(mention.url).hostname.replace(/^www\./, '').toLowerCase();
      if (host === own || host.endsWith(`.${own}`)) return true;
    } catch { /* not a URL */ }
  }
  return false;
}

/* ---------------- reach, engagement, ad value (estimates) ---------------- */

export const engagementOf = (mention: Pick<RawMention, 'likes' | 'comments' | 'shares'>) => mention.likes + mention.comments + mention.shares;

export function estimatedReach(mention: Pick<RawMention, 'channel' | 'views' | 'followers' | 'likes' | 'comments' | 'shares'>, config: AdValueConfig): number {
  if (mention.views > 0) return mention.views;
  if (mention.followers > 0) return mention.followers;
  if (mention.channel === 'online_media') return config.onlineMediaReach;
  return engagementOf(mention) * config.engagementToReach;
}

export function estimatedAdValue(mention: Pick<RawMention, 'channel' | 'views' | 'followers' | 'likes' | 'comments' | 'shares'>, config: AdValueConfig): number {
  return (estimatedReach(mention, config) / 1000) * (config.cpm[mention.channel] ?? 0);
}

/* ---------------- date range ---------------- */

export interface DateRange { from: string; to: string }
const DAY_MS = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Default: the last 30 days (Asia/Jakarta calendar days, approximated in UTC+7). */
export function parseDateRange(from: unknown, to: unknown, now = new Date()): DateRange {
  const today = isoDay(new Date(now.getTime() + 7 * 3_600_000));
  const valid = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  let end = valid(to) ? String(to) : today;
  let start = valid(from) ? String(from) : isoDay(new Date(Date.parse(end) - 29 * DAY_MS));
  if (start > end) [start, end] = [end, start];
  if (Date.parse(end) - Date.parse(start) > 366 * DAY_MS) start = isoDay(new Date(Date.parse(end) - 366 * DAY_MS));
  return { from: start, to: end };
}

export function daysInRange(range: DateRange): string[] {
  const out: string[] = [];
  for (let t = Date.parse(range.from); t <= Date.parse(range.to); t += DAY_MS) out.push(isoDay(new Date(t)));
  return out;
}

/** Calendar day of a timestamp in Asia/Jakarta. */
export const jakartaDay = (value: string | null): string | null => (value ? isoDay(new Date(Date.parse(value) + 7 * 3_600_000)) : null);

/* ---------------- dashboard ---------------- */

export interface ChannelSentimentRow { channel: MediaChannel; positive: number; neutral: number; negative: number; unscored: number; total: number }
export interface TopPost { id: string; url: string; channel: MediaChannel; author: string; title: string; publishedAt: string | null; engagement: number; reach: number; adValue: number; sentiment: Sentiment | null; isOfficial: boolean }
export interface TopSource { name: string; channel: MediaChannel; mentions: number; engagement: number }

export interface MediaDashboard {
  range: DateRange;
  totals: { mentions: number; engagement: number; reach: number; adValue: number; official: number; earned: number };
  currency: string;
  timeline: Array<{ date: string; mentions: number; engagement: number }>;
  peaks: { mentionsDay: string | null; engagementDay: string | null };
  sentiment: Record<Sentiment | 'unscored', number>;
  byChannel: ChannelSentimentRow[];
  bySource: Array<{ source: MediaSource; mentions: number }>;
  topPosts: TopPost[];
  topSources: TopSource[];
}

export function sourceNameOf(mention: Pick<RawMention, 'sourceName' | 'author' | 'url'>): string {
  if (mention.author && mention.author.trim()) return mention.author.trim();
  if (mention.sourceName && mention.sourceName.trim()) return mention.sourceName.trim();
  try { return new URL(mention.url).hostname.replace(/^www\./, ''); } catch { return 'Unknown'; }
}

export function buildMediaDashboard(mentions: MediaMention[], range: DateRange, config: AdValueConfig): MediaDashboard {
  const days = daysInRange(range);
  const timeline = new Map(days.map(day => [day, { date: day, mentions: 0, engagement: 0 }]));
  const sentiment: MediaDashboard['sentiment'] = { positive: 0, neutral: 0, negative: 0, unscored: 0 };
  const channels = new Map<MediaChannel, ChannelSentimentRow>();
  const sources = new Map<MediaSource, number>();
  const sourceNames = new Map<string, TopSource>();
  const totals = { mentions: 0, engagement: 0, reach: 0, adValue: 0, official: 0, earned: 0 };
  const posts: TopPost[] = [];
  for (const mention of mentions) {
    const day = jakartaDay(mention.publishedAt) ?? jakartaDay(mention.firstSeenAt);
    if (!day || day < range.from || day > range.to) continue;
    const engagement = engagementOf(mention);
    const reach = estimatedReach(mention, config);
    const adValue = estimatedAdValue(mention, config);
    totals.mentions += 1;
    totals.engagement += engagement;
    totals.reach += reach;
    totals.adValue += adValue;
    if (mention.isOfficial) totals.official += 1; else totals.earned += 1;
    const point = timeline.get(day);
    if (point) { point.mentions += 1; point.engagement += engagement; }
    sentiment[mention.sentiment ?? 'unscored'] += 1;
    const row = channels.get(mention.channel) ?? { channel: mention.channel, positive: 0, neutral: 0, negative: 0, unscored: 0, total: 0 };
    row[mention.sentiment ?? 'unscored'] += 1;
    row.total += 1;
    channels.set(mention.channel, row);
    sources.set(mention.source, (sources.get(mention.source) ?? 0) + 1);
    const name = sourceNameOf(mention);
    const sourceKey = `${mention.channel}|${name.toLowerCase()}`;
    const top = sourceNames.get(sourceKey) ?? { name, channel: mention.channel, mentions: 0, engagement: 0 };
    top.mentions += 1;
    top.engagement += engagement;
    sourceNames.set(sourceKey, top);
    posts.push({ id: mention.id, url: mention.url, channel: mention.channel, author: name, title: mention.title || mention.snippet.slice(0, 140), publishedAt: mention.publishedAt, engagement, reach, adValue, sentiment: mention.sentiment, isOfficial: mention.isOfficial });
  }
  const series = [...timeline.values()];
  const peak = (key: 'mentions' | 'engagement') => series.reduce<{ date: string | null; value: number }>((best, point) => (point[key] > best.value ? { date: point.date, value: point[key] } : best), { date: null, value: 0 }).date;
  return {
    range,
    totals,
    currency: config.currency,
    timeline: series,
    peaks: { mentionsDay: peak('mentions'), engagementDay: peak('engagement') },
    sentiment,
    byChannel: MEDIA_CHANNELS.map(channel => channels.get(channel)).filter((row): row is ChannelSentimentRow => Boolean(row)),
    bySource: MEDIA_SOURCES.map(source => ({ source, mentions: sources.get(source) ?? 0 })).filter(row => row.mentions > 0),
    topPosts: posts.sort((a, b) => b.engagement - a.engagement || b.reach - a.reach || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 5),
    topSources: [...sourceNames.values()].sort((a, b) => b.mentions - a.mentions || b.engagement - a.engagement).slice(0, 10),
  };
}

/** 2.9K, 673.94M style, like the Dataxet report. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const fmt = (n: number, suffix: string) => `${Number(n.toFixed(2)).toLocaleString('en-US')}${suffix}`;
  if (abs >= 1e12) return fmt(value / 1e12, 'T');
  if (abs >= 1e9) return fmt(value / 1e9, 'B');
  if (abs >= 1e6) return fmt(value / 1e6, 'M');
  if (abs >= 1e4) return fmt(value / 1e3, 'K');
  return Math.round(value).toLocaleString('en-US');
}

export const percent = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%');

/* ---------------- insights (LLM) ---------------- */

export interface MediaInsights {
  executiveSummary: string;
  campaignOverview: string[];
  trendNote: string;
  topPostsNote: string;
  sentimentNote: string;
  sentimentDrivers: Record<Sentiment, string>;
  channelObservations: string[];
  perception: { summary: string; awareness: string; interpretation: string; nicheDiscussion: string; overallTone: string };
  keyInsights: string[];
  recommendations: { strengths: string[]; fixes: string[]; additional: string[] };
}

export function emptyInsights(): MediaInsights {
  return {
    executiveSummary: '', campaignOverview: [], trendNote: '', topPostsNote: '', sentimentNote: '',
    sentimentDrivers: { positive: '', neutral: '', negative: '' }, channelObservations: [],
    perception: { summary: '', awareness: '', interpretation: '', nicheDiscussion: '', overallTone: '' },
    keyInsights: [], recommendations: { strengths: [], fixes: [], additional: [] },
  };
}

const text = (value: unknown, max = 900) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const texts = (value: unknown, maxItems = 6, max = 400) => (Array.isArray(value) ? value.map(item => text(item, max)).filter(Boolean).slice(0, maxItems) : []);

export function buildInsightsPrompt(brandName: string, dashboard: MediaDashboard, mentions: MediaMention[]): { system: string; user: string } {
  const system = [
    `You are a media-monitoring analyst writing a monthly report for ${brandName}, a regulated futures broker in Indonesia.`,
    'Write in English. Use ONLY the numbers and mentions provided. Do not invent events, partners, awards, URLs, or figures.',
    'If the data is thin, say so plainly. Reach and ad value are estimates; call them estimates.',
    'Reply with one JSON object with exactly these keys:',
    '{"executiveSummary": string (3-5 sentences), "campaignOverview": string[3], "trendNote": string, "topPostsNote": string, "sentimentNote": string,',
    '"sentimentDrivers": {"positive": string, "neutral": string, "negative": string}, "channelObservations": string[2-3],',
    '"perception": {"summary": string, "awareness": string, "interpretation": string, "nicheDiscussion": string, "overallTone": string},',
    '"keyInsights": string[3], "recommendations": {"strengths": string[2], "fixes": string[2], "additional": string[2]}}',
  ].join('\n');
  const sample = mentions
    .slice()
    .sort((a, b) => engagementOf(b) - engagementOf(a))
    .slice(0, 60)
    .map(mention => `- [${MEDIA_CHANNEL_LABELS[mention.channel]}] ${jakartaDay(mention.publishedAt) ?? 'undated'} | ${sourceNameOf(mention)} | sentiment=${mention.sentiment ?? 'unscored'} | engagement=${engagementOf(mention)} | ${(mention.title || mention.snippet).slice(0, 200)}`)
    .join('\n');
  const user = [
    `Period: ${dashboard.range.from} to ${dashboard.range.to}`,
    `Totals: ${dashboard.totals.mentions} mentions, ${dashboard.totals.engagement} engagement, estimated reach ${Math.round(dashboard.totals.reach)}, estimated ad value ${dashboard.currency} ${Math.round(dashboard.totals.adValue)}; official ${dashboard.totals.official}, earned ${dashboard.totals.earned}.`,
    `Peaks: most mentions on ${dashboard.peaks.mentionsDay ?? 'n/a'}, most engagement on ${dashboard.peaks.engagementDay ?? 'n/a'}.`,
    `Sentiment: ${JSON.stringify(dashboard.sentiment)}`,
    `By channel: ${JSON.stringify(dashboard.byChannel)}`,
    `Top sources: ${JSON.stringify(dashboard.topSources.slice(0, 8))}`,
    'Mentions (highest engagement first):',
    sample || '(none)',
  ].join('\n');
  return { system, user };
}

export function parseInsightsResponse(content: string): MediaInsights {
  let body: Record<string, unknown> | null = null;
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try { body = JSON.parse(match[0]) as Record<string, unknown>; } catch { body = null; }
  }
  const out = emptyInsights();
  if (!body) return out;
  const drivers = (body.sentimentDrivers ?? {}) as Record<string, unknown>;
  const perception = (body.perception ?? {}) as Record<string, unknown>;
  const recs = (body.recommendations ?? {}) as Record<string, unknown>;
  return {
    executiveSummary: text(body.executiveSummary, 1500),
    campaignOverview: texts(body.campaignOverview),
    trendNote: text(body.trendNote),
    topPostsNote: text(body.topPostsNote),
    sentimentNote: text(body.sentimentNote),
    sentimentDrivers: { positive: text(drivers.positive), neutral: text(drivers.neutral), negative: text(drivers.negative) },
    channelObservations: texts(body.channelObservations),
    perception: { summary: text(perception.summary), awareness: text(perception.awareness), interpretation: text(perception.interpretation), nicheDiscussion: text(perception.nicheDiscussion), overallTone: text(perception.overallTone) },
    keyInsights: texts(body.keyInsights, 5),
    recommendations: { strengths: texts(recs.strengths), fixes: texts(recs.fixes), additional: texts(recs.additional) },
  };
}

/* ---------------- sentiment (LLM) ---------------- */

export const SENTIMENT_BATCH = 40;

export function buildSentimentPrompt(brandName: string, mentions: Array<Pick<MediaMention, 'id' | 'channel' | 'title' | 'snippet'>>): { system: string; user: string } {
  return {
    system: [
      `Classify the sentiment of each mention toward ${brandName} (a futures broker in Indonesia) or toward the topic as it reflects on the brand.`,
      'positive = favourable, praise, education, promotion received well; negative = complaints, fraud/scam claims, losses blamed on the brand, regulatory trouble; neutral = factual, market news, announcements.',
      'Reply with JSON: {"items": [{"id": string, "sentiment": "positive"|"neutral"|"negative", "reason": string (max 15 words)}]}. Include every id exactly once.',
    ].join('\n'),
    user: mentions.map(mention => `${mention.id} | ${MEDIA_CHANNEL_LABELS[mention.channel]} | ${(mention.title || '').slice(0, 200)} | ${(mention.snippet || '').slice(0, 300)}`).join('\n'),
  };
}

export function parseSentimentResponse(content: string, ids: string[]): Array<{ id: string; sentiment: Sentiment; reason: string }> {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let body: unknown;
  try { body = JSON.parse(match[0]); } catch { return []; }
  const items = body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items) ? (body as { items: unknown[] }).items : [];
  const allowed = new Set(ids);
  const seen = new Set<string>();
  const out: Array<{ id: string; sentiment: Sentiment; reason: string }> = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = String(record.id ?? '');
    const sentiment = String(record.sentiment ?? '').toLowerCase();
    if (!allowed.has(id) || seen.has(id) || !SENTIMENTS.includes(sentiment as Sentiment)) continue;
    seen.add(id);
    out.push({ id, sentiment: sentiment as Sentiment, reason: text(record.reason, 160) });
  }
  return out;
}
