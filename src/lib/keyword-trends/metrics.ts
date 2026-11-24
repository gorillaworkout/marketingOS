/**
 * Keyword Trends metrics: a TypeScript port of collector.py
 * (_idea_rows, the merge in collect_monthly_trends, and monthly_trend_rows).
 * Pure functions, no I/O. Percentages use a 0-100 scale rounded to 6 decimals.
 */
import type { DiscoverySource, RequestSpec } from './config';

export const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'] as const;
const MONTH_NUMBERS: Record<string, number> = Object.fromEntries(MONTH_NAMES.map((name, index) => [name, index + 1]));

export type TrendDirection = 'NEW' | 'RISING' | 'FALLING' | 'STABLE';
export type HeatLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface MonthlyVolume { year: number; month: number; searches: number }

export interface KeywordIdea {
  keyword: string;
  avgMonthlySearches: number;
  competition: string | null;
  competitionIndex: number | null;
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
  monthlyVolumes: MonthlyVolume[];
  concepts: string[];
  /** Every request source that returned this keyword, first one first. */
  discoverySources: DiscoverySource[];
}

export interface TrendRow {
  keyword: string;
  searchMonth: string; // YYYY-MM-01
  searchYear: number;
  searchMonthNumber: number;
  searchQuarter: number;
  keywordWordCount: number;
  keywordCharacterCount: number;
  isSeedKeyword: boolean;
  discoverySources: DiscoverySource[];
  concepts: string[];
  avgMonthlySearches: number;
  monthlySearches: number;
  previousMonthlySearches: number | null;
  momChangeAbs: number | null;
  momChangePct: number | null;
  trendDirection: TrendDirection;
  trendIndexPct: number | null;
  peakMonthlySearches: number;
  peakSharePct: number | null;
  heatRank: number;
  heatPercentilePct: number;
  heatLevel: HeatLevel;
  resultSetTotalAvgMonthlySearches: number;
  avgSearchSharePct: number | null;
  resultSetMonthlySearches: number;
  monthlySearchSharePct: number | null;
  monthlyRank: number;
  monthlyHeatPercentilePct: number;
  competition: string | null;
  competitionIndex: number | null;
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  bidMidpoint: number | null;
  bidRange: number | null;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** numerator * 100 / denominator, rounded to 6 decimals; null when the denominator is 0. */
export function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return round6((numerator * 100) / denominator);
}

