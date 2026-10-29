import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decodeCsvBytes, detectDelimiter, detectEncoding, parseCsv } from '../src/lib/seo/csv';
import {
  KEYWORD_CSV_HEADER, MAX_IMPORT_ROWS, keywordsToCsv, normalizeIntent, normalizeKeyword, parseKeywordCsv, siteRootHost, validateTargetUrl,
} from '../src/lib/seo/keywords';
import { buildKeywordUpsertSql } from '../src/lib/seo/keyword-store';
import {
  HOMEPAGE_URL_PATTERN, OPPORTUNITY_BANDS, QUERY_OPPORTUNITIES_SQL, UNTARGETED_KEYWORDS_SQL, bandForPosition, groupOpportunities, isHomepageUrl, toOpportunity,
} from '../src/lib/seo/opportunities';
import { OPPORTUNITY_TYPES, parseQueueRequest } from '../src/lib/seo/content-queue';
import { isDashboardNavItemVisible } from '../src/lib/authorization';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const ICA = 'indonesiancheer.org';

function utf16(text: string, endian: 'le' | 'be', bom: boolean): Uint8Array {
  const le = Buffer.from(text, 'utf16le');
  const body = endian === 'le' ? le : Buffer.from(le.map((_, index) => le[index ^ 1]));
  const mark = endian === 'le' ? [0xff, 0xfe] : [0xfe, 0xff];
  return new Uint8Array(bom ? Buffer.concat([Buffer.from(mark), body]) : body);
}

// ---------- CSV decoding ----------

test('decodes UTF-8 with and without a BOM', () => {
  const text = 'keyword\r\ncheer café\r\n';
  const withBom = new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]));
  assert.deepEqual(detectEncoding(withBom), { encoding: 'utf-8', bomLength: 3 });
  assert.deepEqual(decodeCsvBytes(withBom), { text, encoding: 'utf-8' });
  assert.deepEqual(decodeCsvBytes(new Uint8Array(Buffer.from(text))), { text, encoding: 'utf-8' });
});

test('decodes UTF-16 LE and BE, with or without a BOM (Excel "Unicode text")', () => {
  const text = 'keyword\tintent\r\nlomba cheers\tc\r\n';
  for (const endian of ['le', 'be'] as const) {
    for (const bom of [true, false]) {
      const decoded = decodeCsvBytes(utf16(text, endian, bom));
      assert.equal(decoded.text, text, `${endian} bom=${bom}`);
      assert.equal(decoded.encoding, `utf-16${endian}`);
    }
  }
  assert.equal(decodeCsvBytes(utf16(text, 'le', true).buffer as ArrayBuffer).text, text);
});

test('detects comma, semicolon, and tab delimiters, ignoring quoted text', () => {
  assert.equal(detectDelimiter('keyword,intent\n'), ',');
  assert.equal(detectDelimiter('keyword;intent\n'), ';');
  assert.equal(detectDelimiter('keyword\tintent\n'), '\t');
  assert.equal(detectDelimiter('"a;b;c",d\n'), ',');
});

