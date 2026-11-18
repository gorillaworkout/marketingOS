import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKeyword, normalizeSql, normalizeTerm } from '../src/lib/google-ads/text';
import { aggregatePaidTerms, flagsFor, joinPaidOrganic, parsePaidSource } from '../src/lib/google-ads/paid-organic';
import { keywordCandidates, negativeSuggestions, parseAmount } from '../src/lib/google-ads/search-term-insights';
import { addDays, detectAnomalies, detectScopeAnomalies, windows, type DayMetrics, type ScopeSeries } from '../src/lib/google-ads/anomalies';
import { ALERTS, PAID_ORGANIC } from '../src/lib/google-ads/insights-config';

test('normalizeTerm lowercases, trims, and collapses whitespace; keywords also drop match-type syntax', () => {
  assert.equal(normalizeTerm('  Trading   EMAS\tOnline \n'), 'trading emas online');
  assert.equal(normalizeTerm('DUPOIN'), 'dupoin');
  assert.equal(normalizeTerm('   '), '');
  assert.equal(normalizeKeyword('[Trading Emas]'), 'trading emas');
  assert.equal(normalizeKeyword('"broker  forex"'), 'broker forex');
  assert.equal(normalizeKeyword('+forex +legal'), 'forex legal');
  assert.equal(normalizeSql('query'), "btrim(regexp_replace(lower(query), '\\s+', ' ', 'g'))");
});

test('aggregatePaidTerms sums rows that normalize to the same term', () => {
  const terms = aggregatePaidTerms([
    { text: 'Trading Emas', cost: 100, clicks: 2, impressions: 10, conversions: 1 },
    { text: 'trading  emas ', cost: 50, clicks: 1, impressions: 5, conversions: 0 },
    { text: 'forex', cost: 10, clicks: 1, impressions: 3, conversions: 0 },
    { text: '   ', cost: 999, clicks: 9, impressions: 9, conversions: 9 },
  ]);
  assert.deepEqual(terms.find(term => term.term === 'trading emas'), { term: 'trading emas', cost: 150, clicks: 3, impressions: 15, conversions: 1, variants: 2 });
  assert.equal(terms.length, 2, 'blank terms are dropped');
  assert.deepEqual(aggregatePaidTerms([{ text: '[Dupoin]', cost: 1, clicks: 1, impressions: 1, conversions: 0 }], normalizeKeyword).map(term => term.term), ['dupoin']);
});

test('flags: top-3 organic while paying, and converting paid terms with weak organic', () => {
  const paid = (cost: number, conversions: number) => ({ term: 't', cost, clicks: 10, impressions: 100, conversions, variants: 1 });
  const organic = (position: number | null, clicks: number) => ({ term: 't', clicks, impressions: 1000, position });
  assert.deepEqual(flagsFor(paid(PAID_ORGANIC.minPaidCost, 0), organic(2.4, 50)), ['organic-top3-paying']);
  assert.deepEqual(flagsFor(paid(PAID_ORGANIC.minPaidCost - 1, 0), organic(2.4, 50)), [], 'below the spend floor');
  assert.deepEqual(flagsFor(paid(PAID_ORGANIC.minPaidCost, 0), organic(3.2, 50)), [], 'position 3.2 is not top 3');
  assert.deepEqual(flagsFor(paid(PAID_ORGANIC.minPaidCost, 0), organic(1.5, PAID_ORGANIC.minOrganicClicks - 1)), [], 'needs real organic clicks');
  assert.deepEqual(flagsFor(paid(1000, 2), null), ['seo-opportunity'], 'no organic data at all');
  assert.deepEqual(flagsFor(paid(1000, 2), organic(25, 40)), ['seo-opportunity'], 'ranks too low');
  assert.deepEqual(flagsFor(paid(1000, 2), organic(6, 2)), ['seo-opportunity'], 'too few organic clicks');
  assert.deepEqual(flagsFor(paid(1000, 2), organic(6, 40)), [], 'decent organic');
  assert.deepEqual(flagsFor(paid(1000, 0), null), [], 'no conversions, no opportunity');
  assert.deepEqual(flagsFor(paid(80_000, 3), organic(1.2, 500)), ['organic-top3-paying'], 'strong organic is not an SEO opportunity');
  assert.deepEqual(flagsFor(paid(1000, 0), organic(2, 50), { minPaidCost: 500 }), ['organic-top3-paying'], 'threshold overrides');
});

