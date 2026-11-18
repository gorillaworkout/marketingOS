/**
 * Read side of Google Ads: accounts, sync status, and the dashboard report.
 * Money is returned in account currency units (cost_micros / 1e6). CTR is a
 * 0-1 ratio. Reads only from MarketingOS tables, never from Google.
 */
import { queryAll, queryOne } from '@/lib/database';

export const TABLE_ROW_LIMIT = 500;
export const EXPORT_ROW_LIMIT = 100_000;
export const MAX_REPORT_DAYS = 400;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MetricTotals {
  impressions: number; clicks: number; cost: number; conversions: number; conversionsValue: number;
  ctr: number; avgCpc: number; costPerConversion: number | null;
}

export interface AccountSummary {
  customerId: string; name: string; currencyCode: string; timeZone: string; status: string; testAccount: boolean;
  source: string; active: boolean; lastError: string | null; lastCheckedAt: string | null; lastSyncedAt: string | null;
  firstSyncedDate: string | null; dataFrom: string | null; dataThrough: string | null;
}

export interface SyncRunSummary {
  id: string; mode: string; status: string; trigger: string; rangeStart: string | null; rangeEnd: string | null;
  accountsSynced: number; accountsFailed: number; rowsUpserted: number; error: string | null;
  details: Array<{ customerId: string; name: string; status: string; rows: Record<string, number>; error: string | null; rangeStart: string | null; rangeEnd: string | null }>;
  startedAt: string; finishedAt: string | null;
}

export interface CampaignRow extends MetricTotals { customerId: string; accountName: string; campaignId: string; campaignName: string; status: string; channelType: string }
export interface KeywordRow extends MetricTotals { customerId: string; accountName: string; campaignName: string; adGroupName: string; adGroupId: string; criterionId: string; keyword: string; matchType: string; status: string }
export interface SearchTermRow extends MetricTotals { customerId: string; accountName: string; campaignName: string; adGroupName: string; searchTerm: string; matchType: string; status: string }
export interface DailyPoint extends MetricTotals { date: string }

export interface GoogleAdsReport {
  range: { start: string; end: string; days: number; previous: { start: string; end: string } };
  customerId: string | null;
  currencies: string[];
  totals: { current: MetricTotals; previous: MetricTotals };
  trend: DailyPoint[];
  campaigns: CampaignRow[];
  keywords: KeywordRow[];
  searchTerms: SearchTermRow[];
  limits: { tableRows: number };
}

export class ReportInputError extends Error {}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dayCount(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function parseReportRange(start: string | null, end: string | null): { start: string; end: string; days: number; previous: { start: string; end: string } } {
  if (!start || !end || !ISO_DATE.test(start) || !ISO_DATE.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    throw new ReportInputError('start and end must be YYYY-MM-DD dates.');
  }
  if (start > end) throw new ReportInputError('start must be on or before end.');
  const days = dayCount(start, end);
  if (days > MAX_REPORT_DAYS) throw new ReportInputError(`Pick at most ${MAX_REPORT_DAYS} days.`);
  return { start, end, days, previous: { start: addDays(start, -days), end: addDays(start, -1) } };
}

export function parseCustomerFilter(value: string | null): string | null {
  if (!value || value === 'all') return null;
  const digits = value.replace(/-/g, '');
  if (!/^[0-9]{10}$/.test(digits)) throw new ReportInputError('account must be "all" or a 10-digit customer id.');
  return digits;
}

type RawMetrics = { impressions: string | number | null; clicks: string | number | null; cost: string | number | null; conversions: string | number | null; conversions_value: string | number | null };

export function toTotals(raw: RawMetrics | undefined): MetricTotals {
  const impressions = Number(raw?.impressions ?? 0) || 0;
  const clicks = Number(raw?.clicks ?? 0) || 0;
  const cost = Number(raw?.cost ?? 0) || 0;
  const conversions = Number(raw?.conversions ?? 0) || 0;
  const conversionsValue = Number(raw?.conversions_value ?? 0) || 0;
  return {
    impressions, clicks, cost, conversions, conversionsValue,
    ctr: impressions ? clicks / impressions : 0,
    avgCpc: clicks ? cost / clicks : 0,
    costPerConversion: conversions ? cost / conversions : null,
  };
}

const SUMS = `COALESCE(SUM(impressions), 0)::float8 AS impressions, COALESCE(SUM(clicks), 0)::float8 AS clicks,
  COALESCE(SUM(cost_micros)::numeric / 1000000, 0)::float8 AS cost, COALESCE(SUM(conversions), 0)::float8 AS conversions,
  COALESCE(SUM(conversions_value), 0)::float8 AS conversions_value`;

/** `customer_id = ?` when filtered; parameters are appended by the caller. */
function scope(customerId: string | null, alias = ''): { sql: string; values: unknown[] } {
  const column = alias ? `${alias}.customer_id` : 'customer_id';
  return customerId ? { sql: ` AND ${column} = ?`, values: [customerId] } : { sql: '', values: [] };
}

export async function listAccounts(): Promise<AccountSummary[]> {
  const rows = await queryAll<Record<string, unknown>>(`
    SELECT a.customer_id, a.descriptive_name, a.currency_code, a.time_zone, a.status, a.test_account, a.source, a.active, a.last_error,
      a.last_checked_at, a.last_synced_at, to_char(a.first_synced_date, 'YYYY-MM-DD') AS first_synced_date,
      (SELECT to_char(MIN(date), 'YYYY-MM-DD') FROM google_ads_campaign_daily c WHERE c.customer_id = a.customer_id) AS data_from,
      (SELECT to_char(MAX(date), 'YYYY-MM-DD') FROM google_ads_campaign_daily c WHERE c.customer_id = a.customer_id) AS data_through
    FROM google_ads_accounts a ORDER BY a.descriptive_name, a.customer_id`, []);
  return rows.map(row => ({
    customerId: String(row.customer_id), name: String(row.descriptive_name || ''), currencyCode: String(row.currency_code || ''), timeZone: String(row.time_zone || ''),
    status: String(row.status || ''), testAccount: Boolean(row.test_account), source: String(row.source), active: Boolean(row.active),
    lastError: (row.last_error as string | null) ?? null,
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at as string).toISOString() : null,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string).toISOString() : null,
    firstSyncedDate: (row.first_synced_date as string | null) ?? null, dataFrom: (row.data_from as string | null) ?? null, dataThrough: (row.data_through as string | null) ?? null,
  }));
}

