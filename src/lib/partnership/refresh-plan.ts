// Pure helpers for the Competitor Intelligence refresh toolbar: which competitors
// can use the optional treg feeds, the per-platform estimate before a batch, and
// how a finished report is labelled (Free vs treg $x). No I/O here.

import type { TregRunCost } from '@/lib/seo/treg-cost-guard';
import type { SocialHandles } from './social';
import { TREG_PLATFORM_SPECS, applicablePlatforms, estimateCompetitorTreg, type TregPlatform } from './treg-platforms';

export type RefreshMode = 'free' | 'treg';

/** The subset of GET /api/partnership/treg the toolbar needs. */
export interface ToolbarTregStatus {
  configured: boolean;
  adminOnly: boolean;
  canRun: boolean;
  balanceUsd: number | null;
  balanceError: string | null;
  spentTodayUsd: number;
  dailyLimitUsd: number;
  instagram?: { perCompetitorMicro: number; maxPerCompetitorUsd: number; enabled?: boolean };
}

export interface ToolbarCompetitor { id: string; name: string; instagramHandle: string | null; socialHandles?: SocialHandles }

const handlesOf = (item: ToolbarCompetitor): SocialHandles => ({ ...(item.socialHandles || {}), ...(item.instagramHandle && !item.socialHandles?.instagram ? { instagram: item.instagramHandle } : {}) });
const CHEAPEST_MICRO = Math.min(...Object.values(TREG_PLATFORM_SPECS).map(spec => spec.priceMicro));

/** Why the treg mode cannot be picked right now, or null when it can. */
export function tregUnavailableReason(status: ToolbarTregStatus | null): string | null {
  if (!status) return 'Checking treg…';
  if (status.instagram?.enabled === false) return 'Turned off on the server (PARTNERSHIP_TREG_INSTAGRAM=false).';
  if (!status.configured) return 'treg is not configured on the server (no TREG_API_KEY).';
  if (!status.canRun) return status.adminOnly ? 'Paid treg runs are admin-only.' : 'treg is not available for your account.';
  if (status.balanceUsd !== null && Math.round(status.balanceUsd * 1_000_000) < CHEAPEST_MICRO) {
    return `Balance $${status.balanceUsd.toFixed(2)} is below the cheapest treg call. Top up on treg.to.`;
  }
  if (status.dailyLimitUsd > 0 && Math.round((status.dailyLimitUsd - status.spentTodayUsd) * 1_000_000) < CHEAPEST_MICRO) {
    return `Today's treg limit ($${status.dailyLimitUsd.toFixed(2)}) is used up.`;
  }
  return null;
}

export interface PlannedRefresh {
  id: string; name: string; useTreg: boolean; freeReason: string | null;
  /** treg platforms this competitor will use, and its estimate (micro-USD) sent as confirmedEstimateMicro. */
  platforms: TregPlatform[]; estimateMicro: number;
  /** Selected platforms skipped for this competitor because it has no account there. */
  missing: TregPlatform[];
}
export interface RefreshPlan {
  items: PlannedRefresh[];
  tregCount: number;
  /** Total estimate for the competitors that use treg, in micro-USD. */
  estimateMicro: number;
  calls: number;
  /** Per platform: competitors and micro-USD. */
  breakdown: Array<{ platform: TregPlatform; competitors: number; micro: number }>;
  /** How many of the treg competitors the current balance covers, in list order (null when the balance is unknown). */
  coveredByBalance: number | null;
}

/**
 * Plan a batch in list order. In treg mode each competitor uses the selected platforms
 * it has an account for (Meta Ad Library runs on the company name, so it always applies);
 * a competitor with none of them runs on free sources and says so.
 */
export function planRefreshBatch(competitors: ToolbarCompetitor[], selectedIds: string[], mode: RefreshMode, status: ToolbarTregStatus | null, platforms: TregPlatform[] = ['instagram']): RefreshPlan {
  const selected = new Set(selectedIds);
  const tregOk = mode === 'treg' && tregUnavailableReason(status) === null;
  const items: PlannedRefresh[] = competitors.filter(item => selected.has(item.id)).map(item => {
    const base = { id: item.id, name: item.name, platforms: [] as TregPlatform[], estimateMicro: 0, missing: [] as TregPlatform[] };
    if (mode !== 'treg') return { ...base, useTreg: false, freeReason: null };
    if (!tregOk) return { ...base, useTreg: false, freeReason: 'treg unavailable' };
    const handles = handlesOf(item);
    const estimate = estimateCompetitorTreg(handles, platforms);
    const applied = applicablePlatforms(handles, platforms);
    const missing = platforms.filter(platform => !applied.includes(platform));
    if (!estimate.calls) return { ...base, missing, useTreg: false, freeReason: 'No account on the selected platforms' };
    return { ...base, useTreg: true, freeReason: null, platforms: applied, estimateMicro: estimate.totalMicro, missing };
  });
  const paid = items.filter(item => item.useTreg);
  const breakdown = platforms.map(platform => ({
    platform,
    competitors: paid.filter(item => item.platforms.includes(platform)).length,
    micro: paid.filter(item => item.platforms.includes(platform)).length * TREG_PLATFORM_SPECS[platform].priceMicro,
  })).filter(row => row.competitors > 0);
  const estimateMicro = paid.reduce((sum, item) => sum + item.estimateMicro, 0);
  const balanceMicro = status?.balanceUsd === null || status?.balanceUsd === undefined ? null : Math.round(status.balanceUsd * 1_000_000);
  let coveredByBalance: number | null = null;
  if (balanceMicro !== null) {
    let left = balanceMicro;
    coveredByBalance = 0;
    for (const item of paid) { if (left < item.estimateMicro) break; left -= item.estimateMicro; coveredByBalance += 1; }
  }
  return {
    items, tregCount: paid.length, estimateMicro,
    calls: paid.reduce((sum, item) => sum + item.platforms.reduce((n, platform) => n + TREG_PLATFORM_SPECS[platform].calls, 0), 0),
    breakdown, coveredByBalance,
  };
}

/** Which source a finished report used, for badges in the table, detail, and history. */
export type ReportMode = { kind: 'free' } | { kind: 'treg'; actualMicro: number; estimate: boolean };

export function reportMode(tregCost: TregRunCost | null | undefined): ReportMode {
  if (!tregCost) return { kind: 'free' };
  return { kind: 'treg', actualMicro: tregCost.actualMicro, estimate: tregCost.source === 'estimate' };
}

export function reportModeLabel(mode: ReportMode): string {
  return mode.kind === 'free' ? 'Free' : `treg $${(mode.actualMicro / 1_000_000).toFixed(4)}${mode.estimate ? ' (est.)' : ''}`;
}
