import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildMarketResearchPrompts,
  normalizeMarketResearchInput,
  validateAndHydrateMarketResearchSelection,
  type MarketNewsCandidate,
} from '../src/lib/market-research';
import {
  EmptyMarketResearchPoolError,
  researchLatestMarketNews,
  type MarketResearchFeed,
} from '../src/lib/market-research-sources';
import { buildMarketResearchDocxBlob, marketResearchDocxFilename } from '../src/lib/market-research-docx';

const read = (relative: string) => {
  const file = path.join(process.cwd(), relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

const page = read('src/app/dashboard/market-research/page.tsx');
const route = read('src/app/api/market-research/generate/route.ts');
const layout = read('src/app/dashboard/layout.tsx');
const history = read('src/app/dashboard/history/page.tsx');
const migration = read('db/migrations/008_market_research_history.sql');

const feeds: MarketResearchFeed[] = [
  { outlet: 'Publisher A', url: 'https://publisher-a.example/rss.xml', origin: 'international' },
  { outlet: 'Publisher B', url: 'https://publisher-b.example/rss.xml', origin: 'international' },
];

function rss(items: Array<{ title: string; link: string; description: string; pubDate: string; updated?: string }>): string {
  return `<?xml version="1.0"?><rss><channel>${items.map(item => `<item><title><![CDATA[${item.title}]]></title><link>${item.link}</link><description><![CDATA[${item.description}]]></description><pubDate>${item.pubDate}</pubDate>${item.updated ? `<updated>${item.updated}</updated>` : ''}</item>`).join('')}</channel></rss>`;
}

const candidates: MarketNewsCandidate[] = [{
  id: 'candidate-a',
  outlet: 'Publisher A',
  title: 'Gold Naik Setelah Data Inflation Resmi Dirilis',
  url: 'https://publisher-a.example/emas-naik',
  publishedAt: '2026-07-27T10:05',
  updatedAt: '2026-07-27T10:30',
  categories: ['Commodity'],
  symbols: ['XAUUSD'],
  origin: 'international',
  importanceCategory: 'Inflation',
  evidence: 'Publisher headline menyebut harga emas naik. Data resmi menunjukkan nilai 2.622.000.',
  evidenceLevel: 'publisher-metadata',
}];

test('normalizes a bounded brief and locks research to today in WIB', () => {
  assert.deepEqual(normalizeMarketResearchInput({ brief: 'Cari berita high-impact untuk morning briefing.', researchDate: '2026-07-27' }, '2026-07-27'), {
    brief: 'Cari berita high-impact untuk morning briefing.', researchDate: '2026-07-27',
  });
  assert.throws(() => normalizeMarketResearchInput({ brief: 'short', researchDate: '2026-07-27' }, '2026-07-27'), /brief/i);
  assert.throws(() => normalizeMarketResearchInput({ brief: 'Cari berita penting hari ini.', researchDate: '2026-07-26' }, '2026-07-27'), /today in WIB/i);
});

test('research scans every product group and keeps same-day headline matches sorted by newest update', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    const body = url.includes('publisher-a') ? rss([
      { title: 'Gold Naik Setelah Data Inflation Resmi Dirilis', link: 'https://publisher-a.example/emas', description: 'Data resmi emas pada level 2.622.000.', pubDate: 'Mon, 27 Jul 2026 02:00:00 GMT', updated: 'Mon, 27 Jul 2026 03:30:00 GMT' },
      { title: 'WTI Kemarin Menguat Setelah Data Inflation', link: 'https://publisher-a.example/minyak-kemarin', description: 'Arsip.', pubDate: 'Sun, 26 Jul 2026 03:00:00 GMT' },
    ]) : rss([
      { title: 'Rupiah Bergerak Setelah Interest Rate Bank Indonesia', link: 'https://publisher-b.example/rupiah', description: 'Pernyataan resmi memengaruhi USD/IDR.', pubDate: 'Mon, 27 Jul 2026 04:00:00 GMT' },
      { title: 'Kebijakan Pemerintah Terbaru', link: 'https://publisher-b.example/kebijakan', description: 'Summary hanya menyebut Nasdaq secara sampingan.', pubDate: 'Mon, 27 Jul 2026 05:00:00 GMT' },
    ]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml', 'content-length': String(body.length) } });
  };
  const result = await researchLatestMarketNews('2026-07-27', { feeds, fetchImpl });
  assert.deepEqual(calls.sort(), feeds.map(feed => feed.url).sort());
  assert.deepEqual(result.groupsSearched, ['Forex', 'Commodity', 'US Indices', 'US Stocks']);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].title.includes('Rupiah'), true);
  assert.equal(result.candidates[1].updatedAt, '2026-07-27T10:30');
  assert.equal(result.candidates.every(candidate => candidate.publishedAt.startsWith('2026-07-27')), true);
  assert.equal(result.groupCandidateCounts.Forex, 1);
  assert.equal(result.groupCandidateCounts.Commodity, 1);
  assert.deepEqual(result.sourceStatus, [
    { outlet: 'Publisher A', status: 'ok', candidateCount: 1, sameDayCount: 1 },
    { outlet: 'Publisher B', status: 'ok', candidateCount: 1, sameDayCount: 2 },
  ]);
});

