'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FilterGroup, LoadingState, MetricCard, PageHeader, PageStack, Panel, Select, StatusBadge, TextInput, Toolbar,
} from '@/components/ui/dashboard';
import { changeLabel, formatCtr, formatInteger, formatPosition, sparklinePoints } from '@/lib/seo/format';

type ConnectionStatus = 'not-configured' | 'missing-key' | 'never-synced' | 'connected';
type Site = { id: string; name: string; site_url: string; gsc_property: string | null; active: boolean; last_synced_at: string | null; status: ConnectionStatus };
type SitesResponse = { sites: Site[]; defaultSiteId: string | null; isAdmin: boolean; serviceAccount: { configured: boolean; email?: string | null; error?: string | null } };
type Totals = { clicks: number; impressions: number; ctr: number; position: number | null };
type Row = Totals & { key: string };
type Report = {
  range: { current: { start: string; end: string }; previous: { start: string; end: string }; days: number };
  dataThrough: string | null;
  totals: { current: Totals; previous: Totals };
  trend: Array<Totals & { date: string }>;
  topQueries: Row[];
  topPages: Row[];
};
type TrendMetric = 'clicks' | 'impressions' | 'ctr' | 'position';

const RANGE_OPTIONS = [
  ['7d', 'Last 7 days'], ['28d', 'Last 28 days'], ['90d', 'Last 3 months'], ['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['16m', 'Last 16 months'], ['custom', 'Custom range'],
] as const;

const STATUS_BADGE: Record<ConnectionStatus, { label: string; tone: 'neutral' | 'warning' | 'info' | 'success' }> = {
  'not-configured': { label: 'Not connected', tone: 'warning' },
  'missing-key': { label: 'Service account missing', tone: 'warning' },
  'never-synced': { label: 'Awaiting first sync', tone: 'info' },
  connected: { label: 'Connected', tone: 'success' },
};

async function fetchJson(url: string): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

export default function SeoOverviewPage() {
  const [sitesData, setSitesData] = useState<SitesResponse | null>(null);
  const [siteId, setSiteId] = useState('');
  const [range, setRange] = useState('28d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [queryFilter, setQueryFilter] = useState('');
  const [pageFilter, setPageFilter] = useState('');
  const [applied, setApplied] = useState({ query: '', page: '' });
  const [reportState, setReportState] = useState<{ key: string; report: Report | null; error: string } | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('clicks');
  const [sitesVersion, setSitesVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchJson('/api/seo/sites').then(({ ok, data }) => {
      if (cancelled) return;
      if (!ok) { setError(String(data.error || 'Could not load SEO sites.')); return; }
      const sites = data as unknown as SitesResponse;
      setSitesData(sites);
      setSiteId(current => current || sites.defaultSiteId || sites.sites[0]?.id || '');
    }).catch(() => { if (!cancelled) setError('Could not load SEO sites.'); });
    return () => { cancelled = true; };
  }, [sitesVersion]);

  const site = sitesData?.sites.find(item => item.id === siteId) ?? null;

  const reportQuery = useMemo(() => {
    if (!site || site.status !== 'connected') return null;
    const params = new URLSearchParams({ siteId: site.id });
    if (range === 'custom') {
      if (!customStart || !customEnd) return null;
      params.set('start', customStart); params.set('end', customEnd);
    } else params.set('range', range);
    if (applied.query) params.set('query', applied.query);
    if (applied.page) params.set('page', applied.page);
    return `${params}|${sitesVersion}`;
  }, [site, range, customStart, customEnd, applied, sitesVersion]);

  useEffect(() => {
    if (!reportQuery) return;
    let cancelled = false;
    const [params] = reportQuery.split('|');
    fetchJson(`/api/seo/report?${params}`).then(({ ok, data }) => {
      if (cancelled) return;
      setReportState(ok
        ? { key: reportQuery, report: data as unknown as Report, error: '' }
        : { key: reportQuery, report: null, error: String(data.error || 'Could not load the report.') });
    }).catch(() => { if (!cancelled) setReportState({ key: reportQuery, report: null, error: 'Could not load the report.' }); });
    return () => { cancelled = true; };
  }, [reportQuery]);

  const currentReport = reportQuery && reportState?.key === reportQuery ? reportState : null;
  const report = currentReport?.report ?? null;
  const loadingReport = Boolean(reportQuery) && !currentReport;
  const shownError = error || currentReport?.error || '';

  const syncNow = async () => {
    if (!site) return;
    setSyncing(true); setSyncMessage('');
    try {
      const response = await fetch('/api/seo/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteId: site.id }) });
      const data = await response.json();
      setSyncMessage(response.ok ? `Synced ${data.daysSynced} days (${data.rangeStart} to ${data.rangeEnd}).` : data.error || 'Sync failed.');
      setSitesVersion(version => version + 1);
    } finally {
      setSyncing(false);
    }
  };

  if (!sitesData && !error) return <LoadingState label="Loading SEO OS" />;

  const isAdmin = Boolean(sitesData?.isAdmin);
  const headerActions = <>
    {sitesData && sitesData.sites.length > 0 && <Select aria-label="Site" value={siteId} onChange={event => setSiteId(event.target.value)} className="w-auto">
      {sitesData.sites.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactive)'}</option>)}
    </Select>}
    {isAdmin && site?.gsc_property && <Button variant="primary" onClick={syncNow} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</Button>}
  </>;

  return <PageStack>
    <PageHeader eyebrow="SEO OS / Search Console" title="SEO overview" description="Clicks, impressions, CTR, and position from Google Search Console." actions={headerActions} />

    {shownError && <Panel><p className="text-sm text-red-300">{shownError}</p></Panel>}
    {syncMessage && <Panel><p className="text-sm text-[var(--mos-text-secondary)]">{syncMessage}</p></Panel>}

    {sitesData && !sitesData.sites.length && <Panel padding="none"><EmptyState title="No SEO sites yet" description="Run the SEO OS database migration to add the first site." /></Panel>}

    {site && <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mos-text-muted)]">
      <StatusBadge tone={STATUS_BADGE[site.status].tone} dot>{STATUS_BADGE[site.status].label}</StatusBadge>
      <a href={site.site_url} target="_blank" rel="noreferrer" className="hover:text-[var(--mos-text)]">{site.site_url}</a>
      {site.gsc_property && <span>· Property {site.gsc_property}</span>}
      {site.last_synced_at && <span>· Last synced {new Date(site.last_synced_at).toLocaleString('en-GB')}</span>}
      {report?.dataThrough && <span>· Data through {report.dataThrough}</span>}
    </div>}

    {site && site.status !== 'connected' && <Panel padding="none"><NotConnected site={site} isAdmin={isAdmin} serviceAccount={sitesData!.serviceAccount} /></Panel>}

    {site && site.status === 'connected' && <>
      <Toolbar>
        <FilterGroup>
          <Select aria-label="Date range" value={range} onChange={event => setRange(event.target.value)} className="w-auto">
            {RANGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          {range === 'custom' && <>
            <TextInput type="date" aria-label="Start date" value={customStart} onChange={event => setCustomStart(event.target.value)} className="w-auto" />
            <TextInput type="date" aria-label="End date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} className="w-auto" />
          </>}
          <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setApplied({ query: queryFilter.trim(), page: pageFilter.trim() }); }}>
            <TextInput placeholder="Query contains…" aria-label="Query filter" value={queryFilter} onChange={event => setQueryFilter(event.target.value)} className="w-48" />
            <TextInput placeholder="Page URL contains…" aria-label="Page filter" value={pageFilter} onChange={event => setPageFilter(event.target.value)} className="w-56" />
            <Button type="submit">Apply</Button>
            {(applied.query || applied.page) && <Button onClick={() => { setQueryFilter(''); setPageFilter(''); setApplied({ query: '', page: '' }); }}>Clear</Button>}
          </form>
        </FilterGroup>
        {report && <span className="text-xs text-[var(--mos-text-faint)]">{report.range.current.start} to {report.range.current.end} vs previous {report.range.days} days</span>}
      </Toolbar>

      {loadingReport && !report ? <LoadingState label="Loading report" /> : report && (report.totals.current.impressions === 0 && report.trend.length === 0
        ? <Panel padding="none"><EmptyState title="No Search Console data for this range" description="Pick a longer range, clear filters, or run a sync." /></Panel>
        : <>
          <TotalsCards report={report} />
          <TrendChart report={report} metric={trendMetric} onMetric={setTrendMetric} />
          <div className="grid gap-6 xl:grid-cols-2">
            <TopTable title="Top queries" label="Query" rows={report.topQueries} />
            <TopTable title="Top pages" label="Page" rows={report.topPages} link />
          </div>
        </>)}
    </>}
  </PageStack>;
}