function toInt(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function monthNumber(value: unknown): number | null {
  const text = String(value ?? '').toUpperCase();
  if (MONTH_NUMBERS[text]) return MONTH_NUMBERS[text];
  const numeric = Number(text);
  // REST can send the enum as its number: 2 = JANUARY ... 13 = DECEMBER.
  return Number.isInteger(numeric) && numeric >= 2 && numeric <= 13 ? numeric - 1 : null;
}

/** One GenerateKeywordIdeasResult (REST JSON) -> KeywordIdea. Returns null when there is no keyword text. */
export function parseIdea(result: Record<string, unknown>, source: DiscoverySource): KeywordIdea | null {
  const keyword = String(result.text ?? '').trim();
  if (!keyword) return null;
  const metrics = (result.keywordIdeaMetrics ?? {}) as Record<string, unknown>;
  const annotations = (result.keywordAnnotations ?? {}) as { concepts?: Array<{ name?: string }> };
  const volumes = Array.isArray(metrics.monthlySearchVolumes) ? metrics.monthlySearchVolumes as Array<Record<string, unknown>> : [];
  return {
    keyword,
    avgMonthlySearches: toInt(metrics.avgMonthlySearches),
    competition: typeof metrics.competition === 'string' ? metrics.competition : null,
    competitionIndex: toIntOrNull(metrics.competitionIndex),
    lowTopOfPageBidMicros: toIntOrNull(metrics.lowTopOfPageBidMicros),
    highTopOfPageBidMicros: toIntOrNull(metrics.highTopOfPageBidMicros),
    monthlyVolumes: volumes.flatMap(volume => {
      const month = monthNumber(volume.month);
      const year = toInt(volume.year);
      return month && year ? [{ year, month, searches: toInt(volume.monthlySearches) }] : [];
    }),
    concepts: (annotations.concepts ?? []).map(concept => String(concept.name ?? '')).filter(Boolean),
    discoverySources: [source],
  };
}

/**
 * Merge results of every request spec, de-duplicated by case-folded keyword.
 * The first spec that returned a keyword wins; later specs only add their
 * source. Each spec contributes at most `perSpecLimit` ideas; the merged list
 * is cut to `maxIdeas` (insertion order), as in collect_monthly_trends.
 */
export function mergeIdeas(batches: Array<{ spec: RequestSpec; results: Array<Record<string, unknown>> }>, maxIdeas: number, perSpecLimit = maxIdeas): KeywordIdea[] {
  const byKey = new Map<string, KeywordIdea>();
  for (const { spec, results } of batches) {
    for (const result of results.slice(0, perSpecLimit)) {
      const idea = parseIdea(result, spec.source);
      if (!idea) continue;
      const key = idea.keyword.toLocaleLowerCase();
      const stored = byKey.get(key);
      if (!stored) byKey.set(key, idea);
      else if (!stored.discoverySources.includes(spec.source)) stored.discoverySources.push(spec.source);
    }
  }
  return [...byKey.values()].slice(0, maxIdeas);
}

/** Dense rank, descending: value -> rank (1 = highest). */
function denseRanks(values: number[]): Map<number, number> {
  return new Map([...new Set(values)].sort((a, b) => b - a).map((value, index) => [value, index + 1]));
}

const monthKey = (year: number, month: number) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
const micros = (value: number | null) => (value === null ? null : value / 1_000_000);

/** Port of monthly_trend_rows: one row per keyword x month with trend and heat metrics inside this result set. */
export function monthlyTrendRows(ideas: KeywordIdea[], seedKeywords: readonly string[]): TrendRow[] {
  const averages = ideas.map(idea => idea.avgMonthlySearches);
  const totalAverage = averages.reduce((sum, value) => sum + value, 0);
  const averageRanks = denseRanks(averages);
  const monthlyTotals = new Map<string, number>();
  const monthlyValues = new Map<string, number[]>();
  for (const idea of ideas) {
    for (const volume of idea.monthlyVolumes) {
      const key = monthKey(volume.year, volume.month);
      monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + volume.searches);
      monthlyValues.set(key, [...(monthlyValues.get(key) ?? []), volume.searches]);
    }
  }
  const monthlyRanks = new Map([...monthlyValues].map(([key, values]) => [key, denseRanks(values)]));
  const seeds = new Set(seedKeywords.map(seed => seed.toLocaleLowerCase()));

  const rows: TrendRow[] = [];
  for (const idea of ideas) {
    const volumes = [...idea.monthlyVolumes].sort((a, b) => a.year - b.year || a.month - b.month);
    const peak = volumes.reduce((max, volume) => Math.max(max, volume.searches), 0);
    const average = idea.avgMonthlySearches;
    const percentile = average === 0 ? 0 : pct(averages.filter(value => value <= average).length, ideas.length) ?? 0;
    const heatLevel: HeatLevel = percentile >= 80 ? 'HIGH' : percentile >= 50 ? 'MEDIUM' : 'LOW';
    const low = idea.lowTopOfPageBidMicros;
    const high = idea.highTopOfPageBidMicros;
    let previous: number | null = null;
    for (const volume of volumes) {
      const searches = volume.searches;
      const key = monthKey(volume.year, volume.month);
      const sameMonth = monthlyValues.get(key) ?? [];
      const trendDirection: TrendDirection = previous === 0 && searches > 0 ? 'NEW'
        : previous !== null && searches > previous ? 'RISING'
          : previous !== null && searches < previous ? 'FALLING' : 'STABLE';
      rows.push({
        keyword: idea.keyword,
        searchMonth: `${key}-01`,
        searchYear: volume.year,
        searchMonthNumber: volume.month,
        searchQuarter: Math.floor((volume.month - 1) / 3) + 1,
        keywordWordCount: idea.keyword.split(/\s+/).filter(Boolean).length,
        keywordCharacterCount: [...idea.keyword].length,
        isSeedKeyword: seeds.has(idea.keyword.toLocaleLowerCase()),
        discoverySources: [...idea.discoverySources],
        concepts: [...idea.concepts],
        avgMonthlySearches: average,
        monthlySearches: searches,
        previousMonthlySearches: previous,
        momChangeAbs: previous === null ? null : searches - previous,
        momChangePct: previous === null ? null : pct(searches - previous, previous),
        trendDirection,
        trendIndexPct: pct(searches, average),
        peakMonthlySearches: peak,
        peakSharePct: pct(searches, peak),
        heatRank: averageRanks.get(average) ?? 0,
        heatPercentilePct: percentile,
        heatLevel,
        resultSetTotalAvgMonthlySearches: totalAverage,
        avgSearchSharePct: pct(average, totalAverage),
        resultSetMonthlySearches: monthlyTotals.get(key) ?? 0,
        monthlySearchSharePct: pct(searches, monthlyTotals.get(key) ?? 0),
        monthlyRank: monthlyRanks.get(key)?.get(searches) ?? 0,
        monthlyHeatPercentilePct: searches === 0 ? 0 : pct(sameMonth.filter(value => value <= searches).length, sameMonth.length) ?? 0,
        competition: idea.competition,
        competitionIndex: idea.competitionIndex,
        lowTopOfPageBidMicros: low,
        highTopOfPageBidMicros: high,
        lowTopOfPageBid: micros(low),
        highTopOfPageBid: micros(high),
        bidMidpoint: low !== null && high !== null ? (low + high) / 2_000_000 : null,
        bidRange: low !== null && high !== null ? (high - low) / 1_000_000 : null,
      });
      previous = searches;
    }
  }
  return rows;
}

