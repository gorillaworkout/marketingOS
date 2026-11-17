import { TregError, tregCall, tregFallbackNotice, type FetchLike, type TregConfig } from '@/lib/seo/treg-client';
import { extractHashtags, parseTregInstagramPosts, type InstagramFeedPost } from './campaigns';
import { extractJson, mentionsCompetitor } from './intel';
import type { SocialHandles } from './social';
import { TREG_IG_POSTS_ENDPOINT, TREG_IG_POSTS_PRICE_MICRO } from './treg-instagram';
import { TREG_CALL_MAX_USD, TREG_PLATFORM_SPECS, applicablePlatforms, type TregPlatform } from './treg-platforms';

export * from './treg-platforms';

/**
 * Optional paid social feeds for Competitor Intelligence through treg.to (manual,
 * confirmed runs only; scheduled refreshes never call treg).
 *
 * Endpoints and per-success prices from https://treg.to/catalog (17 Nov 2026), the
 * cheapest routed provider. Every call carries a $0.005 ceiling
 * (X-Treg-Route-Max-Cost), so the dearest providers ($0.011-$0.0295) are refused, free.
 * Verified with one real call each (17 Nov 2026):
 *   treg.tiktok.user.profile  @mifx.indonesia -> sec_uid           640 micro (crawl4ai)
 *   treg.tiktok.user.videos   by sec_uid -> 20 videos               500 micro (crawl4ai)
 *   treg.meta-ads.library.advertiser company "MIFX" -> 30 ads       1100 micro (anyapi; catalog 1200)
 *   treg.facebook.user.posts  facebook.com/finexbroker -> posts     1350 micro (crawl4ai)
 *   treg.x.user.posts         @xtb_id -> 20 posts                   450 micro (anyapi; catalog 500)
 * YouTube is read for free from the channel's public RSS feed, so it is not a treg platform.
 */
export const TREG_ENDPOINTS = {
  tiktokProfile: 'treg.tiktok.user.profile',
  tiktokVideos: 'treg.tiktok.user.videos',
  facebookPosts: 'treg.facebook.user.posts',
  metaAds: 'treg.meta-ads.library.advertiser',
  xPosts: 'treg.x.user.posts',
} as const;

/* ---------------- parsers (provider-native shapes, read defensively) ---------------- */

export type SocialFeedPlatform = 'tiktok' | 'facebook' | 'x' | 'youtube' | 'meta_ads';
export interface SocialFeedPost {
  platform: SocialFeedPlatform;
  url: string;
  account: string | null;
  date: string | null;
  text: string;
  hashtags: string[];
  /** video, post, ad format (VIDEO, IMAGE, CAROUSEL) ... */
  kind: string | null;
  /** Meta ads: running period and where they run. */
  period?: string | null;
  placements?: string[];
  landingUrl?: string | null;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
function isoDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value > 1e12 ? value : value * 1000).toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{9,13}$/.test(value)) return isoDate(Number(value));
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}
function listOf(raw: unknown, key: string): Record<string, unknown>[] {
  const body = extractJson(raw);
  const output = body?.output && typeof body.output === 'object' ? body.output as Record<string, unknown> : body;
  const list = output?.[key];
  return Array.isArray(list) ? list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}
const httpsUrl = (value: unknown): string | null => {
  const text = str(value);
  try { const url = new URL(text); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null; } catch { return null; }
};
const tags = (text: string, extra: unknown): string[] => {
  const fromList = Array.isArray(extra) ? extra.map(item => `#${str(item).replace(/^#/, '')}`).filter(tag => tag.length > 1) : [];
  return [...new Set([...extractHashtags(text), ...fromList])].slice(0, 15);
};

/** sec_uid from treg.tiktok.user.profile. */
export function parseTregTiktokProfile(raw: unknown): string | null {
  const body = extractJson(raw);
  const output = body?.output && typeof body.output === 'object' ? body.output as Record<string, unknown> : body;
  const secUid = str(output?.sec_uid ?? output?.secUid);
  return secUid || null;
}

export function parseTregTiktokVideos(raw: unknown, handle: string, max = 12): SocialFeedPost[] {
  return listOf(raw, 'videos').map((video): SocialFeedPost | null => {
    const text = str(video.description ?? video.desc ?? video.title).trim();
    const id = str(video.post_id ?? video.aweme_id ?? video.id);
    const url = httpsUrl(video.url ?? video.share_url) || (id ? `https://www.tiktok.com/@${handle}/video/${id}` : null);
    const author = video.author && typeof video.author === 'object' ? str((video.author as Record<string, unknown>).username ?? (video.author as Record<string, unknown>).unique_id) : '';
    return url && text ? { platform: 'tiktok', url, account: author || handle, date: isoDate(video.created_at ?? video.create_time), text: text.slice(0, 2_200), hashtags: tags(text, video.hashtags), kind: 'video' } : null;
  }).filter((post): post is SocialFeedPost => post !== null).slice(0, max);
}

