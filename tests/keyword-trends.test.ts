import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { accountFeatureFromPath, isDashboardNavItemVisible, shouldBlockDashboardGenerationPath } from '../src/lib/authorization';
import { createGoogleAdsClient, type GoogleAdsClient, type GoogleAdsRow, type KeywordPlannerClient } from '../src/lib/google-ads/client';
import type { GoogleAdsConfig } from '../src/lib/google-ads/config';
import { collectKeywordTrends, jakartaDate, pickPlannerAccount, runKeywordTrendsFetch, type CollectedTrends, type KeywordTrendsStore } from '../src/lib/keyword-trends/collector';
import { buildIdeasRequest, KEYWORD_TRENDS_CONFIG, KEYWORD_TRENDS_CRON_UTC, requestSpecs } from '../src/lib/keyword-trends/config';
import { buildKeywordTrendsWorkbook, cellValue, selectRecentMonths } from '../src/lib/keyword-trends/export';
import { mergeIdeas, monthlyTrendRows, parseIdea, pct, summarizeKeywords, type KeywordIdea } from '../src/lib/keyword-trends/metrics';
import { buildInsertSql, ROW_COLUMNS, rowValues } from '../src/lib/keyword-trends/store';
import { filterAndSortKeywords } from '../src/lib/keyword-trends/table';

const read = (file: string) => readFileSync(file, 'utf8');

function idea(keyword: string, avg: number, months: Array<[number, number, number]>, extra: Partial<KeywordIdea> = {}): KeywordIdea {
  return {
    keyword, avgMonthlySearches: avg, competition: 'MEDIUM', competitionIndex: 40, lowTopOfPageBidMicros: 1_500_000_000, highTopOfPageBidMicros: 4_000_000_000,
    monthlyVolumes: months.map(([year, month, searches]) => ({ year, month, searches })), concepts: [], discoverySources: ['keyword'], ...extra,
  };
}

test('config: fixed Dupoin settings, request specs mirror _request_specs, REST body', () => {
  assert.deepEqual([...KEYWORD_TRENDS_CONFIG.seedKeywords], ['forex']);
  assert.equal(KEYWORD_TRENDS_CONFIG.pageUrl, 'https://dupoin.com/');
  assert.deepEqual([...KEYWORD_TRENDS_CONFIG.geoIds], ['2360']);
  assert.equal(KEYWORD_TRENDS_CONFIG.languageId, '1025');
  assert.equal(KEYWORD_TRENDS_CONFIG.maxIdeas, 1000);
  assert.equal(KEYWORD_TRENDS_CONFIG.includeAdultKeywords, false);
  assert.deepEqual(requestSpecs(['forex'], 'https://dupoin.com/', 20), [{ source: 'keyword', keywords: ['forex'] }, { source: 'site', keywords: [] }]);
  const many = Array.from({ length: 45 }, (_, index) => `k${index}`);
  assert.deepEqual(requestSpecs(many, null, 20).map(spec => spec.keywords.length), [20, 20, 5]);
  assert.deepEqual(requestSpecs([' a ', 'a', ''], null, 20), [{ source: 'keyword', keywords: ['a'] }]);
  assert.throws(() => requestSpecs([], null, 20), /cannot both be empty/);
  assert.deepEqual(buildIdeasRequest({ source: 'keyword', keywords: ['forex'] }), {
    language: 'languageConstants/1025', geoTargetConstants: ['geoTargetConstants/2360'], keywordPlanNetwork: 'GOOGLE_SEARCH', includeAdultKeywords: false,
    keywordAnnotation: ['KEYWORD_CONCEPT'], pageSize: 1000, keywordSeed: { keywords: ['forex'] },
  });
  const site = buildIdeasRequest({ source: 'site', keywords: [] });
  assert.deepEqual(site.siteSeed, { site: 'https://dupoin.com/' });
  assert.equal(site.keywordSeed, undefined);
  assert.equal(KEYWORD_TRENDS_CRON_UTC, '0 23 2 * *', '06:00 WIB on the 3rd = 23:00 UTC on the 2nd');
});

