/**
 * GAQL queries and row mapping for the Google Ads sync. Every query is a
 * read-only SELECT. Rows are mapped to flat records and summed per primary
 * key, so one upsert statement never touches the same row twice.
 */

export interface Metrics {
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionsValue: number;
}

export interface CampaignDailyRow extends Metrics { date: string; campaignId: string; campaignName: string; campaignStatus: string; channelType: string }
export interface AdGroupDailyRow extends Metrics { date: string; adGroupId: string; campaignId: string; adGroupName: string; adGroupStatus: string }
export interface KeywordDailyRow extends Metrics { date: string; adGroupId: string; criterionId: string; campaignId: string; keywordText: string; matchType: string; criterionStatus: string }
export interface SearchTermDailyRow extends Metrics { date: string; adGroupId: string; searchTerm: string; matchType: string; campaignId: string; termStatus: string }

export interface RangeSnapshot {
  campaigns: CampaignDailyRow[];
  adGroups: AdGroupDailyRow[];
  keywords: KeywordDailyRow[];
  searchTerms: SearchTermDailyRow[];
}

export interface ClientAccount {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  status: string;
  testAccount: boolean;
  manager: boolean;
  level: number;
}

/** Google Ads search terms are capped at 80 chars by Google; keep a hard cap anyway. */
export const MAX_SEARCH_TERM_LENGTH = 500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const METRICS = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value';

function dateWhere(start: string, end: string): string {
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) throw new Error('Dates must be YYYY-MM-DD.');
  return `segments.date BETWEEN '${start}' AND '${end}'`;
}

export const CUSTOMER_CLIENT_QUERY = 'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level, customer_client.status, customer_client.currency_code, customer_client.time_zone, customer_client.test_account FROM customer_client';
export const CUSTOMER_QUERY = 'SELECT customer.id, customer.descriptive_name, customer.manager, customer.status, customer.currency_code, customer.time_zone, customer.test_account FROM customer';

export function buildQueries(start: string, end: string) {
  const where = dateWhere(start, end);
  return {
    campaigns: `SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ${METRICS} FROM campaign WHERE ${where}`,
    adGroups: `SELECT segments.date, campaign.id, ad_group.id, ad_group.name, ad_group.status, ${METRICS} FROM ad_group WHERE ${where}`,
    keywords: `SELECT segments.date, campaign.id, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ${METRICS} FROM keyword_view WHERE ${where}`,
    // Clicked terms only: impression-only long tail is ~97% of rows and has no spend.
    searchTerms: `SELECT segments.date, campaign.id, ad_group.id, search_term_view.search_term, search_term_view.status, segments.search_term_match_type, ${METRICS} FROM search_term_view WHERE ${where} AND metrics.clicks > 0`,
  } as const;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === 'object' ? value as Obj : {});
const str = (value: unknown): string => (value == null ? '' : String(value));
/** int64 fields arrive as JSON strings; doubles as numbers. Missing means 0. */
const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function mapMetrics(row: Obj): Metrics {
  const metrics = obj(row.metrics);
  return {
    impressions: Math.round(num(metrics.impressions)),
    clicks: Math.round(num(metrics.clicks)),
    costMicros: Math.round(num(metrics.costMicros)),
    conversions: num(metrics.conversions),
    conversionsValue: num(metrics.conversionsValue),
  };
}

function date(row: Obj): string {
  const value = str(obj(row.segments).date);
  if (!ISO_DATE.test(value)) throw new Error('Google Ads row has no segments.date.');
  return value;
}

export function mapCampaignRow(row: Obj): CampaignDailyRow {
  const campaign = obj(row.campaign);
  return { date: date(row), campaignId: str(campaign.id), campaignName: str(campaign.name), campaignStatus: str(campaign.status), channelType: str(campaign.advertisingChannelType), ...mapMetrics(row) };
}

export function mapAdGroupRow(row: Obj): AdGroupDailyRow {
  const adGroup = obj(row.adGroup);
  return { date: date(row), adGroupId: str(adGroup.id), campaignId: str(obj(row.campaign).id), adGroupName: str(adGroup.name), adGroupStatus: str(adGroup.status), ...mapMetrics(row) };
}