test('joinPaidOrganic matches by normalized text, computes savings and summary; no flags without GSC data', () => {
  const paid = aggregatePaidTerms([
    { text: 'Dupoin', cost: 200_000, clicks: 40, impressions: 400, conversions: 0 },
    { text: 'trading emas', cost: 90_000, clicks: 30, impressions: 300, conversions: 4 },
    { text: 'forex', cost: 10_000, clicks: 5, impressions: 50, conversions: 0 },
  ]);
  const organic = [{ term: 'DUPOIN ', clicks: 900, impressions: 3000, position: 1.1 }, { term: 'forex', clicks: 3, impressions: 900, position: 18 }];
  const { rows, summary } = joinPaidOrganic(paid, organic);
  const dupoin = rows.find(row => row.term === 'dupoin')!;
  assert.deepEqual(dupoin.flags, ['organic-top3-paying']);
  assert.equal(dupoin.potentialSavings, 200_000);
  assert.equal(dupoin.paid.avgCpc, 5000);
  assert.equal(dupoin.organic?.ctr, 0.3);
  assert.deepEqual(rows.find(row => row.term === 'trading emas')!.flags, ['seo-opportunity']);
  assert.equal(rows.find(row => row.term === 'trading emas')!.organic, null);
  assert.deepEqual(rows.map(row => row.term), ['dupoin', 'trading emas', 'forex'], 'sorted by paid cost');
  assert.deepEqual(summary, { paidTerms: 3, matched: 2, paidCost: 300_000, matchedPaidCost: 210_000, top3Paying: 1, potentialSavings: 200_000, seoOpportunities: 1, seoOpportunityConversions: 4 });
  const unavailable = joinPaidOrganic(paid, [], {}, false);
  assert.ok(unavailable.rows.every(row => row.flags.length === 0), 'never flag SEO opportunities when GSC data is missing');
  assert.equal(unavailable.summary.seoOpportunities, 0);
  assert.equal(parsePaidSource('keywords'), 'keywords');
  assert.equal(parsePaidSource('anything'), 'search-terms');
});

const term = (overrides: Partial<Parameters<typeof negativeSuggestions>[0][number]>) => ({
  customerId: '1111111145', accountName: 'Dupoin-ID1', campaignName: 'Search Brand', adGroupName: 'AG1', searchTerm: 'x', matchType: 'BROAD', status: 'NONE',
  cost: 0, clicks: 1, impressions: 10, conversions: 0, ...overrides,
});

test('negativeSuggestions: >= threshold spend with 0 conversions, per campaign, with wasted spend total', () => {
  const rows = [
    term({ searchTerm: 'Cara Main Slot', cost: 60_000, clicks: 6, adGroupName: 'AG1', matchType: 'BROAD' }),
    term({ searchTerm: 'cara  main slot', cost: 50_000, clicks: 4, adGroupName: 'AG2', matchType: 'PHRASE' }),
    term({ searchTerm: 'cara main slot', campaignName: 'Search Generic', cost: 40_000 }),
    term({ searchTerm: 'forex legal', cost: 500_000, conversions: 1 }),
    term({ searchTerm: 'already excluded', cost: 900_000, status: 'EXCLUDED' }),
    term({ searchTerm: 'cheap term', cost: 99_999 }),
  ];
  const result = negativeSuggestions(rows, 100_000);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], { customerId: '1111111145', accountName: 'Dupoin-ID1', campaignName: 'Search Brand', term: 'cara main slot', cost: 110_000, clicks: 10, impressions: 20, adGroups: 2, matchTypes: ['BROAD', 'PHRASE'] });
  assert.equal(result.wastedSpend, 110_000);
  assert.equal(negativeSuggestions(rows, 0).rows.length, 3, 'threshold 0 lists every 0-conversion term (excluded ones still skipped)');
  assert.equal(negativeSuggestions(rows, 0).wastedSpend, 60_000 + 50_000 + 40_000 + 99_999);
});