function NotConnected({ site, isAdmin, serviceAccount }: { site: Site; isAdmin: boolean; serviceAccount: SitesResponse['serviceAccount'] }) {
  if (site.status === 'never-synced') {
    return <EmptyState title="Waiting for the first sync" description={isAdmin ? 'The property is set. Use Sync now for the last 5 days, or run npm run seo:sync -- --backfill on the server for 16 months of history.' : 'An admin needs to run the first Search Console sync.'} />;
  }
  if (!isAdmin) return <EmptyState title="Not connected" description="Search Console is not connected for this site yet. Ask an admin to finish the SEO OS setup." />;
  const description = site.status === 'not-configured'
    ? 'Set this site\'s Search Console property (sc-domain:example.com or https://example.com/) in SEO settings.'
    : serviceAccount.error || 'The Search Console service account key is not configured on the server.';
  return <EmptyState title="Not connected" description={description} action={<Link href="/dashboard/seo/settings" className="text-xs text-[var(--mos-accent-soft)] hover:underline">Open SEO settings</Link>} />;
}

function TotalsCards({ report }: { report: Report }) {
  const { current, previous } = report.totals;
  const cards: Array<[string, string, ReturnType<typeof changeLabel>]> = [
    ['Clicks', formatInteger(current.clicks), changeLabel(current.clicks, previous.clicks, 'clicks')],
    ['Impressions', formatInteger(current.impressions), changeLabel(current.impressions, previous.impressions, 'impressions')],
    ['Average CTR', formatCtr(current.ctr), changeLabel(current.ctr, previous.impressions ? previous.ctr : null, 'ctr')],
    ['Average position', formatPosition(current.position), changeLabel(current.position, previous.position, 'position')],
  ];
  return <div className="grid overflow-hidden rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] sm:grid-cols-2 xl:grid-cols-4">
    {cards.map(([label, value, change]) => <MetricCard key={label} label={label} value={value} note="vs previous period"
      trend={<span className={change.good == null ? 'text-[var(--mos-text-faint)]' : change.good ? 'text-emerald-300' : 'text-red-300'}>{change.text}</span>} />)}
  </div>;
}