test('parseIdea maps REST JSON (int64 strings, month enums) and mergeIdeas de-dupes by case-folded keyword, first spec wins', () => {
  const parsed = parseIdea({
    text: 'Forex', keywordIdeaMetrics: {
      avgMonthlySearches: '33100', competition: 'MEDIUM', competitionIndex: '35', lowTopOfPageBidMicros: '2210000000', highTopOfPageBidMicros: '7531000000',
      monthlySearchVolumes: [{ month: 'OCTOBER', year: '2026', monthlySearches: '33100' }, { month: 13, year: '2025', monthlySearches: '27100' }, { month: 'SEPTEMBER', year: '2026' }],
    }, keywordAnnotations: { concepts: [{ name: 'Non-Brands' }] },
  }, 'keyword')!;
  assert.equal(parsed.avgMonthlySearches, 33100);
  assert.equal(parsed.competitionIndex, 35);
  assert.equal(parsed.highTopOfPageBidMicros, 7_531_000_000);
  assert.deepEqual(parsed.monthlyVolumes, [{ year: 2026, month: 10, searches: 33100 }, { year: 2025, month: 12, searches: 27100 }, { year: 2026, month: 9, searches: 0 }]);
  assert.deepEqual(parsed.concepts, ['Non-Brands']);
  assert.equal(parseIdea({ text: '  ' }, 'site'), null);
  assert.equal(parseIdea({ text: 'x' }, 'site')!.lowTopOfPageBidMicros, null);

  const merged = mergeIdeas([
    { spec: { source: 'keyword', keywords: ['forex'] }, results: [{ text: 'forex' }, { text: 'Trading Forex' }, { text: 'a' }] },
    { spec: { source: 'site', keywords: [] }, results: [{ text: 'trading forex' }, { text: 'dupoin' }, { text: 'b' }] },
  ], 4, 2);
  assert.deepEqual(merged.map(item => item.keyword), ['forex', 'Trading Forex', 'dupoin'], 'per-spec limit 2, then max 4 in insertion order');
  assert.deepEqual(merged[1].discoverySources, ['keyword', 'site']);
  assert.deepEqual(merged[2].discoverySources, ['site']);
});

