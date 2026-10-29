import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACCOUNT_FEATURES, GENERATION_FEATURES, SEO_FEATURE, accountFeatureFromPath, hasGenerationFeature, isDashboardNavItemVisible, shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';
import { requiresAdminApiAccess } from '../src/lib/admin-api-access';
import { seoPageAccess } from '../src/lib/seo/access';
import {
  buildJwtAssertion, createAccessTokenProvider, createGscClient, fetchAllRows, GSC_SCOPE, loadServiceAccountKey, parseServiceAccountKey, SeoConfigError, type GscClient,
} from '../src/lib/seo/gsc-client';
import { datesForMode, fetchDaySnapshot, mergeRows, pacificDate, runSeoSync, type DaySnapshot, type SeoSyncStore } from '../src/lib/seo/gsc-sync';
import { buildUpsertSql, chunk, replaceDayInTransaction } from '../src/lib/seo/gsc-store';
import { normalizeGscProperty } from '../src/lib/seo/property';
import { reportSource, resolveReportRange, topRowsSource } from '../src/lib/seo/report';
import { connectionStatus, defaultSiteId } from '../src/lib/seo/sites';
import { changeLabel, formatCtr, sparklinePoints } from '../src/lib/seo/format';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const member = (features: string[]) => ({ role: 'member', features });
const admin = { role: 'admin', features: [] };

// ---------- Permissions and navigation ----------

test('seo is an account feature but not a generation feature', () => {
  assert.ok(ACCOUNT_FEATURES.includes(SEO_FEATURE));
  assert.ok(!GENERATION_FEATURES.includes(SEO_FEATURE as never));
  assert.equal(hasGenerationFeature(member(['seo'])), false);
});

test('every /dashboard/seo route maps to the seo feature', () => {
  for (const pathname of ['/dashboard/seo', '/dashboard/seo/', '/dashboard/seo/settings', '/dashboard/seo/anything/nested']) {
    assert.equal(accountFeatureFromPath(pathname), 'seo', pathname);
  }
  assert.equal(accountFeatureFromPath('/dashboard/seoish'), undefined);
  assert.equal(accountFeatureFromPath('/dashboard/internal-docs/x'), 'internal-docs');
});

test('members without seo are blocked from SEO OS routes; seo members and admins are not', () => {
  assert.equal(shouldBlockDashboardGenerationPath(member(['social-post']), '/dashboard/seo'), true);
  assert.equal(shouldBlockDashboardGenerationPath(member(['social-post']), '/dashboard/seo/settings'), true);
  assert.equal(shouldBlockDashboardGenerationPath(member(['seo']), '/dashboard/seo'), false);
  assert.equal(shouldBlockDashboardGenerationPath(admin, '/dashboard/seo'), false);
});

test('SEO nav: overview needs seo, settings is admin only', () => {
  const overview = { href: '/dashboard/seo', feature: 'seo' as const };
  const settings = { href: '/dashboard/seo/settings', adminOnly: true };
  assert.equal(isDashboardNavItemVisible(overview, member(['internal-docs'])), false);
  assert.equal(isDashboardNavItemVisible(overview, member(['seo', 'internal-docs'])), true);
  assert.equal(isDashboardNavItemVisible(overview, admin), true);
  assert.equal(isDashboardNavItemVisible(settings, member(['seo'])), false);
  assert.equal(isDashboardNavItemVisible(settings, admin), true);
});

test('dashboard layout has an SEO OS section and protects settings as admin only', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /label: 'SEO OS'/);
  assert.match(layout, /href: '\/dashboard\/seo', label: 'SEO overview', icon: 'seo', feature: 'seo'/);
  assert.match(layout, /href: '\/dashboard\/seo\/settings', label: 'SEO settings', icon: 'settings', adminOnly: true/);
  assert.match(layout, /adminOnlyPages = \[[^\]]*'\/dashboard\/seo\/settings'/);
});

