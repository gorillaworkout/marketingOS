// treg platforms for Competitor Intelligence: catalog prices and the per-competitor
// estimate. Pure (browser-safe); the calls themselves live in treg-social.ts.
// Prices: https://treg.to/catalog, 17 Nov 2026 (see treg-social.ts for the verified calls).

import type { SocialHandles, SocialPlatform } from './social';

export const TREG_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'meta_ads', 'x'] as const;
export type TregPlatform = typeof TREG_PLATFORMS[number];
export const TREG_CALL_MAX_USD = 0.005;

export interface TregPlatformSpec {
  label: string;
  /** Social handle the platform needs; null = runs on the competitor name (Meta Ad Library). */
  needs: SocialPlatform | null;
  calls: number;
  /** Typical charge per competitor (sum of its calls' catalog prices). */
  priceMicro: number;
  detail: string;
}

export const TREG_PLATFORM_SPECS: Record<TregPlatform, TregPlatformSpec> = {
  instagram: { label: 'Instagram', needs: 'instagram', calls: 1, priceMicro: 900, detail: 'recent posts with captions' },
  tiktok: { label: 'TikTok', needs: 'tiktok', calls: 2, priceMicro: 640 + 500, detail: 'profile lookup + recent videos' },
  facebook: { label: 'Facebook', needs: 'facebook', calls: 1, priceMicro: 1350, detail: 'recent page posts' },
  meta_ads: { label: 'Meta Ad Library', needs: null, calls: 1, priceMicro: 1200, detail: 'ads running on Facebook/Instagram, by page or company name' },
  x: { label: 'X (Twitter)', needs: 'x', calls: 1, priceMicro: 500, detail: 'recent posts' },
};

export function parseTregPlatforms(value: unknown): TregPlatform[] {
  if (!Array.isArray(value)) return [];
  return TREG_PLATFORMS.filter(platform => value.includes(platform));
}

/** Platforms that apply to one competitor: the requested ones it has a handle for (Meta Ad Library always). */
export function applicablePlatforms(handles: SocialHandles, requested: TregPlatform[]): TregPlatform[] {
  return TREG_PLATFORMS.filter(platform => requested.includes(platform) && (TREG_PLATFORM_SPECS[platform].needs === null || Boolean(handles[TREG_PLATFORM_SPECS[platform].needs!])));
}

export interface TregEstimate { calls: number; totalMicro: number; maxMicro: number; platforms: Array<{ platform: TregPlatform; calls: number; micro: number }> }

/** Estimate for ONE competitor; the server guard and the toolbar use the same numbers. */
export function estimateCompetitorTreg(handles: SocialHandles, requested: TregPlatform[]): TregEstimate {
  const platforms = applicablePlatforms(handles, requested).map(platform => ({ platform, calls: TREG_PLATFORM_SPECS[platform].calls, micro: TREG_PLATFORM_SPECS[platform].priceMicro }));
  const calls = platforms.reduce((sum, item) => sum + item.calls, 0);
  return { calls, totalMicro: platforms.reduce((sum, item) => sum + item.micro, 0), maxMicro: Math.round(calls * TREG_CALL_MAX_USD * 1_000_000), platforms };
}

