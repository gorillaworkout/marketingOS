'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FilterGroup, LoadingState, PageHeader, PageStack, Panel, Select, StatusBadge, TextInput, Toolbar,
} from '@/components/ui/dashboard';
import { fetchJson, useSeoSites } from '@/components/seo/useSeoSites';
import { formatCtr, formatInteger, formatPosition } from '@/lib/seo/format';

type Opportunity = {
  query: string; clicks: number; impressions: number; ctr: number; position: number; bestPage: string;
  homepage: boolean; band: 'push' | 're-optimize' | null; tracked: boolean; targetPageUrl: string | null; queued: boolean;
};
type UntargetedKeyword = { id: string; keyword: string; intent: string | null; queued: boolean };
type Report = { range: { start: string; end: string }; dataThrough: string | null; push: Opportunity[]; reoptimize: Opportunity[]; homepage: Opportunity[]; untargetedKeywords: UntargetedKeyword[] };
type QueueItem = { id: string; keyword: string; opportunity_type: string; target_page_url: string | null; requested_by_name: string | null; created_at: string };
type Tab = 'push' | 'reoptimize' | 'no-page';
type SendPayload = { keyword: string; opportunityType: 'push' | 're-optimize' | 'no-page' | 'homepage'; targetPageUrl?: string | null; metrics?: Record<string, unknown> };