test('monthlyTrendRows reproduces collector.py metrics', () => {
  const ideas = [
    idea('forex', 300, [[2026, 9, 200], [2026, 7, 0], [2026, 8, 100]]),
    idea('trading', 100, [[2026, 7, 50], [2026, 8, 50], [2026, 9, 200]], { lowTopOfPageBidMicros: null }),
    idea('zero', 0, [[2026, 7, 0], [2026, 8, 0], [2026, 9, 0]], { competition: null, competitionIndex: null }),
  ];
  const rows = monthlyTrendRows(ideas, ['Forex']);
  assert.equal(rows.length, 9);
  const forex = rows.filter(row => row.keyword === 'forex');
  assert.deepEqual(forex.map(row => row.searchMonth), ['2026-07-01', '2026-08-01', '2026-09-01'], 'months sorted');
  assert.deepEqual(forex.map(row => row.trendDirection), ['STABLE', 'NEW', 'RISING']);
  assert.deepEqual(forex.map(row => row.previousMonthlySearches), [null, 0, 100]);
  assert.deepEqual(forex.map(row => row.momChangeAbs), [null, 100, 100]);
  assert.deepEqual(forex.map(row => row.momChangePct), [null, null, 100], 'previous 0 -> no pct');
  assert.equal(forex[2].trendIndexPct, pct(200, 300));
  assert.equal(forex[2].trendIndexPct, 66.666667);
  assert.equal(forex[2].peakMonthlySearches, 200);
  assert.equal(forex[1].peakSharePct, 50);
  assert.equal(forex[0].isSeedKeyword, true, 'case-insensitive seed match');
  assert.equal(forex[0].searchQuarter, 3);
  assert.equal(forex[0].heatRank, 1);
  assert.equal(forex[0].heatPercentilePct, 100);
  assert.equal(forex[0].heatLevel, 'HIGH');
  assert.equal(forex[0].resultSetTotalAvgMonthlySearches, 400);
  assert.equal(forex[0].avgSearchSharePct, 75);
  assert.equal(forex[0].lowTopOfPageBid, 1500);
  assert.equal(forex[0].highTopOfPageBid, 4000);
  assert.equal(forex[0].bidMidpoint, 2750);
  assert.equal(forex[0].bidRange, 2500);
  // September: forex 200, trading 200, zero 0 -> total 400, dense ranks 1,1,2.
  assert.equal(forex[2].resultSetMonthlySearches, 400);
  assert.equal(forex[2].monthlySearchSharePct, 50);
  assert.equal(forex[2].monthlyRank, 1);
  assert.equal(forex[2].monthlyHeatPercentilePct, 100);

  const trading = rows.filter(row => row.keyword === 'trading');
  assert.deepEqual(trading.map(row => row.trendDirection), ['STABLE', 'STABLE', 'RISING']);
  assert.deepEqual(trading.map(row => row.momChangePct), [null, 0, 300]);
  assert.equal(trading[0].heatRank, 2);
  assert.equal(trading[0].heatPercentilePct, 66.666667, '2 of 3 averages are at or below 100');
  assert.equal(trading[0].heatLevel, 'MEDIUM');
  assert.equal(trading[0].lowTopOfPageBid, null);
  assert.equal(trading[0].bidMidpoint, null);
  assert.equal(trading[0].isSeedKeyword, false);
  // July: forex 0, trading 50, zero 0 -> trading rank 1, forex rank 2, monthly percentile of 50 = 100.
  assert.equal(trading[0].monthlyRank, 1);
  assert.equal(forex[0].monthlyRank, 2);
  assert.equal(forex[0].monthlyHeatPercentilePct, 0, '0 searches -> 0');

  const zero = rows.filter(row => row.keyword === 'zero');
  assert.equal(zero[0].heatPercentilePct, 0);
  assert.equal(zero[0].heatLevel, 'LOW');
  assert.equal(zero[0].heatRank, 3);
  assert.equal(zero[0].trendIndexPct, null, 'avg 0 -> no trend index');
  assert.equal(zero[0].peakSharePct, null);
  assert.equal(zero[0].avgSearchSharePct, 0);
  assert.deepEqual(zero.map(row => row.trendDirection), ['STABLE', 'STABLE', 'STABLE']);

  const falling = monthlyTrendRows([idea('x', 10, [[2025, 12, 30], [2026, 1, 10]])], []);
  assert.deepEqual(falling.map(row => [row.searchMonth, row.trendDirection, row.momChangePct]), [['2025-12-01', 'STABLE', null], ['2026-01-01', 'FALLING', -66.666667]]);
});

test('summarizeKeywords gives one line per keyword with the latest month and an aligned series', () => {
  const rows = monthlyTrendRows([idea('a', 10, [[2026, 8, 5], [2026, 9, 15]]), idea('b', 50, [[2026, 9, 50]])], []);
  const summary = summarizeKeywords(rows);
  assert.deepEqual(summary.months, ['2026-08-01', '2026-09-01']);
  assert.deepEqual(summary.keywords.map(row => row.keyword), ['b', 'a'], 'sorted by avg desc');
  const a = summary.keywords[1];
  assert.equal(a.lastMonth, '2026-09-01');
  assert.equal(a.lastMonthSearches, 15);
  assert.equal(a.momChangeAbs, 10);
  assert.equal(a.momChangePct, 200);
  assert.equal(a.trendDirection, 'RISING');
  assert.deepEqual(a.series, [5, 15]);
  assert.deepEqual(summary.keywords[0].series, [null, 50]);
});