test('research exposes partial publisher failures instead of implying complete coverage', async () => {
  const fetchImpl: typeof fetch = async input => {
    if (String(input).includes('publisher-a')) throw new Error('publisher timeout');
    const body = rss([{ title: 'WTI Crude Turun Setelah Data Employment Resmi', link: 'https://publisher-b.example/oil', description: 'Pengumuman resmi minyak.', pubDate: 'Mon, 27 Jul 2026 04:00:00 GMT' }]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  const result = await researchLatestMarketNews('2026-07-27', { feeds, fetchImpl });
  assert.deepEqual(result.sourceStatus, [
    { outlet: 'Publisher A', status: 'error', candidateCount: 0, sameDayCount: 0, error: 'publisher timeout' },
    { outlet: 'Publisher B', status: 'ok', candidateCount: 1, sameDayCount: 1 },
  ]);
});

test('same-day Rupiah price action fills Forex/IDR while speculation is dropped and CPI still matches', async () => {
  const fetchImpl: typeof fetch = async input => {
    const body = String(input).includes('publisher-b') ? rss([
      { title: 'CPI (Consumer Price Index) release', link: 'https://publisher-b.example/cpi', description: 'Official consumer price index published.', pubDate: 'Mon, 27 Jul 2026 03:00:00 GMT' },
    ]) : rss([
      { title: 'Breaking! Rupiah Melemah 0,56%, Dolar AS Tembus Rp17.800', link: 'https://www.cnbcindonesia.com/market/rupiah-melemah', description: 'Rupiah ditutup melemah terhadap dolar AS.', pubDate: 'Mon, 27 Jul 2026 01:00:00 GMT' },
      { title: 'Prediksi emas naik pekan ini', link: 'https://publisher-a.example/prediksi-emas', description: 'Analis memprediksi harga emas.', pubDate: 'Mon, 27 Jul 2026 02:00:00 GMT' },
    ]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  const localFeeds: MarketResearchFeed[] = [
    { outlet: 'CNBC Indonesia', url: 'https://publisher-a.example/rss.xml', origin: 'indonesia' },
    { outlet: 'US BEA', url: 'https://publisher-b.example/rss.xml', origin: 'international', defaultSymbols: ['USD'] },
  ];
  const result = await researchLatestMarketNews('2026-07-27', { feeds: localFeeds, fetchImpl });
  assert.equal(result.candidates.some(candidate => /prediksi emas/i.test(candidate.title)), false);
  const rupiah = result.candidates.find(candidate => candidate.symbols.includes('IDR'));
  assert.ok(rupiah);
  assert.deepEqual(rupiah.categories, ['Forex']);
  assert.deepEqual(rupiah.symbols, ['IDR']);
  assert.equal(rupiah.importanceCategory, 'Market Moves');
  const cpi = result.candidates.find(candidate => /CPI/i.test(candidate.title));
  assert.ok(cpi);
  assert.equal(cpi.importanceCategory, 'Inflation');
  assert.deepEqual(cpi.symbols, ['USD']);
  assert.equal(result.groupCandidateCounts.Forex, 2);
});

test('thin titles can inherit bounded description SOP keywords without generic growth blurbs', async () => {
  const fetchImpl: typeof fetch = async input => {
    const body = String(input).includes('publisher-a') ? rss([
      { title: 'USD: latest official print', link: 'https://publisher-a.example/usd-print', description: 'The consumer price index rose 0.3% in August after the official release.', pubDate: 'Mon, 27 Jul 2026 02:00:00 GMT' },
    ]) : rss([
      { title: 'Dollar quiet in Asia', link: 'https://publisher-b.example/dollar-quiet', description: 'Traders watch growth across the region while waiting for data.', pubDate: 'Mon, 27 Jul 2026 03:00:00 GMT' },
    ]);
    return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  const result = await researchLatestMarketNews('2026-07-27', { feeds, fetchImpl });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].importanceCategory, 'Inflation');
  assert.deepEqual(result.candidates[0].symbols, ['USD']);
  assert.equal(result.sourceStatus[0].sameDayCount, 1);
  assert.equal(result.sourceStatus[1].sameDayCount, 1);
  assert.equal(result.sourceStatus[1].candidateCount, 0);
});

test('empty same-day pool error reports feed ok counts versus filtered-to-zero', async () => {
  const fetchImpl: typeof fetch = async input => {
    if (String(input).includes('publisher-a')) throw new Error('publisher timeout');
    const body = rss([
      { title: 'Kebijakan Pemerintah Terbaru', link: 'https://publisher-b.example/kebijakan', description: 'Summary hanya menyebut Nasdaq secara sampingan.', pubDate: 'Mon, 27 Jul 2026 04:00:00 GMT' },
      { title: 'Prediksi emas naik ke rekor baru', link: 'https://publisher-b.example/prediksi-emas', description: 'Outlook spekulatif.', pubDate: 'Mon, 27 Jul 2026 05:00:00 GMT' },
    ]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  await assert.rejects(
    () => researchLatestMarketNews('2026-07-27', { feeds, fetchImpl }),
    (error: unknown) => {
      assert.equal(error instanceof EmptyMarketResearchPoolError, true);
      const err = error as EmptyMarketResearchPoolError;
      assert.match(err.message, /Feeds ok 1\/2/);
      assert.match(err.message, /same-day items 2/);
      assert.match(err.message, /kept after symbol\/importance filters 0/);
      assert.match(err.message, /Publisher A: failed \(publisher timeout\)/);
      assert.match(err.message, /Publisher B: ok, 2 same-day → 0 kept/);
      assert.deepEqual(err.sourceStatus, [
        { outlet: 'Publisher A', status: 'error', candidateCount: 0, sameDayCount: 0, error: 'publisher timeout' },
        { outlet: 'Publisher B', status: 'ok', candidateCount: 0, sameDayCount: 2 },
      ]);
      return true;
    },
  );
});

test('feed fetch follows redirects and sends a compatible user agent', async () => {
  const inits: RequestInit[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    inits.push(init || {});
    const body = rss([{ title: 'Gold Naik Setelah Data Inflation Resmi Dirilis', link: 'https://publisher-a.example/emas', description: 'Data resmi emas.', pubDate: 'Mon, 27 Jul 2026 02:00:00 GMT' }]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  await researchLatestMarketNews('2026-07-27', { feeds: feeds.slice(0, 1), fetchImpl });
  assert.equal(inits[0].redirect, 'follow');
  const headers = new Headers(inits[0].headers);
  assert.match(headers.get('user-agent') || '', /Mozilla\/5\.0 \(compatible; MarketingOS\/1\.0/);
});

test('selection is candidate-bound, max ten, unique, and rejects unsupported facts', () => {
  const selection = { items: [{
    candidateId: 'candidate-a', eventKey: 'official-gold-data-release', productCategory: 'Commodity', symbol: 'XAUUSD', mainEvent: 'Data resmi memengaruhi harga emas.',
    latestFactualDevelopment: 'Nilai terbaru tercatat 2.622.000.', marketRelevance: 'Perkembangan ini relevan untuk sentimen Gold.',
  }] };
  const hydrated = validateAndHydrateMarketResearchSelection(selection, candidates);
  assert.equal(hydrated.items[0].articleUrl, candidates[0].url);
  assert.equal(hydrated.items[0].publicationTime, '10:05');
  assert.equal(hydrated.items[0].latestUpdateTime, '10:30');
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [{ ...selection.items[0], candidateId: 'invented' }] }, candidates), /candidate/i);
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [{ ...selection.items[0], latestFactualDevelopment: 'Nilai terbaru 9.999.999.' }] }, candidates), /unsupported numeric/i);
  for (const unsupported of ['Harga bergerak ke USD2500.', 'Harga bergerak ke Rp９９９９.']) {
    assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [{ ...selection.items[0], latestFactualDevelopment: unsupported }] }, candidates), /unsupported numeric/i);
  }
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [{ ...selection.items[0], latestFactualDevelopment: "Pernyataan 'klaim palsu' disampaikan." }] }, candidates), /unsupported quotes/i);
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: Array(11).fill(selection.items[0]) }, candidates), /maximum of ten/i);
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [selection.items[0], selection.items[0]] }, candidates), /unique/i);

  // Same underlying event reported twice, under two DIFFERENT symbols, must
  // still be rejected by the event-similarity gate.
  const duplicateEventCandidates = [
    { ...candidates[0], id: 'a', title: 'Bank Indonesia Pangkas Suku Bunga Acuan', categories: ['Forex' as const], symbols: ['IDR'], evidence: 'Bank Indonesia Pangkas Suku Bunga Acuan.' },
    { ...candidates[0], id: 'b', title: 'BI Turunkan BI-Rate 25 Basis Poin', url: 'https://publisher-a.example/bi-rate', categories: ['Forex' as const], symbols: ['USD'], evidence: 'BI Turunkan BI-Rate 25 Basis Poin.' },
  ];
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [
    { ...selection.items[0], candidateId: 'a', productCategory: 'Forex', symbol: 'IDR', eventKey: 'bank-indonesia-rate-cut', mainEvent: 'Bank Indonesia memangkas suku bunga acuan.', latestFactualDevelopment: 'Keputusan tersebut telah dikonfirmasi.' },
    { ...selection.items[0], candidateId: 'b', productCategory: 'Forex', symbol: 'USD', eventKey: 'bi-rate-lowered', mainEvent: 'BI menurunkan BI-Rate 25 basis poin.', latestFactualDevelopment: 'BI-Rate turun 25 basis poin.' },
  ] }, duplicateEventCandidates), /unique events/i);
});

