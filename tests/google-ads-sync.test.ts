import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertReadOnlyGaql, createGoogleAdsClient, GoogleAdsApiError, type GoogleAdsClient, type GoogleAdsRow } from '../src/lib/google-ads/client';
import { normalizeCustomerId, readGoogleAdsConfig, requireGoogleAdsConfig, sanitizeGoogleAdsError } from '../src/lib/google-ads/config';
import { aggregateByKey, buildQueries, buildSnapshot, deriveMetrics, mapCampaignRow, mapKeywordRow, mapSearchTermRow, type RangeSnapshot } from '../src/lib/google-ads/gaql';
import { AD_GROUP_SPEC, buildUpsertSql, CAMPAIGN_SPEC, KEYWORD_SPEC, SEARCH_TERM_SPEC, upsertValues } from '../src/lib/google-ads/store';
import { dateChunks, discoverAccounts, runGoogleAdsSync, syncRange, type DiscoveredAccount, type GoogleAdsSyncStore, type RowCounts, type StoredAccountState } from '../src/lib/google-ads/sync';
import { toCsv, toTotals, parseReportRange, parseCustomerFilter } from '../src/lib/google-ads/report';
import { presetRange, formatMoney } from '../src/lib/google-ads/format';

const ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token-SECRET-123456',
  GOOGLE_ADS_CLIENT_ID: 'client-id-123456.apps.googleusercontent.com',
  GOOGLE_ADS_CLIENT_SECRET: 'GOCSPX-supersecretvalue',
  GOOGLE_ADS_REFRESH_TOKEN: '1//refresh-token-secret-abcdefghij',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: '111-222-3333',
  GOOGLE_ADS_CUSTOMER_IDS: '4445556666, 777-888-9999',
};
const config = requireGoogleAdsConfig(ENV);