test('table filter and sort: text, trend, competition, min volume; nulls last', () => {
  const base = summarizeKeywords(monthlyTrendRows([
    idea('forex trading', 500, [[2026, 8, 400], [2026, 9, 500]], { competition: 'HIGH' }),
    idea('forex', 1000, [[2026, 8, 1200], [2026, 9, 1000]], { competition: 'LOW', lowTopOfPageBidMicros: null }),
    idea('saham', 50, [[2026, 8, 50], [2026, 9, 50]], { competition: null }),
  ], [])).keywords;
  const all = { text: '', trend: 'all' as const, competition: 'all', minVolume: null };
  assert.deepEqual(filterAndSortKeywords(base, { ...all, text: 'FOREX' }, { key: 'avgMonthlySearches', desc: true }).map(row => row.keyword), ['forex', 'forex trading']);
  assert.deepEqual(filterAndSortKeywords(base, { ...all, trend: 'RISING' }, { key: 'keyword', desc: false }).map(row => row.keyword), ['forex trading']);
  assert.deepEqual(filterAndSortKeywords(base, { ...all, competition: 'UNSPECIFIED' }, { key: 'keyword', desc: false }).map(row => row.keyword), ['saham']);
  assert.deepEqual(filterAndSortKeywords(base, { ...all, minVolume: 100 }, { key: 'avgMonthlySearches', desc: false }).map(row => row.keyword), ['forex trading', 'forex']);
  assert.deepEqual(filterAndSortKeywords(base, all, { key: 'competition', desc: true }).map(row => row.keyword), ['forex trading', 'forex', 'saham']);
  assert.deepEqual(filterAndSortKeywords(base, all, { key: 'lowTopOfPageBid', desc: false }).map(row => row.keyword).at(-1), 'forex', 'null bid sorts last');
  assert.deepEqual(filterAndSortKeywords(base, all, { key: 'lowTopOfPageBid', desc: true }).map(row => row.keyword).at(-1), 'forex', 'null bid sorts last both ways');
});

test('Excel export: last 3 months, Summary / Detail / Column guide, numeric percentages with 0.00%', async () => {
  const months: Array<[number, number, number]> = [[2026, 6, 10], [2026, 7, 20], [2026, 8, 10], [2026, 9, 40]];
  const rows = monthlyTrendRows([idea('forex', 20, months), idea('=cmd', 5, months.map(([y, m]) => [y, m, 5]))], ['forex']);
  const picked = selectRecentMonths(rows, 3);
  assert.deepEqual(picked.months, ['2026-07-01', '2026-08-01', '2026-09-01']);
  assert.equal(picked.rows.length, 6);
  assert.throws(() => selectRecentMonths(rows, 0), /at least 1/);
  assert.equal(cellValue('pct', 12.5), 0.125);
  assert.equal(cellValue('pct', null), null);
  assert.equal(cellValue('text', '=SUM(A1)'), "'=SUM(A1)");

  const { buffer, months: exported, rows: count } = await buildKeywordTrendsWorkbook(rows, {
    reportDate: '2026-11-03', fetchedAt: '2026-11-02T23:00:05Z', accountName: 'Dupoin-ID1', currencyCode: 'IDR', config: KEYWORD_TRENDS_CONFIG,
  });
  assert.deepEqual(exported, picked.months);
  assert.equal(count, 6);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Summary', 'Detail', 'Column guide']);

  const summary = workbook.getWorksheet('Summary')!;
  const summaryMap = new Map<string, unknown>();
  summary.eachRow((row, index) => { if (index > 1) summaryMap.set(String(row.getCell(1).value), row.getCell(2).value); });
  assert.equal(summaryMap.get('Snapshot date'), '2026-11-03');
  assert.equal(summaryMap.get('Months exported'), '2026-07-01, 2026-08-01, 2026-09-01');
  assert.equal(summaryMap.get('Detail rows'), 6);
  assert.equal(summaryMap.get('Keywords'), 2);
  assert.match(String(summaryMap.get('Fetched at')), /WIB$/);

  const detail = workbook.getWorksheet('Detail')!;
  assert.equal(detail.rowCount, 7, 'header + 6 rows');
  const headers = (detail.getRow(1).values as unknown[]).slice(1).map(String);
  const col = (name: string) => headers.indexOf(name) + 1;
  assert.ok(col('MoM change %') > 0 && col('Top of page bid low (IDR)') > 0 && col('Column guide') === 0);
  // Row 2 = '=cmd' (sorted case-insensitively, '=' < 'f'), July.
  const injected = detail.getRow(2);
  assert.equal(injected.getCell(col('Keyword')).value, "'=cmd");
  const forexSep = detail.getRow(7);
  assert.equal(forexSep.getCell(col('Keyword')).value, 'forex');
  assert.equal(forexSep.getCell(col('Monthly searches')).value, 40);
  assert.equal(forexSep.getCell(col('MoM change')).value, 30);
  assert.equal(forexSep.getCell(col('MoM change %')).value, 3, '300% stored as 3');
  assert.equal(forexSep.getCell(col('MoM change %')).numFmt, '0.00%');
  assert.equal(forexSep.getCell(col('Trend index %')).value, 2);
  assert.equal(forexSep.getCell(col('Trend')).value, 'RISING');
  assert.equal(forexSep.getCell(col('Seed keyword')).value, 'Yes');
  assert.equal(forexSep.getCell(col('Top of page bid low (IDR)')).value, 1500);
  assert.equal(forexSep.getCell(col('Monthly searches')).numFmt, '#,##0');
  const searchMonth = forexSep.getCell(col('Search month')).value as Date;
  assert.equal(searchMonth.toISOString().slice(0, 10), '2026-09-01');
  for (const header of headers.filter(name => name.endsWith('%'))) {
    assert.equal(detail.getRow(3).getCell(col(header)).numFmt, '0.00%', header);
    const value = detail.getRow(3).getCell(col(header)).value;
    assert.ok(value === null || typeof value === 'number', `${header} is numeric`);
  }

  const guide = workbook.getWorksheet('Column guide')!;
  assert.equal(guide.rowCount, headers.length + 1);
  assert.equal(guide.getRow(1).getCell(1).value, 'Column');
  const text = read('src/lib/keyword-trends/export.ts');
  assert.doesNotMatch(text, /[\u4e00-\u9fff]/, 'export is English only');
});