test('calendar years in narratives are not treated as unsupported numeric facts', () => {
  assert.equal(candidates[0].evidence.includes('2026'), false);
  const selection = { items: [{
    candidateId: 'candidate-a', eventKey: 'official-gold-data-release', productCategory: 'Commodity', symbol: 'XAUUSD',
    mainEvent: 'Pada 2026 data resmi memengaruhi harga emas.',
    latestFactualDevelopment: 'Nilai terbaru tercatat 2.622.000 tahun 2026.',
    marketRelevance: 'Perkembangan tahun ini relevan untuk sentimen Gold.',
  }] };
  const hydrated = validateAndHydrateMarketResearchSelection(selection, candidates);
  assert.equal(hydrated.items[0].mainEvent.includes('2026'), true);
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [{ ...selection.items[0], latestFactualDevelopment: 'Suku bunga naik 3.5%.' }] }, candidates), /unsupported numeric facts: 3.5/);
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [{ ...selection.items[0], latestFactualDevelopment: 'Harga bergerak 1250.' }] }, candidates), /unsupported numeric facts: 1250/);
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [{ ...selection.items[0], latestFactualDevelopment: 'Target harga 1899 tercatat.' }] }, candidates), /unsupported numeric facts: 1899/);
});

test('an honest zero-selection result is accepted, not treated as a format error', () => {
  // The evidence gate correctly rejecting every candidate (all speculative /
  // low-importance) must hydrate to an empty, valid report — not throw.
  const empty = validateAndHydrateMarketResearchSelection({ items: [] }, candidates);
  assert.deepEqual(empty.items, []);
  // Still rejects a genuinely malformed payload (missing items key entirely).
  assert.throws(() => validateAndHydrateMarketResearchSelection({}, candidates), /items array/i);
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: 'not-an-array' }, candidates), /items array/i);
});

