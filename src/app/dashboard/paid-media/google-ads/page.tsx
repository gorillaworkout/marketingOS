'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button, DataTableFrame, EmptyState, FilterGroup, LoadingState, MetricCard, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextInput, Toolbar,
} from '@/components/ui/dashboard';
import { sparklinePoints } from '@/lib/seo/format';
import { changeVs, formatConversions, formatCount, formatCustomerId, formatMoney, formatRate, presetRange } from '@/lib/google-ads/format';
import { AlertsTab } from '@/components/google-ads/AlertsTab';
import { PaidOrganicTab } from '@/components/google-ads/PaidOrganicTab';
import { SearchTermsTab } from '@/components/google-ads/SearchTermsTab';

type Totals = { impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number; ctr: number; avgCpc: number; costPerConversion: number | null };
type Account = {
  customerId: string; name: string; currencyCode: string; timeZone: string; status: string; testAccount: boolean; source: string; active: boolean;
  lastError: string | null; lastCheckedAt: string | null; lastSyncedAt: string | null; firstSyncedDate: string | null; dataFrom: string | null; dataThrough: string | null;
};
type RunDetail = { customerId: string; name: string; status: string; rows: Record<string, number>; error: string | null; rangeStart: string | null; rangeEnd: string | null };
type Run = {
  id: string; mode: string; status: string; trigger: string; rangeStart: string | null; rangeEnd: string | null; accountsSynced: number; accountsFailed: number;
  rowsUpserted: number; error: string | null; details: RunDetail[]; startedAt: string; finishedAt: string | null;
};
type Overview = { config: { configured: boolean; missing: string[]; invalid: string[]; requiredKeys: string[] }; accounts: Account[]; runs: Run[]; running: Run | null; isAdmin: boolean };
type CampaignRow = Totals & { customerId: string; accountName: string; campaignId: string; campaignName: string; status: string; channelType: string };
type KeywordRow = Totals & { customerId: string; accountName: string; campaignName: string; adGroupName: string; adGroupId: string; criterionId: string; keyword: string; matchType: string; status: string };
type SearchTermRow = Totals & { customerId: string; accountName: string; campaignName: string; adGroupName: string; searchTerm: string; matchType: string; status: string };
type Report = {
  range: { start: string; end: string; days: number; previous: { start: string; end: string } };
  currencies: string[];
  totals: { current: Totals; previous: Totals };
  trend: Array<Totals & { date: string }>;
  campaigns: CampaignRow[]; keywords: KeywordRow[]; searchTerms: SearchTermRow[];
  limits: { tableRows: number };
};
type TrendMetric = 'cost' | 'clicks' | 'impressions' | 'conversions' | 'ctr' | 'avgCpc';
type Tab = 'overview' | 'paid-organic' | 'search-terms' | 'alerts';
type AlertCounts = { open: number; critical: number };