test('new departments do not get SEO OS by default', () => {
  const accounts = read('src/app/dashboard/accounts/AccountsClient.tsx');
  assert.match(accounts, /NEW_DEPARTMENT_FEATURES: readonly AccountFeature\[\] = ASSIGNABLE_FEATURES\.filter\(feature => feature !== SEO_FEATURE\)/);
  assert.doesNotMatch(accounts, /\[\.\.\.ASSIGNABLE_FEATURES\]/);
});

test('server layouts guard SEO pages before render', () => {
  assert.equal(seoPageAccess(null), 'login');
  assert.equal(seoPageAccess(member(['social-post'])), 'forbidden');
  assert.equal(seoPageAccess(member(['seo'])), 'allowed');
  assert.equal(seoPageAccess(admin), 'allowed');
  assert.equal(seoPageAccess(member(['seo']), { adminOnly: true }), 'forbidden');
  assert.equal(seoPageAccess(admin, { adminOnly: true }), 'allowed');

  const layout = read('src/app/dashboard/seo/layout.tsx');
  assert.match(layout, /await cookies\(\)/);
  assert.match(layout, /getAuthorizedUserBySessionId/);
  assert.match(layout, /redirect\('\/'\)/);
  const settingsLayout = read('src/app/dashboard/seo/settings/layout.tsx');
  assert.match(settingsLayout, /seoPageAccess\(user, \{ adminOnly: true \}\)/);
});

// ---------- API guards ----------

test('SEO API routes are feature-gated, and sync/settings are admin only', () => {
  for (const route of ['sites', 'report']) {
    const source = read(`src/app/api/seo/${route}/route.ts`);
    assert.match(source, /requireFeature\(request, 'seo'\)/, route);
    assert.match(source, /if \('error' in auth\) return NextResponse\.json/, route);
  }
  const sync = read('src/app/api/seo/sync/route.ts');
  assert.match(sync, /requireAdmin\(request\)/);
  assert.match(sync, /mode: 'incremental'/);
  assert.doesNotMatch(sync, /backfill'/);
  const settings = read('src/app/api/seo/settings/route.ts');
  assert.equal(settings.match(/requireAdmin\(request\)/g)?.length, 2);

  assert.equal(requiresAdminApiAccess('/api/seo/sync', 'POST'), true);
  assert.equal(requiresAdminApiAccess('/api/seo/settings', 'GET'), true);
  assert.equal(requiresAdminApiAccess('/api/seo/settings', 'PUT'), true);
  assert.equal(requiresAdminApiAccess('/api/seo/report', 'GET'), false);
  assert.equal(requiresAdminApiAccess('/api/seo/sites', 'GET'), false);
});

test('sites route does not leak service account errors to members', () => {
  const source = read('src/app/api/seo/sites/route.ts');
  assert.match(source, /auth\.role === 'admin' \? account : \{ configured: account\.configured \}/);
});

// ---------- Migration 035 ----------

test('migration 035 is transactional, idempotent, and seeds Operations and sites', () => {
  const sql = read('db/migrations/035_seo_os.sql');
  assert.match(sql, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  for (const table of ['seo_sites', 'seo_gsc_daily', 'seo_gsc_page_daily', 'seo_gsc_site_daily', 'seo_sync_runs']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), table);
  }
  assert.match(sql, /DROP CONSTRAINT IF EXISTS departments_permitted_features_valid/);
  const check = sql.match(/ADD CONSTRAINT departments_permitted_features_valid[\s\S]*?\);/)?.[0] ?? '';
  for (const feature of ACCOUNT_FEATURES) assert.match(check, new RegExp(`'${feature}'`), feature);

  assert.match(sql, /'00000000-0000-0000-0000-000000000005',\s*'Operations'/);
  assert.match(sql, /ARRAY\['seo', 'internal-docs'\]/);
  assert.match(sql, /WHERE NOT EXISTS/);
  assert.match(sql, /'ICA Cheerleading', 'https:\/\/indonesiancheer\.org\/', 'sc-domain:indonesiancheer\.org', TRUE/);
  assert.match(sql, /'Dupoin', 'https:\/\/dupoin\.co\.id\/', NULL, FALSE/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_sync_runs_one_running\s+ON seo_sync_runs \(site_id\) WHERE status = 'running'/);
  assert.match(sql, /PRIMARY KEY \(site_id, date, query, page\)/);
});