test('prompt treats brief and publisher text as untrusted data and requires exact candidate IDs', () => {
  const prompts = buildMarketResearchPrompts({ brief: 'Morning briefing.', researchDate: '2026-07-27' }, candidates);
  assert.match(prompts.systemPrompt, /untrusted data/i);
  assert.match(prompts.systemPrompt, /candidateId/);
  assert.match(prompts.systemPrompt, /up to 10/i);
  assert.match(prompts.systemPrompt, /eventKey/);
  assert.match(prompts.userPrompt, /candidate-a/);
});

test('Market Research is admin-only, gateway-routed, persisted, downloadable, and additively migrated', async () => {
  assert.match(layout, /\/dashboard\/market-research/);
  assert.match(page, /Market research/i);
  assert.match(page, /Research brief/i);
  assert.match(page, /Latest Update Time/);
  assert.match(page, /Download DOCX/);
  assert.match(page, /Recent Generated/);
  assert.match(page, /\/dashboard\/history\?type=market-research/);
  assert.match(route, /requireFeature\(request, 'market-research'\)/);
  assert.match(route, /getUserPreferredModel\(auth\.id, 'market-research'\)/);
  assert.doesNotMatch(route, /codexTextOnly|getModelProvider|gpt-5\.6-sol/);
  assert.match(route, /researchLatestMarketNews/);
  assert.match(route, /EmptyMarketResearchPoolError/);
  assert.match(route, /payload\.sourceStatus/);
  assert.match(page, /errorSourceStatus/);
  assert.match(page, /formatMarketResearchSourceStatus/);
  assert.match(page, /@\/lib\/market-research-status/);
  assert.doesNotMatch(page, /@\/lib\/market-research-sources/);
  assert.match(route, /validateAndHydrateMarketResearchSelection/);
  assert.match(route, /INSERT INTO tasks/);
  assert.match(route, /'market-research'/);
  assert.match(history, /market-research/);
  assert.match(history, /Market Research/);
  assert.match(migration, /market-research/);
  assert.doesNotMatch(migration, /DELETE|TRUNCATE|DROP TABLE/i);

  const report = validateAndHydrateMarketResearchSelection({ items: [{
    candidateId: 'candidate-a', eventKey: 'official-gold-data-release', productCategory: 'Commodity', symbol: 'XAUUSD', mainEvent: 'Data resmi memengaruhi harga emas.',
    latestFactualDevelopment: 'Nilai terbaru tercatat 2.622.000.', marketRelevance: 'Perkembangan ini relevan untuk sentimen Gold.',
  }] }, candidates);
  const blob = await buildMarketResearchDocxBlob('Morning briefing.', '2026-07-27', report.items);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
  assert.equal(marketResearchDocxFilename('2026-07-27'), 'DUPOIN_Latest_Market_News_MarketResearch_V1_20260727.docx');
});