export function parseTregFacebookPosts(raw: unknown, max = 12): SocialFeedPost[] {
  return listOf(raw, 'posts').map((post): SocialFeedPost | null => {
    const text = str(post.text ?? post.message ?? post.content).trim();
    const url = httpsUrl(post.url ?? post.permalink ?? post.post_url);
    return url && text ? { platform: 'facebook', url, account: str(post.page_name ?? post.author) || null, date: isoDate(post.posted ?? post.created_time ?? post.time ?? post.timestamp), text: text.slice(0, 2_200), hashtags: tags(text, null), kind: 'post' } : null;
  }).filter((post): post is SocialFeedPost => post !== null).slice(0, max);
}

export function parseTregXPosts(raw: unknown, handle: string, max = 12): SocialFeedPost[] {
  return listOf(raw, 'posts').filter(post => post.isReply !== true).map((post): SocialFeedPost | null => {
    const text = str(post.text ?? post.full_text).trim();
    const id = str(post.id ?? post.rest_id);
    const account = str(post.authorHandle ?? post.screen_name) || handle;
    const url = httpsUrl(post.url) || (id ? `https://x.com/${account}/status/${id}` : null);
    return url && text ? { platform: 'x', url, account, date: isoDate(post.createdUtc ?? post.created_at), text: text.slice(0, 1_200), hashtags: tags(text, null), kind: 'post' } : null;
  }).filter((post): post is SocialFeedPost => post !== null).slice(0, max);
}

function hostMatches(value: unknown, domain: string | null): boolean {
  if (!domain) return false;
  try { const host = new URL(str(value)).hostname.toLowerCase(); return host === domain || host.endsWith(`.${domain}`); } catch { return false; }
}