function TrendChart({ report, metric, onMetric }: { report: Report; metric: TrendMetric; onMetric: (metric: TrendMetric) => void }) {
  const width = 960;
  const height = 220;
  const values = useMemo(() => report.trend.map(point => metric === 'position' ? -(point.position ?? 0) : point[metric]), [report.trend, metric]);
  const points = sparklinePoints(values, width, height, 12);
  const labels: Record<TrendMetric, string> = { clicks: 'Clicks', impressions: 'Impressions', ctr: 'CTR', position: 'Position' };
  return <DataTableFrame title="Trend" description={metric === 'position' ? 'Higher on the chart means a better (lower) position.' : 'Daily totals for the selected range.'} action={
    <div className="flex gap-1">{(Object.keys(labels) as TrendMetric[]).map(key => <Button key={key} size="sm" variant={key === metric ? 'primary' : 'secondary'} onClick={() => onMetric(key)}>{labels[key]}</Button>)}</div>
  }>
    <div className="px-5 py-4">
      {report.trend.length < 2
        ? <p className="py-10 text-center text-xs text-[var(--mos-text-faint)]">Not enough days to draw a trend.</p>
        : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${labels[metric]} trend`} className="h-56 w-full" preserveAspectRatio="none">
          <polyline points={points} fill="none" stroke="var(--mos-accent-soft, #818cf8)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>}
      {report.trend.length >= 2 && <div className="mt-2 flex justify-between text-[11px] text-[var(--mos-text-faint)]"><span>{report.trend[0].date}</span><span>{report.trend[report.trend.length - 1].date}</span></div>}
    </div>
  </DataTableFrame>;
}

function TopTable({ title, label, rows, link = false }: { title: string; label: string; rows: Row[]; link?: boolean }) {
  return <DataTableFrame title={title}>
    <table className="w-full min-w-[560px] text-sm">
      <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
        <tr><th className="p-3">{label}</th><th className="p-3 text-right">Clicks</th><th className="p-3 text-right">Impr.</th><th className="p-3 text-right">CTR</th><th className="p-3 text-right">Pos.</th></tr>
      </thead>
      <tbody>
        {rows.map(row => <tr key={row.key} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
          <td className="max-w-[320px] truncate p-3 text-white" title={row.key}>{link ? <a href={row.key} target="_blank" rel="noreferrer" className="hover:underline">{row.key.replace(/^https?:\/\/[^/]+/, '') || '/'}</a> : row.key}</td>
          <td className="p-3 text-right">{formatInteger(row.clicks)}</td>
          <td className="p-3 text-right">{formatInteger(row.impressions)}</td>
          <td className="p-3 text-right">{formatCtr(row.ctr)}</td>
          <td className="p-3 text-right">{formatPosition(row.position)}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={5} className="p-8 text-center text-[var(--mos-text-faint)]">No rows for this range.</td></tr>}
      </tbody>
    </table>
  </DataTableFrame>;
}
