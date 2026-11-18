/**
 * Paid vs Organic: Google Ads search terms (or keywords) joined to the
 * Dupoin site's Search Console queries by normalized text. Read-only; uses
 * data already in MarketingOS (Google Ads sync + SEO OS GSC sync). Free.
 */
import { queryAll, queryOne } from '@/lib/database';
import { gscRowsSql } from '@/lib/seo/gsc-source';
import { PAID_ORGANIC } from './insights-config';
import { keywordRows, parseCustomerFilter, parseReportRange, searchTermRows } from './report';
import { normalizeKeyword, normalizeSql, normalizeTerm } from './text';

export type PaidSource = 'search-terms' | 'keywords';
export type PaidOrganicFlag = 'organic-top3-paying' | 'seo-opportunity';

export interface PaidTerm { term: string; cost: number; clicks: number; impressions: number; conversions: number; variants: number }
export interface OrganicTerm { term: string; clicks: number; impressions: number; position: number | null }

export interface PaidOrganicRow {
  term: string;
  paid: { cost: number; clicks: number; impressions: number; conversions: number; avgCpc: number; costPerConversion: number | null; variants: number };
  organic: { clicks: number; impressions: number; ctr: number | null; position: number | null } | null;
  flags: PaidOrganicFlag[];
  /** For organic-top3-paying: the paid spend on a term that already ranks top 3 (upper bound of savings). */
  potentialSavings: number;
}

export interface PaidOrganicSummary {
  paidTerms: number;
  matched: number;
  paidCost: number;
  matchedPaidCost: number;
  top3Paying: number;
  potentialSavings: number;
  seoOpportunities: number;
  seoOpportunityConversions: number;
}

export type ThresholdOverrides = Partial<{ -readonly [K in keyof typeof PAID_ORGANIC]: (typeof PAID_ORGANIC)[K] }>;

/** Sums paid rows that share a normalized term (ad groups, match types, accounts). */
export function aggregatePaidTerms(rows: Array<{ text: string; cost: number; clicks: number; impressions: number; conversions: number }>, normalize: (value: string) => string = normalizeTerm): PaidTerm[] {
  const merged = new Map<string, PaidTerm>();
  for (const row of rows) {
    const term = normalize(row.text);
    if (!term) continue;
    const current = merged.get(term) ?? { term, cost: 0, clicks: 0, impressions: 0, conversions: 0, variants: 0 };
    current.cost += row.cost; current.clicks += row.clicks; current.impressions += row.impressions; current.conversions += row.conversions; current.variants += 1;
    merged.set(term, current);
  }
  return [...merged.values()];
}

export function flagsFor(paid: PaidTerm, organic: OrganicTerm | null, thresholds: ThresholdOverrides = {}): PaidOrganicFlag[] {
  const t = { ...PAID_ORGANIC, ...thresholds };
  const flags: PaidOrganicFlag[] = [];
  if (organic && organic.position != null && organic.position <= t.topPosition && organic.clicks >= t.minOrganicClicks && paid.cost >= t.minPaidCost) flags.push('organic-top3-paying');
  const weak = !organic || organic.position == null || organic.position > t.weakPosition || organic.clicks < t.weakMaxClicks;
  if (paid.conversions >= t.minPaidConversions && weak) flags.push('seo-opportunity');
  return flags;
}

/**
 * organicAvailable=false (no GSC data for the range) means no flags at all:
 * a missing organic match is only evidence of weak organic when GSC data exists.
 */