/** Registrable-ish domain of the competitor website: www.mifx.com -> mifx.com. */
export function siteDomain(website: string | null): string | null {
  if (!website) return null;
  try { return new URL(website).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/**
 * Ads from treg.meta-ads.library.advertiser. A name search can return other
 * advertisers, so a Page counts only when one of its ads names the competitor,
 * links to the competitor's website, or links to one of its social handles.
 * Identical creatives are merged.
 */
export function parseTregMetaAds(raw: unknown, competitor: { name: string; website: string | null; handles: SocialHandles }, max = 8): SocialFeedPost[] {
  const ads = listOf(raw, 'ads');
  const domain = siteDomain(competitor.website);
  const handleNeedles = Object.values(competitor.handles).filter(Boolean).map(handle => String(handle).toLowerCase());
  const belongs = (ad: Record<string, unknown>) => {
    const links = [ad.linkUrl, ad.pageUrl, ad.caption, ad.link_url].map(str);
    return mentionsCompetitor(`${str(ad.pageName ?? ad.page_name)} ${str(ad.text ?? ad.body)} ${str(ad.title)}`, competitor.name)
      || links.some(link => hostMatches(link, domain) || handleNeedles.some(needle => needle.length > 2 && link.toLowerCase().includes(needle)));
  };
  const pages = new Set(ads.filter(belongs).map(ad => str(ad.pageId ?? ad.page_id)).filter(Boolean));
  const seen = new Set<string>();
  const out: SocialFeedPost[] = [];
  for (const ad of ads) {
    const pageId = str(ad.pageId ?? ad.page_id);
    if (!(pages.has(pageId) || (!pageId && belongs(ad)))) continue;
    const text = [str(ad.title), str(ad.text ?? ad.body), str(ad.linkDescription)].filter(Boolean).join('\n').trim();
    const id = str(ad.id ?? ad.adArchiveID ?? ad.ad_archive_id);
    const landing = httpsUrl(ad.linkUrl ?? ad.link_url);
    const key = `${text.slice(0, 160)}|${landing || ''}`;
    if (!id || !text || seen.has(key)) continue;
    seen.add(key);
    const start = isoDate(ad.startDate ?? ad.start_date);
    const end = isoDate(ad.endDate ?? ad.end_date);
    const placements = Array.isArray(ad.platforms) ? ad.platforms.map(str).filter(Boolean) : [];
    out.push({
      platform: 'meta_ads', url: `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`, account: str(ad.pageName ?? ad.page_name) || null,
      date: start, text: text.slice(0, 1_500), hashtags: tags(text, null), kind: str(ad.displayFormat ?? ad.display_format) || 'ad',
      period: start ? `${start} to ${ad.active === true ? 'now (active)' : end || '?'}` : null, placements, landingUrl: landing,
    });
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------- the paid run for one competitor ---------------- */

export interface SocialFeedOutcome {
  instagram: InstagramFeedPost[];
  posts: SocialFeedPost[];
  notes: string[];
  costMicro: number;
  costSource: 'reported' | 'estimate';
  calls: number;
  callIds: string[];
  /** At least one call returned data. */
  ok: boolean;
  /** balance_micro from a refusal, if any. */
  refusalBalanceMicro: number | null;
  /** Spend per platform, micro-USD (for the report). */
  perPlatform: Partial<Record<TregPlatform, number>>;
}

const PRICES: Record<string, number> = {
  [TREG_IG_POSTS_ENDPOINT]: TREG_IG_POSTS_PRICE_MICRO, [TREG_ENDPOINTS.tiktokProfile]: 640, [TREG_ENDPOINTS.tiktokVideos]: 500,
  [TREG_ENDPOINTS.facebookPosts]: 1350, [TREG_ENDPOINTS.metaAds]: 1200, [TREG_ENDPOINTS.xPosts]: 500,
};

/**
 * Calls treg for each platform, one call at a time. Never throws: a refused or failed
 * platform adds a note and the run continues on free sources. A refusal for balance
 * stops the remaining platforms (they would be refused too).
 */
export async function fetchTregSocialFeeds(
  config: TregConfig,
  input: { reportId: string; name: string; website: string | null; handles: SocialHandles; platforms: TregPlatform[] },
  fetchImpl: FetchLike = fetch,
): Promise<SocialFeedOutcome> {
  const outcome: SocialFeedOutcome = { instagram: [], posts: [], notes: [], costMicro: 0, costSource: 'reported', calls: 0, callIds: [], ok: false, refusalBalanceMicro: null, perPlatform: {} };
  let stop = false;
  const call = async (platform: TregPlatform, endpointId: string, body: Record<string, unknown>): Promise<unknown | null> => {
    if (stop) return null;
    outcome.calls += 1;
    try {
      const result = await tregCall(config, {
        endpointId, body, meta: { feature: 'partnership-competitor-intel', run: input.reportId, platform },
        idempotencyKey: `${input.reportId}:${endpointId}`, maxCostUsd: TREG_CALL_MAX_USD, timeoutMs: 60_000,
      }, fetchImpl);
      const cost = result.costMicro ?? 0;
      outcome.costMicro += cost;
      outcome.perPlatform[platform] = (outcome.perPlatform[platform] ?? 0) + cost;
      if (result.callId) outcome.callIds.push(result.callId);
      return result.body;
    } catch (error) {
      const tregError = error instanceof TregError ? error : new TregError('provider-error');
      // A timeout may still have been charged: count the catalog price and mark it as an estimate.
      const cost = tregError.kind === 'timeout' || tregError.kind === 'network' ? PRICES[endpointId] ?? 0 : tregError.costMicro;
      if (tregError.kind === 'timeout' || tregError.kind === 'network') outcome.costSource = 'estimate';
      outcome.costMicro += cost;
      outcome.perPlatform[platform] = (outcome.perPlatform[platform] ?? 0) + cost;
      if (tregError.balanceMicro !== null && tregError.balanceMicro !== undefined) outcome.refusalBalanceMicro = tregError.balanceMicro;
      if (['insufficient-balance', 'spend-cap', 'unauthorized'].includes(tregError.kind)) stop = true;
      outcome.notes.push(`${tregFallbackNotice(tregError)} (${TREG_PLATFORM_SPECS[platform].label}); free sources used.`);
      return null;
    }
  };
  const usd = (micro: number | undefined) => `$${((micro ?? 0) / 1_000_000).toFixed(4)}`;
  for (const platform of applicablePlatforms(input.handles, input.platforms)) {
    if (stop) { outcome.notes.push(`treg ${TREG_PLATFORM_SPECS[platform].label} skipped: treg stopped earlier in this run.`); continue; }
    if (platform === 'instagram') {
      const body = await call(platform, TREG_IG_POSTS_ENDPOINT, { username: input.handles.instagram });
      if (body === null) continue;
      const posts = parseTregInstagramPosts(body);
      outcome.instagram.push(...posts);
      outcome.ok = true;
      outcome.notes.push(`treg Instagram: ${posts.length} recent post(s) from @${input.handles.instagram}, cost ${usd(outcome.perPlatform.instagram)}.`);
    } else if (platform === 'tiktok') {
      const profile = await call(platform, TREG_ENDPOINTS.tiktokProfile, { username: input.handles.tiktok });
      const secUid = profile === null ? null : parseTregTiktokProfile(profile);
      if (profile !== null && !secUid) { outcome.notes.push(`treg TikTok: no profile found for @${input.handles.tiktok}.`); continue; }
      if (!secUid) continue;
      const body = await call(platform, TREG_ENDPOINTS.tiktokVideos, { sec_uid: secUid, limit: 12 });
      if (body === null) continue;
      const posts = parseTregTiktokVideos(body, input.handles.tiktok!);
      outcome.posts.push(...posts);
      outcome.ok = true;
      outcome.notes.push(`treg TikTok: ${posts.length} recent video(s) from @${input.handles.tiktok}, cost ${usd(outcome.perPlatform.tiktok)}.`);
    } else if (platform === 'facebook') {
      const body = await call(platform, TREG_ENDPOINTS.facebookPosts, { url: `https://www.facebook.com/${input.handles.facebook}` });
      if (body === null) continue;
      const posts = parseTregFacebookPosts(body);
      outcome.posts.push(...posts);
      outcome.ok = true;
      outcome.notes.push(`treg Facebook: ${posts.length} recent post(s) from facebook.com/${input.handles.facebook}, cost ${usd(outcome.perPlatform.facebook)}.`);
    } else if (platform === 'meta_ads') {
      const domain = siteDomain(input.website);
      const body = await call(platform, TREG_ENDPOINTS.metaAds, {
        company_name: input.name,
        ...(domain ? { company_domain: domain } : {}),
        ...(input.handles.facebook && !input.handles.facebook.startsWith('profile.php') ? { facebook_url: `https://www.facebook.com/${input.handles.facebook}` } : {}),
      });
      if (body === null) continue;
      const ads = parseTregMetaAds(body, { name: input.name, website: input.website, handles: input.handles });
      outcome.posts.push(...ads);
      outcome.ok = true;
      outcome.notes.push(`treg Meta Ad Library: ${ads.length} distinct ad(s) for ${input.name}${ads[0]?.account && ads[0].account !== input.name ? ` (page "${ads[0].account}")` : ''}, cost ${usd(outcome.perPlatform.meta_ads)}.`);
    } else if (platform === 'x') {
      const body = await call(platform, TREG_ENDPOINTS.xPosts, { username: input.handles.x });
      if (body === null) continue;
      const posts = parseTregXPosts(body, input.handles.x!);
      outcome.posts.push(...posts);
      outcome.ok = true;
      outcome.notes.push(`treg X: ${posts.length} recent post(s) from @${input.handles.x}, cost ${usd(outcome.perPlatform.x)}.`);
    }
  }
  return outcome;
}

/* ---------------- YouTube (free: public channel RSS) ---------------- */

/** Channel id from a stored YouTube handle, or from the channel page's canonical link. */
export function youtubeChannelIdFromHandle(handle: string): string | null {
  const match = handle.match(/^channel\/(UC[A-Za-z0-9_-]{20,24})$/);
  return match ? match[1] : null;
}

export function youtubeChannelIdFromPage(html: string): string | null {
  return html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,24})"/)?.[1]
    ?? html.match(/"externalId":"(UC[A-Za-z0-9_-]{20,24})"/)?.[1]
    ?? html.match(/<meta itemprop="(?:channelId|identifier)" content="(UC[A-Za-z0-9_-]{20,24})"/)?.[1]
    ?? null;
}

export function youtubeRssUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

function xmlText(value: string): string {
  return value.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

/** Videos from a channel's public Atom feed (15 newest): title + description + date. */
export function parseYoutubeRss(xml: string, max = 15): SocialFeedPost[] {
  const author = xmlText(xml.match(/<author>\s*<name>([\s\S]*?)<\/name>/)?.[1] || '') || null;
  const out: SocialFeedPost[] = [];
  for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const id = entry.match(/<yt:videoId>([\w-]{6,20})<\/yt:videoId>/)?.[1];
    const title = xmlText(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const description = xmlText(entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] || '');
    if (!id || !title) continue;
    const text = `${title}\n${description}`.trim().slice(0, 1_500);
    out.push({ platform: 'youtube', url: `https://www.youtube.com/watch?v=${id}`, account: author, date: isoDate(entry.match(/<published>([^<]+)<\/published>/)?.[1] || ''), text, hashtags: extractHashtags(text).slice(0, 15), kind: /\/shorts\//.test(entry) ? 'short' : 'video' });
    if (out.length >= max) break;
  }
  return out;
}
