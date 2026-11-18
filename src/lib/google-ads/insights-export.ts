import { getPaidOrganicReport } from './paid-organic';
import { toCsv } from './report';
import { getSearchTermInsights } from './search-term-insights';

export type InsightExportKind = 'paid-organic' | 'negatives' | 'keyword-candidates';
export const INSIGHT_EXPORT_KINDS: readonly InsightExportKind[] = ['paid-organic', 'negatives', 'keyword-candidates'];

const FLAG_LABELS: Record<string, string> = { 'organic-top3-paying': 'Top 3 organic, still paying', 'seo-opportunity': 'SEO opportunity' };

export async function exportInsightCsv(kind: InsightExportKind, params: URLSearchParams): Promise<{ filename: string; csv: string }> {
  const base = { start: params.get('start'), end: params.get('end'), account: params.get('account') };
  const suffix = `${(base.account || 'all').replace(/-/g, '')}-${base.start}-to-${base.end}`;
  if (kind === 'paid-organic') {
    const report = await getPaidOrganicReport({ ...base, source: params.get('source'), limit: Number.MAX_SAFE_INTEGER });
    return {
      filename: `google-ads-paid-vs-organic-${report.source}-${suffix}.csv`,
      csv: toCsv(
        ['Term', 'Flags', 'Ads cost', 'Ads clicks', 'Ads impressions', 'Ads conversions', 'Ads avg CPC', 'Ads cost / conv.', 'Organic clicks', 'Organic impressions', 'Organic CTR', 'Organic avg position', 'Potential savings'],
        report.rows.map(row => [row.term, row.flags.map(flag => FLAG_LABELS[flag]).join('; '), row.paid.cost, row.paid.clicks, row.paid.impressions, row.paid.conversions, row.paid.avgCpc, row.paid.costPerConversion,
          row.organic?.clicks ?? null, row.organic?.impressions ?? null, row.organic?.ctr ?? null, row.organic?.position ?? null, row.potentialSavings]),
      ),
    };
  }
  const insights = await getSearchTermInsights({ ...base, minCost: params.get('minCost'), minConversions: params.get('minConversions'), limit: Number.MAX_SAFE_INTEGER });
  if (kind === 'negatives') {
    return {
      filename: `google-ads-negative-suggestions-${suffix}.csv`,
      csv: toCsv(['Account', 'Customer ID', 'Campaign', 'Search term', 'Match types', 'Ad groups', 'Cost', 'Clicks', 'Impressions', 'Conversions'],
        insights.negatives.map(row => [row.accountName, row.customerId, row.campaignName, row.term, row.matchTypes.join(' '), row.adGroups, row.cost, row.clicks, row.impressions, 0])),
    };
  }
  return {
    filename: `google-ads-keyword-candidates-${suffix}.csv`,
    csv: toCsv(['Account', 'Customer ID', 'Search term', 'Campaigns', 'Match types', 'Conversions', 'Cost', 'Clicks', 'Cost / conv.'],
      insights.candidates.map(row => [row.accountName, row.customerId, row.term, row.campaigns.join('; '), row.matchTypes.join(' '), row.conversions, row.cost, row.clicks, row.costPerConversion])),
  };
}