/** One line per keyword for the page table: the latest month's row plus the series for the chart. */
export interface KeywordSummary {
  keyword: string;
  avgMonthlySearches: number;
  lastMonth: string | null;
  lastMonthSearches: number | null;
  momChangeAbs: number | null;
  momChangePct: number | null;
  trendDirection: TrendDirection | null;
  competition: string | null;
  competitionIndex: number | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  heatLevel: HeatLevel | null;
  isSeedKeyword: boolean;
  /** Searches per month, aligned with KeywordTrendsData.months (null when the keyword has no value for a month). */
  series: Array<number | null>;
}

export function summarizeKeywords(rows: TrendRow[]): { months: string[]; keywords: KeywordSummary[] } {
  const months = [...new Set(rows.map(row => row.searchMonth))].sort();
  const index = new Map(months.map((month, position) => [month, position]));
  const byKeyword = new Map<string, TrendRow[]>();
  for (const row of rows) byKeyword.set(row.keyword, [...(byKeyword.get(row.keyword) ?? []), row]);
  const keywords = [...byKeyword.values()].map(list => {
    const sorted = [...list].sort((a, b) => a.searchMonth.localeCompare(b.searchMonth));
    const last = sorted[sorted.length - 1];
    const series: Array<number | null> = months.map(() => null);
    for (const row of sorted) series[index.get(row.searchMonth)!] = row.monthlySearches;
    return {
      keyword: last.keyword, avgMonthlySearches: last.avgMonthlySearches, lastMonth: last.searchMonth, lastMonthSearches: last.monthlySearches,
      momChangeAbs: last.momChangeAbs, momChangePct: last.momChangePct, trendDirection: last.trendDirection,
      competition: last.competition, competitionIndex: last.competitionIndex, lowTopOfPageBid: last.lowTopOfPageBid, highTopOfPageBid: last.highTopOfPageBid,
      heatLevel: last.heatLevel, isSeedKeyword: last.isSeedKeyword, series,
    } satisfies KeywordSummary;
  });
  keywords.sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches || a.keyword.localeCompare(b.keyword));
  return { months, keywords };
}