test('config: reads env, normalizes ids, reports missing key names only', () => {
  assert.equal(config.loginCustomerId, '1112223333');
  assert.deepEqual(config.customerIds, ['4445556666', '7778889999']);
  assert.equal(config.apiVersion, 'v23');
  const missing = readGoogleAdsConfig({ GOOGLE_ADS_CLIENT_ID: 'x' });
  assert.equal(missing.configured, false);
  if (!missing.configured) assert.deepEqual(missing.missing, ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID']);
  const invalid = readGoogleAdsConfig({ ...ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: '12345' });
  assert.equal(invalid.configured, false);
  if (!invalid.configured) assert.deepEqual(invalid.invalid, ['GOOGLE_ADS_LOGIN_CUSTOMER_ID']);
  assert.throws(() => requireGoogleAdsConfig({}), (error: Error) => /missing GOOGLE_ADS_DEVELOPER_TOKEN/.test(error.message) && !/SECRET/.test(error.message.replace('CLIENT_SECRET', '')));
  assert.equal(normalizeCustomerId(' 123-456-7890 '), '1234567890');
  assert.equal(normalizeCustomerId('12345'), null);
});

test('sanitize: tokens never survive an error message', () => {
  const raw = `failed ya29.a0AfH6SMBxyz-_. Bearer abc.def refresh_token=1//0gabcdefghijklmnop client_secret: GOCSPX-supersecretvalue dev-token-SECRET-123456`;
  const clean = sanitizeGoogleAdsError(raw, [config.developerToken, config.clientSecret, config.refreshToken]);
  for (const secret of ['ya29.', 'abc.def', '1//0g', 'GOCSPX', 'dev-token-SECRET']) assert.ok(!clean.includes(secret), `${secret} leaked: ${clean}`);
  assert.ok(sanitizeGoogleAdsError('x'.repeat(2000)).length <= 500);
});

test('GAQL: only SELECT, date-bounded, search terms limited to clicked rows', () => {
  const queries = buildQueries('2026-11-01', '2026-11-07');
  for (const query of Object.values(queries)) {
    assert.doesNotThrow(() => assertReadOnlyGaql(query));
    assert.match(query, /^SELECT /);
    assert.match(query, /segments\.date BETWEEN '2026-11-01' AND '2026-11-07'/);
  }
  assert.match(queries.searchTerms, /metrics\.clicks > 0/);
  assert.throws(() => buildQueries("2026-11-01' OR 1=1 --", '2026-11-07'));
  assert.throws(() => assertReadOnlyGaql('mutate campaigns'));
  assert.throws(() => assertReadOnlyGaql('SELECT a FROM b; DELETE'));
});

const campaignRaw = (date: string, id: string, cost: string, extra: Partial<Record<string, unknown>> = {}) => ({
  segments: { date }, campaign: { id, name: `Campaign ${id}`, status: 'ENABLED', advertisingChannelType: 'SEARCH' },
  metrics: { impressions: '100', clicks: '10', costMicros: cost, conversions: 2.5, conversionsValue: 1000 }, ...extra,
});

test('mapping: int64 strings, doubles, missing metrics, nested fields', () => {
  const row = mapCampaignRow(campaignRaw('2026-11-02', '42', '16077224079522'));
  assert.deepEqual(row, { date: '2026-11-02', campaignId: '42', campaignName: 'Campaign 42', campaignStatus: 'ENABLED', channelType: 'SEARCH', impressions: 100, clicks: 10, costMicros: 16077224079522, conversions: 2.5, conversionsValue: 1000 });
  const keyword = mapKeywordRow({ segments: { date: '2026-11-02' }, campaign: { id: '1' }, adGroup: { id: '2' }, adGroupCriterion: { criterionId: '3', status: 'ENABLED', keyword: { text: 'forex', matchType: 'BROAD' } }, metrics: { clicks: '1' } });
  assert.equal(keyword.keywordText, 'forex');
  assert.equal(keyword.matchType, 'BROAD');
  assert.equal(keyword.impressions, 0);
  assert.equal(keyword.costMicros, 0);
  const term = mapSearchTermRow({ segments: { date: '2026-11-02', searchTermMatchType: 'EXACT' }, campaign: { id: '1' }, adGroup: { id: '2' }, searchTermView: { searchTerm: 'broker forex', status: 'ADDED' }, metrics: { clicks: '3', costMicros: '3000000' } });
  assert.deepEqual([term.searchTerm, term.matchType, term.termStatus, term.clicks, term.costMicros], ['broker forex', 'EXACT', 'ADDED', 3, 3000000]);
  assert.throws(() => mapCampaignRow({ campaign: { id: '1' } }), /segments\.date/);
  const derived = deriveMetrics({ impressions: 200, clicks: 10, costMicros: 50_000_000, conversions: 0, conversionsValue: 0 });
  assert.deepEqual(derived, { cost: 50, ctr: 0.05, avgCpc: 5, costPerConversion: null });
});

test('aggregation: duplicate keys are summed so one upsert never hits a row twice', () => {
  const snapshot = buildSnapshot({
    campaigns: [campaignRaw('2026-11-02', '1', '1000000'), campaignRaw('2026-11-02', '1', '2000000'), campaignRaw('2026-11-03', '1', '5'), { segments: { date: '2026-11-02' }, campaign: {}, metrics: {} }],
    adGroups: [], keywords: [], searchTerms: [],
  });
  assert.equal(snapshot.campaigns.length, 2);
  const day = snapshot.campaigns.find(row => row.date === '2026-11-02')!;
  assert.equal(day.costMicros, 3_000_000);
  assert.equal(day.impressions, 200);
  assert.equal(day.conversions, 5);
  assert.equal(aggregateByKey([{ ...day }, { ...day }], () => 'same').length, 1);
});

test('upsert SQL: keyed on the primary key, updates attributes and metrics, values line up with columns', () => {
  const sql = buildUpsertSql(CAMPAIGN_SPEC, 2);
  assert.match(sql, /^INSERT INTO google_ads_campaign_daily \(customer_id, date, campaign_id, campaign_name, campaign_status, channel_type, impressions, clicks, cost_micros, conversions, conversions_value, synced_at\)/);
  assert.match(sql, /ON CONFLICT \(customer_id, date, campaign_id\) DO UPDATE SET campaign_name = EXCLUDED\.campaign_name/);
  assert.equal((sql.match(/\?/g) ?? []).length, 24);
  const syncedAt = new Date('2026-11-18T00:00:00Z');
  const values = upsertValues(CAMPAIGN_SPEC, '1234567890', [mapCampaignRow(campaignRaw('2026-11-02', '9', '7'))], syncedAt);
  assert.deepEqual(values, ['1234567890', '2026-11-02', '9', 'Campaign 9', 'ENABLED', 'SEARCH', 100, 10, 7, 2.5, 1000, syncedAt]);
  for (const spec of [AD_GROUP_SPEC, KEYWORD_SPEC, SEARCH_TERM_SPEC]) {
    const one = buildUpsertSql(spec, 1);
    assert.equal((one.match(/\?/g) ?? []).length, 1 + spec.keyColumns.length + spec.attributeColumns.length + 6, spec.table);
  }
  // The migration's primary keys match the ON CONFLICT targets.
  const migration = readFileSync('db/migrations/066_paid_media_google_ads.sql', 'utf8');
  for (const spec of [CAMPAIGN_SPEC, AD_GROUP_SPEC, KEYWORD_SPEC, SEARCH_TERM_SPEC]) {
    const block = migration.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${spec.table} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? '';
    assert.match(block, new RegExp(`PRIMARY KEY \\(customer_id, ${spec.keyColumns.join(', ')}\\)`), spec.table);
  }
});

test('dates: chunks are inclusive and contiguous; never-synced accounts get the 90-day backfill', () => {
  assert.deepEqual(dateChunks('2026-11-01', '2026-11-16', 7), [
    { start: '2026-11-01', end: '2026-11-07' }, { start: '2026-11-08', end: '2026-11-14' }, { start: '2026-11-15', end: '2026-11-16' },
  ]);
  assert.deepEqual(syncRange('incremental', '2026-11-18'), { start: '2026-11-05', end: '2026-11-18', days: 14 });
  assert.deepEqual(syncRange('incremental', '2026-11-18', { neverSynced: true }), { start: '2026-08-21', end: '2026-11-18', days: 90 });
  assert.deepEqual(syncRange('backfill', '2026-11-18'), { start: '2026-08-21', end: '2026-11-18', days: 90 });
  assert.equal(syncRange('backfill', '2026-11-18', { days: 9999 }).days, 400);
  assert.deepEqual(presetRange('7d', new Date('2026-11-18T10:00:00+07:00')), { start: '2026-11-11', end: '2026-11-17' });
  assert.deepEqual(presetRange('today', new Date('2026-11-18T23:30:00+07:00')), { start: '2026-11-18', end: '2026-11-18' });
});

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (url: string, body: Record<string, unknown> | null, headers: Record<string, string>) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'ya29.fake-access', expires_in: 3600 }), { status: 200 });
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    const result = handler(url, body, init.headers as Record<string, string>);
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers: result.headers });
  };
  return { fetchFn, calls };
}