const RANGE_OPTIONS = [['today', 'Today'], ['7d', 'Last 7 days'], ['14d', 'Last 14 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['custom', 'Custom range']] as const;
const RUN_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = { succeeded: 'success', partial: 'warning', failed: 'danger', running: 'info' };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  return { ok: response.ok, status: response.status, data };
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' : 'never');

export default function GoogleAdsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [account, setAccount] = useState('all');
  const [preset, setPreset] = useState('30d');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const [reportState, setReportState] = useState<{ key: string; report: Report | null; error: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [syncMessage, setSyncMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('cost');
  const [tab, setTab] = useState<Tab>('overview');
  const [alertCounts, setAlertCounts] = useState<AlertCounts | null>(null);
  const [alertVersion, setAlertVersion] = useState(0);

  const loadOverview = useCallback(async () => {
    try {
      const { ok, data } = await fetchJson<Overview>('/api/paid-media/google-ads/overview');
      if (!ok) { setOverviewError(data.error || 'Could not load Google Ads.'); return null; }
      setOverview(data); setOverviewError('');
      return data;
    } catch {
      setOverviewError('Could not load Google Ads.');
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchJson<Overview>('/api/paid-media/google-ads/overview').then(({ ok, data }) => {
      if (cancelled) return;
      if (ok) setOverview(data); else setOverviewError(data.error || 'Could not load Google Ads.');
    }).catch(() => { if (!cancelled) setOverviewError('Could not load Google Ads.'); });
    return () => { cancelled = true; };
  }, []);

  // Open alert count for the Alerts tab badge; refreshed after syncs and alert actions.
  useEffect(() => {
    let cancelled = false;
    fetchJson<AlertCounts>('/api/paid-media/google-ads/alerts?summary=1').then(({ ok, data }) => {
      if (cancelled || !ok) return;
      setAlertCounts({ open: data.open, critical: data.critical });
      window.dispatchEvent(new CustomEvent('google-ads-alerts', { detail: data.open }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [version, alertVersion]);

  const running = overview?.running ?? null;
  // Poll while a sync runs; refresh the report when it finishes.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const next = await loadOverview();
      if (next && !next.running) setVersion(value => value + 1);
    }, 4000);
    return () => clearInterval(timer);
  }, [running, loadOverview]);

  const range = useMemo(() => (preset === 'custom' ? (custom.start && custom.end ? custom : null) : presetRange(preset)), [preset, custom]);
  const hasData = Boolean(overview?.accounts.some(item => item.dataThrough));
  const reportKey = range && overview?.config.configured !== undefined && hasData ? `${new URLSearchParams({ start: range.start, end: range.end, account })}|${version}` : null;

  useEffect(() => {
    if (!reportKey) return;
    let cancelled = false;
    const [params] = reportKey.split('|');
    fetchJson<Report>(`/api/paid-media/google-ads/report?${params}`).then(({ ok, data }) => {
      if (cancelled) return;
      setReportState({ key: reportKey, report: ok ? data : null, error: ok ? '' : data.error || 'Could not load the report.' });
    }).catch(() => { if (!cancelled) setReportState({ key: reportKey, report: null, error: 'Could not load the report.' }); });
    return () => { cancelled = true; };
  }, [reportKey]);

  const current = reportKey && reportState?.key === reportKey ? reportState : null;
  const report = current?.report ?? null;
  const selectedAccount = overview?.accounts.find(item => item.customerId === account) ?? null;
  const currency = selectedAccount?.currencyCode || (report?.currencies.length === 1 ? report.currencies[0] : 'IDR');

  const syncNow = async () => {
    setStarting(true); setSyncMessage('');
    try {
      const { ok, data } = await fetchJson<{ accepted?: boolean }>('/api/paid-media/google-ads/sync', { method: 'POST' });
      setSyncMessage(ok ? 'Sync started. Accounts never synced get 90 days of history; others refresh the last 14 days.' : data.error || 'Could not start the sync.');
    } catch {
      setSyncMessage('Could not start the sync.');
    } finally {
      setStarting(false);
      await loadOverview();
    }
  };

  const exportUrl = (kind: string) => range ? `/api/paid-media/google-ads/export?${new URLSearchParams({ kind, start: range.start, end: range.end, account })}` : '#';

  if (!overview && !overviewError) return <LoadingState label="Loading Google Ads" />;

  const configured = overview?.config.configured ?? false;
  const lastRun = overview?.runs[0] ?? null;
  const failedAccounts = overview?.accounts.filter(item => item.lastError && !item.lastError.startsWith('Account status is')) ?? [];

  const headerActions = <>
    {overview && overview.accounts.length > 0 && <Select aria-label="Account" value={account} onChange={event => setAccount(event.target.value)} className="w-auto">
      <option value="all">All accounts</option>
      {overview.accounts.map(item => <option key={item.customerId} value={item.customerId}>{item.name || formatCustomerId(item.customerId)} ({formatCustomerId(item.customerId)})</option>)}
    </Select>}
    {configured && <Button variant="primary" onClick={syncNow} disabled={starting || Boolean(running)}>{running ? 'Syncing…' : starting ? 'Starting…' : 'Sync now'}</Button>}
  </>;

  return <PageStack>
    <PageHeader eyebrow="Paid Media" title="Google Ads"
      description="Spend, impressions, clicks, and conversions for every Google Ads account under the Dupoin MCC. Data is copied read-only from the Google Ads API once a day (free) and on Sync now; nothing in Google Ads is ever changed."
      actions={headerActions} />

    {tab === 'overview' && <Panel padding="compact">
      <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--mos-text-muted)]">
        <li>Dates and spend follow each account&apos;s own time zone and currency (Dupoin accounts: Asia/Jakarta, IDR). Today&apos;s numbers are partial and recent conversions can still change, so the last 14 days are re-pulled on every sync.</li>
        <li>CTR = clicks / impressions. Avg CPC = cost / clicks. Cost / conv. = cost / conversions. KPIs and the trend come from campaign data; the search term table lists terms with at least one click.</li>
        <li>Tables show the top {report?.limits.tableRows ?? 500} rows by cost; Export CSV downloads every row for the selected range and account.</li>
      </ul>
    </Panel>}

    {overviewError && <Panel><p className="text-sm text-red-300">{overviewError}</p></Panel>}
    {syncMessage && <Panel><p className="text-sm text-[var(--mos-text-secondary)]">{syncMessage}</p></Panel>}

    {overview && !configured && <Panel padding="none"><EmptyState title="Google Ads is not connected yet"
      description={`The server is missing Google Ads API credentials. An admin needs to add ${[...overview.config.missing, ...overview.config.invalid].join(', ') || overview.config.requiredKeys.join(', ')} to .env.local on the server and restart MarketingOS.${overview.config.invalid.length ? ` Check the format of: ${overview.config.invalid.join(', ')}.` : ''}`} /></Panel>}

    {overview && <SyncStatus lastRun={lastRun} running={running} accounts={overview.accounts} failedAccounts={failedAccounts} />}

    {overview && configured && !hasData && !running && <Panel padding="none"><EmptyState title="No Google Ads data yet"
      description="Press Sync now to pull the last 90 days for every account. It takes a minute or two; this page updates when it is done." /></Panel>}

    {hasData && <>
      <TabBar tab={tab} onTab={setTab} alertCounts={alertCounts} />
      {tab !== 'alerts' && <Toolbar>
        <FilterGroup>
          <Select aria-label="Date range" value={preset} onChange={event => setPreset(event.target.value)} className="w-auto">
            {RANGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          {preset === 'custom' && <>
            <TextInput type="date" aria-label="Start date" value={custom.start} onChange={event => setCustom(value => ({ ...value, start: event.target.value }))} className="w-auto" />
            <TextInput type="date" aria-label="End date" value={custom.end} onChange={event => setCustom(value => ({ ...value, end: event.target.value }))} className="w-auto" />
          </>}
        </FilterGroup>
        {tab !== 'overview' && range && <span className="text-xs text-[var(--mos-text-faint)]">{range.start} to {range.end}</span>}
        {tab === 'overview' && report && <span className="text-xs text-[var(--mos-text-faint)]">{report.range.start} to {report.range.end} vs previous {report.range.days} days{report.currencies.length > 1 && account === 'all' ? ' · accounts use different currencies; pick one account for exact money totals' : ''}</span>}
      </Toolbar>}

      {tab === 'paid-organic' && <PaidOrganicTab range={range} account={account} currency={currency} version={version} />}
      {tab === 'search-terms' && <SearchTermsTab range={range} account={account} currency={currency} version={version} />}
      {tab === 'alerts' && <AlertsTab account={account} version={version} onChanged={() => setAlertVersion(value => value + 1)} />}

      {tab === 'overview' && alertCounts && alertCounts.open > 0 && <Panel padding="compact">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className={alertCounts.critical ? 'text-red-300' : 'text-amber-200'}>{alertCounts.open} open alert{alertCounts.open === 1 ? '' : 's'}{alertCounts.critical ? ` (${alertCounts.critical} critical)` : ''} from the latest daily check.</span>
          <Button size="sm" onClick={() => setTab('alerts')}>Review alerts</Button>
        </div>
      </Panel>}
      {tab === 'overview' && <>
      {current?.error && <Panel><p className="text-sm text-red-300">{current.error}</p></Panel>}
      {!report && !current?.error && range && <LoadingState label="Loading report" />}
      {report && <>
        <KpiCards report={report} currency={currency} />
        <TrendChart report={report} metric={trendMetric} onMetric={setTrendMetric} currency={currency} exportHref={exportUrl('daily')} />
        <SortableTable<CampaignRow> title="Campaigns" exportHref={exportUrl('campaigns')} rows={report.campaigns} rowKey={row => `${row.customerId}|${row.campaignId}`} currency={currency}
          columns={[
            ...(account === 'all' ? [{ key: 'account', label: 'Account', value: (row: CampaignRow) => row.accountName }] : []),
            { key: 'campaign', label: 'Campaign', value: row => row.campaignName, wide: true },
            { key: 'status', label: 'Status', value: row => row.status, render: row => <StatusText value={row.status} /> },
            { key: 'channel', label: 'Type', value: row => row.channelType, render: row => <span className="text-[var(--mos-text-muted)]">{humanize(row.channelType)}</span> },
          ]} />
        <SortableTable<KeywordRow> title="Keywords" exportHref={exportUrl('keywords')} rows={report.keywords} rowKey={row => `${row.customerId}|${row.adGroupId}|${row.criterionId}`} currency={currency}
          columns={[
            { key: 'keyword', label: 'Keyword', value: row => row.keyword, wide: true },
            { key: 'match', label: 'Match', value: row => row.matchType, render: row => <span className="text-[var(--mos-text-muted)]">{humanize(row.matchType)}</span> },
            { key: 'campaign', label: 'Campaign / ad group', value: row => `${row.campaignName} ${row.adGroupName}`, render: row => <span className="text-[var(--mos-text-muted)]">{row.campaignName}<span className="text-[var(--mos-text-faint)]"> / {row.adGroupName}</span></span> },
          ]} />
        <SortableTable<SearchTermRow> title="Search terms" description="Terms with at least one click in the range." exportHref={exportUrl('search-terms')} rows={report.searchTerms}
          rowKey={row => `${row.customerId}|${row.adGroupName}|${row.searchTerm}|${row.matchType}`} currency={currency}
          columns={[
            { key: 'term', label: 'Search term', value: row => row.searchTerm, wide: true },
            { key: 'match', label: 'Match', value: row => row.matchType, render: row => <span className="text-[var(--mos-text-muted)]">{humanize(row.matchType)}</span> },
            { key: 'campaign', label: 'Campaign / ad group', value: row => `${row.campaignName} ${row.adGroupName}`, render: row => <span className="text-[var(--mos-text-muted)]">{row.campaignName}<span className="text-[var(--mos-text-faint)]"> / {row.adGroupName}</span></span> },
          ]} />
      </>}
      </>}
    </>}
  </PageStack>;
}

const TABS: Array<[Tab, string]> = [['overview', 'Overview'], ['paid-organic', 'Paid vs Organic'], ['search-terms', 'Search term analysis'], ['alerts', 'Alerts']];

function TabBar({ tab, onTab, alertCounts }: { tab: Tab; onTab: (tab: Tab) => void; alertCounts: AlertCounts | null }) {
  return <div role="tablist" aria-label="Google Ads views" className="flex flex-wrap gap-1 border-b border-[var(--mos-border)]">
    {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => onTab(key)}
      className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${tab === key ? 'border-[var(--mos-accent-soft,#818cf8)] text-[var(--mos-text)]' : 'border-transparent text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]'}`}>
      {label}
      {key === 'alerts' && alertCounts && alertCounts.open > 0 && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${alertCounts.critical ? 'bg-red-500/20 text-red-300' : 'bg-amber-400/15 text-amber-200'}`}>{alertCounts.open}</span>}
    </button>)}
  </div>;
}