export async function recentRuns(limit = 5): Promise<SyncRunSummary[]> {
  const rows = await queryAll<Record<string, unknown>>(`
    SELECT id, mode, status, trigger, to_char(range_start, 'YYYY-MM-DD') AS range_start, to_char(range_end, 'YYYY-MM-DD') AS range_end,
      accounts_synced, accounts_failed, rows_upserted, details, error, started_at, finished_at
    FROM google_ads_sync_runs ORDER BY started_at DESC LIMIT ?`, [Math.max(1, Math.min(50, limit))]);
  return rows.map(row => ({
    id: String(row.id), mode: String(row.mode), status: String(row.status), trigger: String(row.trigger),
    rangeStart: (row.range_start as string | null) ?? null, rangeEnd: (row.range_end as string | null) ?? null,
    accountsSynced: Number(row.accounts_synced), accountsFailed: Number(row.accounts_failed), rowsUpserted: Number(row.rows_upserted),
    error: (row.error as string | null) ?? null,
    details: (typeof row.details === 'string' ? JSON.parse(row.details) : row.details ?? []) as SyncRunSummary['details'],
    startedAt: new Date(row.started_at as string).toISOString(), finishedAt: row.finished_at ? new Date(row.finished_at as string).toISOString() : null,
  }));
}

async function totals(start: string, end: string, customerId: string | null): Promise<MetricTotals> {
  const filter = scope(customerId);
  return toTotals(await queryOne<RawMetrics>(`SELECT ${SUMS} FROM google_ads_campaign_daily WHERE date BETWEEN ? AND ?${filter.sql}`, [start, end, ...filter.values]));
}

