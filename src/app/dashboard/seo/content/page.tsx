'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Button, DataTableFrame, FilterGroup, LoadingState, PageHeader, PageStack, Panel, Select, StatusBadge, TextArea, TextInput, Toolbar,
} from '@/components/ui/dashboard';
import { fetchJson, useSeoSites } from '@/components/seo/useSeoSites';
import { CONTENT_STATUSES, type ContentStatus } from '@/lib/seo/content-status';
import { ContentStatusBadge, STATUS_LABELS } from '@/components/seo/ContentStatusBadge';

type Draft = {
  id: string; keyword: string; title: string; status: ContentStatus; current_version: number; word_count: number;
  model: string | null; fallback_label: string | null; published_url: string | null; created_by_name: string | null; updated_at: string;
};
type QueueItem = { id: string; keyword: string; opportunity_type: string; target_page_url: string | null; note: string | null; requested_by_name: string | null; created_at: string };
type Guideline = { id: string; brand_name: string };
type Filter = ContentStatus | 'all';

const EMPTY_FORM = { keyword: '', targetPageUrl: '', caseStudy: '', instructions: '', brandGuidelineId: 'default', queueItemId: '' };

export default function ContentStudioPage() {
  const router = useRouter();
  const { data: sitesData, site, siteId, setSiteId, error: sitesError, loading } = useSeoSites();
  const [filter, setFilter] = useState<Filter>('all');
  const [version, setVersion] = useState(0);
  const [list, setList] = useState<{ key: string; drafts: Draft[]; counts: Record<string, number>; error: string } | null>(null);
  const [queue, setQueue] = useState<{ key: string; items: QueueItem[] } | null>(null);
  const [guidelines, setGuidelines] = useState<Guideline[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState<'' | 'ai' | 'blank'>('');
  const [message, setMessage] = useState('');

  const listKey = site ? `siteId=${encodeURIComponent(site.id)}&status=${filter}&v=${version}` : null;

  useEffect(() => {
    if (!listKey || !site) return;
    let cancelled = false;
    fetchJson<{ drafts: Draft[]; counts: Record<string, number> }>(`/api/seo/content?${listKey}`).then(({ ok, data }) => {
      if (!cancelled) setList({ key: listKey, drafts: ok ? data.drafts : [], counts: ok ? data.counts : {}, error: ok ? '' : data.error || 'Could not load articles.' });
    }).catch(() => { if (!cancelled) setList({ key: listKey, drafts: [], counts: {}, error: 'Could not load articles.' }); });
    fetchJson<{ items: QueueItem[] }>(`/api/seo/content-queue?siteId=${encodeURIComponent(site.id)}`).then(({ ok, data }) => {
      if (!cancelled && ok) setQueue({ key: listKey, items: data.items });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [listKey, site]);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ guidelines: Guideline[] }>('/api/brand-guidelines').then(({ ok, data }) => {
      if (!cancelled && ok) setGuidelines(data.guidelines);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const current = list && list.key === listKey ? list : null;
  const queueItems = queue?.items ?? [];
  const pickedQueueItem = queueItems.find(item => item.id === form.queueItemId) ?? null;

  const startFromQueue = (item: QueueItem) => {
    setForm({ ...EMPTY_FORM, brandGuidelineId: form.brandGuidelineId, keyword: item.keyword, targetPageUrl: item.target_page_url ?? '', queueItemId: item.id });
    setMessage(`Started from the queue: "${item.keyword}". Add a case study, then generate.`);
    document.getElementById('new-article')?.scrollIntoView({ behavior: 'smooth' });
  };

  const create = async (mode: 'ai' | 'blank') => {
    if (!site) return;
    setBusy(mode); setMessage(mode === 'ai' ? 'Writing the draft. This can take a minute or two…' : '');
    try {
      const { ok, status, data } = await fetchJson<{ id: string; draftId?: string | null }>('/api/seo/content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, mode, ...form, queueItemId: form.queueItemId || undefined }),
      });
      if (ok) { router.push(`/dashboard/seo/content/${data.id}`); return; }
      if (status === 409 && data.draftId) { router.push(`/dashboard/seo/content/${data.draftId}`); return; }
      setMessage(data.error || 'Could not create the article.');
      setVersion(value => value + 1);
    } catch {
      setMessage('Could not create the article.');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <LoadingState label="Loading Content Studio" />;

  const headerActions = sitesData && sitesData.sites.length > 0 && <Select aria-label="Site" value={siteId} onChange={event => setSiteId(event.target.value)} className="w-auto">
    {sitesData.sites.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactive)'}</option>)}
  </Select>;
  const total = Object.values(current?.counts ?? {}).reduce((sum, value) => sum + value, 0);
  const error = sitesError || current?.error || '';
  const set = (key: keyof typeof EMPTY_FORM) => (event: { target: { value: string } }) => setForm(previous => ({ ...previous, [key]: event.target.value }));

  return <PageStack>
    <PageHeader eyebrow="SEO OS / Content Studio" title="Content Studio" description="Turn a keyword and a case study into an on-brand article, review it, and track it until it is published." actions={headerActions} />

    {error && <Panel><p className="text-sm text-red-300">{error}</p></Panel>}
    {message && <Panel><p className="text-sm text-[var(--mos-text-secondary)]">{message}</p></Panel>}

    {site && <Panel id="new-article">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">New article</h2>
        {pickedQueueItem && <span className="flex items-center gap-2 text-xs text-[var(--mos-text-muted)]">
          <StatusBadge tone="info">From queue: {pickedQueueItem.opportunity_type}</StatusBadge>
          <Button size="sm" variant="ghost" onClick={() => setForm(previous => ({ ...previous, queueItemId: '' }))}>Detach</Button>
        </span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-xs text-[var(--mos-text-muted)]">Target keyword
          <TextInput value={form.keyword} onChange={set('keyword')} placeholder="e.g. lomba cheerleading 2026" maxLength={200} />
        </label>
        <label className="grid gap-1 text-xs text-[var(--mos-text-muted)]">Page to improve (optional)
          <TextInput value={form.targetPageUrl} onChange={set('targetPageUrl')} placeholder={`${site.site_url.replace(/\/$/, '')}/…`} />
        </label>
        <label className="grid gap-1 text-xs text-[var(--mos-text-muted)] md:col-span-2">Case study / first-hand material
          <TextArea rows={6} value={form.caseStudy} onChange={set('caseStudy')} placeholder="Real event details, results, numbers, quotes the article can use. The AI will not invent facts beyond this." />
        </label>
        <label className="grid gap-1 text-xs text-[var(--mos-text-muted)]">Extra instructions (optional)
          <TextInput value={form.instructions} onChange={set('instructions')} placeholder="e.g. Bahasa Indonesia, 1200 words, mention registration deadline" />
        </label>
        <label className="grid gap-1 text-xs text-[var(--mos-text-muted)]">Brand guideline
          <Select value={form.brandGuidelineId} onChange={set('brandGuidelineId')}>
            <option value="default">Dupoin Futures (default)</option>
            {guidelines.map(item => <option key={item.id} value={item.id}>{item.brand_name}</option>)}
          </Select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" disabled={!form.keyword.trim() || !!busy} onClick={() => create('ai')}>{busy === 'ai' ? 'Writing draft…' : 'Generate AI draft'}</Button>
        <Button disabled={!form.keyword.trim() || !!busy} onClick={() => create('blank')}>{busy === 'blank' ? 'Creating…' : 'Start blank'}</Button>
      </div>
    </Panel>}

    {site && <DataTableFrame title={`From Opportunities (${queueItems.length})`} description="Keywords sent from SEO OS Opportunities. Starting a draft moves the item to in progress; publishing marks it done.">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Keyword</th><th className="p-3">Type</th><th className="p-3">Target page</th><th className="p-3">Sent by</th><th className="p-3 text-right" /></tr></thead>
        <tbody>
          {queueItems.map(item => <tr key={item.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
            <td className="p-3 text-white">{item.keyword}</td>
            <td className="p-3">{item.opportunity_type}</td>
            <td className="max-w-[280px] truncate p-3" title={item.target_page_url ?? ''}>{item.target_page_url ?? 'New page'}</td>
            <td className="p-3">{item.requested_by_name ?? '—'}</td>
            <td className="p-3 text-right"><Button size="sm" variant={form.queueItemId === item.id ? 'primary' : 'secondary'} onClick={() => startFromQueue(item)}>Start draft</Button></td>
          </tr>)}
          {!queueItems.length && <tr><td colSpan={5} className="p-8 text-center text-[var(--mos-text-faint)]">Nothing waiting. Send keywords from <Link href="/dashboard/seo/opportunities" className="text-[var(--mos-accent-soft)] hover:underline">Opportunities</Link>.</td></tr>}
        </tbody>
      </table>
    </DataTableFrame>}

    {site && <Toolbar>
      <FilterGroup>
        <Button size="sm" variant={filter === 'all' ? 'primary' : 'secondary'} onClick={() => setFilter('all')}>All ({total})</Button>
        {CONTENT_STATUSES.map(status => <Button key={status} size="sm" variant={filter === status ? 'primary' : 'secondary'} onClick={() => setFilter(status)}>
          {status === 'queued' ? 'Publish queue' : STATUS_LABELS[status]} ({current?.counts[status] ?? 0})
        </Button>)}
      </FilterGroup>
    </Toolbar>}

    {site && <DataTableFrame title={filter === 'queued' ? 'Publish queue' : 'Articles'} description={filter === 'queued' ? 'Approved articles waiting to go live. Publish them in the CMS, then mark them published with the live URL.' : undefined}>
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Article</th><th className="p-3">Status</th><th className="p-3 text-right">Words</th><th className="p-3 text-right">Version</th><th className="p-3">Updated</th></tr></thead>
        <tbody>
          {current?.drafts.map(draft => <tr key={draft.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
            <td className="max-w-[380px] p-3">
              <Link href={`/dashboard/seo/content/${draft.id}`} className="block truncate text-white hover:underline">{draft.title || draft.keyword}</Link>
              <span className="block truncate text-xs text-[var(--mos-text-faint)]">{draft.keyword}{draft.created_by_name ? ` · ${draft.created_by_name}` : ''}</span>
            </td>
            <td className="p-3"><ContentStatusBadge status={draft.status} /></td>
            <td className="p-3 text-right">{draft.word_count.toLocaleString('en-US')}</td>
            <td className="p-3 text-right">v{draft.current_version}</td>
            <td className="p-3">{new Date(draft.updated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
          </tr>)}
          {current && !current.drafts.length && <tr><td colSpan={5} className="p-8 text-center text-[var(--mos-text-faint)]">No articles here yet.</td></tr>}
          {!current && <tr><td colSpan={5} className="p-8 text-center text-[var(--mos-text-faint)]">Loading articles…</td></tr>}
        </tbody>
      </table>
    </DataTableFrame>}
  </PageStack>;
}
