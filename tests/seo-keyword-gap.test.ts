import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assignBucket, buildGapKeywords, FREE_METHODOLOGY, phrasesMatch } from '../src/lib/seo/keyword-gap-bucket.ts';
import { extractPageCandidates } from '../src/lib/seo/keyword-gap-extract.ts';
import { gscKeywordSource, STORED_GSC_QUERIES_SQL } from '../src/lib/seo/keyword-gap-gsc.ts';
import { gscSourceMessage } from '../src/lib/seo/keyword-gap-input.ts';
import { parseGscQueryRows } from '../src/lib/seo/keyword-gap-parse.ts';
import { parseDataForSeoRanked, parseSemrushOrganic, scrubProviderSecret, semrushOrganicUrl } from '../src/lib/seo/keyword-gap-providers.ts';

test('buckets follow our position and competitor coverage', () => {
  assert.equal(assignBucket(null, true), 'missing');
  assert.equal(assignBucket(null, false), null);
  assert.equal(assignBucket(24, true), 'weak');
  assert.equal(assignBucket(15, false), 'almost');
  assert.equal(assignBucket(8, true), 'shared');
  assert.equal(assignBucket(4, false), 'strength');
  assert.equal(phrasesMatch('gold trading account', 'gold trading'), true);
  assert.equal(phrasesMatch('gold', 'silver'), false);
});

test('free mode never fills competitor position or volume', () => {
  const rows = buildGapKeywords({
    ranked: false,
    ours: [{ query: 'gold trading', clicks: 3, impressions: 40, ctr: 0.075, position: 8 }],
    competitorKeywords: [{ keyword: 'gold trading', domain: 'rival.test', position: 2, volume: 9000 }],
  });
  assert.equal(rows[0].bucket, 'shared');
  assert.equal(rows[0].competitorPosition, null);
  assert.equal(rows[0].volume, null);
  assert.match(FREE_METHODOLOGY, /not real ranking data/);
  assert.match(FREE_METHODOLOGY, /em dash/);
});

test('a Search Console Queries export ignores the preamble', () => {
  const parsed = parseGscQueryRows([
    ['Search Console'],
    ['Queries', 'Clicks', 'Impressions', 'CTR', 'Position'],
    ['gold trading', 12, 100, '12%', 8.5],
    ['', 0, 0, '0%', 0],
  ]);
  assert.equal(parsed.error, null);
  assert.equal(parsed.keywords.length, 1);
  assert.equal(parsed.keywords[0].query, 'gold trading');
  assert.equal(parsed.keywords[0].clicks, 12);
  assert.equal(parsed.keywords[0].ctr, 0.12);
  assert.equal(parsed.keywords[0].position, 8.5);
});

test('page phrases come from the title, headings, slug, and body', () => {
  const phrases = extractPageCandidates('https://rival.test/gold-trading-account', `
    <html><head><title>Gold trading account for new clients</title>
    <meta name="description" content="Compare gold trading fees before you open an account"></head>
    <body><h1>Gold trading account</h1><h2>Fee comparison</h2><p>Gold trading account fees stay visible on the fee comparison page.</p></body></html>`);
  assert.equal(phrases.includes('gold trading'), true);
  assert.equal(phrases.includes('fee comparison'), true);
});

test('ranking providers parse official rows and hide keys', () => {
  const semrush = parseSemrushOrganic('Ph;Po;Nq\ngold trading;4;1200\n', 'rival.test');
  assert.equal(semrush.ours[0].position, 4);
  assert.equal(semrush.competitor[0].volume, 1200);
  const dataForSeo = parseDataForSeoRanked({
    tasks: [{ status_code: 20000, result: [{ items: [{ keyword_data: { keyword: 'gold trading', keyword_info: { search_volume: 500 } }, ranked_serp_element: { serp_item: { rank_group: 6 } } }] }] }],
  }, 'dupoin.co.id');
  assert.equal(dataForSeo.ours[0].position, 6);
  assert.equal(dataForSeo.ours[0].impressions, 500);
  const key = 'semrush-secret-key';
  assert.equal(scrubProviderSecret(`ERROR 403 ${semrushOrganicUrl('dupoin.co.id', 'id', key)}`, key).includes(key), false);
});

test('stored Search Console rows are the primary source and Dupoin is not seeded with any', () => {
  assert.equal(gscKeywordSource({ gscProperty: 'sc-domain:example.com', active: true, storedRows: 12 }), 'stored');
  assert.equal(gscKeywordSource({ gscProperty: null, active: false, storedRows: 0 }), 'upload');
  assert.match(STORED_GSC_QUERIES_SQL, /seo_gsc_daily/);
  const migration = readFileSync(new URL('../db/migrations/035_seo_os.sql', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../scripts/seo-sync.ts', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/lib/seo/sync-service.ts', import.meta.url), 'utf8');
  assert.match(migration, /'Dupoin', 'https:\/\/dupoin\.co\.id\/', NULL, FALSE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS seo_gsc_daily/);
  assert.doesNotMatch(migration, /INSERT INTO seo_gsc_daily/);
  assert.match(sync, /npm run seo:sync/);
  assert.match(service, /active = TRUE AND gsc_property IS NOT NULL/);
  const layout = readFileSync(new URL('../src/app/dashboard/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /Keyword Gap \(Beta\)/);
  const dupoin = gscSourceMessage({
    domain: 'https://dupoin.co.id/',
    gscProperty: null,
    storedRows: 0,
    connectedSites: [{ name: 'ICA Cheerleading', gscProperty: 'sc-domain:indonesiancheer.org', storedRows: 1200 }],
  });
  assert.match(dupoin, /dupoin\.co\.id has no Search Console property and no synced queries/);
  assert.match(dupoin, /CSV or XLSX upload until GSC is configured/);
  assert.match(dupoin, /sc-domain:indonesiancheer\.org/);
  const ica = gscSourceMessage({
    domain: 'https://indonesiancheer.org/',
    gscProperty: 'sc-domain:indonesiancheer.org',
    storedRows: 1200,
    connectedSites: [],
  });
  assert.match(ica, /1,200 stored Search Console queries/);
  assert.doesNotMatch(ica, /upload/i);
  const page = readFileSync(new URL('../src/app/dashboard/seo/keyword-gap/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /data-testid="keyword-gap-gsc-source"/);
  assert.match(page, /gscSourceMessage/);
});