test('client: paginates googleAds:search, sends developer-token and login-customer-id, retries 429, never calls mutate', async () => {
  let attempts = 0;
  const { fetchFn, calls } = fakeFetch((url, body) => {
    if (url.endsWith('customers:listAccessibleCustomers')) return { body: { resourceNames: ['customers/1112223333', 'customers/4445556666'] } };
    attempts += 1;
    if (attempts === 1) return { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ quotaErrorDetails: { retryDelay: '1s' } }] } } };
    if (!body?.pageToken) return { body: { results: [{ a: 1 }, { a: 2 }], nextPageToken: 'p2' } };
    return { body: { results: [{ a: 3 }] } };
  });
  const sleeps: number[] = [];
  const client = createGoogleAdsClient(config, { fetch: fetchFn, sleep: async ms => { sleeps.push(ms); } });
  assert.deepEqual(await client.listAccessibleCustomers(), ['1112223333', '4445556666']);
  const rows = await client.search('4445556666', buildQueries('2026-11-01', '2026-11-02').campaigns);
  assert.deepEqual(rows, [{ a: 1 }, { a: 2 }, { a: 3 }]);
  assert.deepEqual(sleeps, [1000]);
  const apiCalls = calls.filter(call => call.url.includes('googleads.googleapis.com'));
  for (const call of apiCalls) {
    assert.match(call.url, /^https:\/\/googleads\.googleapis\.com\/v23\/customers(:listAccessibleCustomers|\/\d{10}\/googleAds:search)$/);
    assert.doesNotMatch(call.url, /mutate/i);
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers['developer-token'], config.developerToken);
    assert.equal(headers.authorization, 'Bearer ya29.fake-access');
  }
  assert.equal((apiCalls[0].init.headers as Record<string, string>)['login-customer-id'], undefined, 'listAccessibleCustomers runs without a login customer');
  assert.equal((apiCalls[1].init.headers as Record<string, string>)['login-customer-id'], '1112223333');
  await assert.rejects(client.search('4445556666', 'UPDATE x'), /Only single GAQL SELECT/);
  // The module has no mutate endpoint at all.
  assert.doesNotMatch(readFileSync('src/lib/google-ads/client.ts', 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''), /:mutate|googleAds:mutate/);
});

