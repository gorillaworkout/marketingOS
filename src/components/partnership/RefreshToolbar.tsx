'use client';

import { useRef, useState } from 'react';
import { Button, Panel, StatusBadge } from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import { TregCostNotice, type TregStatus } from '@/components/seo/TregCostNotice';
import {
  planRefreshBatch, reportModeLabel, tregUnavailableReason,
  type RefreshMode, type ReportMode, type ToolbarTregStatus,
} from '@/lib/partnership/refresh-plan';
import { SOCIAL_PLATFORMS, type SocialHandles } from '@/lib/partnership/social';
import { TREG_PLATFORMS, TREG_PLATFORM_SPECS, type TregPlatform } from '@/lib/partnership/treg-platforms';

/**
 * Top-of-page refresh controls for Competitor Intelligence: pick competitors, pick
 * Free sources or treg (paid social feeds: Instagram, TikTok, Facebook, X, Meta ads), confirm the treg estimate, then run
 * them ONE AT A TIME (the server does the AI calls; one at a time keeps the VPS
 * light). Each competitor goes through POST /api/partnership/competitors/[id]/refresh,
 * so the server-side treg guard (estimate, balance, reservation, daily limit, Free
 * fallback) applies per competitor.
 */

export type ToolbarRun = {
  id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; progress: number; message: string; error: string | null;
  /** Actual treg cost from the spend ledger once the run settled (null = no treg spend). */
  tregCostMicro?: number | null;
};
export type ToolbarCompetitorRow = {
  id: string; name: string; instagramHandle: string | null; socialHandles?: SocialHandles;
  latestRun: ToolbarRun | null; lastRefreshMode: ReportMode | null;
};
export type ToolbarListResponse = { competitors: ToolbarCompetitorRow[] };

type JobStatus = 'waiting' | 'starting' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type Job = {
  id: string; name: string; useTreg: boolean; freeReason: string | null;
  platforms: TregPlatform[]; estimateMicro: number;
  status: JobStatus; progress: number; message: string; error: string | null;
  tregOutcome: 'reserved' | 'skipped' | 'off' | null; mode: ReportMode | null; costMicro: number | null;
};