test('client.generateKeywordIdeas: POST customers/{id}:generateKeywordIdeas, pages to the limit, MCC login header', async () => {
  const config: GoogleAdsConfig = { developerToken: 'dev-token-123456', clientId: 'client-id-123456', clientSecret: 'secret-123456', refreshToken: 'refresh-123456', loginCustomerId: '1112223333', customerIds: [], apiVersion: 'v23' };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let page = 0;
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.fake', expires_in: 3600 }), { status: 200 });
    page += 1;
    const results = Array.from({ length: 3 }, (_, index) => ({ text: `kw-${page}-${index}` }));
    return new Response(JSON.stringify({ results, nextPageToken: page < 5 ? `p${page}` : undefined }), { status: 200 });
  };
  const client = createGoogleAdsClient(config, { fetch: fetchFn, sleep: async () => {} });
  const ideas = await client.generateKeywordIdeas('4445556666', buildIdeasRequest({ source: 'keyword', keywords: ['forex'] }), { limit: 7 });
  assert.equal(ideas.length, 7);
  const api = calls.filter(call => call.url.includes('googleads'));
  assert.equal(api.length, 3, 'stops paging once the limit is reached');
  assert.equal(api[0].url, 'https://googleads.googleapis.com/v23/customers/4445556666:generateKeywordIdeas');
  assert.equal(api[0].init.method, 'POST');
  assert.equal((api[0].init.headers as Record<string, string>)['login-customer-id'], '1112223333');
  assert.equal(JSON.parse(String(api[0].init.body)).pageToken, undefined);
  assert.equal(JSON.parse(String(api[1].init.body)).pageToken, 'p1');
  assert.deepEqual(JSON.parse(String(api[1].init.body)).keywordSeed, { keywords: ['forex'] });
  await assert.rejects(client.generateKeywordIdeas('123', {}), /Invalid customer id/);
});

function fakePlannerClient(failWith?: Error): GoogleAdsClient & KeywordPlannerClient & { requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    async listAccessibleCustomers() { return []; },
    async search(): Promise<GoogleAdsRow[]> {
      return [
        { customerClient: { id: '1112223333', descriptiveName: 'Dupoin MCC', manager: true, status: 'ENABLED', currencyCode: 'IDR' } },
        { customerClient: { id: '9990001111', descriptiveName: 'A-Test', manager: false, status: 'ENABLED', currencyCode: 'IDR', testAccount: true } },
        { customerClient: { id: '5556667777', descriptiveName: 'Dupoin-ID2', manager: false, status: 'ENABLED', currencyCode: 'IDR' } },
        { customerClient: { id: '4445556666', descriptiveName: 'Dupoin-ID1', manager: false, status: 'ENABLED', currencyCode: 'IDR' } },
        { customerClient: { id: '7778889999', descriptiveName: 'AAA USD', manager: false, status: 'ENABLED', currencyCode: 'USD' } },
      ];
    },
    async generateKeywordIdeas(customerId, request) {
      if (failWith) throw failWith;
      requests.push({ customerId, request });
      const volumes = [{ month: 'AUGUST', year: '2026', monthlySearches: '10' }, { month: 'SEPTEMBER', year: '2026', monthlySearches: '20' }];
      return request.siteSeed
        ? [{ text: 'Forex', keywordIdeaMetrics: { avgMonthlySearches: '15', monthlySearchVolumes: volumes } }, { text: 'dupoin', keywordIdeaMetrics: { avgMonthlySearches: '5', monthlySearchVolumes: volumes } }]
        : [{ text: 'forex', keywordIdeaMetrics: { avgMonthlySearches: '15', monthlySearchVolumes: volumes } }];
    },
  };
}