test('client: permission errors surface as sanitized GoogleAdsApiError', async () => {
  const { fetchFn } = fakeFetch(() => ({ status: 403, body: { error: { code: 403, message: `denied for token ${config.developerToken}`, details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' }, message: `User doesn't have permission (token ${config.developerToken})` }] }] } } }));
  const client = createGoogleAdsClient(config, { fetch: fetchFn, sleep: async () => {} });
  await assert.rejects(client.search('4445556666', 'SELECT customer.id FROM customer'), (error: unknown) => {
    assert.ok(error instanceof GoogleAdsApiError);
    assert.equal(error.status, 403);
    assert.equal(error.code, 'authorizationError.USER_PERMISSION_DENIED');
    assert.ok(error.isPermission);
    assert.ok(!error.message.includes(config.developerToken));
    return true;
  });
});

// ---- In-memory fakes for the orchestration ----

type Tables = { campaigns: Map<string, unknown>; adGroups: Map<string, unknown>; keywords: Map<string, unknown>; searchTerms: Map<string, unknown> };
function memoryStore() {
  const accounts = new Map<string, DiscoveredAccount & { firstSyncedDate: string | null; lastError: string | null }>();
  const tables: Tables = { campaigns: new Map(), adGroups: new Map(), keywords: new Map(), searchTerms: new Map() };
  const runs: Array<Record<string, unknown>> = [];
  let running = false;
  const store: GoogleAdsSyncStore = {
    async startRun(run) { if (running) return false; running = true; runs.push({ ...run, status: 'running' }); return true; },
    async releaseStaleRuns() {},
    async upsertAccounts(list) { for (const account of list) accounts.set(account.customerId, { ...account, firstSyncedDate: accounts.get(account.customerId)?.firstSyncedDate ?? null, lastError: account.error ?? account.skipReason ?? null }); },
    async accountStates(): Promise<StoredAccountState[]> { return [...accounts.values()].map(account => ({ customerId: account.customerId, firstSyncedDate: account.firstSyncedDate, active: true })); },
    async replaceRange(customerId, start, end, snapshot: RangeSnapshot): Promise<RowCounts> {
      const put = <T extends { date: string }>(table: Map<string, unknown>, rows: T[], key: (row: T) => string) => {
        for (const id of [...table.keys()]) { const [cid, date] = id.split('|'); if (cid === customerId && date >= start && date <= end) table.delete(id); }
        for (const row of rows) table.set(`${customerId}|${key(row)}`, row);
        return rows.length;
      };
      return {
        campaigns: put(tables.campaigns, snapshot.campaigns, row => `${row.date}|${row.campaignId}`),
        adGroups: put(tables.adGroups, snapshot.adGroups, row => `${row.date}|${row.adGroupId}`),
        keywords: put(tables.keywords, snapshot.keywords, row => `${row.date}|${row.adGroupId}|${row.criterionId}`),
        searchTerms: put(tables.searchTerms, snapshot.searchTerms, row => `${row.date}|${row.adGroupId}|${row.searchTerm}|${row.matchType}`),
      };
    },
    async markAccountSynced(customerId, result) { const account = accounts.get(customerId)!; account.lastError = result.error; if (!result.error) account.firstSyncedDate = result.firstSyncedDate; },
    async finishRun(runId, result) { running = false; Object.assign(runs.find(run => run.id === runId)!, result); },
  };
  return { store, accounts, tables, runs };
}

function fakeAdsClient(): GoogleAdsClient & { queries: Array<{ customerId: string; query: string; login: string | null | undefined }> } {
  const queries: Array<{ customerId: string; query: string; login: string | null | undefined }> = [];
  return {
    queries,
    async listAccessibleCustomers() { return ['1112223333', '4445556666', '9990001111']; },
    async search(customerId, query, options = {}): Promise<GoogleAdsRow[]> {
      queries.push({ customerId, query, login: options.loginCustomerId });
      if (/FROM customer_client/.test(query)) {
        return [
          { customerClient: { id: '1112223333', descriptiveName: 'Dupoin MCC', manager: true, level: '0', status: 'ENABLED', currencyCode: 'IDR', timeZone: 'Asia/Jakarta' } },
          { customerClient: { id: '4445556666', descriptiveName: 'Dupoin-ID1', manager: false, level: '1', status: 'ENABLED', currencyCode: 'IDR', timeZone: 'Asia/Jakarta' } },
          { customerClient: { id: '5556667777', descriptiveName: 'Dupoin-ID2', manager: false, level: '1', status: 'ENABLED', currencyCode: 'IDR', timeZone: 'Asia/Jakarta' } },
          { customerClient: { id: '6667778888', descriptiveName: 'Old', manager: false, level: '1', status: 'CANCELED', currencyCode: 'IDR', timeZone: 'Asia/Jakarta' } },
        ];
      }
      if (/FROM customer$/.test(query)) throw new GoogleAdsApiError('Google Ads API 403 authorizationError.USER_PERMISSION_DENIED: no access', 403, 'authorizationError.USER_PERMISSION_DENIED');
      if (customerId === '5556667777') throw new GoogleAdsApiError('Google Ads API 403 authorizationError.CUSTOMER_NOT_ENABLED: not enabled', 403, 'authorizationError.CUSTOMER_NOT_ENABLED');
      const date = query.match(/BETWEEN '([\d-]+)'/)![1];
      if (/FROM campaign /.test(query)) return [campaignRaw(date, '10', '1000000'), campaignRaw(date, '10', '500000')];
      if (/FROM ad_group /.test(query)) return [{ segments: { date }, campaign: { id: '10' }, adGroup: { id: '20', name: 'AG', status: 'ENABLED' }, metrics: { impressions: '5' } }];
      if (/FROM keyword_view/.test(query)) return [{ segments: { date }, campaign: { id: '10' }, adGroup: { id: '20' }, adGroupCriterion: { criterionId: '30', status: 'ENABLED', keyword: { text: 'forex', matchType: 'PHRASE' } }, metrics: { clicks: '2' } }];
      return [{ segments: { date, searchTermMatchType: 'PHRASE' }, campaign: { id: '10' }, adGroup: { id: '20' }, searchTermView: { searchTerm: 'forex broker', status: 'NONE' }, metrics: { clicks: '1' } }];
    },
  };
}

test('discovery: every client under the MCC plus env ids; managers skipped; unreadable and closed accounts flagged', async () => {
  const client = fakeAdsClient();
  const accounts = await discoverAccounts(client, '1112223333', ['4445556666', '7778889999']);
  const byId = new Map(accounts.map(account => [account.customerId, account]));
  assert.ok(!byId.has('1112223333'), 'manager skipped');
  assert.equal(byId.get('4445556666')!.source, 'mcc+env');
  assert.equal(byId.get('4445556666')!.loginCustomerId, '1112223333');
  assert.equal(byId.get('5556667777')!.error, null);
  assert.equal(byId.get('6667778888')!.error, null);
  assert.match(byId.get('6667778888')!.skipReason!, /CANCELED/);
  assert.match(byId.get('7778889999')!.error!, /USER_PERMISSION_DENIED/, 'env id that cannot be read is kept and flagged');
  assert.ok(!byId.has('9990001111'), 'accessible-but-unreadable id outside env is not shown');
});

test('sync: backfills never-synced accounts, keeps going past a failing account, and re-runs idempotently', async () => {
  const { store, accounts, tables, runs } = memoryStore();
  const client = fakeAdsClient();
  const deps = { store, newId: (() => { let n = 0; return () => `run-${++n}`; })(), createClient: async () => ({ client, loginCustomerId: '1112223333', extraCustomerIds: ['4445556666'], secrets: [] }) };
  const now = new Date('2026-11-18T05:00:00Z');
  const first = await runGoogleAdsSync({ mode: 'incremental', now }, deps);
  if (first.status === 'busy') throw new Error('unexpected busy');
  assert.equal(first.status, 'partial');
  assert.equal(first.accountsSynced, 1);
  assert.equal(first.accountsFailed, 1, 'ID2 errored');
  assert.equal(first.details.find(detail => detail.customerId === '6667778888')!.status, 'skipped', 'CANCELED account is skipped, not failed');
  const ok = first.details.find(detail => detail.customerId === '4445556666')!;
  assert.deepEqual([ok.rangeStart, ok.rangeEnd], ['2026-08-21', '2026-11-18'], 'first sync is a 90-day backfill');
  assert.equal(ok.rows.campaigns, 13, 'one aggregated campaign row per 7-day chunk start (fake returns the chunk start date)');
  assert.match(first.details.find(detail => detail.customerId === '5556667777')!.error!, /CUSTOMER_NOT_ENABLED/);
  assert.equal(accounts.get('4445556666')!.firstSyncedDate, '2026-08-21');
  assert.match(accounts.get('5556667777')!.lastError!, /CUSTOMER_NOT_ENABLED/);
  const campaignRow = tables.campaigns.get('4445556666|2026-08-21|10') as { costMicros: number };
  assert.equal(campaignRow.costMicros, 1_500_000);
  const sizes = () => Object.values(tables).map(table => table.size);
  const before = sizes();

  const second = await runGoogleAdsSync({ mode: 'incremental', now }, deps);
  if (second.status === 'busy') throw new Error('unexpected busy');
  const again = second.details.find(detail => detail.customerId === '4445556666')!;
  assert.deepEqual([again.rangeStart, again.rangeEnd], ['2026-11-05', '2026-11-18'], 'later syncs re-pull 14 days');
  assert.deepEqual(sizes(), before, 'idempotent: no duplicate rows');
  assert.equal(runs.length, 2);
  assert.equal(runs[0].status, 'partial');
  // All data queries were SELECTs against client accounts, using the MCC as login customer.
  for (const call of client.queries.filter(item => /segments\.date/.test(item.query))) {
    assert.match(call.query, /^SELECT /);
    assert.notEqual(call.customerId, '1112223333');
    assert.equal(call.login, '1112223333');
  }
});

test('sync: lock, config errors, and no tokens in stored errors', async () => {
  const { store } = memoryStore();
  await store.startRun({ id: 'held', mode: 'incremental', trigger: 'cli', rangeStart: null, rangeEnd: null, triggeredBy: null });
  const busy = await runGoogleAdsSync({ mode: 'incremental' }, { store, newId: () => 'x', createClient: async () => { throw new Error('unreachable'); } });
  assert.equal(busy.status, 'busy');

  const fresh = memoryStore();
  const configError = await runGoogleAdsSync({ mode: 'incremental' }, { store: fresh.store, newId: () => 'y', createClient: async () => { requireGoogleAdsConfig({}); throw new Error('unreachable'); } });
  if (configError.status !== 'busy') {
    assert.equal(configError.status, 'failed');
    assert.equal(configError.configError, true);
    assert.match(configError.error!, /GOOGLE_ADS_DEVELOPER_TOKEN/);
  }

  const leaky = memoryStore();
  const secret = 'dev-token-SECRET-123456';
  const result = await runGoogleAdsSync({ mode: 'incremental' }, {
    store: leaky.store, newId: () => 'z',
    createClient: async () => ({ client: { listAccessibleCustomers: async () => [], search: async () => { throw new Error(`boom ${secret} ya29.abcdef`); } }, loginCustomerId: '1112223333', extraCustomerIds: [], secrets: [secret] }),
  });
  if (result.status !== 'busy') {
    assert.equal(result.status, 'failed');
    assert.ok(!result.error!.includes(secret));
    assert.ok(!result.error!.includes('ya29.'));
  }
});

test('report helpers: totals derive CTR/CPC/cost per conversion; ranges and filters validated; CSV is safe', () => {
  const totals = toTotals({ impressions: '1000', clicks: '50', cost: 250000, conversions: 5, conversions_value: 0 });
  assert.deepEqual([totals.ctr, totals.avgCpc, totals.costPerConversion], [0.05, 5000, 50000]);
  assert.equal(toTotals(undefined).costPerConversion, null);
  assert.deepEqual(parseReportRange('2026-11-01', '2026-11-07').previous, { start: '2026-10-25', end: '2026-10-31' });
  assert.throws(() => parseReportRange('2026-11-07', '2026-11-01'));
  assert.throws(() => parseReportRange('2026-11-01', null));
  assert.equal(parseCustomerFilter('all'), null);
  assert.equal(parseCustomerFilter('444-555-6666'), '4445556666');
  assert.throws(() => parseCustomerFilter('1 OR 1=1'));
  assert.equal(toCsv(['a', 'b'], [['=HYPERLINK("x")', 'x,y'], [1.23456, -5]]), `a,b\r\n"'=HYPERLINK(""x"")","x,y"\r\n1.2346,-5\r\n`);
  assert.equal(formatMoney(935370397, 'IDR'), 'IDR 935,370,397');
});