// ---------- Property validation and site status ----------

test('GSC property accepts domain and URL-prefix properties only', () => {
  assert.equal(normalizeGscProperty('sc-domain:IndonesianCheer.org'), 'sc-domain:indonesiancheer.org');
  assert.equal(normalizeGscProperty(' https://indonesiancheer.org/ '), 'https://indonesiancheer.org/');
  assert.equal(normalizeGscProperty(''), null);
  assert.equal(normalizeGscProperty(null), null);
  for (const bad of ['indonesiancheer.org', 'https://indonesiancheer.org', 'sc-domain:', 'ftp://x/', 42]) {
    assert.equal(normalizeGscProperty(bad), undefined, String(bad));
  }
});

test('connection status and default site', () => {
  assert.equal(connectionStatus({ gsc_property: null, last_synced_at: null }, true), 'not-configured');
  assert.equal(connectionStatus({ gsc_property: 'sc-domain:a.org', last_synced_at: null }, false), 'missing-key');
  assert.equal(connectionStatus({ gsc_property: 'sc-domain:a.org', last_synced_at: null }, true), 'never-synced');
  assert.equal(connectionStatus({ gsc_property: 'sc-domain:a.org', last_synced_at: '2026-10-28' }, true), 'connected');
  assert.equal(defaultSiteId([{ id: 'ica', active: true }, { id: 'dupoin', active: false }]), 'ica');
  assert.equal(defaultSiteId([{ id: 'dupoin', active: false }]), null);
});

// ---------- GSC client ----------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const keyJson = JSON.stringify({ type: 'service_account', client_email: 'seo-os@example.iam.gserviceaccount.com', private_key: pem, private_key_id: 'kid1' });

test('service account key loading fails with clear, secret-free messages', async () => {
  await assert.rejects(loadServiceAccountKey({}), (error: unknown) => error instanceof SeoConfigError && error.code === 'missing-key-path' && /GSC_SA_KEY_PATH is not set/.test(error.message));
  await assert.rejects(loadServiceAccountKey({ GSC_SA_KEY_PATH: '/nope/key.json' }, async () => { throw new Error('ENOENT secret path'); }),
    (error: unknown) => error instanceof SeoConfigError && error.code === 'key-unreadable' && !error.message.includes('/nope'));
  await assert.rejects(loadServiceAccountKey({ GSC_SA_KEY_PATH: '/k' }, async () => 'not json'), /not valid JSON/);
  assert.throws(() => parseServiceAccountKey(JSON.stringify({ type: 'service_account', client_email: 'a@b', private_key: 'oops' })),
    (error: unknown) => error instanceof SeoConfigError && !error.message.includes('oops'));
  const key = await loadServiceAccountKey({ GSC_SA_KEY_PATH: '/k' }, async () => keyJson);
  assert.equal(key.clientEmail, 'seo-os@example.iam.gserviceaccount.com');
});