test('keywordCandidates: converting terms not yet keywords nor added/excluded, sorted by conversions', () => {
  const rows = [
    term({ searchTerm: 'Akun Demo Forex', conversions: 3, cost: 90_000, campaignName: 'A' }),
    term({ searchTerm: 'akun demo forex', conversions: 1, cost: 10_000, campaignName: 'B', matchType: 'PHRASE' }),
    term({ searchTerm: 'dupoin', conversions: 9, cost: 1000 }),
    term({ searchTerm: 'added term', conversions: 5, status: 'ADDED' }),
    term({ searchTerm: 'weak term', conversions: 0.5 }),
    term({ searchTerm: 'other account', conversions: 2, customerId: '2222229348' }),
  ];
  const keywords = new Map([['1111111145', new Set(['dupoin'])]]);
  const candidates = keywordCandidates(rows, keywords, 1);
  assert.deepEqual(candidates.map(row => row.term), ['akun demo forex', 'other account']);
  assert.deepEqual(candidates[0], { customerId: '1111111145', accountName: 'Dupoin-ID1', term: 'akun demo forex', conversions: 4, cost: 100_000, clicks: 2, campaigns: ['A', 'B'], matchTypes: ['BROAD', 'PHRASE'], costPerConversion: 25_000 });
  assert.equal(keywordCandidates(rows, keywords, 0.5).length, 3);
  assert.equal(parseAmount(null, 7, 'x'), 7);
  assert.equal(parseAmount('250000', 7, 'x'), 250_000);
  assert.throws(() => parseAmount('-1', 7, 'minCost'), /minCost must be a number/);
  assert.throws(() => parseAmount('abc', 7, 'minCost'), /minCost/);
});

// ---- Anomalies ----

const AS_OF = '2026-11-17';
function series(daily: (dayIndex: number, date: string) => Partial<DayMetrics> | null, overrides: Partial<ScopeSeries> = {}): ScopeSeries {
  const days: DayMetrics[] = [];
  const w = windows(AS_OF);
  for (let index = 0; index < ALERTS.recentDays + ALERTS.baselineDays; index += 1) {
    const date = addDays(w.baseline.start, index);
    const day = daily(index, date);
    if (day) days.push({ date, cost: 0, clicks: 0, impressions: 0, conversions: 0, ...day });
  }
  return { customerId: '1111111145', accountName: 'Dupoin-ID1', campaignId: '99', campaignName: 'Search Brand', campaignStatus: 'ENABLED', currency: 'IDR', days, ...overrides };
}
const isRecent = (index: number) => index >= ALERTS.baselineDays;
const steady = { cost: 1_000_000, clicks: 200, impressions: 4000, conversions: 5 };
const kinds = (s: ScopeSeries) => detectScopeAnomalies(s, AS_OF).map(alert => `${alert.kind}:${alert.severity}`).sort();