test('parses RFC 4180 quoting, doubled quotes, and embedded newlines', () => {
  assert.deepEqual(parseCsv('a,"b ""x"", y","line\r\nbreak"\r\nc,d,e'), [['a', 'b "x", y', 'line\r\nbreak'], ['c', 'd', 'e']]);
  assert.deepEqual(parseCsv('a;b\n1;2\n', ';'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a\rb'), [['a'], ['b']]);
});

// ---------- Keyword validation ----------

test('keyword and intent normalisation', () => {
  assert.equal(normalizeKeyword('  Lomba   CHEERLEADING\u00a0Jakarta '), 'lomba cheerleading jakarta');
  assert.equal(normalizeKeyword('ＩＣＡ'), 'ica');
  assert.equal(normalizeIntent(''), null);
  assert.equal(normalizeIntent(' Info '), 'informational');
  assert.equal(normalizeIntent('t'), 'transactional');
  assert.equal(normalizeIntent('buy'), undefined);
});

test('target URLs must be http(s) on the site root or its subdomains', () => {
  assert.equal(siteRootHost('https://indonesiancheer.org/', 'sc-domain:indonesiancheer.org'), ICA);
  assert.equal(siteRootHost('https://www.dupoin.co.id/', null), 'dupoin.co.id');
  assert.deepEqual(validateTargetUrl('', ICA), { url: null });
  assert.deepEqual(validateTargetUrl('https://indonesiancheer.org/events#top', ICA), { url: 'https://indonesiancheer.org/events' });
  assert.deepEqual(validateTargetUrl('https://blog.indonesiancheer.org/a', ICA), { url: 'https://blog.indonesiancheer.org/a' });
  assert.ok('error' in validateTargetUrl('https://evilindonesiancheer.org/', ICA));
  assert.ok('error' in validateTargetUrl('javascript:alert(1)', ICA));
  assert.ok('error' in validateTargetUrl('not a url', ICA));
});

test('keyword CSV: header aliases, dedupe, blank rows, and row-numbered errors', () => {
  const csv = [
    'Query;URL;Search Intent',
    'Lomba Cheers;https://indonesiancheer.org/lomba;comm',
    '',
    'lomba   cheers;;',
    'cheer camp;https://other.com/x;',
    ';https://indonesiancheer.org/;',
    'ica rules;;buy',
    'ica rules;;nav',
  ].join('\n');
  const result = parseKeywordCsv(csv, { rootHost: ICA });
  assert.deepEqual(result.rows, [
    { keyword: 'Lomba Cheers', normalized: 'lomba cheers', targetPageUrl: 'https://indonesiancheer.org/lomba', intent: 'commercial' },
    { keyword: 'ica rules', normalized: 'ica rules', targetPageUrl: null, intent: 'navigational' },
  ]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.dataRows, 6);
  assert.deepEqual(result.errors.map(error => error.row), [5, 6, 7]);
  assert.match(result.errors[0].message, /not on indonesiancheer\.org/);
});

test('keyword CSV without a header reads keyword, target, intent positionally', () => {
  const result = parseKeywordCsv('cheer gym jakarta\ncheer shoes,,transactional\n', { rootHost: ICA });
  assert.deepEqual(result.rows.map(row => [row.keyword, row.intent]), [['cheer gym jakarta', null], ['cheer shoes', 'transactional']]);
  assert.deepEqual(result.errors, []);
});

test('keyword CSV caps rows and rejects empty files', () => {
  assert.equal(parseKeywordCsv('', { rootHost: ICA }).errors[0].message, 'The file is empty');
  const many = Array.from({ length: MAX_IMPORT_ROWS + 3 }, (_, index) => `kw ${index}`).join('\n');
  const result = parseKeywordCsv(many, { rootHost: ICA });
  assert.equal(result.rows.length, MAX_IMPORT_ROWS);
  assert.match(result.errors.at(-1)!.message, /Only the first/);
});

test('keyword export is formula-safe and re-imports unchanged', () => {
  const rows = [
    { keyword: '=HYPERLINK("http://x")', target_page_url: null, intent: null },
    { keyword: '-cheer', target_page_url: 'https://indonesiancheer.org/a,b', intent: 'commercial' },
    { keyword: '@ica', target_page_url: null, intent: null },
  ];
  const csv = keywordsToCsv(rows);
  assert.ok(csv.startsWith('\uFEFF' + KEYWORD_CSV_HEADER.join(',') + '\r\n'));
  for (const line of csv.split('\r\n').slice(1)) assert.doesNotMatch(line, /^"?[=+\-@]/, line);
  const reimported = parseKeywordCsv(decodeCsvBytes(new Uint8Array(Buffer.from(csv))).text, { rootHost: ICA });
  assert.deepEqual(reimported.rows.map(row => row.keyword), rows.map(row => row.keyword));
  assert.equal(reimported.rows[1].targetPageUrl, 'https://indonesiancheer.org/a,b');
});

test('keyword upsert keeps stored target and intent when the file leaves them empty', () => {
  const sql = buildKeywordUpsertSql(2);
  assert.equal(sql.match(/\?/g)?.length, 14);
  assert.match(sql, /ON CONFLICT \(site_id, keyword_normalized\) DO UPDATE/);
  assert.match(sql, /COALESCE\(EXCLUDED\.target_page_url, seo_keywords\.target_page_url\)/);
  assert.match(sql, /COALESCE\(EXCLUDED\.intent, seo_keywords\.intent\)/);
});

// ---------- Opportunities ----------

test('bands follow the position Search Console displays: 11-20 push, 21-30 re-optimize', () => {
  assert.deepEqual(Object.keys(OPPORTUNITY_BANDS), ['push', 're-optimize']);
  assert.equal(bandForPosition(10.4), null);
  assert.equal(bandForPosition(10.5), 'push');
  assert.equal(bandForPosition(20.4), 'push');
  assert.equal(bandForPosition(20.5), 're-optimize');
  assert.equal(bandForPosition(30.4), 're-optimize');
  assert.equal(bandForPosition(30.5), null);
  assert.equal(bandForPosition(null), null);
});

test('homepage detection covers root URLs only', () => {
  for (const url of ['https://indonesiancheer.org/', 'https://indonesiancheer.org', 'http://www.indonesiancheer.org/', 'https://blog.indonesiancheer.org/']) assert.equal(isHomepageUrl(url), true, url);
  for (const url of ['https://indonesiancheer.org/events', 'https://indonesiancheer.org/?q=1', null]) assert.equal(isHomepageUrl(url), false, String(url));
});

test('opportunity rows are typed and grouped; homepage queries are also listed under No page', () => {
  const rows = [
    toOpportunity({ query: 'a', clicks: '2', impressions: '100', position: '12.2', best_page: 'https://indonesiancheer.org/a', tracked: true, target_page_url: null, queued: false }),
    toOpportunity({ query: 'b', clicks: 0, impressions: 40, position: 25, best_page: 'https://indonesiancheer.org/', tracked: false, target_page_url: null, queued: true }),
    toOpportunity({ query: 'c', clicks: 9, impressions: 90, position: 3, best_page: 'https://indonesiancheer.org/', tracked: false, target_page_url: null, queued: false }),
  ];
  assert.equal(rows[0].ctr, 0.02);
  const report = groupOpportunities(rows, []);
  assert.deepEqual(report.push.map(row => row.query), ['a']);
  assert.deepEqual(report.reoptimize.map(row => row.query), ['b']);
  assert.deepEqual(report.homepage.map(row => row.query), ['b', 'c']);
});

test('opportunity SQL weights position by impressions and takes regexes as parameters', () => {
  assert.match(QUERY_OPPORTUNITIES_SQL, /SUM\(position \* impressions\)/);
  assert.match(QUERY_OPPORTUNITIES_SQL, /DISTINCT ON \(query\)/);
  assert.match(QUERY_OPPORTUNITIES_SQL, /b\.page ~\* \?/);
  assert.equal(QUERY_OPPORTUNITIES_SQL.match(/\?/g)?.length, 10);
  assert.doesNotMatch(QUERY_OPPORTUNITIES_SQL, /https/);
  assert.match(UNTARGETED_KEYWORDS_SQL, /target_page_url IS NULL/);
  assert.match(UNTARGETED_KEYWORDS_SQL, /NOT EXISTS/);
  assert.ok(HOMEPAGE_URL_PATTERN.includes('?'), 'pattern stays out of SQL text');
});

// ---------- Content Studio hand-off ----------

test('send-to-Content-Studio requests are validated and metrics whitelisted', () => {
  assert.deepEqual(OPPORTUNITY_TYPES, ['push', 're-optimize', 'no-page', 'homepage']);
  const parsed = parseQueueRequest({
    keyword: ' Lomba  Cheers ', opportunityType: 'push', targetPageUrl: 'https://indonesiancheer.org/lomba',
    metrics: { clicks: 3, impressions: 120, position: 14.2, bestPage: 'https://indonesiancheer.org/lomba', rangeStart: '2026-10-01', rangeEnd: 'x', evil: '<script>' },
    note: 'n'.repeat(2000),
  }, ICA);
  assert.ok(!('error' in parsed));
  assert.equal(parsed.keyword, 'Lomba Cheers');
  assert.equal(parsed.normalized, 'lomba cheers');
  assert.deepEqual(parsed.metrics, { clicks: 3, impressions: 120, position: 14.2, bestPage: 'https://indonesiancheer.org/lomba', rangeStart: '2026-10-01' });
  assert.equal(parsed.note?.length, 1000);
  assert.ok('error' in parseQueueRequest({ keyword: '', opportunityType: 'push' }, ICA));
  assert.ok('error' in parseQueueRequest({ keyword: 'x', opportunityType: 'publish' }, ICA));
  assert.ok('error' in parseQueueRequest({ keyword: 'x', opportunityType: 'no-page', targetPageUrl: 'https://other.com/' }, ICA));
  assert.ok('error' in parseQueueRequest(null, ICA));
});

// ---------- Migration, routes, pages ----------

test('migration 036 is transactional, idempotent, and free of "?"', () => {
  const sql = read('db/migrations/036_seo_opportunities.sql');
  assert.match(sql, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\?/);
  for (const statement of sql.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^\n]*/g) ?? []) assert.match(statement, /IF NOT EXISTS/, statement);
  assert.match(sql, /idx_seo_keywords_site_keyword ON seo_keywords \(site_id, keyword_normalized\)/);
  assert.match(sql, /idx_seo_content_queue_one_pending[^;]*WHERE status = 'pending'/);
  assert.match(sql, /REFERENCES seo_sites\(id\) ON DELETE CASCADE/);
});

test('P2 SEO API routes are gated by the seo feature', () => {
  for (const route of ['opportunities', 'keywords', 'content-queue']) {
    const source = read(`src/app/api/seo/${route}/route.ts`);
    const handlers = source.match(/export async function (GET|POST|PATCH|DELETE)/g) ?? [];
    assert.ok(handlers.length > 0, route);
    assert.equal(source.match(/requireFeature\(request, 'seo'\)/g)?.length, handlers.length, route);
  }
  const keywords = read('src/app/api/seo/keywords/route.ts');
  assert.match(keywords, /MAX_IMPORT_BYTES/);
  assert.match(keywords, /status: 413/);
});

test('Opportunities and Keywords pages are in the SEO OS nav for seo members', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /href: '\/dashboard\/seo\/opportunities', label: 'Opportunities', icon: 'target', feature: 'seo'/);
  assert.match(layout, /href: '\/dashboard\/seo\/keywords', label: 'Keywords', icon: 'keyword', feature: 'seo'/);
  const item = { href: '/dashboard/seo/opportunities', feature: 'seo' as const };
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: ['seo'] }), true);
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: ['social-post'] }), false);
  assert.match(read('src/app/dashboard/seo/opportunities/page.tsx'), /only reports queries that got at least one impression/);
});
