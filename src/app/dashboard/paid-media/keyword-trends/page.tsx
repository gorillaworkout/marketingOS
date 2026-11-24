'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FilterGroup, LoadingState, PageHeader, PageStack, Panel, Select, StatusBadge, TextInput, Toolbar,
} from '@/components/ui/dashboard';
import { sparklinePoints } from '@/lib/seo/format';
import { formatCount, formatMoney } from '@/lib/google-ads/format';
import type { KeywordSummary, TrendDirection } from '@/lib/keyword-trends/metrics';
import { filterAndSortKeywords, type SortKey } from '@/lib/keyword-trends/table';

type Snapshot = {
  id: string; status: 'running' | 'succeeded' | 'failed'; trigger: string; triggeredBy: string | null; reportDate: string; accountName: string; currencyCode: string;
  ideasCount: number; rowsCount: number; firstMonth: string | null; lastMonth: string | null; error: string | null; startedAt: string; finishedAt: string | null;
};
type Data = {
  configured: boolean; missing: string[];
  config: { seedKeywords: string[]; pageUrl: string; marketName: string; languageName: string; maxIdeas: number };
  snapshot: Snapshot | null; runs: Snapshot[]; running: Snapshot | null; months: string[]; keywords: KeywordSummary[];
};

const RUN_TONE: Record<string, 'success' | 'danger' | 'info'> = { succeeded: 'success', failed: 'danger', running: 'info' };
const TREND_TONE: Record<TrendDirection, 'success' | 'danger' | 'info' | 'neutral'> = { RISING: 'success', FALLING: 'danger', NEW: 'info', STABLE: 'neutral' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' : 'never');
const monthLabel = (month: string | null) => (month ? new Date(`${month}T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const money = (value: number | null, currency: string) => (value === null ? '—' : formatMoney(value, currency || 'IDR'));
const signed = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatCount(Math.abs(value))}`);
const percent = (value: number | null) => (value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}%`);

async function requestData(): Promise<{ ok: boolean; status: number; body: Data & { error?: string } }> {
  const response = await fetch('/api/paid-media/keyword-trends', { cache: 'no-store' });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) as Data & { error?: string } };
}

const COLUMNS: Array<{ key: SortKey; label: string; right?: boolean }> = [
  { key: 'keyword', label: 'Keyword' },
  { key: 'avgMonthlySearches', label: 'Avg monthly searches', right: true },
  { key: 'lastMonthSearches', label: 'Last month', right: true },
  { key: 'momChangeAbs', label: 'MoM', right: true },
  { key: 'momChangePct', label: 'MoM %', right: true },
  { key: 'trendDirection', label: 'Trend' },
  { key: 'competition', label: 'Competition' },
  { key: 'lowTopOfPageBid', label: 'CPC low', right: true },
  { key: 'highTopOfPageBid', label: 'CPC high', right: true },
];

export default function KeywordTrendsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [starting, setStarting] = useState(false);
  const [text, setText] = useState('');
  const [trend, setTrend] = useState<TrendDirection | 'all'>('all');
  const [competition, setCompetition] = useState('all');
  const [minVolume, setMinVolume] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'avgMonthlySearches', desc: true });
  const [selected, setSelected] = useState<string | null>(null);

  const apply = useCallback((result: { ok: boolean; status: number; body: Data & { error?: string } }) => {
    if (!result.ok) { setError(result.body.error || `Could not load Keyword Trends (${result.status}).`); return; }
    setError('');
    setData(result.body);
  }, []);
  const load = useCallback(async () => apply(await requestData()), [apply]);

  useEffect(() => {
    let cancelled = false;
    requestData().then(result => { if (!cancelled) apply(result); }).catch(() => { if (!cancelled) setError('Could not load Keyword Trends.'); });
    return () => { cancelled = true; };
  }, [apply]);
  // Poll while a fetch is running.
  useEffect(() => {
    if (!data?.running) return;
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  }, [data?.running, load]);

  const fetchNow = async () => {
    setStarting(true);
    setMessage('');
    const response = await fetch('/api/paid-media/keyword-trends/fetch', { method: 'POST' });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setStarting(false);
    setMessage(response.ok ? 'Fetch started. It usually takes under a minute; this page updates when it is done.' : body.error || `Could not start the fetch (${response.status}).`);
    await load();
  };

  const rows = useMemo(() => filterAndSortKeywords(data?.keywords ?? [], {
    text, trend, competition, minVolume: minVolume.trim() === '' || !Number.isFinite(Number(minVolume)) ? null : Number(minVolume),
  }, sort), [data?.keywords, text, trend, competition, minVolume, sort]);
  const competitionOptions = useMemo(() => [...new Set((data?.keywords ?? []).map(row => row.competition ?? 'UNSPECIFIED'))].sort(), [data?.keywords]);

  if (!data && !error) return <LoadingState label="Loading Keyword Trends" />;

  const snapshot = data?.snapshot ?? null;
  const lastRun = data?.runs[0] ?? null;
  const running = data?.running ?? null;
  const currency = snapshot?.currencyCode || 'IDR';
  const chosen = selected ? data?.keywords.find(row => row.keyword === selected) ?? null : null;

  return <PageStack>
    <PageHeader eyebrow="Paid Media" title="Keyword Trends"
      description="Monthly Google search volume, trend, competition, and top-of-page CPC for keyword ideas from Google Ads Keyword Planner. Read-only and free; nothing in Google Ads is changed."
      actions={<>
        {snapshot && <a href={`/api/paid-media/keyword-trends/export?snapshot=${encodeURIComponent(snapshot.id)}`} className="inline-flex h-9 items-center whitespace-nowrap rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-sm text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]">Export Excel (3 months)</a>}
        {data?.configured && <Button variant="primary" onClick={fetchNow} disabled={starting || Boolean(running)}>{running ? 'Fetching…' : starting ? 'Starting…' : 'Fetch now'}</Button>}
      </>} />

    <Panel padding="compact">
      <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--mos-text-muted)]">
        <li>Keyword ideas come from the seed keyword <strong>{data?.config.seedKeywords.join(', ')}</strong> and the site <strong>{data?.config.pageUrl}</strong>, for {data?.config.marketName} in {data?.config.languageName} on Google Search (up to {data?.config.maxIdeas} keywords). These settings are fixed.</li>
        <li>Data is fetched automatically on the 3rd of every month at 06:00 WIB, and whenever you press Fetch now. Google updates Keyword Planner volumes once a month, and the latest month is usually the previous calendar month. Each fetch is kept as a snapshot; this page shows the latest one.</li>
        <li>MoM compares the last month with the month before. Trend: RISING, FALLING, STABLE, or NEW (0 searches the month before). CPC low/high is Google&apos;s top-of-page bid range in {currency}. Click a keyword to see its 12-month volume.</li>
      </ul>
    </Panel>

    {error && <Panel><p className="text-sm text-red-300">{error}</p></Panel>}
    {message && <Panel><p className="text-sm text-[var(--mos-text-secondary)]">{message}</p></Panel>}

    {data && !data.configured && <Panel padding="none"><EmptyState title="Google Ads is not connected yet"
      description={`The server is missing Google Ads API credentials (${data.missing.join(', ')}). An admin needs to add them to .env.local and restart MarketingOS.`} /></Panel>}

    {data && <Panel padding="compact">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[var(--mos-text-muted)]">
        <span>Snapshot: <span className="text-[var(--mos-text-secondary)]">{snapshot ? `${snapshot.reportDate} (${monthLabel(snapshot.firstMonth)} to ${monthLabel(snapshot.lastMonth)}, ${formatCount(snapshot.ideasCount)} keywords)` : 'none yet'}</span></span>
        <span className="flex items-center gap-2">Last fetch:
          {running ? <StatusBadge tone="info" dot>running since {when(running.startedAt)}</StatusBadge>
            : lastRun ? <><StatusBadge tone={RUN_TONE[lastRun.status] ?? 'neutral'} dot>{lastRun.status}</StatusBadge><span className="text-[var(--mos-text-secondary)]">{when(lastRun.finishedAt ?? lastRun.startedAt)} ({lastRun.trigger}{lastRun.triggeredBy ? ` by ${lastRun.triggeredBy}` : ''})</span></>
              : <span className="text-[var(--mos-text-secondary)]">never</span>}
        </span>
        {snapshot?.accountName && <span>Account: <span className="text-[var(--mos-text-secondary)]">{snapshot.accountName}</span></span>}
      </div>
      {lastRun?.status === 'failed' && lastRun.error && <p className="mt-2 text-xs text-red-300">Last fetch failed: {lastRun.error}</p>}
    </Panel>}

    {data?.configured && !snapshot && !running && <Panel padding="none"><EmptyState title="No Keyword Trends data yet" description="Press Fetch now to pull keyword ideas and 12 months of search volume. It takes under a minute." /></Panel>}

    {chosen && <KeywordChart keyword={chosen} months={data?.months ?? []} onClose={() => setSelected(null)} />}

    {snapshot && <>
      <Toolbar>
        <FilterGroup>
          <TextInput placeholder="Filter keywords…" aria-label="Filter keywords" value={text} onChange={event => setText(event.target.value)} className="h-9 w-56" />
          <Select aria-label="Trend" value={trend} onChange={event => setTrend(event.target.value as TrendDirection | 'all')} className="w-auto">
            <option value="all">All trends</option>
            {(['RISING', 'FALLING', 'STABLE', 'NEW'] as const).map(value => <option key={value} value={value}>{value}</option>)}
          </Select>
          <Select aria-label="Competition" value={competition} onChange={event => setCompetition(event.target.value)} className="w-auto">
            <option value="all">All competition</option>
            {competitionOptions.map(value => <option key={value} value={value}>{value}</option>)}
          </Select>
          <TextInput type="number" min={0} placeholder="Min avg volume" aria-label="Minimum avg monthly searches" value={minVolume} onChange={event => setMinVolume(event.target.value)} className="h-9 w-40" />
        </FilterGroup>
        <span className="text-xs text-[var(--mos-text-faint)]">{formatCount(rows.length)} of {formatCount(data?.keywords.length ?? 0)} keywords</span>
      </Toolbar>

      <DataTableFrame title={`Keywords (${monthLabel(snapshot.lastMonth)})`} description="Sorted by avg monthly searches by default. Click a column to sort, click a keyword for its 12-month chart.">
        <div className="max-h-[640px] overflow-y-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="sticky top-0 border-b border-[var(--mos-border)] bg-[var(--mos-panel)] text-left text-xs text-[var(--mos-text-faint)]">
              <tr>{COLUMNS.map(column => <th key={column.key} className={`p-3 ${column.right ? 'text-right' : ''}`}>
                <button type="button" className="uppercase tracking-wide hover:text-[var(--mos-text)]" onClick={() => setSort(value => ({ key: column.key, desc: value.key === column.key ? !value.desc : column.key !== 'keyword' }))}>
                  {column.label}{sort.key === column.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                </button>
              </th>)}</tr>
            </thead>
            <tbody>
              {rows.map(row => <tr key={row.keyword} className={`border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)] ${row.keyword === selected ? 'bg-white/[0.04]' : ''}`}>
                <td className="max-w-[340px] truncate p-3" title={row.keyword}>
                  <button type="button" className="text-left text-white hover:underline" onClick={() => setSelected(row.keyword === selected ? null : row.keyword)}>{row.keyword}</button>
                  {row.isSeedKeyword && <span className="ml-2 text-[11px] text-[var(--mos-text-faint)]">seed</span>}
                </td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">{formatCount(row.avgMonthlySearches)}</td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">{row.lastMonthSearches === null ? '—' : formatCount(row.lastMonthSearches)}</td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">{signed(row.momChangeAbs)}</td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">{percent(row.momChangePct)}</td>
                <td className="whitespace-nowrap p-3">{row.trendDirection ? <StatusBadge tone={TREND_TONE[row.trendDirection]}>{row.trendDirection}</StatusBadge> : '—'}</td>
                <td className="whitespace-nowrap p-3">{row.competition ?? '—'}{row.competitionIndex !== null ? <span className="ml-1 text-[11px] text-[var(--mos-text-faint)]">({row.competitionIndex})</span> : null}</td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">{money(row.lowTopOfPageBid, currency)}</td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">{money(row.highTopOfPageBid, currency)}</td>
              </tr>)}
              {!rows.length && <tr><td colSpan={COLUMNS.length} className="p-8 text-center text-[var(--mos-text-faint)]">No keywords match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </DataTableFrame>
    </>}
  </PageStack>;
}

function KeywordChart({ keyword, months, onClose }: { keyword: KeywordSummary; months: string[]; onClose: () => void }) {
  const width = 960;
  const height = 220;
  const points = months.map((month, index) => ({ month, value: keyword.series[index] })).filter((point): point is { month: string; value: number } => point.value !== null).slice(-12);
  const line = sparklinePoints(points.map(point => point.value), width, height, 12);
  const peak = points.reduce((max, point) => Math.max(max, point.value), 0);
  return <DataTableFrame title={`“${keyword.keyword}”: monthly searches`} description={`Last ${points.length} months. Avg ${formatCount(keyword.avgMonthlySearches)}, peak ${formatCount(peak)}.`}
    action={<Button size="sm" onClick={onClose}>Close</Button>}>
    <div className="px-5 py-4">
      {points.length < 2
        ? <p className="py-10 text-center text-xs text-[var(--mos-text-faint)]">Not enough months to draw a trend.</p>
        : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Monthly searches for ${keyword.keyword}`} className="h-56 w-full" preserveAspectRatio="none">
          <polyline points={line} fill="none" stroke="var(--mos-accent-soft, #818cf8)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {line.split(' ').map((point, index) => {
            const [x, y] = point.split(',');
            return <circle key={points[index].month} cx={x} cy={y} r="6" fill="transparent"><title>{`${monthLabel(points[index].month)}: ${formatCount(points[index].value)}`}</title></circle>;
          })}
        </svg>}
      {points.length >= 2 && <div className="mt-2 grid text-[11px] text-[var(--mos-text-faint)]" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
        {points.map(point => <span key={point.month} className="text-center tabular-nums">{monthLabel(point.month)}<br />{formatCount(point.value)}</span>)}
      </div>}
    </div>
  </DataTableFrame>;
}