export function joinPaidOrganic(paid: PaidTerm[], organic: OrganicTerm[], thresholds: ThresholdOverrides = {}, organicAvailable = true): { rows: PaidOrganicRow[]; summary: PaidOrganicSummary } {
  const byTerm = new Map(organic.map(row => [normalizeTerm(row.term), row]));
  const rows = paid.map(term => {
    const match = byTerm.get(term.term) ?? null;
    const flags = organicAvailable ? flagsFor(term, match, thresholds) : [];
    return {
      term: term.term,
      paid: {
        cost: term.cost, clicks: term.clicks, impressions: term.impressions, conversions: term.conversions, variants: term.variants,
        avgCpc: term.clicks ? term.cost / term.clicks : 0, costPerConversion: term.conversions ? term.cost / term.conversions : null,
      },
      organic: match ? { clicks: match.clicks, impressions: match.impressions, ctr: match.impressions ? match.clicks / match.impressions : null, position: match.position } : null,
      flags,
      potentialSavings: flags.includes('organic-top3-paying') ? term.cost : 0,
    };
  }).sort((left, right) => right.paid.cost - left.paid.cost || left.term.localeCompare(right.term));
  const summary: PaidOrganicSummary = {
    paidTerms: rows.length,
    matched: rows.filter(row => row.organic).length,
    paidCost: rows.reduce((sum, row) => sum + row.paid.cost, 0),
    matchedPaidCost: rows.filter(row => row.organic).reduce((sum, row) => sum + row.paid.cost, 0),
    top3Paying: rows.filter(row => row.flags.includes('organic-top3-paying')).length,
    potentialSavings: rows.reduce((sum, row) => sum + row.potentialSavings, 0),
    seoOpportunities: rows.filter(row => row.flags.includes('seo-opportunity')).length,
    seoOpportunityConversions: rows.filter(row => row.flags.includes('seo-opportunity')).reduce((sum, row) => sum + row.paid.conversions, 0),
  };
  return { rows, summary };
}

// ---- Database ----

export interface GscSiteStatus {
  siteFound: boolean;
  siteId: string | null;
  siteName: string | null;
  siteUrl: string | null;
  gscProperty: string | null;
  active: boolean;
  lastSyncedAt: string | null;
  /** Rows in the requested range (daily + monthly). */
  rowsInRange: number;
  dataFrom: string | null;
  dataThrough: string | null;
  available: boolean;
  message: string | null;
}

/** The Dupoin site in SEO OS (dupoin.co.id). */
export async function dupoinGscStatus(range: { start: string; end: string }): Promise<GscSiteStatus> {
  const site = await queryOne<{ id: string; name: string; site_url: string; gsc_property: string | null; active: boolean; last_synced_at: string | null }>(
    `SELECT id, name, site_url, gsc_property, active, last_synced_at FROM seo_sites
     WHERE site_url ILIKE '%dupoin.co.id%' OR gsc_property ILIKE '%dupoin.co.id%' ORDER BY active DESC, created_at LIMIT 1`, [],
  );
  if (!site) {
    return { siteFound: false, siteId: null, siteName: null, siteUrl: null, gscProperty: null, active: false, lastSyncedAt: null, rowsInRange: 0, dataFrom: null, dataThrough: null, available: false, message: 'Dupoin (dupoin.co.id) is not set up in SEO OS, so there is no organic data to compare.' };
  }
  const coverage = await queryOne<{ rows: string | number; data_from: string | null; data_through: string | null }>(
    `SELECT (SELECT COUNT(*) FROM seo_gsc_daily WHERE site_id = ? AND date BETWEEN ? AND ?)
          + (SELECT COUNT(*) FROM seo_gsc_monthly m JOIN seo_gsc_rollup_months r ON r.site_id = m.site_id AND r.month = m.month
             WHERE m.site_id = ? AND r.first_date <= ? AND r.last_date >= ?) AS rows,
       (SELECT to_char(MIN(date), 'YYYY-MM-DD') FROM seo_gsc_site_daily WHERE site_id = ?) AS data_from,
       (SELECT to_char(MAX(date), 'YYYY-MM-DD') FROM seo_gsc_site_daily WHERE site_id = ?) AS data_through`,
    [site.id, range.start, range.end, site.id, range.end, range.start, site.id, site.id],
  );
  const rowsInRange = Number(coverage?.rows ?? 0);
  const base = {
    siteFound: true, siteId: site.id, siteName: site.name, siteUrl: site.site_url, gscProperty: site.gsc_property, active: site.active,
    lastSyncedAt: site.last_synced_at ? new Date(site.last_synced_at).toISOString() : null, rowsInRange,
    dataFrom: coverage?.data_from ?? null, dataThrough: coverage?.data_through ?? null,
  };
  if (!site.active || !site.gsc_property) return { ...base, available: false, message: 'Dupoin is in SEO OS but its Search Console property is not connected or the site is inactive, so organic data is not synced.' };
  if (!rowsInRange) return { ...base, available: false, message: `Dupoin Search Console has no query data for ${range.start} to ${range.end}${base.dataThrough ? ` (data runs ${base.dataFrom} to ${base.dataThrough})` : ''}.` };
  return { ...base, available: true, message: null };
}

