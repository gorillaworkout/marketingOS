import test from 'node:test';
import assert from 'node:assert/strict';
import { researchArticleMarketNews, type ResearchFeed } from '../src/lib/article-market-news-research';

const feeds: ResearchFeed[] = [
  { outlet: 'Publisher A', url: 'https://publisher-a.example/market.xml' },
  { outlet: 'Publisher B', url: 'https://publisher-b.example/economy.xml' },
];

function rss(items: Array<{ title: string; link: string; description: string; pubDate: string }>): string {
  return `<?xml version="1.0"?><rss><channel>${items.map(item => `<item><title><![CDATA[${item.title}]]></title><link>${item.link}</link><description><![CDATA[${item.description}]]></description><pubDate>${item.pubDate}</pubDate></item>`).join('')}</channel></rss>`;
}

test('automatic research keeps only relevant same-day publisher evidence and queries every curated feed', async () => {
  const requested: Array<{ url: string; redirect?: RequestRedirect }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requested.push({ url, redirect: init?.redirect });
    const body = url.includes('publisher-a')
      ? rss([
          { title: 'Harga Emas Naik Rp 10.000 Hari Ini', link: 'https://publisher-a.example/emas-naik', description: 'Harga emas satu gram menjadi Rp 2.622.000.', pubDate: 'Mon, 27 Jul 2026 03:05:00 GMT' },
          { title: 'Harga Emas Kemarin', link: 'https://publisher-a.example/emas-kemarin', description: 'Arsip lama.', pubDate: 'Sun, 26 Jul 2026 03:05:00 GMT' },
          { title: 'Kebijakan Moneter Tetap Berjalan', link: 'https://publisher-a.example/moneter', description: 'Ringkasan juga menyebut harga emas stabil.', pubDate: 'Mon, 27 Jul 2026 04:05:00 GMT' },
        ])
      : rss([{ title: 'IHSG Bergerak Terbatas', link: 'https://publisher-b.example/ihsg', description: 'Indeks saham bergerak.', pubDate: 'Mon, 27 Jul 2026 04:00:00 GMT' }]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml', 'content-length': String(body.length) } });
  };

  const sources = await researchArticleMarketNews('harga emas', '2026-07-27', { feeds, fetchImpl, timeoutMs: 1_000 });
  assert.equal(requested.length, 2);
  assert.ok(requested.every(request => request.redirect === 'error'));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].outlet, 'Publisher A');
  assert.equal(sources[0].url, 'https://publisher-a.example/emas-naik');
  assert.equal(sources[0].publishedAt, '2026-07-27T10:05');
  assert.match(sources[0].verifiedFacts, /Rp 2\.622\.000/);
  assert.equal(sources[0].provenance, 'automated');
});

test('automatic research fails closed when no same-day relevant evidence exists', async () => {
  const fetchImpl: typeof fetch = async () => new Response(rss([
    { title: 'IHSG Hari Ini', link: 'https://publisher-a.example/ihsg', description: 'Saham bergerak.', pubDate: 'Mon, 27 Jul 2026 03:05:00 GMT' },
  ]), { status: 200, headers: { 'content-type': 'text/xml' } });
  await assert.rejects(
    researchArticleMarketNews('harga emas', '2026-07-27', { feeds, fetchImpl, timeoutMs: 1_000 }),
    /No relevant same-day publisher research/i,
  );
});

test('automatic research rejects oversized or non-XML publisher responses', async () => {
  const oversizedFetch: typeof fetch = async () => new Response('<rss/>', { status: 200, headers: { 'content-type': 'text/xml', 'content-length': '9999999' } });
  await assert.rejects(researchArticleMarketNews('harga emas', '2026-07-27', { feeds: feeds.slice(0, 1), fetchImpl: oversizedFetch, maxBytes: 1_024 }), /No relevant same-day publisher research/i);

  const htmlFetch: typeof fetch = async () => new Response('<html>not rss</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  await assert.rejects(researchArticleMarketNews('harga emas', '2026-07-27', { feeds: feeds.slice(0, 1), fetchImpl: htmlFetch }), /No relevant same-day publisher research/i);
});
