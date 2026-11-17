// Paid treg platforms for Media Monitoring: catalog prices and the per-run estimate.
// Pure (browser-safe). The calls live in media-treg.ts, which only the manual
// "Generate with treg" route imports. Scheduled refreshes never reach treg.
//
// Endpoints and cheapest per-success prices from https://treg.to/catalog/endpoints/<id>
// (read 18 Nov 2026). Routed endpoints try providers cheapest first; the per-call ceiling
// (X-Treg-Route-Max-Cost) makes treg refuse, free of charge, any provider above it.

import type { MediaChannel, MediaSettings } from './media';

export const MEDIA_TREG_PLATFORMS = ['instagram_hashtag', 'instagram_reels', 'tiktok', 'x', 'threads', 'youtube', 'facebook', 'news'] as const;
export type MediaTregPlatform = typeof MEDIA_TREG_PLATFORMS[number];

export interface MediaTregPlatformSpec {
  label: string;
  endpoint: string;
  channel: MediaChannel;
  /** What one call searches for. */
  input: 'hashtag' | 'keyword';
  /** Catalog per-success price (cheapest provider), micro-USD. */
  priceMicro: number;
  /** Per-call ceiling sent to treg, USD. */
  maxCostUsd: number;
  detail: string;
}

export const MEDIA_TREG_SPECS: Record<MediaTregPlatform, MediaTregPlatformSpec> = {
  instagram_hashtag: { label: 'Instagram hashtag posts', endpoint: 'treg.instagram.hashtag.posts', channel: 'instagram', input: 'hashtag', priceMicro: 1_880, maxCostUsd: 0.005, detail: 'recent posts under each hashtag' },
  instagram_reels: { label: 'Instagram reels search', endpoint: 'treg.instagram.search.reels', channel: 'instagram', input: 'keyword', priceMicro: 1_500, maxCostUsd: 0.005, detail: 'reels matching each keyword' },
  tiktok: { label: 'TikTok video search', endpoint: 'treg.tiktok.search.videos', channel: 'tiktok', input: 'keyword', priceMicro: 1_000, maxCostUsd: 0.005, detail: 'first page of videos per keyword' },
  x: { label: 'X (Twitter) post search', endpoint: 'treg.x.search.posts', channel: 'x', input: 'keyword', priceMicro: 750, maxCostUsd: 0.005, detail: 'posts per keyword' },
  threads: { label: 'Threads post search', endpoint: 'treg.threads.search.posts', channel: 'threads', input: 'keyword', priceMicro: 2_000, maxCostUsd: 0.005, detail: 'posts per keyword' },
  youtube: { label: 'YouTube video search', endpoint: 'treg.youtube.search.videos', channel: 'youtube', input: 'keyword', priceMicro: 1_000, maxCostUsd: 0.005, detail: 'videos per keyword' },
  facebook: { label: 'Facebook post search', endpoint: 'justoneapi.x.facebook-search-post-v1', channel: 'facebook', input: 'keyword', priceMicro: 29_520, maxCostUsd: 0.035, detail: 'public posts per keyword (single provider, CNY 0.20 ≈ $0.0295 per call)' },
  news: { label: 'Google News (SERP)', endpoint: 'treg.google.serp.news', channel: 'online_media', input: 'keyword', priceMicro: 150, maxCostUsd: 0.005, detail: 'news results per keyword' },
};

/** At most this many keywords (and hashtags) per platform per paid run, to keep the cost predictable. */
export const MEDIA_TREG_MAX_TERMS = 3;
export const MEDIA_TREG_FEATURE = 'partnership-media-monitoring';

export function parseMediaTregPlatforms(value: unknown): MediaTregPlatform[] {
  if (!Array.isArray(value)) return [];
  return MEDIA_TREG_PLATFORMS.filter(platform => value.includes(platform));
}

/** Terms one platform will search: hashtags (without #) for the hashtag endpoint, keywords for the rest. */
export function tregTermsFor(platform: MediaTregPlatform, settings: Pick<MediaSettings, 'keywords' | 'hashtags'>): string[] {
  const spec = MEDIA_TREG_SPECS[platform];
  const source = spec.input === 'hashtag'
    ? (settings.hashtags.length ? settings.hashtags.map(tag => tag.replace(/^#/, '')) : settings.keywords.map(keyword => keyword.replace(/\s+/g, '')))
    : settings.keywords.length ? settings.keywords : settings.hashtags.map(tag => tag.replace(/^#/, ''));
  return [...new Set(source.filter(Boolean))].slice(0, MEDIA_TREG_MAX_TERMS);
}

export interface MediaTregEstimate {
  calls: number;
  totalMicro: number;
  maxMicro: number;
  platforms: Array<{ platform: MediaTregPlatform; terms: string[]; calls: number; micro: number }>;
}

/** The estimate the UI shows and the server guard checks; both use these numbers. */
export function estimateMediaTreg(settings: Pick<MediaSettings, 'keywords' | 'hashtags'>, platforms: MediaTregPlatform[]): MediaTregEstimate {
  const rows = platforms.map(platform => {
    const terms = tregTermsFor(platform, settings);
    return { platform, terms, calls: terms.length, micro: terms.length * MEDIA_TREG_SPECS[platform].priceMicro };
  }).filter(row => row.calls > 0);
  return {
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
    totalMicro: rows.reduce((sum, row) => sum + row.micro, 0),
    maxMicro: Math.round(rows.reduce((sum, row) => sum + row.calls * MEDIA_TREG_SPECS[row.platform].maxCostUsd, 0) * 1_000_000),
    platforms: rows,
  };
}