test('collector: picks the first enabled IDR client account, runs keyword + site specs, merges and computes rows', async () => {
  assert.equal(pickPlannerAccount([])?.customerId, undefined);
  const client = fakePlannerClient();
  const collected = await collectKeywordTrends(client, '1112223333');
  assert.equal(collected.account.customerId, '4445556666', 'IDR first, then name; skips manager and test accounts');
  assert.equal(client.requests.length, 2);
  assert.equal(collected.ideasCount, 2);
  assert.deepEqual(collected.rows.map(row => row.keyword), ['forex', 'forex', 'dupoin', 'dupoin']);
  assert.deepEqual(collected.rows[0].discoverySources, ['keyword', 'site']);
  assert.equal(collected.rows[0].isSeedKeyword, true);
  assert.equal(collected.firstMonth, '2026-08-01');
  assert.equal(collected.lastMonth, '2026-09-01');
  assert.equal(jakartaDate(new Date('2026-11-02T23:00:00Z')), '2026-11-03', 'cron at 23:00 UTC on the 2nd is the 3rd in Jakarta');
});

function memoryStore() {
  const snapshots: Array<{ id: string; status: string; trigger: string; error?: string; collected?: CollectedTrends }> = [];
  const store: KeywordTrendsStore = {
    async startSnapshot({ id, trigger }) {
      if (snapshots.some(item => item.status === 'running')) return false;
      snapshots.push({ id, status: 'running', trigger });
      return true;
    },
    async completeSnapshot(id, collected) { Object.assign(snapshots.find(item => item.id === id)!, { status: 'succeeded', collected }); },
    async failSnapshot(id, error) { Object.assign(snapshots.find(item => item.id === id)!, { status: 'failed', error }); },
  };
  return { store, snapshots };
}

test('runKeywordTrendsFetch: succeeded, busy when another fetch runs, failed with a sanitized error', async () => {
  const { store, snapshots } = memoryStore();
  let id = 0;
  const deps = (client: GoogleAdsClient & KeywordPlannerClient) => ({ store, newId: () => `s${++id}`, createClient: async () => ({ client, loginCustomerId: '1112223333', secrets: ['super-secret-dev-token'] }) });
  const ok = await runKeywordTrendsFetch({ trigger: 'scheduled' }, deps(fakePlannerClient()));
  assert.equal(ok.status, 'succeeded');
  assert.equal(snapshots[0].status, 'succeeded');
  assert.equal(snapshots[0].trigger, 'scheduled');

  snapshots.push({ id: 'other', status: 'running', trigger: 'manual' });
  const busy = await runKeywordTrendsFetch({ trigger: 'manual' }, deps(fakePlannerClient()));
  assert.equal(busy.status, 'busy');
  snapshots.pop();

  const failed = await runKeywordTrendsFetch({ trigger: 'manual' }, deps(fakePlannerClient(new Error('403 for super-secret-dev-token: DEVELOPER_TOKEN_NOT_APPROVED'))));
  assert.equal(failed.status, 'failed');
  assert.ok('error' in failed && !failed.error.includes('super-secret-dev-token'));
  assert.match(snapshots.at(-1)!.error!, /DEVELOPER_TOKEN_NOT_APPROVED/);
});

test('store: insert SQL matches the row values and the migration columns', () => {
  const rows = monthlyTrendRows([idea('forex', 10, [[2026, 9, 10]])], ['forex']);
  assert.equal(rowValues('s1', rows[0]).length, ROW_COLUMNS.length);
  const sql = buildInsertSql(2);
  assert.equal((sql.match(/\?/g) ?? []).length, ROW_COLUMNS.length * 2);
  const migration = read('db/migrations/068_keyword_trends.sql');
  for (const column of ROW_COLUMNS) assert.match(migration, new RegExp(`\\b${column}\\b`), column);
});

