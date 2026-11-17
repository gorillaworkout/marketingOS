// Pure helpers for the Competitor Intelligence refresh toolbar: which competitors
// can use the optional treg Instagram feed, the total estimate before a batch,
// and how a finished report is labelled (Free vs treg $x). No I/O here.

import type { TregRunCost } from '@/lib/seo/treg-cost-guard';

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

export interface ToolbarCompetitor { id: string; name: string; instagramHandle: string | null }

/** Why the treg mode cannot be picked right now, or null when it can. */
export function tregUnavailableReason(status: ToolbarTregStatus | null): string | null {
  if (!status) return 'Checking treg…';
  if (status.instagram?.enabled === false) return 'Turned off on the server (PARTNERSHIP_TREG_INSTAGRAM=false).';
  if (!status.configured) return 'treg is not configured on the server (no TREG_API_KEY).';
  if (!status.canRun) return status.adminOnly ? 'Paid treg runs are admin-only.' : 'treg is not available for your account.';
  const perMicro = status.instagram?.perCompetitorMicro ?? 0;
  if (status.balanceUsd !== null && Math.round(status.balanceUsd * 1_000_000) < perMicro) {
    return `Balance $${status.balanceUsd.toFixed(2)} is below one competitor's estimate. Top up on treg.to.`;
  }
  if (status.dailyLimitUsd > 0 && Math.round((status.dailyLimitUsd - status.spentTodayUsd) * 1_000_000) < perMicro) {
    return `Today's treg limit ($${status.dailyLimitUsd.toFixed(2)}) is used up.`;
  }
  return null;
}

export interface PlannedRefresh { id: string; name: string; useTreg: boolean; freeReason: string | null }
export interface RefreshPlan {
  items: PlannedRefresh[];
  tregCount: number;
  /** Total estimate for the competitors that use treg, in micro-USD. */
  estimateMicro: number;
  /** How many of the treg competitors the current balance covers (null when the balance is unknown). */
  coveredByBalance: number | null;
}

/**
 * Plan a batch in the order the competitors are listed. In treg mode, a competitor
 * without an Instagram handle runs on free sources and says so.
 */
export function planRefreshBatch(competitors: ToolbarCompetitor[], selectedIds: string[], mode: RefreshMode, status: ToolbarTregStatus | null): RefreshPlan {
  const selected = new Set(selectedIds);
  const tregOk = mode === 'treg' && tregUnavailableReason(status) === null;
  const items = competitors.filter(item => selected.has(item.id)).map(item => {
    if (mode !== 'treg') return { id: item.id, name: item.name, useTreg: false, freeReason: null };
    if (!tregOk) return { id: item.id, name: item.name, useTreg: false, freeReason: 'treg unavailable' };
    if (!item.instagramHandle) return { id: item.id, name: item.name, useTreg: false, freeReason: 'No Instagram handle' };
    return { id: item.id, name: item.name, useTreg: true, freeReason: null };
  });
  const perMicro = status?.instagram?.perCompetitorMicro ?? 0;
  const tregCount = items.filter(item => item.useTreg).length;
  const balanceMicro = status?.balanceUsd === null || status?.balanceUsd === undefined ? null : Math.round(status.balanceUsd * 1_000_000);
  const coveredByBalance = balanceMicro === null ? null : perMicro > 0 ? Math.min(tregCount, Math.floor(balanceMicro / perMicro)) : tregCount;
  return { items, tregCount, estimateMicro: tregCount * perMicro, coveredByBalance };
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
