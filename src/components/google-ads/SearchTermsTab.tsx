'use client';

import { useState } from 'react';
import { Button, FilterGroup, LoadingState, Panel, TextInput, Toolbar } from '@/components/ui/dashboard';
import { formatConversions, formatCount, formatCustomerId, formatMoney } from '@/lib/google-ads/format';
import { SEARCH_TERMS } from '@/lib/google-ads/insights-config';
import type { KeywordCandidate, NegativeSuggestion, SearchTermInsights } from '@/lib/google-ads/search-term-insights';
import { Explainer, InsightTable, SummaryCards } from './InsightTable';
import { useInsight } from './useInsight';

type Range = { start: string; end: string };
const humanize = (value: string) => value.toLowerCase().replace(/_/g, ' ');

export function SearchTermsTab({ range, account, currency, version }: { range: Range | null; account: string; currency: string; version: number }) {
  const [draft, setDraft] = useState({ minCost: String(SEARCH_TERMS.defaultNegativeMinCost), minConversions: String(SEARCH_TERMS.defaultCandidateMinConversions) });
  const [applied, setApplied] = useState(draft);
  const params = range ? new URLSearchParams({ start: range.start, end: range.end, account, minCost: applied.minCost || '0', minConversions: applied.minConversions || '1' }).toString() : null;
  const { data, error, loading } = useInsight<SearchTermInsights>(params ? `/api/paid-media/google-ads/search-terms?${params}` : null, version);
  const money = (value: number) => formatMoney(value, currency);
  const exportHref = (kind: string) => (params ? `/api/paid-media/google-ads/export?${params}&kind=${kind}` : undefined);
  const accountColumn = account === 'all' ? [{ key: 'account', label: 'Account', value: (row: { accountName: string; customerId: string }) => row.accountName || formatCustomerId(row.customerId) }] : [];

  return <>
    <Panel padding="compact">
      <Explainer>
        <li>Suggestions only. MarketingOS never changes Google Ads; review the lists and add negatives or keywords yourself in Google Ads (or upload the CSV with Google Ads Editor).</li>
        <li><b>Negative keyword suggestions</b>: search terms that spent at least the threshold below with 0 conversions in the range, per campaign. <b>Wasted spend</b> is their total cost. Check intent before adding: a term with few clicks may simply need more time.</li>
        <li><b>Keyword candidates</b>: search terms with conversions that are not yet a keyword in that account (any match type, any date synced) and not already added or excluded.</li>
        <li>Only search terms with at least one click are synced, so terms with impressions but no clicks are not here.</li>
      </Explainer>
    </Panel>
    <Toolbar>
      <form className="contents" onSubmit={event => { event.preventDefault(); setApplied(draft); }}>
        <FilterGroup>
          <label className="flex items-center gap-2 text-xs text-[var(--mos-text-muted)]">Negatives: spend at least ({currency})
            <TextInput type="number" min={0} step={10000} aria-label="Minimum spend for negative suggestions" value={draft.minCost} onChange={event => setDraft(value => ({ ...value, minCost: event.target.value }))} className="h-8 w-36" />
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--mos-text-muted)]">Candidates: conversions at least
            <TextInput type="number" min={0.01} step={1} aria-label="Minimum conversions for keyword candidates" value={draft.minConversions} onChange={event => setDraft(value => ({ ...value, minConversions: event.target.value }))} className="h-8 w-24" />
          </label>
          <Button type="submit" size="sm">Apply</Button>
        </FilterGroup>
      </form>
    </Toolbar>
    {error && <Panel><p className="text-sm text-red-300">{error}</p></Panel>}
    {loading && <LoadingState label="Analysing search terms" />}
    {data && <>
      <SummaryCards cards={[
        { label: 'Wasted spend', value: money(data.wastedSpend), note: `${money(data.minCost)}+ spend and 0 conversions`, tone: data.wastedSpend ? 'bad' : undefined },
        { label: 'Negative suggestions', value: formatCount(data.negativeCount), note: 'search term + campaign pairs' },
        { label: 'Keyword candidates', value: formatCount(data.candidateCount), note: `at least ${formatConversions(data.minConversions)} conversion${data.minConversions === 1 ? '' : 's'}`, tone: data.candidateCount ? 'good' : undefined },
        { label: 'Candidate conversions', value: formatConversions(data.candidateConversions), note: 'from terms you do not bid on directly' },
      ]} />
      <InsightTable<NegativeSuggestion> title="Negative keyword suggestions" total={data.negativeCount} rows={data.negatives}
        description={`Top ${data.limits.rows} by cost on the page; Export CSV has every row.`} defaultSort="cost" exportHref={exportHref('negatives')}
        rowKey={row => `${row.customerId}|${row.campaignName}|${row.term}`} emptyText="No search terms above the threshold without conversions."
        columns={[
          { key: 'term', label: 'Search term', value: row => row.term, wide: true },
          ...accountColumn,
          { key: 'campaign', label: 'Campaign', value: row => row.campaignName },
          { key: 'match', label: 'Matched via', value: row => row.matchTypes.map(humanize).join(', ') },
          { key: 'cost', label: 'Cost', value: row => row.cost, render: row => money(row.cost), align: 'right' },
          { key: 'clicks', label: 'Clicks', value: row => row.clicks, render: row => formatCount(row.clicks), align: 'right' },
          { key: 'impressions', label: 'Impr.', value: row => row.impressions, render: row => formatCount(row.impressions), align: 'right' },
          { key: 'cpc', label: 'Avg CPC', value: row => (row.clicks ? row.cost / row.clicks : 0), render: row => money(row.clicks ? row.cost / row.clicks : 0), align: 'right' },
        ]} />
      <InsightTable<KeywordCandidate> title="Keyword candidates" total={data.candidateCount} rows={data.candidates}
        description="Converting search terms you could add as keywords (exact or phrase) to control bids and ad copy." defaultSort="conversions" exportHref={exportHref('keyword-candidates')}
        rowKey={row => `${row.customerId}|${row.term}`} emptyText="No converting search terms missing as keywords."
        columns={[
          { key: 'term', label: 'Search term', value: row => row.term, wide: true },
          ...accountColumn,
          { key: 'campaigns', label: 'Campaigns', value: row => row.campaigns.join(', ') },
          { key: 'match', label: 'Matched via', value: row => row.matchTypes.map(humanize).join(', ') },
          { key: 'conversions', label: 'Conv.', value: row => row.conversions, render: row => formatConversions(row.conversions), align: 'right' },
          { key: 'cost', label: 'Cost', value: row => row.cost, render: row => money(row.cost), align: 'right' },
          { key: 'clicks', label: 'Clicks', value: row => row.clicks, render: row => formatCount(row.clicks), align: 'right' },
          { key: 'cpa', label: 'Cost / conv.', value: row => row.costPerConversion, render: row => row.costPerConversion == null ? '—' : money(row.costPerConversion), align: 'right' },
        ]} />
    </>}
  </>;
}