test('migration 068 is additive with no placeholder character; rollback drops both tables', () => {
  const sql = read('db/migrations/068_keyword_trends.sql');
  const rollback = read('db/rollbacks/068_keyword_trends_down.sql');
  assert.ok(!sql.includes('?') && !rollback.includes('?'), 'the migration runner treats the question mark as a placeholder');
  assert.match(sql, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE departments/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS keyword_trend_snapshots\b/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS keyword_trend_rows\b/);
  assert.match(sql, /idx_keyword_trend_snapshots_one_running/);
  assert.match(rollback, /DROP TABLE IF EXISTS keyword_trend_rows;/);
  assert.match(rollback, /DROP TABLE IF EXISTS keyword_trend_snapshots;/);
  assert.match(rollback, /DELETE FROM schema_migrations WHERE name = '068_keyword_trends\.sql'/);
});

test('access: Keyword Trends uses the google-ads grant; every route requires it; sidebar entry; no treg', () => {
  const member = (features: string[]) => ({ role: 'member', features });
  assert.equal(accountFeatureFromPath('/dashboard/paid-media/keyword-trends'), 'google-ads');
  assert.equal(shouldBlockDashboardGenerationPath(member(['seo']), '/dashboard/paid-media/keyword-trends'), true);
  assert.equal(shouldBlockDashboardGenerationPath(member(['google-ads']), '/dashboard/paid-media/keyword-trends'), false);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'admin', features: [] }, '/dashboard/paid-media/keyword-trends'), false);
  const item = { href: '/dashboard/paid-media/keyword-trends', feature: 'google-ads' as const };
  assert.equal(isDashboardNavItemVisible(item, member([])), false);
  assert.equal(isDashboardNavItemVisible(item, member(['google-ads'])), true);
  assert.match(read('src/app/dashboard/layout.tsx'), /\{ href: '\/dashboard\/paid-media\/keyword-trends', label: 'Keyword Trends', icon: '[a-z]+', feature: 'google-ads' \}/);
  for (const route of ['', '/fetch', '/export'].map(name => `src/app/api/paid-media/keyword-trends${name}/route.ts`)) {
    const source = read(route);
    const handlers = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b[\s\S]*?\n}/g)];
    assert.ok(handlers.length > 0, route);
    for (const handler of handlers) {
      assert.match(handler[0], /requireFeature\(request, 'google-ads'\)[\s\S]*?if \('error' in auth\) return NextResponse\.json\(\{ error: auth\.error \}, \{ status: auth\.status \}\);/, `${route} ${handler[1]}`);
    }
  }
  const page = read('src/app/dashboard/paid-media/keyword-trends/page.tsx');
  for (const label of ['Keyword Trends', 'Fetch now', 'Export Excel', 'Avg monthly searches', 'Last month', 'MoM %', 'Trend', 'Competition', 'CPC low', 'CPC high', 'Min avg volume', 'Last fetch']) assert.ok(page.includes(label), label);
  for (const file of ['src/lib/keyword-trends/config.ts', 'src/lib/keyword-trends/metrics.ts', 'src/lib/keyword-trends/collector.ts', 'src/lib/keyword-trends/store.ts',
    'src/lib/keyword-trends/service.ts', 'src/lib/keyword-trends/export.ts', 'scripts/keyword-trends-fetch.ts', 'src/app/api/paid-media/keyword-trends/fetch/route.ts']) {
    const source = read(file);
    assert.doesNotMatch(source, /treg/i, `${file} must not use treg`);
    assert.doesNotMatch(source, /ya29\.[A-Za-z0-9_-]{20,}|1\/\/0[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{10,}/, file);
  }
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['keyword-trends:fetch'], 'tsx scripts/keyword-trends-fetch.ts');
  assert.match(read('docs/paid-media-keyword-trends.md'), /0 23 2 \* \* cd \/home\/ubuntu\/apps\/marketingos && npm run keyword-trends:fetch -- --scheduled/);
});