const RANGE_OPTIONS: Array<[string, string]> = [['7d', 'Last 7 days'], ['28d', 'Last 28 days'], ['90d', 'Last 3 months'], ['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['16m', 'Last 16 months'], ['custom', 'Custom range']];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function SeoOpportunitiesPage() {
  const { data: sitesData, site, siteId, setSiteId, error: sitesError, loading } = useSeoSites();
  const [range, setRange] = useState('28d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [applied, setApplied] = useState<{ start: string; end: string } | null>(null);
  const [minImpressions, setMinImpressions] = useState('1');
  const [tab, setTab] = useState<Tab>('push');
  const [version, setVersion] = useState(0);
  const [reportState, setReportState] = useState<{ key: string; report: Report | null; error: string } | null>(null);
  const [queue, setQueue] = useState<{ key: string; items: QueueItem[] } | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState('');

  const rangeQuery = range === 'custom' ? (applied ? `start=${applied.start}&end=${applied.end}` : null) : `range=${range}`;
  const reportKey = site && rangeQuery ? `siteId=${encodeURIComponent(site.id)}&${rangeQuery}&minImpressions=${Math.max(1, Math.floor(Number(minImpressions)) || 1)}&v=${version}` : null;
  const customValid = DATE_PATTERN.test(customStart) && DATE_PATTERN.test(customEnd) && customStart <= customEnd;

  useEffect(() => {
    if (!reportKey) return;
    let cancelled = false;
    fetchJson<Report>(`/api/seo/opportunities?${reportKey}`).then(({ ok, data }) => {
      if (cancelled) return;
      setReportState({ key: reportKey, report: ok ? data : null, error: ok ? '' : data.error || 'Could not load opportunities.' });
    }).catch(() => { if (!cancelled) setReportState({ key: reportKey, report: null, error: 'Could not load opportunities.' }); });
    fetchJson<{ items: QueueItem[] }>(`/api/seo/content-queue?siteId=${encodeURIComponent(site!.id)}`).then(({ ok, data }) => {
      if (!cancelled && ok) setQueue({ key: reportKey, items: data.items });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [reportKey, site]);

  const current = reportKey && reportState?.key === reportKey ? reportState : null;
  const report = current?.report ?? null;
  const queueItems = queue?.items ?? [];

  const send = async (payload: SendPayload) => {
    if (!site || !report) return;
    setSending(payload.keyword); setMessage('');
    try {
      const { ok, status, data } = await fetchJson('/api/seo/content-queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id, ...payload, metrics: { ...payload.metrics, rangeStart: report.range.start, rangeEnd: report.range.end } }),
      });
      setMessage(ok ? (status === 201 ? `"${payload.keyword}" sent to Content Studio.` : `"${payload.keyword}" is already waiting in Content Studio.`) : data.error || 'Could not send to Content Studio.');
      setVersion(value => value + 1);
    } finally {
      setSending('');
    }
  };

  const dismiss = async (id: string) => {
    const { ok, data } = await fetchJson('/api/seo/content-queue', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'dismissed' }) });
    if (!ok) setMessage(data.error || 'Could not remove the item.');
    setVersion(value => value + 1);
  };

  const sendQuery = (row: Opportunity, opportunityType: SendPayload['opportunityType']) => send({
    keyword: row.query, opportunityType, targetPageUrl: row.targetPageUrl ?? (row.homepage ? null : row.bestPage),
    metrics: { clicks: row.clicks, impressions: row.impressions, position: row.position, bestPage: row.bestPage },
  });

  const tabs = useMemo(() => [
    ['push', 'Push', report?.push.length ?? 0],
    ['reoptimize', 'Re-optimize', report?.reoptimize.length ?? 0],
    ['no-page', 'No page', (report?.untargetedKeywords.length ?? 0) + (report?.homepage.length ?? 0)],
  ] as Array<[Tab, string, number]>, [report]);

  if (loading) return <LoadingState label="Loading SEO OS" />;

  const headerActions = sitesData && sitesData.sites.length > 0 && <Select aria-label="Site" value={siteId} onChange={event => setSiteId(event.target.value)} className="w-auto">
    {sitesData.sites.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactive)'}</option>)}
  </Select>;
  const error = sitesError || current?.error || '';

  return <PageStack>
    <PageHeader eyebrow="SEO OS / Opportunities" title="Opportunities" description="Queries close to page 1, pages that need a rewrite, and keywords with no page yet." actions={headerActions} />

    {error && <Panel><p className="text-sm text-red-300">{error}</p></Panel>}
    {message && <Panel><p className="text-sm text-[var(--mos-text-secondary)]">{message}</p></Panel>}

    <Panel>
      <p className="text-xs leading-5 text-[var(--mos-text-muted)]">
        Search Console only reports queries that got at least one impression. Keywords you do not rank for at all never show up there, so add them on the <Link href="/dashboard/seo/keywords" className="text-[var(--mos-accent-soft)] hover:underline">Keywords</Link> page; tracked keywords with no target page and no Search Console impressions appear under <strong>No page</strong>.
        Positions are impression-weighted averages, rounded the way Search Console shows them.
      </p>
    </Panel>

    {site && site.status !== 'connected' && <Panel padding="none"><EmptyState title="Search Console is not connected for this site" description="Push and re-optimize need synced Search Console data. Tracked keywords without a page still show under No page." action={<Link href="/dashboard/seo" className="text-xs text-[var(--mos-accent-soft)] hover:underline">Open SEO overview</Link>} /></Panel>}

    {site && <Toolbar>
      <FilterGroup>
        <Select aria-label="Date range" value={range} onChange={event => setRange(event.target.value)} className="w-auto">
          {RANGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        {range === 'custom' && <>
          <TextInput type="date" aria-label="Start date" value={customStart} onChange={event => setCustomStart(event.target.value)} className="w-auto" />
          <TextInput type="date" aria-label="End date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} className="w-auto" />
          <Button size="sm" disabled={!customValid} onClick={() => setApplied({ start: customStart, end: customEnd })}>Apply</Button>
        </>}
        <label className="flex items-center gap-2 text-xs text-[var(--mos-text-muted)]">Min. impressions
          <TextInput type="number" min={1} aria-label="Minimum impressions" value={minImpressions} onChange={event => setMinImpressions(event.target.value)} className="w-24" />
        </label>
        <div className="flex gap-1">{tabs.map(([key, label, count]) => <Button key={key} size="sm" variant={tab === key ? 'primary' : 'secondary'} onClick={() => setTab(key)}>{label} ({count})</Button>)}</div>
      </FilterGroup>
      {report && <span className="text-xs text-[var(--mos-text-faint)]">{report.range.start} to {report.range.end}</span>}
    </Toolbar>}

    {site && range === 'custom' && !applied && <Panel><p className="text-sm text-[var(--mos-text-muted)]">Pick a start and end date, then Apply.</p></Panel>}
    {reportKey && !current && <Panel><p className="text-sm text-[var(--mos-text-muted)]">Loading opportunities…</p></Panel>}

    {report && tab === 'push' && <QueryTable title="Push: position 11-20" description="Page 2 queries with impressions. Strengthen the ranking page to reach page 1." rows={report.push} sending={sending} onSend={row => sendQuery(row, 'push')} />}
    {report && tab === 'reoptimize' && <QueryTable title="Re-optimize: position 21-30" description="Page 3 queries. The ranking page likely needs a rewrite or a better-matched page." rows={report.reoptimize} sending={sending} onSend={row => sendQuery(row, 're-optimize')} />}
    {report && tab === 'no-page' && <>
      <DataTableFrame title="Tracked keywords with no page" description="Imported keywords with no target page URL and no Search Console impressions in this range.">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Keyword</th><th className="p-3">Intent</th><th className="p-3 text-right">Content Studio</th></tr></thead>
          <tbody>
            {report.untargetedKeywords.map(row => <tr key={row.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
              <td className="p-3 text-white">{row.keyword}</td>
              <td className="p-3">{row.intent ?? '—'}</td>
              <td className="p-3 text-right"><SendButton queued={row.queued} busy={sending === row.keyword} onSend={() => send({ keyword: row.keyword, opportunityType: 'no-page' })} /></td>
            </tr>)}
            {!report.untargetedKeywords.length && <tr><td colSpan={3} className="p-8 text-center text-[var(--mos-text-faint)]">No tracked keywords without a page. <Link href="/dashboard/seo/keywords" className="text-[var(--mos-accent-soft)] hover:underline">Import keywords</Link></td></tr>}
          </tbody>
        </table>
      </DataTableFrame>
      <QueryTable title="Queries ranking with the homepage" description="The homepage is the best page for these queries, which usually means no dedicated page exists." rows={report.homepage} sending={sending} onSend={row => sendQuery(row, 'homepage')} />
    </>}

    {site && <DataTableFrame title={`Waiting in Content Studio (${queueItems.length})`} description="Pending items Content Studio will pick up. Remove anything sent by mistake.">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Keyword</th><th className="p-3">Type</th><th className="p-3">Target page</th><th className="p-3">Sent by</th><th className="p-3 text-right" /></tr></thead>
        <tbody>
          {queueItems.map(item => <tr key={item.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
            <td className="p-3 text-white">{item.keyword}</td>
            <td className="p-3">{item.opportunity_type}</td>
            <td className="max-w-[280px] truncate p-3" title={item.target_page_url ?? ''}>{item.target_page_url ?? 'New page'}</td>
            <td className="p-3">{item.requested_by_name ?? '—'}</td>
            <td className="p-3 text-right"><Button size="sm" onClick={() => dismiss(item.id)}>Remove</Button></td>
          </tr>)}
          {!queueItems.length && <tr><td colSpan={5} className="p-8 text-center text-[var(--mos-text-faint)]">Nothing waiting.</td></tr>}
        </tbody>
      </table>
    </DataTableFrame>}
  </PageStack>;
}

function SendButton({ queued, busy, onSend }: { queued: boolean; busy: boolean; onSend: () => void }) {
  if (queued) return <StatusBadge tone="info">Sent</StatusBadge>;
  return <Button size="sm" onClick={onSend} disabled={busy}>{busy ? 'Sending…' : 'Send to Content Studio'}</Button>;
}

function QueryTable({ title, description, rows, sending, onSend }: { title: string; description: string; rows: Opportunity[]; sending: string; onSend: (row: Opportunity) => void }) {
  return <DataTableFrame title={title} description={description}>
    <table className="w-full min-w-[820px] text-sm">
      <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
        <tr><th className="p-3">Query</th><th className="p-3">Best page</th><th className="p-3 text-right">Impr.</th><th className="p-3 text-right">Clicks</th><th className="p-3 text-right">CTR</th><th className="p-3 text-right">Pos.</th><th className="p-3 text-right">Content Studio</th></tr>
      </thead>
      <tbody>
        {rows.map(row => <tr key={row.query} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
          <td className="max-w-[260px] p-3 text-white" title={row.query}>
            <span className="block truncate">{row.query}</span>
            <span className="mt-1 flex gap-1">{row.tracked && <StatusBadge>Tracked</StatusBadge>}{row.homepage && <StatusBadge tone="warning">Homepage</StatusBadge>}</span>
          </td>
          <td className="max-w-[260px] truncate p-3" title={row.bestPage}><a href={row.bestPage} target="_blank" rel="noreferrer" className="hover:underline">{row.bestPage.replace(/^https?:\/\/[^/]+/, '') || '/'}</a></td>
          <td className="p-3 text-right">{formatInteger(row.impressions)}</td>
          <td className="p-3 text-right">{formatInteger(row.clicks)}</td>
          <td className="p-3 text-right">{formatCtr(row.ctr)}</td>
          <td className="p-3 text-right">{formatPosition(row.position)}</td>
          <td className="p-3 text-right"><SendButton queued={row.queued} busy={sending === row.query} onSend={() => onSend(row)} /></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={7} className="p-8 text-center text-[var(--mos-text-faint)]">No queries in this band for the range.</td></tr>}
      </tbody>
    </table>
  </DataTableFrame>;
}