const humanize = (value: string) => value ? value.toLowerCase().replace(/_/g, ' ').replace(/^./, char => char.toUpperCase()) : '—';

function StatusText({ value }: { value: string }) {
  const tone = value === 'ENABLED' ? 'success' : value === 'PAUSED' ? 'warning' : 'neutral';
  return <StatusBadge tone={tone}>{humanize(value)}</StatusBadge>;
}

function SyncStatus({ lastRun, running, accounts, failedAccounts }: { lastRun: Run | null; running: Run | null; accounts: Account[]; failedAccounts: Account[] }) {
  return <Panel padding="compact">
    <SectionHeader title="Sync status" description={running ? `Sync running since ${when(running.startedAt)}…` : lastRun ? `Last sync ${when(lastRun.finishedAt ?? lastRun.startedAt)} (${lastRun.trigger}, ${lastRun.mode}${lastRun.rangeStart ? `, ${lastRun.rangeStart} to ${lastRun.rangeEnd}` : ''}).` : 'No sync has run yet.'}
      action={lastRun && <StatusBadge tone={RUN_TONE[lastRun.status] ?? 'neutral'} dot>{lastRun.status === 'partial' ? 'Partly failed' : humanize(lastRun.status)}</StatusBadge>} />
    {lastRun?.error && !running && <p className="mt-3 text-xs text-red-300">{lastRun.error}</p>}
    {accounts.length > 0 && <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wide text-[var(--mos-text-faint)]">
          <tr><th className="py-1.5 pr-3">Account</th><th className="py-1.5 pr-3">Customer ID</th><th className="py-1.5 pr-3">Currency</th><th className="py-1.5 pr-3">Data</th><th className="py-1.5 pr-3">Last synced</th><th className="py-1.5">Status</th></tr>
        </thead>
        <tbody>
          {accounts.map(item => <tr key={item.customerId} className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
            <td className="py-1.5 pr-3">{item.name || '—'}{item.testAccount ? ' (test)' : ''}</td>
            <td className="py-1.5 pr-3 tabular-nums">{formatCustomerId(item.customerId)}</td>
            <td className="py-1.5 pr-3">{item.currencyCode || '—'}</td>
            <td className="py-1.5 pr-3">{item.dataFrom ? `${item.dataFrom} to ${item.dataThrough}` : 'No spend data yet'}</td>
            <td className="py-1.5 pr-3">{when(item.lastSyncedAt)}</td>
            <td className="py-1.5">{!item.lastError ? <span className="text-emerald-300">OK</span>
              : item.lastError.startsWith('Account status is') ? <span className="text-amber-200" title={item.lastError}>Skipped: {item.lastError}</span>
              : <span className="text-red-300" title={item.lastError}>Error: {item.lastError}</span>}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}
    {failedAccounts.length > 0 && <p className="mt-2 text-[11px] text-[var(--mos-text-faint)]">Accounts with an error are skipped and retried on the next sync. A permission error means the Google user behind the refresh token cannot read that account.</p>}
  </Panel>;
}

function KpiCards({ report, currency }: { report: Report; currency: string }) {
  const { current, previous } = report.totals;
  const cards: Array<[string, string, ReturnType<typeof changeVs>, string?]> = [
    ['Spend', formatMoney(current.cost, currency, current.cost >= 1e7), changeVs(current.cost, previous.cost, false), formatMoney(current.cost, currency)],
    ['Impressions', formatCount(current.impressions, current.impressions >= 1e6), changeVs(current.impressions, previous.impressions)],
    ['Clicks', formatCount(current.clicks), changeVs(current.clicks, previous.clicks)],
    ['CTR', formatRate(current.ctr), changeVs(current.ctr, previous.impressions ? previous.ctr : null)],
    ['Avg CPC', formatMoney(current.avgCpc, currency), changeVs(current.avgCpc, previous.clicks ? previous.avgCpc : null, true)],
    ['Conversions', formatConversions(current.conversions), changeVs(current.conversions, previous.conversions)],
    ['Cost / conv.', current.costPerConversion == null ? '—' : formatMoney(current.costPerConversion, currency), changeVs(current.costPerConversion, previous.costPerConversion, true)],
  ];
  return <div className="grid overflow-hidden rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
    {cards.map(([label, value, change, title]) => <div key={label} title={title}><MetricCard label={label} value={value} note="vs previous period"
      trend={<span className={change.good == null ? 'text-[var(--mos-text-faint)]' : change.good ? 'text-emerald-300' : 'text-red-300'}>{change.text}</span>} /></div>)}
  </div>;
}

const TREND_LABELS: Record<TrendMetric, string> = { cost: 'Spend', clicks: 'Clicks', impressions: 'Impressions', conversions: 'Conversions', ctr: 'CTR', avgCpc: 'Avg CPC' };

function TrendChart({ report, metric, onMetric, currency, exportHref }: { report: Report; metric: TrendMetric; onMetric: (metric: TrendMetric) => void; currency: string; exportHref: string }) {
  const width = 960;
  const height = 220;
  const values = report.trend.map(point => point[metric]);
  const points = sparklinePoints(values, width, height, 12);
  const format = (value: number) => metric === 'cost' || metric === 'avgCpc' ? formatMoney(value, currency) : metric === 'ctr' ? formatRate(value) : metric === 'conversions' ? formatConversions(value) : formatCount(value);
  const max = values.length ? Math.max(...values) : 0;
  return <DataTableFrame title="Daily trend" description={`Daily ${TREND_LABELS[metric].toLowerCase()} for the selected range. Peak ${format(max)}.`} action={
    <div className="flex flex-wrap gap-1">
      {(Object.keys(TREND_LABELS) as TrendMetric[]).map(key => <Button key={key} size="sm" variant={key === metric ? 'primary' : 'secondary'} onClick={() => onMetric(key)}>{TREND_LABELS[key]}</Button>)}
      <a href={exportHref} className="inline-flex h-8 items-center whitespace-nowrap rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-xs text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]">Export CSV</a>
    </div>
  }>
    <div className="px-5 py-4">
      {report.trend.length < 2
        ? <p className="py-10 text-center text-xs text-[var(--mos-text-faint)]">Not enough days to draw a trend.</p>
        : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${TREND_LABELS[metric]} trend`} className="h-56 w-full" preserveAspectRatio="none">
          <polyline points={points} fill="none" stroke="var(--mos-accent-soft, #818cf8)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {points.split(' ').map((point, index) => {
            const [x, y] = point.split(',');
            const day = report.trend[index];
            return <circle key={day.date} cx={x} cy={y} r="6" fill="transparent"><title>{`${day.date}: ${format(day[metric])}`}</title></circle>;
          })}
        </svg>}
      {report.trend.length >= 2 && <div className="mt-2 flex justify-between text-[11px] text-[var(--mos-text-faint)]"><span>{report.trend[0].date}</span><span>{report.trend[report.trend.length - 1].date}</span></div>}
    </div>
  </DataTableFrame>;
}

type Column<T> = { key: string; label: string; value: (row: T) => string; render?: (row: T) => ReactNode; wide?: boolean };
type MetricKey = 'impressions' | 'clicks' | 'ctr' | 'cost' | 'avgCpc' | 'conversions' | 'costPerConversion';
const METRIC_COLUMNS: Array<{ key: MetricKey; label: string }> = [
  { key: 'cost', label: 'Cost' }, { key: 'impressions', label: 'Impr.' }, { key: 'clicks', label: 'Clicks' }, { key: 'ctr', label: 'CTR' },
  { key: 'avgCpc', label: 'Avg CPC' }, { key: 'conversions', label: 'Conv.' }, { key: 'costPerConversion', label: 'Cost / conv.' },
];

function SortableTable<T extends Totals>({ title, description, rows, columns, rowKey, currency, exportHref }: {
  title: string; description?: string; rows: T[]; columns: Array<Column<T>>; rowKey: (row: T) => string; currency: string; exportHref: string;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'cost', desc: true });
  const [filter, setFilter] = useState('');
  const sorted = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle ? rows.filter(row => columns.some(column => column.value(row).toLowerCase().includes(needle))) : rows;
    const column = columns.find(item => item.key === sort.key);
    const metric = METRIC_COLUMNS.find(item => item.key === sort.key);
    const value = (row: T): number | string => column ? column.value(row).toLowerCase() : metric ? (row[metric.key] ?? -1) : 0;
    return [...filtered].sort((left, right) => {
      const a = value(left); const b = value(right);
      const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
      return sort.desc ? -order : order;
    });
  }, [rows, columns, sort, filter]);
  const header = (key: string, label: string, right = false) => <th className={`p-3 ${right ? 'text-right' : ''}`}>
    <button type="button" className="uppercase tracking-wide hover:text-[var(--mos-text)]" onClick={() => setSort(value => ({ key, desc: value.key === key ? !value.desc : true }))}>
      {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </button>
  </th>;
  const cell = (row: T, key: MetricKey) => {
    if (key === 'cost' || key === 'avgCpc') return formatMoney(row[key], currency);
    if (key === 'costPerConversion') return row.costPerConversion == null ? '—' : formatMoney(row.costPerConversion, currency);
    if (key === 'ctr') return formatRate(row.ctr);
    if (key === 'conversions') return formatConversions(row.conversions);
    return formatCount(row[key]);
  };
  return <DataTableFrame title={`${title} (${rows.length})`} description={description} action={<div className="flex items-center gap-2">
    <TextInput placeholder="Filter…" aria-label={`Filter ${title}`} value={filter} onChange={event => setFilter(event.target.value)} className="h-8 w-44" />
    <a href={exportHref} className="inline-flex h-8 items-center whitespace-nowrap rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-xs text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]">Export CSV</a>
  </div>}>
    <div className="max-h-[560px] overflow-y-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="sticky top-0 border-b border-[var(--mos-border)] bg-[var(--mos-panel)] text-left text-xs text-[var(--mos-text-faint)]">
          <tr>{columns.map(column => <th key={column.key} className="p-0">{header(column.key, column.label)}</th>)}{METRIC_COLUMNS.map(column => <th key={column.key} className="p-0 text-right">{header(column.key, column.label, true)}</th>)}</tr>
        </thead>
        <tbody>
          {sorted.map(row => <tr key={rowKey(row)} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
            {columns.map(column => <td key={column.key} className={`p-3 ${column.wide ? 'max-w-[320px] truncate text-white' : 'whitespace-nowrap'}`} title={column.value(row)}>{column.render ? column.render(row) : column.value(row) || '—'}</td>)}
            {METRIC_COLUMNS.map(column => <td key={column.key} className="whitespace-nowrap p-3 text-right tabular-nums">{cell(row, column.key)}</td>)}
          </tr>)}
          {!sorted.length && <tr><td colSpan={columns.length + METRIC_COLUMNS.length} className="p-8 text-center text-[var(--mos-text-faint)]">No rows for this range.</td></tr>}
        </tbody>
      </table>
    </div>
  </DataTableFrame>;
}
