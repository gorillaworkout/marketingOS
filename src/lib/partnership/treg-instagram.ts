import { TregError, tregCall, type FetchLike, type TregConfig } from '@/lib/seo/treg-client';
import { parseTregInstagramPosts, type InstagramFeedPost } from './campaigns';

/**
 * Optional paid Instagram feed for Competitor Intelligence through treg.to.
 * Endpoint chosen 17 Nov 2026 from https://treg.to/catalog/endpoints/treg.instagram.user.posts:
 * routed over 5 providers (crawl4ai, tikhub, scrapecreators, anyapi, justoneapi),
 * cheapest first, billed per success from $0.0009. A ceiling of $0.005 per call
 * refuses the dearest provider ($0.01476). Verified with one real call for
 * @mifx.indonesia: 12 posts, X-Treg-Cost-Micro 900 (served by crawl4ai).
 */
export const TREG_IG_POSTS_ENDPOINT = 'treg.instagram.user.posts';
/** Typical charge per competitor (catalog per-success price). */
export const TREG_IG_POSTS_PRICE_MICRO = 900;
/** Per-call ceiling sent as X-Treg-Route-Max-Cost; treg refuses (free) above it. */
export const TREG_IG_POSTS_MAX_USD = 0.005;
export const TREG_IG_FEATURE = 'partnership-competitor-intel';

export function estimateInstagramFeedMicro(accounts: number): { calls: number; totalMicro: number; maxMicro: number } {
  const calls = Math.max(0, accounts);
  return { calls, totalMicro: calls * TREG_IG_POSTS_PRICE_MICRO, maxMicro: Math.round(calls * TREG_IG_POSTS_MAX_USD * 1_000_000) };
}

/** Off switch for ops: PARTNERSHIP_TREG_INSTAGRAM=false keeps Competitor Intelligence on free sources only. */
export function instagramFeedEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PARTNERSHIP_TREG_INSTAGRAM?.trim().toLowerCase() !== 'false';
}

export type InstagramFeedOutcome =
  | { ok: true; posts: InstagramFeedPost[]; costMicro: number; costSource: 'reported' | 'estimate'; callId: string | null }
  | { ok: false; error: TregError; costMicro: number; costSource: 'reported' | 'estimate' };

export async function fetchTregInstagramFeed(config: TregConfig, input: { handle: string; reportId: string }, fetchImpl: FetchLike = fetch): Promise<InstagramFeedOutcome> {
  try {
    const result = await tregCall(config, {
      endpointId: TREG_IG_POSTS_ENDPOINT,
      body: { username: input.handle },
      meta: { feature: TREG_IG_FEATURE, run: input.reportId },
      idempotencyKey: `${input.reportId}:ig`,
      maxCostUsd: TREG_IG_POSTS_MAX_USD,
      timeoutMs: 60_000,
    }, fetchImpl);
    return { ok: true, posts: parseTregInstagramPosts(result.body), costMicro: result.costMicro ?? 0, costSource: 'reported', callId: result.callId };
  } catch (error) {
    const tregError = error instanceof TregError ? error : new TregError('provider-error');
    // A timeout may still have been charged: count the typical price and say it is an estimate.
    if (tregError.kind === 'timeout' || tregError.kind === 'network') return { ok: false, error: tregError, costMicro: TREG_IG_POSTS_PRICE_MICRO, costSource: 'estimate' };
    return { ok: false, error: tregError, costMicro: tregError.costMicro, costSource: 'reported' };
  }
}