test('JWT assertion is RS256-signed with the read-only Search Console scope', () => {
  const key = parseServiceAccountKey(keyJson);
  const jwt = buildJwtAssertion(key, 1_800_000_000);
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT', kid: 'kid1' });
  const body = JSON.parse(Buffer.from(claims, 'base64url').toString());
  assert.equal(body.scope, GSC_SCOPE);
  assert.equal(body.scope, 'https://www.googleapis.com/auth/webmasters.readonly');
  assert.equal(body.iss, key.clientEmail);
  assert.equal(body.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(body.exp - body.iat, 3600);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${claims}`);
  assert.ok(verifier.verify(publicKey, Buffer.from(signature, 'base64url')));
});

test('access tokens are cached until shortly before expiry', async () => {
  let calls = 0;
  let now = 1_000_000;
  const tokens = createAccessTokenProvider(parseServiceAccountKey(keyJson), {
    now: () => now,
    fetch: async (_url, init) => {
      calls += 1;
      assert.match(String(init?.body), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
      return Response.json({ access_token: `t${calls}`, expires_in: 3600 });
    },
  });
  assert.equal(await tokens.getToken(), 't1');
  now += 3_000_000;
  assert.equal(await tokens.getToken(), 't1');
  now += 600_000;
  assert.equal(await tokens.getToken(), 't2');
});

const staticTokens = { getToken: async () => 'token' };

test('GSC client retries 429 and 5xx with backoff and honours Retry-After', async () => {
  const statuses = [429, 503, 200];
  const sleeps: number[] = [];
  const urls: string[] = [];
  const client = createGscClient(staticTokens, {
    sleep: async ms => { sleeps.push(ms); },
    baseDelayMs: 100,
    fetch: async url => {
      urls.push(url);
      const status = statuses.shift()!;
      if (status === 200) return Response.json({ rows: [{ keys: ['2026-10-01'], clicks: 1, impressions: 2, ctr: 0.5, position: 3 }] });
      return new Response('{}', { status, headers: status === 429 ? { 'Retry-After': '2' } : {} });
    },
  });
  const rows = await client.query('sc-domain:indonesiancheer.org', { startDate: '2026-10-01', endDate: '2026-10-01', dimensions: ['date'] });
  assert.equal(rows.length, 1);
  assert.deepEqual(sleeps, [2000, 200]);
  assert.equal(urls[0], 'https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aindonesiancheer.org/searchAnalytics/query');
});

test('GSC client gives up after max retries and explains 403/404', async () => {
  let attempts = 0;
  const throttled = createGscClient(staticTokens, { sleep: async () => {}, maxRetries: 2, fetch: async () => { attempts += 1; return new Response('{}', { status: 429 }); } });
  await assert.rejects(throttled.query('sc-domain:a.org', { startDate: 'x', endDate: 'x', dimensions: ['date'] }), /Search Console API error 429/);
  assert.equal(attempts, 3);

  const forbidden = createGscClient(staticTokens, { serviceAccountEmail: 'sa@x.iam.gserviceaccount.com', fetch: async () => new Response('{}', { status: 403 }) });
  await assert.rejects(forbidden.query('sc-domain:a.org', { startDate: 'x', endDate: 'x', dimensions: ['date'] }),
    (error: unknown) => error instanceof SeoConfigError && error.code === 'no-access' && /sa@x\.iam\.gserviceaccount\.com/.test(error.message) && /Restricted user/.test(error.message));
  const missing = createGscClient(staticTokens, { fetch: async () => new Response('{}', { status: 404 }) });
  await assert.rejects(missing.query('https://a.org/', { startDate: 'x', endDate: 'x', dimensions: ['date'] }), /was not found/);
});

test('GSC client refreshes the token once on 401', async () => {
  const forced: boolean[] = [];
  const tokens = { getToken: async (force = false) => { forced.push(force); return force ? 'fresh' : 'stale'; } };
  const statuses = [401, 200];
  const client = createGscClient(tokens, { fetch: async () => statuses.shift() === 401 ? new Response('{}', { status: 401 }) : Response.json({}) });
  assert.deepEqual(await client.query('sc-domain:a.org', { startDate: 'x', endDate: 'x', dimensions: ['date'] }), []);
  assert.ok(forced.includes(true));
});

test('fetchAllRows paginates with startRow until a short page', async () => {
  const requests: Array<{ startRow?: number; rowLimit?: number }> = [];
  const client: GscClient = {
    async query(_property, request) {
      requests.push({ startRow: request.startRow, rowLimit: request.rowLimit });
      const size = request.startRow! < 4 ? 2 : 1;
      return Array.from({ length: size }, (_, index) => ({ keys: [`q${request.startRow! + index}`], clicks: 1, impressions: 1, ctr: 1, position: 1 }));
    },
  };
  const rows = await fetchAllRows(client, 'sc-domain:a.org', { startDate: 'd', endDate: 'd', dimensions: ['query'] }, 2);
  assert.equal(rows.length, 5);
  assert.deepEqual(requests.map(request => request.startRow), [0, 2, 4]);
  assert.ok(requests.every(request => request.rowLimit === 2));
});

// ---------- Sync ----------

test('incremental sync covers the last 5 days ending yesterday (Pacific); backfill covers 16 months', () => {
  const now = new Date('2026-10-29T03:00:00Z'); // still 2026-10-28 in Los Angeles
  assert.equal(pacificDate(now), '2026-10-28');
  assert.deepEqual(datesForMode('incremental', now), ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  const backfill = datesForMode('backfill', now);
  assert.equal(backfill[0], '2025-06-28');
  assert.equal(backfill.at(-1), '2026-10-27');
  assert.ok(backfill.length > 480 && backfill.length < 490);
});

test('day snapshot pulls three views per day and merges truncated duplicates', async () => {
  const dims: string[] = [];
  const client: GscClient = {
    async query(_property, request) {
      dims.push(request.dimensions.join(','));
      assert.equal(request.startDate, '2026-10-20');
      assert.equal(request.endDate, '2026-10-20');
      if (request.dimensions[0] === 'date') return [{ keys: ['2026-10-20'], clicks: 5, impressions: 50, ctr: 0.1, position: 4 }];
      if (request.dimensions.length === 1) return [{ keys: ['https://a.org/'], clicks: 5, impressions: 50, ctr: 0.1, position: 4 }];
      const long = 'x'.repeat(600);
      return [
        { keys: [`${long}a`, 'https://a.org/'], clicks: 1, impressions: 10, ctr: 0.1, position: 2 },
        { keys: [`${long}b`, 'https://a.org/'], clicks: 1, impressions: 30, ctr: 1 / 30, position: 6 },
      ];
    },
  };
  const snapshot = await fetchDaySnapshot(client, 'sc-domain:a.org', '2026-10-20');
  assert.deepEqual(dims, ['date', 'page', 'query,page']);
  assert.equal(snapshot.site[0].clicks, 5);
  assert.equal(snapshot.queryPages.length, 1);
  assert.equal(snapshot.queryPages[0].query.length, 500);
  assert.equal(snapshot.queryPages[0].impressions, 40);
  assert.equal(snapshot.queryPages[0].position, 5);
  assert.equal(snapshot.queryPages[0].ctr, 2 / 40);
  assert.equal(mergeRows([{ k: 'a', clicks: 1, impressions: 0, ctr: 0, position: 3 }, { k: 'a', clicks: 0, impressions: 0, ctr: 0, position: 2 }], row => row.k)[0].position, 2);
});

function memoryStore(overrides: Partial<SeoSyncStore> = {}) {
  const calls = { replaced: [] as string[], finished: [] as unknown[], started: 0, synced: 0 };
  const store: SeoSyncStore = {
    getSite: async id => ({ id, name: 'ICA Cheerleading', site_url: 'https://indonesiancheer.org/', gsc_property: 'sc-domain:indonesiancheer.org', active: true }),
    startRun: async () => { calls.started += 1; return true; },
    releaseStaleRuns: async () => {},
    replaceDay: async (_site, date, snapshot) => { calls.replaced.push(date); return snapshot.site.length + snapshot.pages.length + snapshot.queryPages.length; },
    finishRun: async (_id, result) => { calls.finished.push(result); },
    markSiteSynced: async () => { calls.synced += 1; },
    ...overrides,
  };
  return { store, calls };
}

const oneRowClient: GscClient = { async query() { return [{ keys: ['k', 'https://a.org/'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 }]; } };

test('runSeoSync upserts each day, records the run, and marks the site synced', async () => {
  const { store, calls } = memoryStore();
  const result = await runSeoSync({ siteId: 's', mode: 'incremental', dates: ['2026-10-20', '2026-10-21'] }, { store, createClient: async () => oneRowClient, newId: () => 'run-1' });
  assert.deepEqual(result, { status: 'succeeded', runId: 'run-1', daysSynced: 2, rowsUpserted: 6, rangeStart: '2026-10-20', rangeEnd: '2026-10-21' });
  assert.deepEqual(calls.replaced, ['2026-10-20', '2026-10-21']);
  assert.deepEqual(calls.finished, [{ status: 'succeeded', daysSynced: 2, rowsUpserted: 6, error: null }]);
  assert.equal(calls.synced, 1);
});

test('runSeoSync returns busy when another run holds the lock', async () => {
  const { store, calls } = memoryStore({ startRun: async () => false });
  const result = await runSeoSync({ siteId: 's', mode: 'incremental', dates: ['2026-10-20'] }, { store, createClient: async () => oneRowClient, newId: () => 'r' });
  assert.equal(result.status, 'busy');
  assert.equal(calls.replaced.length, 0);
});

test('runSeoSync fails gracefully when the property or key is missing', async () => {
  const noProperty = memoryStore({ getSite: async id => ({ id, name: 'Dupoin', site_url: 'https://dupoin.co.id/', gsc_property: null, active: false }) });
  const first = await runSeoSync({ siteId: 's', mode: 'incremental', dates: ['2026-10-20'] }, { store: noProperty.store, createClient: async () => oneRowClient, newId: () => 'r1' });
  assert.equal(first.status, 'failed');
  assert.ok(first.status === 'failed' && first.configError && /set its GSC property in SEO OS settings/.test(first.error));
  assert.equal((noProperty.calls.finished[0] as { status: string }).status, 'failed');

  const noKey = memoryStore();
  const second = await runSeoSync({ siteId: 's', mode: 'incremental', dates: ['2026-10-20'] }, {
    store: noKey.store, newId: () => 'r2',
    createClient: async () => { throw new SeoConfigError('Search Console is not connected: GSC_SA_KEY_PATH is not set on the server.', 'missing-key-path'); },
  });
  assert.ok(second.status === 'failed' && second.configError && /GSC_SA_KEY_PATH/.test(second.error));
  assert.equal(noKey.calls.synced, 0);
});

test('runSeoSync records partial progress when the API fails mid-run', async () => {
  const { store, calls } = memoryStore();
  let day = 0;
  const flaky: GscClient = { async query(_p, request) { if (request.startDate === '2026-10-21') throw new Error('Search Console API error 500: boom'); day += 1; return oneRowClient.query(_p, request); } };
  const result = await runSeoSync({ siteId: 's', mode: 'incremental', dates: ['2026-10-20', '2026-10-21'] }, { store, createClient: async () => flaky, newId: () => 'r' });
  assert.ok(result.status === 'failed' && !result.configError && result.daysSynced === 1);
  assert.ok(day > 0);
  assert.deepEqual(calls.finished, [{ status: 'failed', daysSynced: 1, rowsUpserted: 3, error: 'Search Console API error 500: boom' }]);
});

test('upsert SQL updates metrics on conflict and the day replace deletes stale rows', async () => {
  assert.equal(
    buildUpsertSql({ table: 'seo_gsc_page_daily', keyColumns: ['site_id', 'date', 'page'] }, 2),
    'INSERT INTO seo_gsc_page_daily (site_id, date, page, clicks, impressions, ctr, position, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT (site_id, date, page) DO UPDATE SET clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position, synced_at = EXCLUDED.synced_at',
  );
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);

  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const transaction = { execute: async (sql: string, values: unknown[] = []) => { statements.push({ sql, values }); return sql.startsWith('INSERT') ? (sql.match(/\(\?/g)?.length ?? 0) : 0; } };
  const syncedAt = new Date('2026-10-29T00:00:00Z');
  const snapshot: DaySnapshot = {
    site: [{ date: 'd', clicks: 1, impressions: 2, ctr: 0.5, position: 3 }],
    pages: Array.from({ length: 501 }, (_, index) => ({ date: 'd', page: `p${index}`, clicks: 1, impressions: 1, ctr: 1, position: 1 })),
    queryPages: [],
  };
  const rows = await replaceDayInTransaction(transaction, 'site', '2026-10-20', snapshot, syncedAt);
  assert.equal(rows, 502);
  const inserts = statements.filter(statement => statement.sql.startsWith('INSERT'));
  assert.equal(inserts.length, 3); // 1 site row + 500 + 1 page rows
  const deletes = statements.filter(statement => statement.sql.startsWith('DELETE'));
  assert.equal(deletes.length, 3);
  for (const statement of deletes) {
    assert.match(statement.sql, /WHERE site_id = \? AND date = \? AND synced_at < \?/);
    assert.deepEqual(statement.values, ['site', '2026-10-20', syncedAt]);
  }
});

// ---------- Report ----------

test('report range resolves presets, custom ranges, and the previous period', () => {
  const preset = resolveReportRange({ range: '7d' }, '2026-10-27');
  assert.deepEqual(preset, { current: { start: '2026-10-21', end: '2026-10-27' }, previous: { start: '2026-10-14', end: '2026-10-20' }, days: 7 });
  const fallback = resolveReportRange({ range: 'bogus' }, '2026-10-27');
  assert.equal(fallback.days, 28);
  const custom = resolveReportRange({ start: '2026-10-01', end: '2026-10-10' }, '2026-10-27');
  assert.deepEqual(custom.previous, { start: '2026-09-21', end: '2026-09-30' });
  assert.equal(resolveReportRange({ start: '2026-10-10', end: '2026-10-01' }, '2026-10-27').days, 28);
});

test('report source uses the narrowest table and escapes LIKE wildcards', () => {
  assert.equal(reportSource({}).table, 'seo_gsc_site_daily');
  assert.equal(reportSource({ page: '/blog' }).table, 'seo_gsc_page_daily');
  const both = reportSource({ query: '100%_off', page: '/blog' });
  assert.equal(both.table, 'seo_gsc_daily');
  assert.deepEqual(both.values, ['%100\\%\\_off%', '%/blog%']);
  assert.equal(topRowsSource('query', {}).table, 'seo_gsc_daily');
  assert.equal(topRowsSource('page', {}).table, 'seo_gsc_page_daily');
  assert.equal(topRowsSource('page', { query: 'cheer' }).table, 'seo_gsc_daily');
});

test('dashboard formatting treats a lower position as an improvement', () => {
  assert.deepEqual(changeLabel(120, 100, 'clicks'), { text: '+20.0%', good: true });
  assert.deepEqual(changeLabel(4.2, 5.0, 'position'), { text: '−0.8', good: true });
  assert.deepEqual(changeLabel(10, 0, 'clicks'), { text: 'no comparison', good: null });
  assert.equal(formatCtr(0.0345), '3.5%');
  assert.equal(sparklinePoints([0, 10], 100, 20, 0), '0.0,20.0 100.0,0.0');
});

// ---------- Script, docs, secrets ----------

test('seo:sync script supports backfill and documents (not installs) the cron line', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['seo:sync'], 'tsx scripts/seo-sync.ts');
  const script = read('scripts/seo-sync.ts');
  assert.match(script, /--backfill/);
  assert.match(script, /--site=/);
  assert.match(script, /^\/\/ 30 1 \* \* \* cd \/home\/ubuntu\/apps\/marketingos && .*npm run seo:sync/m);
  const docs = read('docs/seo-os/setup.md');
  for (const step of ['Search Console API', 'GSC_SA_KEY_PATH', '/home/ubuntu/secrets/gsc-sa.json', 'chmod 600', 'Restricted', 'sc-domain:indonesiancheer.org', '--backfill', 'crontab']) {
    assert.ok(docs.includes(step), step);
  }
});

test('no service account key material is committed or logged', () => {
  for (const file of ['src/lib/seo/gsc-client.ts', 'src/lib/seo/sync-service.ts', 'scripts/seo-sync.ts', 'docs/seo-os/setup.md']) {
    const source = read(file);
    assert.doesNotMatch(source, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, file);
    assert.doesNotMatch(source, /console\.(log|error)\([^)]*(privateKey|private_key|key\.)/, file);
  }
  assert.match(read('.gitignore'), /^gsc-sa\*\.json$/m);
});

test('SEO migrations contain no "?" because scripts/migrate.ts rewrites ? into $n placeholders', () => {
  for (const file of ['db/migrations/035_seo_os.sql']) {
    assert.doesNotMatch(read(file), /\?/, file);
  }
});