test('anomaly windows: 7 days ending asOf vs the 28 days before', () => {
  assert.deepEqual(windows(AS_OF), { recent: { start: '2026-11-11', end: '2026-11-17' }, baseline: { start: '2026-10-14', end: '2026-11-10' } });
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('steady campaign raises nothing', () => {
  assert.deepEqual(kinds(series(() => steady)), []);
});

test('spend spike and CPC rise (warning vs critical)', () => {
  // Spend x1.6 with the same clicks -> spend spike + CPC rise, both warnings.
  assert.deepEqual(kinds(series(index => (isRecent(index) ? { ...steady, cost: 1_600_000 } : steady))), ['cpa_rise:warning', 'cpc_rise:warning', 'spend_spike:warning']);
  // Spend x2.2 -> critical.
  const critical = detectScopeAnomalies(series(index => (isRecent(index) ? { ...steady, cost: 2_200_000, clicks: 440, conversions: 11 } : steady)), AS_OF);
  assert.deepEqual(critical.map(alert => `${alert.kind}:${alert.severity}`), ['spend_spike:critical']);
  assert.match(critical[0].message, /IDR 2,200,000\/day .* IDR 1,000,000\/day .*\+120%/);
  assert.equal(critical[0].changeRatio, 2.2);
  // Ratio met but the daily increase is below the campaign floor: no spike.
  assert.deepEqual(kinds(series(index => (isRecent(index) ? { cost: 150_000, clicks: 50, conversions: 1 } : { cost: 90_000, clicks: 30, conversions: 1 }))), []);
  // Account level uses the higher floor.
  const account = (recentCost: number) => kinds(series(index => (isRecent(index) ? { cost: recentCost, clicks: 400, conversions: 10 } : { cost: 800_000, clicks: 400, conversions: 10 }), { campaignId: '', campaignName: '' }));
  assert.deepEqual(account(1_290_000), ['cpa_rise:warning', 'cpc_rise:warning'], '+490k/day is under the 500k account floor');
  assert.deepEqual(account(1_300_000), ['cpa_rise:warning', 'cpc_rise:warning', 'spend_spike:warning'], '+500k/day meets it');
});

test('CPC rise needs enough clicks in both windows', () => {
  const few = series(index => (isRecent(index) ? { cost: 20_000, clicks: 10 } : { cost: 10_000, clicks: 10 }));
  assert.deepEqual(kinds(few), [], '70 recent clicks < 100');
});

test('cost per conversion rise and conversions drop', () => {
  // Same spend, conversions 5/day -> 2/day: CPA x2.5 (critical) and conversions -60% (warning at 0.4 ratio <= 0.6, critical <= 0.5).
  assert.deepEqual(kinds(series(index => (isRecent(index) ? { ...steady, conversions: 2 } : steady))), ['conversions_drop:critical', 'cpa_rise:critical']);
  // 5 -> 3.5/day: CPA x1.43 warning, drop to 70% (no drop alert).
  assert.deepEqual(kinds(series(index => (isRecent(index) ? { ...steady, conversions: 3.5 } : steady))), ['cpa_rise:warning']);
  // Too few baseline conversions: no CPA or drop alerts.
  assert.deepEqual(kinds(series(index => (isRecent(index) ? { ...steady, conversions: 0 } : { ...steady, conversions: index % 2 ? 1 : 0 }))), []);
});

test('spend stopped: critical for enabled campaigns, warning when paused, skipped when removed; other rules skipped', () => {
  const stopped = (status: string, campaignId = '99') => series((index, date) => (date >= addDays(AS_OF, -1) ? null : steady), { campaignStatus: status, campaignId });
  assert.deepEqual(kinds(stopped('ENABLED')), ['spend_stopped:critical']);
  assert.deepEqual(kinds(stopped('PAUSED')), ['spend_stopped:warning']);
  assert.match(detectScopeAnomalies(stopped('PAUSED'), AS_OF)[0].message, /Campaign status is paused/);
  assert.deepEqual(kinds(stopped('REMOVED')), [], 'removed campaigns are expected to stop');
  assert.deepEqual(kinds(series((index, date) => (date >= addDays(AS_OF, -1) ? null : steady), { campaignId: '', campaignName: '', campaignStatus: undefined })), ['spend_stopped:critical'], 'account level');
  // One day of 0 is not "stopped".
  assert.deepEqual(kinds(series((index, date) => (date === AS_OF ? null : steady))), []);
  // Campaigns that barely spent are ignored.
  assert.deepEqual(kinds(series((index, date) => (date >= addDays(AS_OF, -1) ? null : { cost: 50_000, clicks: 10 }))), []);
  // Sporadic spend in the baseline is not "steady".
  assert.ok(!kinds(series((index, date) => (date >= addDays(AS_OF, -1) || index % 3 ? null : { ...steady, cost: 3_000_000 }))).some(kind => kind.startsWith('spend_stopped')));
});

test('detectAnomalies runs every scope', () => {
  const alerts = detectAnomalies([series(() => steady), series(index => (isRecent(index) ? { ...steady, cost: 2_200_000, clicks: 440, conversions: 11 } : steady), { campaignId: '7' })], AS_OF);
  assert.deepEqual(alerts.map(alert => [alert.campaignId, alert.kind]), [['7', 'spend_spike']]);
  assert.equal(alerts[0].details.recentStart, '2026-11-11');
});