/** GSC queries for the site, grouped by normalized text, limited to the given terms. */
export async function organicTerms(siteId: string, range: { start: string; end: string }, terms: string[]): Promise<OrganicTerm[]> {
  if (!terms.length) return [];
  const source = gscRowsSql('query', siteId, range);
  const term = normalizeSql('query');
  const rows = await queryAll<{ term: string; clicks: string | number; impressions: string | number; position: string | number | null }>(
    `WITH gsc_rows AS (${source.sql})
     SELECT ${term} AS term, SUM(clicks)::float8 AS clicks, SUM(impressions)::float8 AS impressions, (SUM(weighted) / NULLIF(SUM(impressions), 0))::float8 AS position
     FROM gsc_rows WHERE ${term} = ANY(?::text[]) GROUP BY 1`,
    [...source.values, terms],
  );
  return rows.map(row => ({
    term: row.term, clicks: Math.round(Number(row.clicks) || 0), impressions: Math.round(Number(row.impressions) || 0),
    position: row.position == null ? null : Number(row.position),
  }));
}

export interface PaidOrganicReport {
  range: { start: string; end: string };
  source: PaidSource;
  gsc: GscSiteStatus;
  thresholds: typeof PAID_ORGANIC;
  summary: PaidOrganicSummary;
  rows: PaidOrganicRow[];
  totalRows: number;
}

export function parsePaidSource(value: string | null): PaidSource {
  return value === 'keywords' ? 'keywords' : 'search-terms';
}

export async function getPaidOrganicReport(input: { start: string | null; end: string | null; account: string | null; source: string | null; limit?: number }): Promise<PaidOrganicReport> {
  const range = parseReportRange(input.start, input.end);
  const customerId = parseCustomerFilter(input.account);
  const source = parsePaidSource(input.source);
  const paid = source === 'keywords'
    ? aggregatePaidTerms((await keywordRows(range.start, range.end, customerId)).map(row => ({ text: row.keyword, cost: row.cost, clicks: row.clicks, impressions: row.impressions, conversions: row.conversions })), normalizeKeyword)
    : aggregatePaidTerms((await searchTermRows(range.start, range.end, customerId)).map(row => ({ text: row.searchTerm, cost: row.cost, clicks: row.clicks, impressions: row.impressions, conversions: row.conversions })));
  const gsc = await dupoinGscStatus(range);
  const organic = gsc.available && gsc.siteId ? await organicTerms(gsc.siteId, range, paid.map(term => term.term)) : [];
  const joined = joinPaidOrganic(paid, organic, {}, gsc.available);
  const limit = input.limit ?? PAID_ORGANIC.rowLimit;
  // Flagged rows first so the UI limit never hides them.
  const ordered = [...joined.rows.filter(row => row.flags.length), ...joined.rows.filter(row => !row.flags.length)];
  return { range: { start: range.start, end: range.end }, source, gsc, thresholds: PAID_ORGANIC, summary: joined.summary, rows: ordered.slice(0, limit), totalRows: joined.rows.length };
}
