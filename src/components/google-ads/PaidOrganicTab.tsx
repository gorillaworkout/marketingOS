'use client';

import { useMemo, useState } from 'react';
import { LoadingState, Panel, Select, StatusBadge, Toolbar, FilterGroup } from '@/components/ui/dashboard';
import { formatConversions, formatCount, formatMoney, formatRate } from '@/lib/google-ads/format';
import type { PaidOrganicReport, PaidOrganicRow } from '@/lib/google-ads/paid-organic';
import { Explainer, InsightTable, SummaryCards } from './InsightTable';
import { useInsight } from './useInsight';

type Range = { start: string; end: string };
const FLAG_FILTERS = [['flagged', 'Flagged terms'], ['organic-top3-paying', 'Top 3 organic, still paying'], ['seo-opportunity', 'SEO opportunity'], ['matched', 'Has organic data'], ['all', 'All paid terms']] as const;

export function PaidOrganicTab({ range, account, currency, version }: { range: Range | null; account: string; currency: string; version: number }) {
  const [source, setSource] = useState<'search-terms' | 'keywords'>('search-terms');
  const [show, setShow] = useState<(typeof FLAG_FILTERS)[number][0]>('flagged');
  const params = range ? new URLSearchParams({ start: range.start, end: range.end, account, source }).toString() : null;
  const { data, error, loading } = useInsight<PaidOrganicReport>(params ? `/api/paid-media/google-ads/paid-organic?${params}` : null, version);
  const rows = useMemo(() => (data?.rows ?? []).filter(row =>
    show === 'all' ? true : show === 'matched' ? Boolean(row.organic) : show === 'flagged' ? row.flags.length > 0 : row.flags.includes(show)), [data, show]);
  const money = (value: number) => formatMoney(value, currency);
  const t = data?.thresholds;

  return <>
    <Panel padding="compact">
      <Explainer>
        <li>Compares what you pay for in Google Ads with how the same words already do in Google organic search for dupoin.co.id (from SEO OS / Search Console). Both sources are already in MarketingOS, so this is free.</li>
        <li>Terms are matched after lowercasing, trimming, and collapsing spaces. Paid numbers are summed across ad groups, match types{account === 'all' ? ', and accounts' : ''}.</li>
        <li><b>Top 3 organic, still paying</b>: average organic position {t ? `≤ ${t.topPosition}` : 'in the top 3'} with at least {t?.minOrganicClicks ?? 10} organic clicks and {t ? money(t.minPaidCost) : 'some'}+ ad spend. The spend is an upper bound of savings; test pausing or lowering bids before cutting.</li>
        <li><b>SEO opportunity</b>: the paid term converts but organic is weak (no organic data, position worse than {t?.weakPosition ?? 10}, or under {t?.weakMaxClicks ?? 5} organic clicks). Good topics for content.</li>
        <li>Search Console data lags 2 to 3 days, so the newest days may have paid data but no organic data yet.</li>
      </Explainer>
    </Panel>
    {error && <Panel><p className="text-sm text-red-300">{error}</p></Panel>}
    {loading && <LoadingState label="Matching paid terms with Search Console" />}
    {data && <>
      {!data.gsc.available
        ? <Panel><p className="text-sm text-amber-200">Organic data not available: {data.gsc.message} Paid terms are listed without organic numbers and no flags are raised.</p></Panel>
        : <p className="text-xs text-[var(--mos-text-faint)]">Organic source: {data.gsc.siteName} ({data.gsc.gscProperty}), Search Console data {data.gsc.dataFrom} to {data.gsc.dataThrough}.</p>}
      <SummaryCards cards={[
        { label: 'Paid terms', value: formatCount(data.summary.paidTerms), note: `${formatCount(data.summary.matched)} also appear in organic search` },
        { label: 'Spend on matched terms', value: money(data.summary.matchedPaidCost), note: `of ${money(data.summary.paidCost)} total paid spend` },
        { label: 'Potential savings', value: money(data.summary.potentialSavings), note: `${formatCount(data.summary.top3Paying)} terms already rank top 3`, tone: data.summary.potentialSavings ? 'bad' : undefined },
        { label: 'SEO opportunities', value: formatCount(data.summary.seoOpportunities), note: `${formatConversions(data.summary.seoOpportunityConversions)} paid conversions on weak organic terms`, tone: data.summary.seoOpportunities ? 'good' : undefined },
      ]} />
      <Toolbar>
        <FilterGroup>
          <Select aria-label="Paid source" value={source} onChange={event => setSource(event.target.value as typeof source)} className="w-auto">
            <option value="search-terms">Paid side: search terms (what people typed)</option>
            <option value="keywords">Paid side: keywords (what you bid on)</option>
          </Select>
          <Select aria-label="Show" value={show} onChange={event => setShow(event.target.value as typeof show)} className="w-auto">
            {FLAG_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </FilterGroup>
      </Toolbar>
      <InsightTable<PaidOrganicRow> title="Paid vs organic" total={show === 'all' ? data.totalRows : undefined}
        description={`Flagged rows first; the page shows up to ${data.thresholds.rowLimit} rows, Export CSV has all of them.`}
        rows={rows} rowKey={row => row.term} defaultSort="cost"
        exportHref={params ? `/api/paid-media/google-ads/export?${params}&kind=paid-organic` : undefined}
        emptyText={show === 'flagged' ? 'No flagged terms for this range.' : 'No rows.'}
        columns={[
          { key: 'term', label: 'Term', value: row => row.term, wide: true },
          { key: 'flags', label: 'Flag', value: row => row.flags.join(' '), render: row => <span className="flex gap-1">
            {row.flags.includes('organic-top3-paying') && <StatusBadge tone="warning">Top 3, still paying</StatusBadge>}
            {row.flags.includes('seo-opportunity') && <StatusBadge tone="success">SEO opportunity</StatusBadge>}
            {!row.flags.length && <span className="text-[var(--mos-text-faint)]">—</span>}
          </span> },
          { key: 'cost', label: 'Ads cost', value: row => row.paid.cost, render: row => money(row.paid.cost), align: 'right' },
          { key: 'paidClicks', label: 'Ads clicks', value: row => row.paid.clicks, render: row => formatCount(row.paid.clicks), align: 'right' },
          { key: 'conversions', label: 'Ads conv.', value: row => row.paid.conversions, render: row => formatConversions(row.paid.conversions), align: 'right' },
          { key: 'cpc', label: 'Ads CPC', value: row => row.paid.avgCpc, render: row => money(row.paid.avgCpc), align: 'right' },
          { key: 'orgClicks', label: 'Organic clicks', value: row => row.organic?.clicks ?? null, render: row => row.organic ? formatCount(row.organic.clicks) : '—', align: 'right' },
          { key: 'orgImpr', label: 'Organic impr.', value: row => row.organic?.impressions ?? null, render: row => row.organic ? formatCount(row.organic.impressions) : '—', align: 'right' },
          { key: 'orgCtr', label: 'Organic CTR', value: row => row.organic?.ctr ?? null, render: row => row.organic?.ctr == null ? '—' : formatRate(row.organic.ctr), align: 'right' },
          { key: 'position', label: 'Organic pos.', title: 'Average position in Google organic results (1 = top)', value: row => row.organic?.position == null ? null : -row.organic.position,
            render: row => row.organic?.position == null ? '—' : row.organic.position.toFixed(1), align: 'right' },
        ]} />
    </>}
  </>;
}
