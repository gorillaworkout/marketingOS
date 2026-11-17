'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Panel, StatusBadge } from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import type { TregStatus } from '@/lib/seo/treg-cost-guard';

/**
 * Shared cost UI for every treg-backed feature. Before a generate it shows the
 * estimated cost of ONE generate and the remaining balance and asks for a confirm
 * click; after it, the actual cost and the new remaining balance. Pair it with the
 * server-side guard in src/lib/seo/treg-cost-guard.ts.
 */

export type { TregStatus };

export interface TregCostResult {
  estimatedMicro: number;
  actualMicro: number | null;
  source: 'reported' | 'estimate' | null;
  balanceAfterMicro: number | null;
}

export const usd = (value: number, digits = 4) => `$${value.toFixed(digits)}`;
const fromMicro = (micro: number, digits = 4) => usd(micro / 1_000_000, digits);

/** Reads GET /api/seo/treg (balance cached 5 minutes on the server). Partnership passes /api/partnership/treg. */
export function useTregStatus(path = '/api/seo/treg'): { status: TregStatus | null; reload: () => Promise<void> } {
  const [status, setStatus] = useState<TregStatus | null>(null);
  const reload = useCallback(async () => {
    const { ok, data } = await fetchJson<TregStatus>(path);
    if (ok) setStatus(data);
  }, [path]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);
  return { status, reload };
}

/** Balance, today's spend vs the daily limit, and the low-balance warning. */
export function TregBalancePanel({ status }: { status: TregStatus | null }) {
  return <Panel data-testid="treg-balance">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium text-[var(--mos-text)]">treg data provider</h2>
        {!status && <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Checking treg…</p>}
        {status && !status.configured && <p className="mt-1 text-sm text-[var(--mos-text-secondary)]">Not configured. This feature runs in Free mode. Ops can add TREG_API_KEY on the server to enable paid data.</p>}
        {status?.configured && <p className="mt-1 text-sm text-[var(--mos-text-secondary)]">
          Remaining balance: <span className="font-medium text-[var(--mos-text)]">{status.balanceUsd === null ? '—' : usd(status.balanceUsd, 2)}</span>
          {status.balanceFetchedAt && <span className="text-xs text-[var(--mos-text-muted)]"> (checked {new Date(status.balanceFetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, refreshed every 5 minutes)</span>}
          {' · '}Spent today: {usd(status.spentTodayUsd, 2)} of {usd(status.dailyLimitUsd, 2)} daily limit
        </p>}
        {status?.balanceError && <p className="mt-1 text-sm text-amber-200">{status.balanceError}. Runs fall back to Free mode if treg refuses.</p>}
        {status?.lowBalance && <p className="mt-1 text-sm text-amber-200">Low balance: under {usd(status.lowBalanceUsd, 2)}. Top up on treg.to before paid runs start falling back to Free mode.</p>}
        {status?.configured && status.adminOnly && !status.canRun && <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Paid treg runs are admin-only, like AI Visibility Run now. You can still use Free mode.</p>}
      </div>
      {status?.configured && <StatusBadge tone={status.lowBalance || status.balanceError ? 'warning' : 'success'} dot>{status.lowBalance ? 'Low balance' : status.balanceError ? 'Unavailable' : 'Ready'}</StatusBadge>}
    </div>
  </Panel>;
}

export interface TregCostNoticeProps {
  /** Feature name shown in the copy, e.g. "Keyword Gap". */
  feature: string;
  status: TregStatus | null;
  /** Estimate for ONE generate. `detail` explains how it was computed. */
  estimate: { totalMicro: number; calls: number; detail?: string };
  /** Show the confirm step (the parent's first Run click sets it). */
  confirming?: boolean;
  busy?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  /** After a generate: what it cost and the balance left. */
  result?: TregCostResult | null;
  /** What the estimate covers, e.g. "3 competitors". Default "one generate". */
  scopeLabel?: string;
}

export function TregCostNotice({ feature, status, estimate, confirming, busy, onConfirm, onCancel, result, scopeLabel = 'one generate' }: TregCostNoticeProps) {
  if (!status?.configured) return null;
  if (result) {
    const actual = result.actualMicro;
    return <p className="mt-3 text-sm text-[var(--mos-text-secondary)]" data-testid="treg-cost-result">
      treg cost for this {feature} run: <span className="font-medium text-[var(--mos-text)]">{actual === null ? `~${fromMicro(result.estimatedMicro)} (reserved)` : fromMicro(actual)}</span>
      {actual !== null && <span className="text-xs text-[var(--mos-text-muted)]">{result.source === 'estimate' ? ' (estimate: treg did not report every charge)' : ' (reported by treg)'}</span>}
      {' · '}estimate was {fromMicro(result.estimatedMicro)}
      {' · '}Remaining balance: <span className="font-medium text-[var(--mos-text)]">{result.balanceAfterMicro === null ? '—' : fromMicro(result.balanceAfterMicro, 2)}</span>
    </p>;
  }
  const balanceMicro = status.balanceUsd === null ? null : Math.round(status.balanceUsd * 1_000_000);
  const after = balanceMicro === null ? null : balanceMicro - estimate.totalMicro;
  const short = after !== null && after < 0;
  return <div className="mt-3 space-y-2" data-testid="treg-cost-estimate">
    <p className="text-sm text-[var(--mos-text-secondary)]">
      Estimated cost for {scopeLabel}: <span className="font-medium text-[var(--mos-text)]">~{fromMicro(estimate.totalMicro)}</span> ({estimate.calls} treg call{estimate.calls === 1 ? '' : 's'}{estimate.detail ? `: ${estimate.detail}` : ''})
      {' · '}Remaining balance: <span className="font-medium text-[var(--mos-text)]">{balanceMicro === null ? '—' : fromMicro(balanceMicro, 2)}</span>
      {after !== null && !short && <span className="text-xs text-[var(--mos-text-muted)]"> (about {fromMicro(after, 2)} after this run)</span>}
      <span className="block text-xs text-[var(--mos-text-muted)]">Estimate from treg&apos;s catalog price. The recorded cost is what treg reports after the run.</span>
    </p>
    {short && <p className="text-sm text-amber-200">The balance is below this estimate, so the run will use Free mode unless treg is topped up.</p>}
    {confirming && <div className="rounded-md border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-100" data-testid="treg-cost-confirm">
      <p>This {feature} run spends treg balance: about {fromMicro(estimate.totalMicro)} (estimate). If treg refuses (for example, insufficient balance), it falls back to Free mode, and refused calls are not charged.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={busy} onClick={onConfirm}>Confirm and run (~{fromMicro(estimate.totalMicro)})</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>}
  </div>;
}