const POLL_MS = 3000;
const WAIT_LIMIT_MS = 15 * 60_000;
const isRunning = (run: ToolbarRun | null | undefined) => run?.status === 'queued' || run?.status === 'running';
const microUsd = (micro: number, digits = 4) => `$${(micro / 1_000_000).toFixed(digits)}`;
/** Catalog prices like $0.00135 keep their 5th digit; totals stay at 4. */
const priceUsd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro % 100 === 0 ? 4 : 5)}`;
const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
/** Deadline helper kept outside the component body (Date.now is impure). */
const deadlineFrom = (ms: number) => { const end = Date.now() + ms; return () => Date.now() < end; };

function JobLine({ job }: { job: Job }) {
  const tone = job.status === 'succeeded' ? 'success' : job.status === 'failed' ? 'danger' : job.status === 'cancelled' || job.status === 'waiting' ? 'neutral' : 'info';
  const label = job.status === 'running' || job.status === 'queued' ? `${job.status} ${job.progress}%` : job.status;
  return <li className="flex flex-wrap items-center gap-2 text-xs text-[var(--mos-text-secondary)]" data-testid="refresh-job">
    <span className="min-w-[96px] font-medium text-[var(--mos-text)]">{job.name}</span>
    <StatusBadge tone={tone}>{label}</StatusBadge>
    <StatusBadge tone={job.useTreg && job.tregOutcome !== 'skipped' ? 'warning' : 'neutral'}>{job.useTreg ? 'treg' : 'Free'}</StatusBadge>
    {(job.status === 'running' || job.status === 'queued') && <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-[var(--mos-accent)]" style={{ width: `${job.progress}%` }} /></span>}
    {(job.status === 'running' || job.status === 'queued') && job.message && <span className="text-[var(--mos-text-muted)]">{job.message}</span>}
    {job.freeReason && <span className="text-[var(--mos-text-muted)]">{job.freeReason}: free sources</span>}
    {job.tregOutcome === 'skipped' && <span className="text-amber-200">treg skipped (balance or limit): free sources used</span>}
    {job.status === 'succeeded' && job.mode && <span className="text-[var(--mos-text-muted)]">Used: {reportModeLabel(job.mode)}</span>}
    {job.status === 'failed' && job.costMicro !== null && <span className="text-[var(--mos-text-muted)]">treg cost {microUsd(job.costMicro)}</span>}
    {job.status === 'failed' && job.error && <span className="text-red-300">{job.error}</span>}
  </li>;
}

const DEFAULT_PLATFORMS: TregPlatform[] = [...TREG_PLATFORMS];
const accountCount = (item: ToolbarCompetitorRow) => SOCIAL_PLATFORMS.filter(platform => (platform === 'instagram' ? item.socialHandles?.instagram || item.instagramHandle : item.socialHandles?.[platform])).length;

export function RefreshToolbar({ competitors, treg, selectedIds, setSelectedIds, reloadTreg, onList, onBatchChange, onFindSocial }: {
  competitors: ToolbarCompetitorRow[];
  treg: (TregStatus & ToolbarTregStatus) | null;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  reloadTreg: () => Promise<void>;
  onList: (data: ToolbarListResponse) => void;
  onBatchChange: (active: boolean) => void;
  /** Open the social-account finder for these competitors. */
  onFindSocial?: (ids: string[]) => void;
}) {
  const [platforms, setPlatforms] = useState<TregPlatform[]>(DEFAULT_PLATFORMS);
  const [mode, setMode] = useState<RefreshMode>('free');
  const [confirming, setConfirming] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef(false);

  const tregReason = tregUnavailableReason(treg);
  const effectiveMode: RefreshMode = mode === 'treg' && !tregReason ? 'treg' : 'free';
  const plan = planRefreshBatch(competitors, selectedIds, effectiveMode, treg, platforms);
  const maxPerMicro = TREG_PLATFORMS.reduce((sum, platform) => sum + TREG_PLATFORM_SPECS[platform].priceMicro, 0);
  const togglePlatform = (platform: TregPlatform) => { setConfirming(false); setPlatforms(current => (current.includes(platform) ? current.filter(item => item !== platform) : TREG_PLATFORMS.filter(item => item === platform || current.includes(item)))); };
  const allSelected = competitors.length > 0 && competitors.every(item => selectedIds.includes(item.id));
  const runningIds = new Set(competitors.filter(item => isRunning(item.latestRun)).map(item => item.id));

  const toggle = (id: string) => setSelectedIds(selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds, id]);
  const update = (id: string, patch: Partial<Job>) => setJobs(current => current.map(job => (job.id === id ? { ...job, ...patch } : job)));

  const waitFor = async (job: Job, reportId: string) => {
    const withinLimit = deadlineFrom(WAIT_LIMIT_MS);
    while (withinLimit()) {
      await sleep(POLL_MS);
      const { ok, data } = await fetchJson<ToolbarListResponse>('/api/partnership/competitors');
      if (!ok) continue;
      onList(data);
      const row = data.competitors.find(item => item.id === job.id);
      const run = row?.latestRun;
      if (!row || !run || run.id !== reportId) continue;
      const costMicro = run.tregCostMicro ?? null;
      if (run.status === 'succeeded') { update(job.id, { status: 'succeeded', progress: 100, mode: row.lastRefreshMode, costMicro }); return; }
      if (run.status === 'failed') { update(job.id, { status: 'failed', error: run.error || 'The refresh failed.', costMicro }); return; }
      update(job.id, { status: run.status, progress: run.progress, message: run.message });
    }
    update(job.id, { status: 'failed', error: 'Still running after 15 minutes; check the table later.' });
  };

  const run = async () => {
    setConfirming(false); setError('');
    const queue: Job[] = plan.items.map(item => ({ ...item, status: 'waiting', progress: 0, message: '', error: null, tregOutcome: null, mode: null, costMicro: null }));
    if (!queue.length) return;
    cancelRef.current = false;
    setJobs(queue); setActive(true); onBatchChange(true);
    try {
      for (const job of queue) {
        if (cancelRef.current) { update(job.id, { status: 'cancelled' }); continue; }
        update(job.id, { status: 'starting' });
        const body = job.useTreg ? JSON.stringify({ treg: { platforms: job.platforms, confirmedEstimateMicro: job.estimateMicro } }) : undefined;
        const { ok, status, data } = await fetchJson<{ id: string; treg?: 'reserved' | 'skipped' | 'off' }>(
          `/api/partnership/competitors/${encodeURIComponent(job.id)}/refresh`,
          { method: 'POST', body, headers: body ? { 'content-type': 'application/json' } : undefined },
        );
        if (!ok) {
          update(job.id, { status: 'failed', error: status === 409 && /already/i.test(data.error || '') ? 'A refresh is already running for this competitor.' : data.error || 'Could not start the refresh.' });
          continue;
        }
        update(job.id, { status: 'queued', tregOutcome: data.treg ?? null });
        await waitFor(job, data.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The batch stopped.');
    } finally {
      setActive(false); onBatchChange(false);
      void reloadTreg();
    }
  };

  const done = jobs.filter(job => job.status === 'succeeded');
  // Actual cost from the spend ledger, for succeeded and failed runs alike.
  const paid = jobs.filter(job => job.costMicro !== null);
  const actualMicro = paid.reduce((sum, job) => sum + (job.costMicro ?? 0), 0);
  const tregDone = paid.length;

  return <Panel data-testid="refresh-toolbar">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium text-[var(--mos-text)]">Refresh competitors</h2>
        <p className="mt-0.5 text-xs text-[var(--mos-text-muted)]">Pick competitors and a source, then refresh. They run one at a time; keep this tab open until the list finishes. Weekly scheduled refreshes always use free sources.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onFindSocial && <Button size="sm" variant="secondary" disabled={active || !selectedIds.length} onClick={() => onFindSocial(selectedIds)} data-testid="find-social-bulk">Find social accounts ({selectedIds.length})</Button>}
        {active && <Button size="sm" variant="ghost" onClick={() => { cancelRef.current = true; }}>Stop after current</Button>}
        <Button variant="primary" disabled={active || !plan.items.length || plan.items.some(item => runningIds.has(item.id))}
          onClick={() => (effectiveMode === 'treg' && plan.tregCount > 0 ? setConfirming(true) : void run())}>
          {active ? 'Refreshing…' : `Refresh selected (${plan.items.length})`}
        </Button>
      </div>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Competitors to refresh">
      <label className="mr-1 inline-flex items-center gap-1.5 text-xs text-[var(--mos-text-secondary)]">
        <input type="checkbox" checked={allSelected} disabled={active} onChange={() => setSelectedIds(allSelected ? [] : competitors.map(item => item.id))} /> Select all
      </label>
      {competitors.map(item => {
        const on = selectedIds.includes(item.id);
        return <label key={item.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? 'border-[var(--mos-accent)] bg-[var(--mos-accent)]/15 text-[var(--mos-text)]' : 'border-[var(--mos-border)] text-[var(--mos-text-secondary)]'}`}>
          <input type="checkbox" className="sr-only" checked={on} disabled={active} onChange={() => toggle(item.id)} />
          {item.name}
          {runningIds.has(item.id) && <span className="text-[10px] text-indigo-200">running</span>}
          {(() => { const count = accountCount(item); return <span className="text-[10px] text-[var(--mos-text-faint)]" title={count ? `${count} social account${count === 1 ? '' : 's'} saved` : 'No social accounts saved yet: use Find social accounts'}>{count ? `${count} social` : 'no socials'}</span>; })()}
        </label>;
      })}
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Source">
      <span className="text-xs text-[var(--mos-text-faint)]">Source</span>
      <button type="button" role="radio" aria-checked={mode === 'free'} disabled={active} onClick={() => { setMode('free'); setConfirming(false); }}
        className={`rounded-[var(--mos-radius-control)] border px-3 py-1.5 text-xs ${mode === 'free' ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-[var(--mos-border)] text-[var(--mos-text-secondary)]'}`}>
        Free sources <span className="text-[var(--mos-text-faint)]">· website, news, pasted posts · $0</span>
      </button>
      <button type="button" role="radio" aria-checked={mode === 'treg'} disabled={active || Boolean(tregReason)} title={tregReason || ''} onClick={() => setMode('treg')}
        className={`rounded-[var(--mos-radius-control)] border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-45 ${mode === 'treg' && !tregReason ? 'border-amber-400/50 bg-amber-400/10 text-amber-100' : 'border-[var(--mos-border)] text-[var(--mos-text-secondary)]'}`}>
        treg <span className="text-[var(--mos-text-faint)]">· free sources + social feeds and Meta ads · paid, up to ~{microUsd(maxPerMicro)} per competitor</span>
      </button>
      {tregReason && <span className="text-xs text-[var(--mos-text-muted)]" data-testid="treg-unavailable">treg unavailable: {tregReason}</span>}
      {treg?.configured && treg.balanceUsd !== null && <span className="text-xs text-[var(--mos-text-muted)]">Balance {microUsd(Math.round(treg.balanceUsd * 1_000_000), 2)} · today {microUsd(Math.round(treg.spentTodayUsd * 1_000_000), treg.spentTodayUsd > 0 && treg.spentTodayUsd < 0.01 ? 4 : 2)} of {microUsd(Math.round(treg.dailyLimitUsd * 1_000_000), 2)} limit</span>}
    </div>

    {effectiveMode === 'treg' && <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="treg platforms" data-testid="treg-platforms">
      <span className="text-xs text-[var(--mos-text-faint)]">treg platforms</span>
      {TREG_PLATFORMS.map(platform => {
        const spec = TREG_PLATFORM_SPECS[platform];
        const on = platforms.includes(platform);
        return <label key={platform} title={spec.detail} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? 'border-amber-400/50 bg-amber-400/10 text-amber-100' : 'border-[var(--mos-border)] text-[var(--mos-text-secondary)]'}`}>
          <input type="checkbox" checked={on} disabled={active} onChange={() => togglePlatform(platform)} />
          {spec.label} <span className="text-[var(--mos-text-faint)]">{priceUsd(spec.priceMicro)}</span>
        </label>;
      })}
      <span className="text-xs text-[var(--mos-text-muted)]">YouTube uploads are read free (RSS) whenever a channel is saved.</span>
    </div>}

    {effectiveMode === 'treg' && plan.items.length > 0 && <>
      {plan.tregCount === 0 && <p className="mt-3 text-sm text-amber-200">{platforms.length ? 'None of the selected competitors has an account on the selected platforms, so this refresh uses free sources only ($0). Use Find social accounts first.' : 'Pick at least one treg platform, or use Free sources.'}</p>}
      {plan.tregCount > 0 && <ul className="mt-3 space-y-0.5 text-xs text-[var(--mos-text-secondary)]" data-testid="treg-breakdown">
        {plan.breakdown.map(row => <li key={row.platform}>{TREG_PLATFORM_SPECS[row.platform].label}: {row.competitors} competitor{row.competitors === 1 ? '' : 's'} × {priceUsd(TREG_PLATFORM_SPECS[row.platform].priceMicro)} = {priceUsd(row.micro)}</li>)}
      </ul>}
      {plan.tregCount > 0 && <TregCostNotice
        feature="Competitor Intelligence"
        status={treg}
        scopeLabel={`${plan.tregCount} competitor${plan.tregCount === 1 ? '' : 's'}`}
        estimate={{ totalMicro: plan.estimateMicro, calls: plan.calls, detail: `${plan.breakdown.map(row => TREG_PLATFORM_SPECS[row.platform].label).join(', ')}; each call capped at $0.005` }}
        confirming={confirming}
        busy={active}
        onConfirm={() => void run()}
        onCancel={() => setConfirming(false)}
      />}
      {plan.tregCount > 0 && plan.coveredByBalance !== null && plan.coveredByBalance < plan.tregCount && <p className="mt-2 text-xs text-amber-200">The balance covers about {plan.coveredByBalance} of {plan.tregCount}; the rest fall back to free sources.</p>}
      {plan.items.some(item => item.freeReason) && <p className="mt-2 text-xs text-[var(--mos-text-muted)]">Free sources only (no account on the selected platforms): {plan.items.filter(item => item.freeReason).map(item => item.name).join(', ')}.</p>}
      {plan.items.some(item => item.useTreg && item.missing.length > 0) && <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Skipped where no account is saved: {plan.items.filter(item => item.useTreg && item.missing.length).map(item => `${item.name} (${item.missing.map(platform => TREG_PLATFORM_SPECS[platform].label).join(', ')})`).join('; ')}.</p>}
    </>}

    {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    {jobs.length > 0 && <div className="mt-4 border-t border-[var(--mos-border)] pt-3">
      <ul className="space-y-1.5">{jobs.map(job => <JobLine key={job.id} job={job} />)}</ul>
      {!active && <p className="mt-2 text-xs text-[var(--mos-text-muted)]" data-testid="refresh-batch-summary">
        {done.length} of {jobs.length} refreshed{jobs.some(job => job.status === 'failed') ? `, ${jobs.filter(job => job.status === 'failed').length} failed` : ''}.
        {' '}Actual treg cost: {tregDone ? `${microUsd(actualMicro)} for ${tregDone} competitor${tregDone === 1 ? '' : 's'}` : '$0 (free sources)'}.
      </p>}
    </div>}
  </Panel>;
}
