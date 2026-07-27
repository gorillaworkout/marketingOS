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
import { researchLatestMarketNews, type MarketResearchFeed } from '../src/lib/market-research-sources';
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
  { outlet: 'Publisher A', url: 'https://publisher-a.example/rss.xml' },
  { outlet: 'Publisher B', url: 'https://publisher-b.example/rss.xml' },
];

function rss(items: Array<{ title: string; link: string; description: string; pubDate: string; updated?: string }>): string {
  return `<?xml version="1.0"?><rss><channel>${items.map(item => `<item><title><![CDATA[${item.title}]]></title><link>${item.link}</link><description><![CDATA[${item.description}]]></description><pubDate>${item.pubDate}</pubDate>${item.updated ? `<updated>${item.updated}</updated>` : ''}</item>`).join('')}</channel></rss>`;
}

const candidates: MarketNewsCandidate[] = [{
  id: 'candidate-a',
  outlet: 'Publisher A',
  title: 'Harga Emas Naik Setelah Data Resmi Dirilis',
  url: 'https://publisher-a.example/emas-naik',
  publishedAt: '2026-07-27T10:05',
  updatedAt: '2026-07-27T10:30',
  categories: ['Gold'],
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
      { title: 'Harga Emas Naik Setelah Data Resmi Dirilis', link: 'https://publisher-a.example/emas', description: 'Data resmi emas pada level 2.622.000.', pubDate: 'Mon, 27 Jul 2026 02:00:00 GMT', updated: 'Mon, 27 Jul 2026 03:30:00 GMT' },
      { title: 'Harga Minyak Kemarin Menguat', link: 'https://publisher-a.example/minyak-kemarin', description: 'Arsip.', pubDate: 'Sun, 26 Jul 2026 03:00:00 GMT' },
    ]) : rss([
      { title: 'Rupiah Bergerak Setelah Pernyataan Resmi Bank Indonesia', link: 'https://publisher-b.example/rupiah', description: 'Pernyataan resmi memengaruhi USD/IDR.', pubDate: 'Mon, 27 Jul 2026 04:00:00 GMT' },
      { title: 'Kebijakan Pemerintah Terbaru', link: 'https://publisher-b.example/kebijakan', description: 'Summary hanya menyebut Nasdaq secara sampingan.', pubDate: 'Mon, 27 Jul 2026 05:00:00 GMT' },
    ]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml', 'content-length': String(body.length) } });
  };
  const result = await researchLatestMarketNews('2026-07-27', { feeds, fetchImpl });
  assert.deepEqual(calls.sort(), feeds.map(feed => feed.url).sort());
  assert.deepEqual(result.groupsSearched, ['Forex', 'Gold', 'Oil', 'US Indices']);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].title.includes('Rupiah'), true);
  assert.equal(result.candidates[1].updatedAt, '2026-07-27T10:30');
  assert.equal(result.candidates.every(candidate => candidate.publishedAt.startsWith('2026-07-27')), true);
  assert.equal(result.groupCandidateCounts.Forex, 1);
  assert.equal(result.groupCandidateCounts.Gold, 1);
  assert.equal(result.sourceStatus.every(source => source.status === 'ok'), true);
});

test('research exposes partial publisher failures instead of implying complete coverage', async () => {
  const fetchImpl: typeof fetch = async input => {
    if (String(input).includes('publisher-a')) throw new Error('publisher timeout');
    const body = rss([{ title: 'Harga Minyak Turun Setelah Pengumuman Resmi', link: 'https://publisher-b.example/oil', description: 'Pengumuman resmi minyak.', pubDate: 'Mon, 27 Jul 2026 04:00:00 GMT' }]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  const result = await researchLatestMarketNews('2026-07-27', { feeds, fetchImpl });
  assert.deepEqual(result.sourceStatus, [
    { outlet: 'Publisher A', status: 'error', candidateCount: 0, error: 'publisher timeout' },
    { outlet: 'Publisher B', status: 'ok', candidateCount: 1 },
  ]);
});

test('selection is candidate-bound, max five, unique, and rejects unsupported facts', () => {
  const selection = { items: [{
    candidateId: 'candidate-a', eventKey: 'official-gold-data-release', productCategory: 'Gold', mainEvent: 'Data resmi memengaruhi harga emas.',
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
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: Array(6).fill(selection.items[0]) }, candidates), /maximum of five/i);
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [selection.items[0], selection.items[0]] }, candidates), /unique/i);

  const duplicateEventCandidates = [
    { ...candidates[0], id: 'a', title: 'Bank Indonesia Pangkas Suku Bunga Acuan', evidence: 'Bank Indonesia Pangkas Suku Bunga Acuan.' },
    { ...candidates[0], id: 'b', title: 'BI Turunkan BI-Rate 25 Basis Poin', url: 'https://publisher-a.example/bi-rate', evidence: 'BI Turunkan BI-Rate 25 Basis Poin.' },
  ];
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [
    { ...selection.items[0], candidateId: 'a', eventKey: 'bank-indonesia-rate-cut', mainEvent: 'Bank Indonesia memangkas suku bunga acuan.', latestFactualDevelopment: 'Keputusan tersebut telah dikonfirmasi.' },
    { ...selection.items[0], candidateId: 'b', eventKey: 'bi-rate-lowered', mainEvent: 'BI menurunkan BI-Rate 25 basis poin.', latestFactualDevelopment: 'BI-Rate turun 25 basis poin.' },
  ] }, duplicateEventCandidates), /unique events/i);
});

test('prompt treats brief and publisher text as untrusted data and requires exact candidate IDs', () => {
  const prompts = buildMarketResearchPrompts({ brief: 'Morning briefing.', researchDate: '2026-07-27' }, candidates);
  assert.match(prompts.systemPrompt, /untrusted data/i);
  assert.match(prompts.systemPrompt, /candidateId/);
  assert.match(prompts.systemPrompt, /maximum of 5/i);
  assert.match(prompts.systemPrompt, /eventKey/);
  assert.match(prompts.userPrompt, /candidate-a/);
});

test('Market Research is admin-only, Codex-only, persisted, downloadable, and additively migrated', async () => {
  assert.match(layout, /\/dashboard\/market-research/);
  assert.match(page, /Market Research/);
  assert.match(page, /Research Brief/);
  assert.match(page, /Latest Update Time/);
  assert.match(page, /Download DOCX/);
  assert.match(route, /requireAdmin\(request\)/);
  assert.match(route, /codexTextOnly: true/);
  assert.match(route, /gpt-5\.6-sol/);
  assert.match(route, /researchLatestMarketNews/);
  assert.match(route, /validateAndHydrateMarketResearchSelection/);
  assert.match(route, /INSERT INTO tasks/);
  assert.match(route, /'market-research'/);
  assert.match(history, /market-research/);
  assert.match(history, /Market Research/);
  assert.match(migration, /market-research/);
  assert.doesNotMatch(migration, /DELETE|TRUNCATE|DROP TABLE/i);

  const report = validateAndHydrateMarketResearchSelection({ items: [{
    candidateId: 'candidate-a', eventKey: 'official-gold-data-release', productCategory: 'Gold', mainEvent: 'Data resmi memengaruhi harga emas.',
    latestFactualDevelopment: 'Nilai terbaru tercatat 2.622.000.', marketRelevance: 'Perkembangan ini relevan untuk sentimen Gold.',
  }] }, candidates);
  const blob = await buildMarketResearchDocxBlob('Morning briefing.', '2026-07-27', report.items);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
  assert.equal(marketResearchDocxFilename('2026-07-27'), 'DUPOIN_Latest_Market_News_MarketResearch_V1_20260727.docx');
});