export function mapKeywordRow(row: Obj): KeywordDailyRow {
  const criterion = obj(row.adGroupCriterion);
  const keyword = obj(criterion.keyword);
  return {
    date: date(row), adGroupId: str(obj(row.adGroup).id), criterionId: str(criterion.criterionId), campaignId: str(obj(row.campaign).id),
    keywordText: str(keyword.text), matchType: str(keyword.matchType), criterionStatus: str(criterion.status), ...mapMetrics(row),
  };
}

export function mapSearchTermRow(row: Obj): SearchTermDailyRow {
  const view = obj(row.searchTermView);
  return {
    date: date(row), adGroupId: str(obj(row.adGroup).id), searchTerm: str(view.searchTerm).slice(0, MAX_SEARCH_TERM_LENGTH),
    matchType: str(obj(row.segments).searchTermMatchType), campaignId: str(obj(row.campaign).id), termStatus: str(view.status), ...mapMetrics(row),
  };
}

export function mapCustomerClientRow(row: Obj): ClientAccount {
  const client = obj(row.customerClient);
  return {
    customerId: str(client.id), descriptiveName: str(client.descriptiveName), currencyCode: str(client.currencyCode), timeZone: str(client.timeZone),
    status: str(client.status), testAccount: client.testAccount === true, manager: client.manager === true, level: Math.round(num(client.level)),
  };
}

export function mapCustomerRow(row: Obj): ClientAccount {
  const customer = obj(row.customer);
  return {
    customerId: str(customer.id), descriptiveName: str(customer.descriptiveName), currencyCode: str(customer.currencyCode), timeZone: str(customer.timeZone),
    status: str(customer.status), testAccount: customer.testAccount === true, manager: customer.manager === true, level: 0,
  };
}

/** Sums metrics of rows that share a key; descriptive fields keep the last value seen. */
export function aggregateByKey<T extends Metrics>(rows: T[], key: (row: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    const current = merged.get(id);
    if (!current) { merged.set(id, { ...row }); continue; }
    merged.set(id, {
      ...current, ...row,
      impressions: current.impressions + row.impressions,
      clicks: current.clicks + row.clicks,
      costMicros: current.costMicros + row.costMicros,
      conversions: current.conversions + row.conversions,
      conversionsValue: current.conversionsValue + row.conversionsValue,
    });
  }
  return [...merged.values()];
}

export const campaignKey = (row: CampaignDailyRow) => `${row.date}|${row.campaignId}`;
export const adGroupKey = (row: AdGroupDailyRow) => `${row.date}|${row.adGroupId}`;
export const keywordKey = (row: KeywordDailyRow) => `${row.date}|${row.adGroupId}|${row.criterionId}`;
export const searchTermKey = (row: SearchTermDailyRow) => `${row.date}|${row.adGroupId}|${row.searchTerm}|${row.matchType}`;

/** Maps raw API rows for one date range into deduplicated snapshot rows. Rows without ids are dropped. */
export function buildSnapshot(raw: { campaigns: Obj[]; adGroups: Obj[]; keywords: Obj[]; searchTerms: Obj[] }): RangeSnapshot {
  return {
    campaigns: aggregateByKey(raw.campaigns.map(mapCampaignRow).filter(row => row.campaignId), campaignKey),
    adGroups: aggregateByKey(raw.adGroups.map(mapAdGroupRow).filter(row => row.adGroupId), adGroupKey),
    keywords: aggregateByKey(raw.keywords.map(mapKeywordRow).filter(row => row.adGroupId && row.criterionId), keywordKey),
    searchTerms: aggregateByKey(raw.searchTerms.map(mapSearchTermRow).filter(row => row.adGroupId && row.searchTerm), searchTermKey),
  };
}

/** Derived metrics. CTR is a 0-1 ratio; money values are in account currency units (micros / 1e6). */
export function deriveMetrics(metrics: Metrics) {
  const cost = metrics.costMicros / 1_000_000;
  return {
    cost,
    ctr: metrics.impressions ? metrics.clicks / metrics.impressions : 0,
    avgCpc: metrics.clicks ? cost / metrics.clicks : 0,
    costPerConversion: metrics.conversions ? cost / metrics.conversions : null,
  };
}
