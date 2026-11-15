'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FormField, LoadingState, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextArea, TextInput,
} from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import { TREND_THEMES, TREND_THEME_LABELS, TREND_WINDOWS, type TrendItem, type TrendsDigestResult } from '@/lib/partnership/trends';

type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed';
type Run = {
  id: string; trigger: string; status: RunStatus; progress: number; message: string; windowDays: number | null;
  windowStart: string | null; windowEnd: string | null; model: string | null; error: string | null; createdAt: string; finishedAt: string | null;
  result: TrendsDigestResult | null;
};
type Brand = { id: string; name: string; website: string | null; newsroomUrl: string | null; searchTerms: string[]; notes: string | null; active: boolean };
type Overview = { latest: Run | null; history: Run[]; running: Run | null; brands: Brand[]; canDelete: boolean };
type BrandForm = { name: string; website: string; newsroomUrl: string; searchTerms: string; notes: string; active: boolean };

const EMPTY_BRAND: BrandForm = { name: '', website: '', newsroomUrl: '', searchTerms: '', notes: '', active: true };
const when = (value: string | null) => (value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const isRunning = (run: Run | null | undefined) => run?.status === 'queued' || run?.status === 'running';
const toForm = (brand: Brand): BrandForm => ({ name: brand.name, website: brand.website || '', newsroomUrl: brand.newsroomUrl || '', searchTerms: brand.searchTerms.join(', '), notes: brand.notes || '', active: brand.active });

function ItemCard({ item }: { item: TrendItem }) {
  return <li id={`item-${item.id}`} className="scroll-mt-24 rounded-[6px] border border-[var(--mos-border)] p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mos-text-faint)]">
      <span className="font-mono">{item.id}</span>
      <StatusBadge tone="info">{item.brand}</StatusBadge>
      {item.date && <span>{item.date}</span>}
    </div>
    <p className="mt-1.5 font-medium text-[var(--mos-text)]">{item.title}</p>
    {item.summary && <p className="mt-1 text-[var(--mos-text-secondary)]">{item.summary}</p>}
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {item.sources.map(source => source.url && <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer nofollow" title={source.url} className="text-xs text-[var(--mos-accent-soft)] hover:underline">
        Source: {source.title.slice(0, 80)}
      </a>)}
    </div>
  </li>;
}

function ItemChips({ ids, items }: { ids: string[]; items: Map<string, TrendItem> }) {
  return <span className="flex flex-wrap gap-1.5">
    {ids.map(id => {
      const item = items.get(id);
      return item ? <a key={id} href={`#item-${id}`} title={item.title} className="rounded border border-[var(--mos-border)] px-1.5 py-0.5 text-[11px] text-[var(--mos-accent-soft)] hover:border-[var(--mos-border-strong)]">{id} · {item.brand}</a> : null;
    })}
  </span>;
}

function BrandFields({ form, setForm }: { form: BrandForm; setForm: (next: BrandForm) => void }) {
  return <div className="grid gap-3 md:grid-cols-2">
    <FormField label="Brand" required><TextInput value={form.name} maxLength={60} onChange={event => setForm({ ...form, name: event.target.value })} /></FormField>
    <FormField label="Other names" hint="Comma-separated, used for news search (for example IG Group)"><TextInput value={form.searchTerms} onChange={event => setForm({ ...form, searchTerms: event.target.value })} /></FormField>
    <FormField label="Website" hint="Official site only. Leave blank if unsure."><TextInput value={form.website} placeholder="https://" spellCheck={false} onChange={event => setForm({ ...form, website: event.target.value })} /></FormField>
    <FormField label="Newsroom / blog URL" hint="Official press, news, or blog listing. This page is crawled."><TextInput value={form.newsroomUrl} placeholder="https://" spellCheck={false} onChange={event => setForm({ ...form, newsroomUrl: event.target.value })} /></FormField>
    <FormField label="Notes" className="md:col-span-2"><TextArea rows={2} maxLength={1000} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></FormField>
    <label className="flex items-center gap-2 text-sm text-[var(--mos-text-secondary)]"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Include in digests</label>
  </div>;
}

export default function GlobalTrendsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shown, setShown] = useState<Run | null>(null);
  const [windowDays, setWindowDays] = useState<number>(30);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [newBrand, setNewBrand] = useState<BrandForm | null>(null);
  const [editing, setEditing] = useState<{ id: string; form: BrandForm } | null>(null);

  const load = useCallback(async () => {
    const { ok, data } = await fetchJson<Overview>('/api/partnership/trends');
    if (!ok) { setMessage(data.error || 'Could not load Global Industry Trends.'); return; }
    setOverview(data);
    setShown(current => (current && current.id !== data.latest?.id ? current : data.latest));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const running = overview?.running ?? null;
  useEffect(() => {
    if (!isRunning(running)) return;
    const timer = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const refresh = async () => {
    setMessage('');
    const { ok, data } = await fetchJson<{ id: string }>('/api/partnership/trends', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ windowDays }) });
    setMessage(ok ? `Refresh started for the last ${windowDays} days. It reads Google News and official newsrooms, then summarizes. This takes a few minutes.` : data.error || 'Could not start the refresh.');
    await load();
  };

  const openRun = async (id: string) => {
    const { ok, data } = await fetchJson<{ report: Run }>(`/api/partnership/trends/${encodeURIComponent(id)}`);
    if (!ok) { setMessage(data.error || 'Could not open the digest.'); return; }
    setShown(data.report);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveBrand = async (form: BrandForm, id?: string) => {
    setBusy(true); setMessage('');
    try {
      const { ok, data } = await fetchJson(id ? `/api/partnership/trend-brands/${encodeURIComponent(id)}` : '/api/partnership/trend-brands', {
        method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
      });
      if (!ok) { setMessage(data.error || 'Could not save the brand.'); return; }
      setNewBrand(null); setEditing(null);
      await load();
    } finally { setBusy(false); }
  };

  const removeBrand = async (brand: Brand) => {
    if (!window.confirm(`Remove ${brand.name} from the watchlist?`)) return;
    const { ok, data } = await fetchJson(`/api/partnership/trend-brands/${encodeURIComponent(brand.id)}`, { method: 'DELETE' });
    if (!ok) { setMessage(data.error || 'Could not delete.'); return; }
    await load();
  };

  const result = shown?.result && Array.isArray(shown.result.items) ? shown.result : null;
  const itemsById = useMemo(() => new Map((result?.items || []).map(item => [item.id, item])), [result]);

  if (!overview) return message ? <Panel><p className="text-sm text-red-300">{message}</p></Panel> : <LoadingState label="Loading Global Industry Trends" />;
  const activeCount = overview.brands.filter(brand => brand.active).length;

  return <PageStack>
    <PageHeader
      eyebrow="Partnership / Global Industry Trends"
      title="Global Industry Trends"
      description="What similar brokers worldwide are doing, from Google News and their official newsrooms. Every item links to its source; anything without a source is not shown. A new 30-day digest is built every week."
      actions={<div className="flex items-center gap-2">
        <Select aria-label="Window" value={String(windowDays)} onChange={event => setWindowDays(Number(event.target.value))}>
          {TREND_WINDOWS.map(days => <option key={days} value={days}>Last {days} days</option>)}
        </Select>
        <Button variant="primary" disabled={isRunning(running) || !activeCount} onClick={refresh}>{isRunning(running) ? 'Refreshing…' : 'Refresh'}</Button>
      </div>}
    />
    {message && <Panel padding="compact"><p className="text-sm text-[var(--mos-text-secondary)]">{message}</p></Panel>}
    {isRunning(running) && <Panel padding="compact">
      <p className="text-sm text-[var(--mos-text-secondary)]">{running?.message || 'Running'} ({running?.progress}%) · last {running?.windowDays || 30} days</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[var(--mos-accent)]" style={{ width: `${running?.progress || 0}%` }} /></div>
    </Panel>}

    {!result && <Panel><EmptyState title="No digest yet" description={`Choose a window and click Refresh. ${activeCount} brand(s) are on the watchlist.`} /></Panel>}

    {result && shown && <>
      <Panel>
        <SectionHeader
          title={`Last ${result.windowDays} days (${result.window.start} to ${result.window.end})`}
          description={`Built ${when(shown.finishedAt)} · ${shown.trigger === 'scheduled' ? 'weekly' : 'manual'}${shown.model ? ` · ${shown.model}` : ''} · ${result.items.length} cited item(s) from ${result.brands.length} watched brand(s)`}
          className="mb-3"
        />
        {shown.id !== overview.latest?.id && <p className="mb-2 text-xs text-amber-200">You are viewing an older digest. <button type="button" className="underline" onClick={() => setShown(overview.latest)}>Show the latest</button></p>}
        {result.summary && <p className="text-sm leading-6 text-[var(--mos-text-secondary)]">{result.summary}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {TREND_THEMES.map(theme => <a key={theme} href={`#theme-${theme}`}><StatusBadge tone={result.counts[theme] ? 'info' : 'neutral'}>{TREND_THEME_LABELS[theme]}: {result.counts[theme]}</StatusBadge></a>)}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionHeader title="Top trends this period" description="Patterns across brands. Each one lists the items it is based on." className="mb-3" />
          {!result.topTrends.length && <p className="text-sm text-[var(--mos-text-muted)]">No cited trends in this digest.</p>}
          <ol className="space-y-4">
            {result.topTrends.map((trend, index) => <li key={`${trend.title}-${index}`} className="text-sm">
              <p className="font-medium text-[var(--mos-text)]">{index + 1}. {trend.title}</p>
              {trend.detail && <p className="mt-1 text-[var(--mos-text-secondary)]">{trend.detail}</p>}
              <div className="mt-1.5"><ItemChips ids={trend.itemIds} items={itemsById} /></div>
            </li>)}
          </ol>
        </Panel>
        <Panel>
          <SectionHeader title="Ideas for Dupoin (Indonesia, BAPPEBTI-compliant)" description="Drafts for the team. Each idea cites the trend items that inspired it. Review with Compliance before use." className="mb-3" />
          {!result.ideas.length && <p className="text-sm text-[var(--mos-text-muted)]">No cited ideas in this digest.</p>}
          <ul className="space-y-4">
            {result.ideas.map((idea, index) => <li key={`${idea.title}-${index}`} className="text-sm">
              <p className="font-medium text-[var(--mos-text)]">{idea.title}</p>
              {idea.detail && <p className="mt-1 text-[var(--mos-text-secondary)]">{idea.detail}</p>}
              {idea.complianceNote && <p className="mt-1 text-xs text-amber-200">{idea.complianceNote}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--mos-text-faint)]">Inspired by <ItemChips ids={idea.itemIds} items={itemsById} /></div>
            </li>)}
          </ul>
        </Panel>
      </div>

      {TREND_THEMES.map(theme => {
        const items = result.items.filter(item => item.theme === theme);
        if (!items.length) return null;
        return <Panel key={theme}>
          <div id={`theme-${theme}`} className="scroll-mt-24"><SectionHeader title={`${TREND_THEME_LABELS[theme]} (${items.length})`} className="mb-3" /></div>
          <ul className="grid gap-3 md:grid-cols-2">{items.map(item => <ItemCard key={item.id} item={item} />)}</ul>
        </Panel>;
      })}
      {TREND_THEMES.some(theme => !result.counts[theme]) && <p className="text-xs text-[var(--mos-text-faint)]">No cited items this period for: {TREND_THEMES.filter(theme => !result.counts[theme]).map(theme => TREND_THEME_LABELS[theme]).join(', ')}.</p>}

      {result.notes.length > 0 && <Panel padding="compact">
        <details>
          <summary className="cursor-pointer text-sm text-[var(--mos-text-secondary)]">How this digest was built ({result.notes.length} note(s))</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--mos-text-muted)]">{result.notes.map(note => <li key={note}>{note}</li>)}</ul>
        </details>
      </Panel>}
    </>}

    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader title={`Global brand watchlist (${activeCount} active)`} description="Brands the digest searches for. Newsroom URLs are crawled with the same safety checks as Website Audit." />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowWatchlist(value => !value)}>{showWatchlist ? 'Hide' : 'Show'} watchlist</Button>
          <Button size="sm" variant="primary" onClick={() => { setShowWatchlist(true); setNewBrand(newBrand ? null : EMPTY_BRAND); }}>{newBrand ? 'Cancel' : 'Add brand'}</Button>
        </div>
      </div>
      {newBrand && <div className="mt-4">
        <BrandFields form={newBrand} setForm={setNewBrand} />
        <div className="mt-3"><Button variant="primary" disabled={busy || !newBrand.name.trim()} onClick={() => saveBrand(newBrand)}>Save brand</Button></div>
      </div>}
      {showWatchlist && <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
            <tr><th className="p-3">Brand</th><th className="p-3">Website</th><th className="p-3">Newsroom / blog</th><th className="p-3">Status</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {overview.brands.map(brand => <tr key={brand.id} className="border-b border-[var(--mos-border)] align-top text-[var(--mos-text-secondary)]">
              {editing?.id === brand.id
                ? <td colSpan={5} className="p-3">
                  <BrandFields form={editing.form} setForm={form => setEditing({ id: brand.id, form })} />
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="primary" disabled={busy || !editing.form.name.trim()} onClick={() => saveBrand(editing.form, brand.id)}>Save</Button>
                    <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </td>
                : <>
                  <td className="p-3"><p className="font-medium text-[var(--mos-text)]">{brand.name}</p>{brand.searchTerms.length > 0 && <p className="text-xs text-[var(--mos-text-faint)]">Also: {brand.searchTerms.join(', ')}</p>}{brand.notes && <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{brand.notes}</p>}</td>
                  <td className="p-3 text-xs">{brand.website ? <a className="text-[var(--mos-accent-soft)] hover:underline" href={brand.website} target="_blank" rel="noopener noreferrer nofollow">{brand.website}</a> : '—'}</td>
                  <td className="p-3 text-xs">{brand.newsroomUrl ? <a className="text-[var(--mos-accent-soft)] hover:underline" href={brand.newsroomUrl} target="_blank" rel="noopener noreferrer nofollow">{brand.newsroomUrl}</a> : <span className="text-amber-200">None (news only)</span>}</td>
                  <td className="p-3"><StatusBadge tone={brand.active ? 'success' : 'neutral'}>{brand.active ? 'Active' : 'Off'}</StatusBadge></td>
                  <td className="p-3 text-right"><span className="flex justify-end gap-2">
                    <Button size="sm" onClick={() => setEditing({ id: brand.id, form: toForm(brand) })}>Edit</Button>
                    {overview.canDelete && <Button size="sm" variant="ghost" onClick={() => removeBrand(brand)}>Delete</Button>}
                  </span></td>
                </>}
            </tr>)}
          </tbody>
        </table>
        {!overview.brands.length && <p className="p-3 text-sm text-[var(--mos-text-muted)]">No brands yet.</p>}
      </div>}
    </Panel>

    {overview.history.length > 0 && <DataTableFrame title="Digest history" description="Open an older digest to compare periods.">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
          <tr><th className="p-3">Started</th><th className="p-3">Window</th><th className="p-3">Trigger</th><th className="p-3">Status</th><th className="p-3">Detail</th><th className="p-3"></th></tr>
        </thead>
        <tbody>
          {overview.history.map(run => <tr key={run.id} className={`border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)] ${run.id === shown?.id ? 'bg-white/[0.04]' : ''}`}>
            <td className="p-3 text-xs">{when(run.createdAt)}</td>
            <td className="p-3 text-xs">{run.windowDays ? `${run.windowDays} days` : '—'}{run.windowStart && ` (${run.windowStart} to ${run.windowEnd})`}</td>
            <td className="p-3 text-xs">{run.trigger === 'scheduled' ? 'Weekly' : 'Manual'}</td>
            <td className="p-3 text-xs"><StatusBadge tone={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : 'info'}>{run.status}</StatusBadge></td>
            <td className="max-w-[320px] truncate p-3 text-xs" title={run.error || run.message}>{run.error || run.message}</td>
            <td className="p-3 text-right">{run.status === 'succeeded' && <Button size="sm" onClick={() => openRun(run.id)}>Open</Button>}</td>
          </tr>)}
        </tbody>
      </table>
    </DataTableFrame>}
  </PageStack>;
}
