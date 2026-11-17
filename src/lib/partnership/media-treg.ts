/**
 * Paid Media Monitoring search through treg.to. MANUAL ONLY: called from the
 * "Generate with treg" route after the user confirmed the estimate and the shared
 * cost guard (src/lib/seo/treg-cost-guard.ts) reserved it. Never from cron:
 * fetchTregMentions refuses any trigger other than 'manual' before it touches the network.
 */
import { TregError, tregCall, tregFallbackNotice, type FetchLike, type TregConfig } from '@/lib/seo/treg-client';
import { channelFromUrl, rawMention, type DateRange, type MediaChannel, type MediaSettings, type RawMention } from './media';
import { MEDIA_TREG_FEATURE, MEDIA_TREG_SPECS, tregTermsFor, type MediaTregPlatform } from './media-treg-platforms';

export class TregNotAllowedError extends Error {
  constructor(trigger: string) { super(`treg is manual-only; refused for a ${trigger} run.`); }
}

/* ---------------- defensive parsing of provider-native rows ---------------- */

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

function pick(row: Row, paths: string[]): unknown {
  for (const path of paths) {
    let current: unknown = row;
    for (const key of path.split('.')) current = isRow(current) ? current[key] : Array.isArray(current) && /^\d+$/.test(key) ? current[Number(key)] : undefined;
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return undefined;
}

const count = (row: Row, paths: string[]): number => {
  const value = pick(row, paths);
  const parsed = typeof value === 'number' ? value : Number(str(value).replace(/[, ]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

function dateOf(row: Row): string | null {
  const value = pick(row, ['taken_at', 'taken_at_timestamp', 'create_time', 'createTime', 'created_at', 'createdAt', 'createdUtc', 'published_at', 'publishedAt', 'publish_time', 'timestamp', 'date', 'time', 'creation_time']);
  if (typeof value === 'number' || /^\d{9,13}$/.test(str(value))) {
    const n = Number(value);
    return n > 0 ? new Date(n > 1e12 ? n : n * 1000).toISOString() : null;
  }
  const parsed = Date.parse(str(value));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Unwraps edges/node/post/thread_items wrappers (Threads, GraphQL-style providers). */
function unwrap(row: Row): Row {
  let current: Row = row;
  for (let depth = 0; depth < 4; depth += 1) {
    const next = isRow(current.node) ? current.node
      : Array.isArray(current.thread_items) && isRow(current.thread_items[0]) ? current.thread_items[0] as Row
        : isRow(current.post) ? current.post
          : isRow(current.media) && !current.code && !current.id ? current.media
            : null;
    if (!next) break;
    current = next;
  }
  return current;
}

/** The list inside {output:{posts|reels|videos|results}}, {data:{…}}, or a bare array. */
export function tregRows(raw: unknown): Row[] {
  const body = isRow(raw) ? raw : null;
  const containers = [body?.output, body?.data, isRow(body?.data) ? (body!.data as Row).data : undefined, body];
  for (const container of containers) {
    if (Array.isArray(container)) return container.filter(isRow).map(unwrap);
    if (!isRow(container)) continue;
    for (const key of ['posts', 'reels', 'videos', 'results', 'items', 'news', 'news_results', 'edges', 'list', 'data']) {
      const list = container[key];
      if (Array.isArray(list)) return list.filter(isRow).map(unwrap);
    }
  }
  return [];
}

function urlFor(platform: MediaTregPlatform, row: Row, author: string): string | null {
  const direct = str(pick(row, ['url', 'link', 'permalink', 'post_url', 'share_url', 'video_url', 'webVideoUrl', 'shareUrl']));
  if (/^https?:\/\//i.test(direct)) return direct;
  const code = str(pick(row, ['code', 'shortcode']));
  const id = str(pick(row, ['video_id', 'videoId', 'aweme_id', 'post_id', 'rest_id', 'id_str', 'id']));
  switch (MEDIA_TREG_SPECS[platform].channel) {
    case 'instagram': return code ? `https://www.instagram.com/${platform === 'instagram_reels' ? 'reel' : 'p'}/${code}/` : null;
    case 'tiktok': return id && author ? `https://www.tiktok.com/@${author}/video/${id}` : null;
    case 'x': return id && author ? `https://x.com/${author}/status/${id}` : null;
    case 'threads': return code && author ? `https://www.threads.net/@${author}/post/${code}` : null;
    case 'youtube': return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
    case 'facebook': return id ? `https://www.facebook.com/${id}` : null;
    default: return null;
  }
}

export function parseTregMediaRows(platform: MediaTregPlatform, raw: unknown, term: string): RawMention[] {
  const spec = MEDIA_TREG_SPECS[platform];
  const out: RawMention[] = [];
  for (const row of tregRows(raw)) {
    const author = str(pick(row, ['user.username', 'owner.username', 'author.unique_id', 'author.uniqueId', 'author.username', 'author.screen_name', 'authorHandle', 'user.screen_name', 'screen_name', 'username', 'channel.name', 'channelTitle', 'author_name', 'page_name', 'author.name', 'user.name'])).replace(/^@/, '');
    const captionValue = pick(row, ['caption.text', 'caption', 'text', 'full_text', 'description', 'desc', 'message', 'content', 'title', 'snippet']);
    const caption = str(isRow(captionValue) ? captionValue.text : captionValue).trim();
    const title = str(pick(row, ['title'])).trim();
    const url = urlFor(platform, row, author);
    if (!url || (!caption && !title)) continue;
    const channel: MediaChannel = spec.channel === 'online_media' ? channelFromUrl(url) : spec.channel;
    const publisher = str(pick(row, ['source.name', 'source', 'publisher', 'domain']));
    out.push(rawMention({
      url, channel, source: 'treg', matchedTerm: term,
      author: spec.channel === 'online_media' ? null : author || null,
      sourceName: spec.channel === 'online_media' ? publisher || null : spec.label,
      title: (spec.channel === 'online_media' ? title || caption : caption.split('\n')[0]).slice(0, 300),
      snippet: (spec.channel === 'online_media' ? str(pick(row, ['snippet', 'description'])) : caption).slice(0, 1000),
      publishedAt: dateOf(row),
      likes: count(row, ['like_count', 'likes', 'digg_count', 'favorite_count', 'favourites_count', 'likeCount', 'stats.diggCount', 'statistics.digg_count', 'statistics.likeCount', 'edge_liked_by.count', 'reactions_count', 'reaction_count']),
      comments: count(row, ['comment_count', 'comments_count', 'commentCount', 'reply_count', 'replyCount', 'stats.commentCount', 'statistics.comment_count', 'statistics.commentCount', 'text_post_app_info.direct_reply_count', 'edge_media_to_comment.count']),
      shares: count(row, ['share_count', 'shares', 'shareCount', 'retweet_count', 'retweetCount', 'reshare_count', 'repost_count', 'stats.shareCount', 'statistics.share_count', 'text_post_app_info.repost_count']),
      views: count(row, ['play_count', 'view_count', 'views', 'viewCount', 'video_view_count', 'ig_play_count', 'playCount', 'stats.playCount', 'statistics.play_count', 'statistics.viewCount']),
      followers: count(row, ['user.follower_count', 'owner.follower_count', 'author.follower_count', 'authorStats.followerCount', 'author.followers_count', 'user.followers_count']),
    }));
  }
  return out;
}

/* ---------------- calls ---------------- */

export interface TregMediaOutcome {
  mentions: RawMention[];
  notes: string[];
  costMicro: number;
  costSource: 'reported' | 'estimate';
  calls: number;
  callIds: string[];
  ok: boolean;
  refusalBalanceMicro: number | null;
}

/**
 * One call per (platform, term), one at a time. Never throws on a provider failure: a
 * refused or failed call adds a note and the run keeps its free results. A refusal for
 * balance, spend cap or token stops the remaining calls.
 */
export async function fetchTregMentions(
  config: TregConfig,
  input: { runId: string; trigger: 'manual' | 'scheduled'; platforms: MediaTregPlatform[]; settings: Pick<MediaSettings, 'keywords' | 'hashtags' | 'language'>; range: DateRange },
  fetchImpl: FetchLike = fetch,
): Promise<TregMediaOutcome> {
  if (input.trigger !== 'manual') throw new TregNotAllowedError(input.trigger);
  const outcome: TregMediaOutcome = { mentions: [], notes: [], costMicro: 0, costSource: 'reported', calls: 0, callIds: [], ok: false, refusalBalanceMicro: null };
  let stop = false;
  for (const platform of input.platforms) {
    const spec = MEDIA_TREG_SPECS[platform];
    for (const term of tregTermsFor(platform, input.settings)) {
      if (stop) { outcome.notes.push(`treg ${spec.label} "${term}" skipped: treg stopped earlier in this run.`); continue; }
      outcome.calls += 1;
      const isGet = spec.endpoint.startsWith('justoneapi.');
      const body: Record<string, unknown> = spec.input === 'hashtag' ? { hashtag: term } : { q: term };
      if (platform === 'news') Object.assign(body, input.settings.language === 'en' ? { country: 'us', language: 'en' } : { country: 'id', language: 'id' }, { limit: 50 });
      if (platform === 'tiktok') body.limit = 20;
      try {
        const result = await tregCall(config, {
          endpointId: spec.endpoint,
          body: isGet ? undefined : body,
          method: isGet ? 'GET' : 'POST',
          query: isGet ? { keyword: term, startDate: input.range.from, endDate: input.range.to, cursor: '0' } : undefined,
          meta: { feature: MEDIA_TREG_FEATURE, run: input.runId, platform },
          idempotencyKey: `${input.runId}:${spec.endpoint}:${term}`,
          maxCostUsd: spec.maxCostUsd,
          timeoutMs: 60_000,
        }, fetchImpl);
        outcome.costMicro += result.costMicro ?? 0;
        if (result.callId) outcome.callIds.push(result.callId);
        const found = parseTregMediaRows(platform, result.body, term);
        outcome.mentions.push(...found);
        outcome.ok = true;
        outcome.notes.push(`treg ${spec.label} "${term}": ${found.length} result(s), cost $${((result.costMicro ?? 0) / 1_000_000).toFixed(4)}.`);
      } catch (error) {
        const tregError = error instanceof TregError ? error : new TregError('provider-error');
        // A timeout may still have been charged: count the catalog price and mark it as an estimate.
        if (tregError.kind === 'timeout' || tregError.kind === 'network') {
          outcome.costMicro += spec.priceMicro;
          outcome.costSource = 'estimate';
        } else {
          outcome.costMicro += tregError.costMicro;
        }
        if (tregError.balanceMicro !== null) outcome.refusalBalanceMicro = tregError.balanceMicro;
        if (['insufficient-balance', 'spend-cap', 'unauthorized', 'not-configured'].includes(tregError.kind)) stop = true;
        outcome.notes.push(`${tregFallbackNotice(tregError)} (${spec.label} "${term}"); free sources kept.`);
      }
    }
  }
  return outcome;
}