export async function dailyTrend(start: string, end: string, customerId: string | null): Promise<DailyPoint[]> {
  const filter = scope(customerId);
  const rows = await queryAll<RawMetrics & { date: string }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, ${SUMS} FROM google_ads_campaign_daily WHERE date BETWEEN ? AND ?${filter.sql} GROUP BY date ORDER BY date`,
    [start, end, ...filter.values],
  );
  return rows.map(row => ({ date: row.date, ...toTotals(row) }));
}

export async function campaignRows(start: string, end: string, customerId: string | null, limit = EXPORT_ROW_LIMIT): Promise<CampaignRow[]> {
  const filter = scope(customerId, 'c');
  const rows = await queryAll<RawMetrics & Record<string, string>>(`
    SELECT c.customer_id, COALESCE(a.descriptive_name, '') AS account_name, c.campaign_id,
      (array_agg(c.campaign_name ORDER BY c.date DESC))[1] AS campaign_name,
      (array_agg(c.campaign_status ORDER BY c.date DESC))[1] AS status,
      (array_agg(c.channel_type ORDER BY c.date DESC))[1] AS channel_type, ${SUMS.replace(/SUM\((\w+)\)/g, 'SUM(c.$1)')}
    FROM google_ads_campaign_daily c LEFT JOIN google_ads_accounts a ON a.customer_id = c.customer_id
    WHERE c.date BETWEEN ? AND ?${filter.sql}
    GROUP BY c.customer_id, a.descriptive_name, c.campaign_id
    ORDER BY cost DESC, impressions DESC LIMIT ?`, [start, end, ...filter.values, limit]);
  return rows.map(row => ({
    customerId: row.customer_id, accountName: row.account_name, campaignId: row.campaign_id, campaignName: row.campaign_name,
    status: row.status, channelType: row.channel_type, ...toTotals(row),
  }));
}

/** Latest names in range for campaign and ad group ids. */
async function nameMaps(start: string, end: string, customerId: string | null) {
  const filter = scope(customerId);
  const campaigns = await queryAll<{ customer_id: string; campaign_id: string; campaign_name: string }>(
    `SELECT DISTINCT ON (customer_id, campaign_id) customer_id, campaign_id, campaign_name FROM google_ads_campaign_daily
     WHERE date BETWEEN ? AND ?${filter.sql} ORDER BY customer_id, campaign_id, date DESC`, [start, end, ...filter.values]);
  const adGroups = await queryAll<{ customer_id: string; ad_group_id: string; ad_group_name: string }>(
    `SELECT DISTINCT ON (customer_id, ad_group_id) customer_id, ad_group_id, ad_group_name FROM google_ads_ad_group_daily
     WHERE date BETWEEN ? AND ?${filter.sql} ORDER BY customer_id, ad_group_id, date DESC`, [start, end, ...filter.values]);
  return {
    campaign: new Map(campaigns.map(row => [`${row.customer_id}|${row.campaign_id}`, row.campaign_name])),
    adGroup: new Map(adGroups.map(row => [`${row.customer_id}|${row.ad_group_id}`, row.ad_group_name])),
  };
}

export async function keywordRows(start: string, end: string, customerId: string | null, limit = EXPORT_ROW_LIMIT): Promise<KeywordRow[]> {
  const filter = scope(customerId, 'k');
  const [rows, names] = await Promise.all([queryAll<RawMetrics & Record<string, string>>(`
    SELECT k.customer_id, COALESCE(a.descriptive_name, '') AS account_name, k.ad_group_id, k.criterion_id,
      (array_agg(k.campaign_id ORDER BY k.date DESC))[1] AS campaign_id,
      (array_agg(k.keyword_text ORDER BY k.date DESC))[1] AS keyword,
      (array_agg(k.match_type ORDER BY k.date DESC))[1] AS match_type,
      (array_agg(k.criterion_status ORDER BY k.date DESC))[1] AS status, ${SUMS.replace(/SUM\((\w+)\)/g, 'SUM(k.$1)')}
    FROM google_ads_keyword_daily k LEFT JOIN google_ads_accounts a ON a.customer_id = k.customer_id
    WHERE k.date BETWEEN ? AND ?${filter.sql}
    GROUP BY k.customer_id, a.descriptive_name, k.ad_group_id, k.criterion_id
    ORDER BY cost DESC, clicks DESC, impressions DESC LIMIT ?`, [start, end, ...filter.values, limit]), nameMaps(start, end, customerId)]);
  return rows.map(row => ({
    customerId: row.customer_id, accountName: row.account_name, adGroupId: row.ad_group_id, criterionId: row.criterion_id,
    campaignName: names.campaign.get(`${row.customer_id}|${row.campaign_id}`) ?? '', adGroupName: names.adGroup.get(`${row.customer_id}|${row.ad_group_id}`) ?? '',
    keyword: row.keyword, matchType: row.match_type, status: row.status, ...toTotals(row),
  }));
}

export async function searchTermRows(start: string, end: string, customerId: string | null, limit = EXPORT_ROW_LIMIT): Promise<SearchTermRow[]> {
  const filter = scope(customerId, 's');
  const [rows, names] = await Promise.all([queryAll<RawMetrics & Record<string, string>>(`
    SELECT s.customer_id, COALESCE(a.descriptive_name, '') AS account_name, s.ad_group_id, s.search_term, s.match_type,
      (array_agg(s.campaign_id ORDER BY s.date DESC))[1] AS campaign_id,
      (array_agg(s.term_status ORDER BY s.date DESC))[1] AS status, ${SUMS.replace(/SUM\((\w+)\)/g, 'SUM(s.$1)')}
    FROM google_ads_search_term_daily s LEFT JOIN google_ads_accounts a ON a.customer_id = s.customer_id
    WHERE s.date BETWEEN ? AND ?${filter.sql}
    GROUP BY s.customer_id, a.descriptive_name, s.ad_group_id, s.search_term, s.match_type
    ORDER BY cost DESC, clicks DESC LIMIT ?`, [start, end, ...filter.values, limit]), nameMaps(start, end, customerId)]);
  return rows.map(row => ({
    customerId: row.customer_id, accountName: row.account_name,
    campaignName: names.campaign.get(`${row.customer_id}|${row.campaign_id}`) ?? '', adGroupName: names.adGroup.get(`${row.customer_id}|${row.ad_group_id}`) ?? '',
    searchTerm: row.search_term, matchType: row.match_type, status: row.status, ...toTotals(row),
  }));
}

export async function getGoogleAdsReport(input: { start: string | null; end: string | null; account: string | null }): Promise<GoogleAdsReport> {
  const range = parseReportRange(input.start, input.end);
  const customerId = parseCustomerFilter(input.account);
  const filter = scope(customerId);
  const [current, previous, trend, campaigns, keywords, searchTerms, currencies] = await Promise.all([
    totals(range.start, range.end, customerId),
    totals(range.previous.start, range.previous.end, customerId),
    dailyTrend(range.start, range.end, customerId),
    campaignRows(range.start, range.end, customerId, TABLE_ROW_LIMIT),
    keywordRows(range.start, range.end, customerId, TABLE_ROW_LIMIT),
    searchTermRows(range.start, range.end, customerId, TABLE_ROW_LIMIT),
    queryAll<{ currency_code: string }>(`SELECT DISTINCT currency_code FROM google_ads_accounts WHERE currency_code <> ''${filter.sql} ORDER BY currency_code`, filter.values),
  ]);
  return {
    range, customerId, currencies: currencies.map(row => row.currency_code),
    totals: { current, previous }, trend, campaigns, keywords, searchTerms, limits: { tableRows: TABLE_ROW_LIMIT },
  };
}

export type ExportKind = 'campaigns' | 'keywords' | 'search-terms' | 'daily';
export const EXPORT_KINDS: readonly ExportKind[] = ['campaigns', 'keywords', 'search-terms', 'daily'];

function csvCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, '');
  let text = String(value);
  // Spreadsheet formula injection guard (text cells only).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const METRIC_HEADERS = ['Impressions', 'Clicks', 'CTR', 'Cost', 'Avg CPC', 'Conversions', 'Conv. value', 'Cost / conv.'];
const metricCells = (row: MetricTotals) => [row.impressions, row.clicks, row.ctr, row.cost, row.avgCpc, row.conversions, row.conversionsValue, row.costPerConversion];

export async function exportCsv(kind: ExportKind, input: { start: string | null; end: string | null; account: string | null }): Promise<{ filename: string; csv: string }> {
  const range = parseReportRange(input.start, input.end);
  const customerId = parseCustomerFilter(input.account);
  const suffix = `${customerId ?? 'all'}-${range.start}-to-${range.end}`;
  if (kind === 'campaigns') {
    const rows = await campaignRows(range.start, range.end, customerId);
    return { filename: `google-ads-campaigns-${suffix}.csv`, csv: toCsv(['Account', 'Customer ID', 'Campaign', 'Campaign ID', 'Status', 'Channel', ...METRIC_HEADERS], rows.map(row => [row.accountName, row.customerId, row.campaignName, row.campaignId, row.status, row.channelType, ...metricCells(row)])) };
  }
  if (kind === 'keywords') {
    const rows = await keywordRows(range.start, range.end, customerId);
    return { filename: `google-ads-keywords-${suffix}.csv`, csv: toCsv(['Account', 'Customer ID', 'Campaign', 'Ad group', 'Keyword', 'Match type', 'Status', ...METRIC_HEADERS], rows.map(row => [row.accountName, row.customerId, row.campaignName, row.adGroupName, row.keyword, row.matchType, row.status, ...metricCells(row)])) };
  }
  if (kind === 'search-terms') {
    const rows = await searchTermRows(range.start, range.end, customerId);
    return { filename: `google-ads-search-terms-${suffix}.csv`, csv: toCsv(['Account', 'Customer ID', 'Campaign', 'Ad group', 'Search term', 'Match type', 'Status', ...METRIC_HEADERS], rows.map(row => [row.accountName, row.customerId, row.campaignName, row.adGroupName, row.searchTerm, row.matchType, row.status, ...metricCells(row)])) };
  }
  const rows = await dailyTrend(range.start, range.end, customerId);
  return { filename: `google-ads-daily-${suffix}.csv`, csv: toCsv(['Date', ...METRIC_HEADERS], rows.map(row => [row.date, ...metricCells(row)])) };
}
