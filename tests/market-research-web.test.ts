import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import {
  marketResearchNeedsShortlist,
  normalizeMarketResearchInput,
  validateAndHydrateMarketResearchSelection,
  type MarketNewsCandidate,
} from '../src/lib/market-research';
import { buildMarketResearchDocxBlob } from '../src/lib/market-research-docx';
import { EmptyMarketResearchPoolError, type MarketResearchFeed } from '../src/lib/market-research-sources';
import {
  buildMarketResearchSearchQueries,
  gatherMarketResearch,
  MARKET_RESEARCH_OPEN_WEB_OUTLET,
  MARKET_RESEARCH_SERPER_SKIPPED,
} from '../src/lib/market-research-web';
import {
  candidatesForShortlist,
  signMarketResearchGatherToken,
  verifyMarketResearchGatherToken,
  type MarketResearchGatherClaims,
} from '../src/lib/market-research-shortlist';

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');

const THEME_BRIEF = 'Brief the semiconductor export-control sector for today and what it means for the desk.';
const RESEARCH_DATE = '2026-09-24';
const NOW = Date.parse('2026-09-24T02:00:00Z');

const feeds: MarketResearchFeed[] = [
  { outlet: 'Publisher A', url: 'https://publisher-a.example/rss.xml', origin: 'international' },
  { outlet: 'Publisher B', url: 'https://publisher-b.example/rss.xml', origin: 'international' },
];

function rss(items: Array<{ title: string; link: string; description: string; pubDate: string }>): string {
  return `<?xml version="1.0"?><rss><channel>${items.map(item => `<item><title><![CDATA[${item.title}]]></title><link>${item.link}</link><description><![CDATA[${item.description}]]></description><pubDate>${item.pubDate}</pubDate></item>`).join('')}</channel></rss>`;
}

function response(body: string, status = 200, contentType = 'text/html'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType, 'content-length': String(body.length) } });
}

const emptyRss = rss([]);

function longPage(body: string): string {
  return `<!doctype html><html><head><title>Source</title></head><body><article><p>${body}</p><p>${'Market context for the confirmed policy action. '.repeat(4)}</p></article></body></html>`;
}

test('search queries carry the brief theme and the research date', () => {
  const queries = buildMarketResearchSearchQueries(THEME_BRIEF, RESEARCH_DATE);
  assert.ok(queries.length >= 2 && queries.length <= 3);
  assert.ok(queries.some(query => /semiconductor/i.test(query) && query.includes(RESEARCH_DATE)));
});

test('gather reads a theme page from Serper and raises evidence to full text', async () => {
  const calls: string[] = [];
  const phases: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('rss.xml')) return response(emptyRss, 200, 'application/rss+xml');
    if (url.includes('google.serper.dev/search')) {
      return response(JSON.stringify({
        organic: [
          {
            title: 'US tightens semiconductor export controls',
            link: 'https://news.example/semi',
            snippet: 'Semiconductor export controls were updated in the latest official policy note for exporters.',
          },
          {
            title: 'Analyst predicts semiconductor controls could reach new highs',
            link: 'https://news.example/predict',
            snippet: 'Analyst predicts semiconductor export controls could reach a fresh target this quarter.',
          },
          {
            title: 'Harga emas Antam hari ini untuk briefing',
            link: 'https://news.example/antam',
            snippet: 'Harga emas Antam hari ini naik di butik dan bukan peristiwa pasar.',
          },
          {
            title: 'Exness semiconductor export controls note',
            link: 'https://news.example/exness',
            snippet: 'Exness published a semiconductor export controls recap for clients today.',
          },
        ],
      }), 200, 'application/json');
    }
    if (url === 'https://news.example/semi') {
      return response(longPage('The bureau tightened semiconductor export controls by 12 percent after the official notice.'));
    }
    return response('missing', 404, 'text/plain');
  };

  const result = await gatherMarketResearch(THEME_BRIEF, RESEARCH_DATE, {
    feeds,
    fetchImpl,
    serperApiKey: 'test-key',
    enableJina: false,
    now: () => NOW,
    onProgress: phase => phases.push(phase),
  });

  assert.deepEqual(phases, ['feeds', 'search', 'read']);
  assert.ok(calls.some(url => url.includes('google.serper.dev/search')));
  assert.equal(calls.includes('https://news.example/semi'), true);
  assert.equal(calls.some(url => url.includes('r.jina.ai') || url.includes('/predict') || url.includes('/antam') || url.includes('/exness')), false);
  assert.equal(result.candidates.length, 1);
  const theme = result.candidates[0];
  assert.ok(theme.categories.includes('Theme'));
  assert.equal(theme.evidenceLevel, 'full-text');
  assert.match(theme.evidence, /Full page text:/);
  assert.match(theme.evidence, /\b12\b/);
  assert.equal(theme.gatheredVia, 'open-web');
  assert.equal(result.themeCandidateCount, 1);
  assert.equal(result.sourceStatus.some(source => source.outlet === MARKET_RESEARCH_OPEN_WEB_OUTLET && source.status === 'ok' && source.candidateCount === 1), true);

  const selection = {
    candidateId: theme.id,
    eventKey: 'semiconductor-export-controls-tightened',
    productCategory: 'Theme' as const,
    symbol: theme.symbols[0],
    mainEvent: 'Kontrol ekspor semikonduktor diperketat secara resmi.',
    latestFactualDevelopment: 'Kebijakan itu mencatat perubahan 12 persen.',
    marketRelevance: 'Perkembangan ini relevan untuk sentimen saham Amerika.',
  };
  const hydrated = validateAndHydrateMarketResearchSelection({ items: [selection] }, result.candidates);
  assert.equal(hydrated.items[0].evidenceLevel, 'full-text');
  assert.equal(hydrated.items[0].articleUrl, 'https://news.example/semi');
  assert.throws(
    () => validateAndHydrateMarketResearchSelection({ items: [{ ...selection, latestFactualDevelopment: 'Perubahan tercatat 99 persen.' }] }, result.candidates),
    /unsupported numeric/i,
  );
});

test('gather uses Jina when the direct page is blocked and drops a different calendar day', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('rss.xml')) return response(emptyRss, 200, 'application/rss+xml');
    if (url.includes('google.serper.dev/search')) {
      return response(JSON.stringify({
        organic: [
          {
            title: 'Semiconductor export controls take effect',
            link: 'https://news.example/live',
            snippet: 'Semiconductor export controls were updated in the latest official policy note for exporters.',
          },
          {
            title: 'Semiconductor export controls recap',
            link: 'https://news.example/yesterday',
            snippet: 'Sep 23, 2026 semiconductor export controls were the previous session story for exporters.',
          },
        ],
      }), 200, 'application/json');
    }
    if (url === 'https://news.example/live') return response('Just a moment');
    if (url.startsWith('https://r.jina.ai/https://news.example/live')) {
      return response([
        'Title: Semiconductor export controls take effect',
        'Published Time: Thu, 24 Sep 2026 01:00:00 GMT',
        '',
        'The bureau tightened semiconductor export controls by 12 percent after publishing the official notice to exporters this morning.',
      ].join('\n'), 200, 'text/plain');
    }
    return response('missing', 404, 'text/plain');
  };

  const result = await gatherMarketResearch(THEME_BRIEF, RESEARCH_DATE, {
    feeds,
    fetchImpl,
    serperApiKey: 'test-key',
    now: () => NOW,
  });

  assert.ok(calls.some(url => url.startsWith('https://r.jina.ai/https://news.example/live')));
  assert.equal(calls.includes('https://news.example/yesterday'), false);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].evidenceLevel, 'full-text');
  assert.equal(result.candidates[0].publishedAt, '2026-09-24T08:00');
  assert.equal(result.candidates[0].publicationTimeKnown, true);
  assert.match(result.candidates[0].evidence, /\b12\b/);
});

test('missing Serper key keeps category feeds, records the skip, and can still read the article', async () => {
  const calls: string[] = [];
  const phases: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('rss.xml')) {
      const body = url.includes('publisher-a')
        ? rss([{ title: 'Gold Naik Setelah Data Inflation Resmi Dirilis', link: 'https://publisher-a.example/emas', description: 'Data resmi emas dipublikasikan.', pubDate: 'Mon, 27 Jul 2026 02:00:00 GMT' }])
        : emptyRss;
      return response(body, 200, 'application/rss+xml');
    }
    if (url === 'https://publisher-a.example/emas') {
      return response(longPage('The official gold print was 7.5 after the inflation release.'));
    }
    return response('missing', 404, 'text/plain');
  };

  const result = await gatherMarketResearch('Prepare a morning briefing for gold and inflation today.', '2026-07-27', {
    feeds,
    fetchImpl,
    serperApiKey: '',
    enableJina: false,
    onProgress: phase => phases.push(phase),
  });

  assert.deepEqual(phases, ['feeds', 'skip', 'read']);
  assert.equal(calls.some(url => url.includes('google.serper.dev')), false);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].evidenceLevel, 'full-text');
  assert.match(result.candidates[0].evidence, /7\.5/);
  assert.equal(result.candidates[0].gatheredVia, 'publisher-feed');
  const web = result.sourceStatus.find(source => source.outlet === MARKET_RESEARCH_OPEN_WEB_OUTLET);
  assert.deepEqual(web, {
    outlet: MARKET_RESEARCH_OPEN_WEB_OUTLET,
    status: 'error',
    candidateCount: 0,
    sameDayCount: 0,
    error: MARKET_RESEARCH_SERPER_SKIPPED,
  });
  const candidate = result.candidates[0];
  validateAndHydrateMarketResearchSelection({ items: [{
    candidateId: candidate.id,
    eventKey: 'official-gold-inflation-print',
    productCategory: 'Commodity',
    symbol: 'XAUUSD',
    mainEvent: 'Data inflasi resmi menggerakkan emas.',
    latestFactualDevelopment: 'Cetakan resmi emas tercatat 7.5.',
    marketRelevance: 'Perkembangan ini relevan untuk sentimen emas.',
  }] }, result.candidates);
  assert.throws(() => validateAndHydrateMarketResearchSelection({ items: [{
    candidateId: candidate.id,
    eventKey: 'official-gold-inflation-print',
    productCategory: 'Commodity',
    symbol: 'XAUUSD',
    mainEvent: 'Data inflasi resmi menggerakkan emas.',
    latestFactualDevelopment: 'Cetakan resmi emas tercatat 8.5.',
    marketRelevance: 'Perkembangan ini relevan untuk sentimen emas.',
  }] }, result.candidates), /unsupported numeric/i);
});

test('empty feeds and empty web search stay an honest empty pool', async () => {
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    if (url.includes('rss.xml')) return response(emptyRss, 200, 'application/rss+xml');
    if (url.includes('google.serper.dev/search')) return response(JSON.stringify({ organic: [] }), 200, 'application/json');
    return response('missing', 404, 'text/plain');
  };
  await assert.rejects(
    () => gatherMarketResearch(THEME_BRIEF, RESEARCH_DATE, { feeds, fetchImpl, serperApiKey: 'test-key', now: () => NOW }),
    (error: unknown) => {
      assert.equal(error instanceof EmptyMarketResearchPoolError, true);
      const status = (error as EmptyMarketResearchPoolError).sourceStatus;
      assert.equal(status.some(source => source.outlet === 'Publisher A' && source.status === 'ok'), true);
      assert.equal(status.some(source => source.outlet === MARKET_RESEARCH_OPEN_WEB_OUTLET && source.candidateCount === 0), true);
      return true;
    },
  );
});

test('at most one Indonesian open-web article is kept', async () => {
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    if (url.includes('rss.xml')) return response(emptyRss, 200, 'application/rss+xml');
    if (url.includes('google.serper.dev/search')) {
      return response(JSON.stringify({
        organic: [
          { title: 'Semiconductor export controls tighten in Jakarta', link: 'https://www.detik.com/semi-new', snippet: '2 hours ago. Semiconductor export controls tightened after the official notice to exporters.' },
          { title: 'Semiconductor export controls update from Jakarta', link: 'https://www.cnbcindonesia.com/semi-old', snippet: '5 hours ago. Semiconductor export controls were updated for local exporters.' },
        ],
      }), 200, 'application/json');
    }
    if (url.includes('detik.com') || url.includes('cnbcindonesia.com')) return response('Just a moment');
    return response('missing', 404, 'text/plain');
  };
  const result = await gatherMarketResearch(THEME_BRIEF, RESEARCH_DATE, {
    feeds,
    fetchImpl,
    serperApiKey: 'test-key',
    enableJina: false,
    now: () => NOW,
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].origin, 'indonesia');
  assert.equal(result.candidates[0].url, 'https://www.detik.com/semi-new');
  assert.equal(result.candidates[0].evidenceLevel, 'search-snippet');
});

test('a placeholder publication clock is not evidence for a bare day number', () => {
  const candidate: MarketNewsCandidate = {
    id: 'candidate-theme',
    outlet: 'news.example',
    title: 'Semiconductor export controls take effect',
    url: 'https://news.example/live',
    publishedAt: '2026-09-24T00:00',
    updatedAt: null,
    categories: ['Theme'],
    symbols: ['semiconductor export controls'],
    origin: 'international',
    importanceCategory: 'Sector',
    evidence: 'Full page text: semiconductor export controls were tightened by 12 percent.',
    evidenceLevel: 'full-text',
    publicationTimeKnown: false,
    gatheredVia: 'open-web',
  };
  const base = {
    candidateId: candidate.id,
    eventKey: 'semiconductor-export-controls-tightened',
    productCategory: 'Theme' as const,
    symbol: candidate.symbols[0],
    mainEvent: 'Kontrol ekspor semikonduktor diperketat secara resmi.',
    latestFactualDevelopment: 'Kebijakan itu mencatat perubahan 12 persen.',
    marketRelevance: 'Perkembangan ini relevan untuk sentimen saham.',
  };
  validateAndHydrateMarketResearchSelection({ items: [base] }, [candidate]);
  assert.throws(
    () => validateAndHydrateMarketResearchSelection({ items: [{ ...base, mainEvent: 'Pada 23 September kontrol ekspor diperketat.' }] }, [candidate]),
    /unsupported numeric/i,
  );
  assert.equal(marketResearchNeedsShortlist(1), false);
  assert.equal(marketResearchNeedsShortlist(2), true);
});

test('shortlist token round-trips, rejects tampering, and filters the confirmed ids', () => {
  const secret = 'test-secret';
  const candidates: MarketNewsCandidate[] = [0, 1].map(index => ({
    id: `abc123def456789${index}`.slice(0, 16),
    outlet: 'news.example',
    title: `Semiconductor export controls note ${index}`,
    url: `https://news.example/note-${index}`,
    publishedAt: '2026-09-24T08:00',
    updatedAt: null,
    categories: ['Theme' as const],
    symbols: [`Semiconductor ${index}`],
    origin: 'international' as const,
    importanceCategory: 'Sector',
    evidence: 'Full page text: semiconductor export controls were tightened by 12 percent.',
    evidenceLevel: 'full-text' as const,
    publicationTimeKnown: true,
    gatheredVia: 'open-web' as const,
  }));
  const claims: MarketResearchGatherClaims = {
    userId: 'user-1',
    brief: THEME_BRIEF,
    researchDate: RESEARCH_DATE,
    exp: Date.now() + 60_000,
    candidates,
    groupsSearched: ['Forex', 'Commodity', 'US Indices', 'US Stocks'],
    groupCandidateCounts: { Forex: 0, Commodity: 0, 'US Indices': 0, 'US Stocks': 0 },
    sourceStatus: [],
    themeCandidateCount: 2,
  };
  const token = signMarketResearchGatherToken(claims, secret);
  const verified = verifyMarketResearchGatherToken(token, secret);
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.claims.candidates[1].evidence.includes('12'), true);
  const kept = candidatesForShortlist(verified.claims, [candidates[0].id]);
  assert.deepEqual(kept.map(candidate => candidate.id), [candidates[0].id]);
  assert.throws(() => candidatesForShortlist(verified.claims, ['deadbeefdeadbeef']), /no longer available/i);

  const parts = token.split('~');
  const tamperedPayload = `${parts[1].slice(0, -2)}${parts[1].endsWith('a') ? 'b' : 'a'}`;
  const tampered = verifyMarketResearchGatherToken(`${parts[0]}~${tamperedPayload}~${parts[2]}`, secret);
  assert.deepEqual(tampered, { ok: false, reason: 'invalid' });

  const expired = signMarketResearchGatherToken({ ...claims, exp: Date.now() + 1_000 }, secret, Date.now());
  const stale = verifyMarketResearchGatherToken(expired, secret, Date.now() + 5_000);
  assert.deepEqual(stale, { ok: false, reason: 'expired' });

  assert.throws(
    () => normalizeMarketResearchInput({ brief: THEME_BRIEF, researchDate: RESEARCH_DATE, gatherToken: token }, RESEARCH_DATE),
    /at least one candidate/i,
  );
  const input = normalizeMarketResearchInput({
    brief: THEME_BRIEF,
    researchDate: RESEARCH_DATE,
    gatherToken: token,
    candidateIds: [candidates[0].id, candidates[0].id],
  }, RESEARCH_DATE);
  assert.deepEqual(input.candidateIds, [candidates[0].id]);
});

test('DOCX names full-text evidence and the operator UI keeps the shortlist step', async () => {
  const candidate: MarketNewsCandidate = {
    id: 'candidate-theme',
    outlet: 'news.example',
    title: 'Semiconductor export controls take effect',
    url: 'https://news.example/live',
    publishedAt: '2026-09-24T08:00',
    updatedAt: null,
    categories: ['Theme'],
    symbols: ['semiconductor export controls'],
    origin: 'international',
    importanceCategory: 'Sector',
    evidence: 'Full page text: semiconductor export controls were tightened by 12 percent.',
    evidenceLevel: 'full-text',
    publicationTimeKnown: true,
  };
  const report = validateAndHydrateMarketResearchSelection({ items: [{
    candidateId: candidate.id,
    eventKey: 'semiconductor-export-controls-tightened',
    productCategory: 'Theme',
    symbol: candidate.symbols[0],
    mainEvent: 'Kontrol ekspor semikonduktor diperketat secara resmi.',
    latestFactualDevelopment: 'Kebijakan itu mencatat perubahan 12 persen.',
    marketRelevance: 'Perkembangan ini relevan untuk sentimen saham.',
  }] }, [candidate]);
  const blob = await buildMarketResearchDocxBlob(THEME_BRIEF, RESEARCH_DATE, report.items);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml')?.async('string');
  assert.match(xml || '', /Full page text was read/);

  const page = read('src/app/dashboard/market-research/page.tsx');
  const route = read('src/app/api/market-research/generate/route.ts');
  const history = read('src/app/dashboard/history/page.tsx');
  assert.match(page, /Candidate shortlist/);
  assert.match(page, /Brief selected candidates/);
  assert.match(page, /Fill theme example/);
  assert.match(page, /formatMarketResearchEvidenceLevel/);
  assert.match(page, /Select at least one candidate/);
  assert.doesNotMatch(page, /@\/lib\/market-research-sources/);
  assert.match(route, /step: 'shortlist'/);
  assert.match(route, /Repairing evidence-bound selection \(attempt \$\{attempt \+ 1\}\/3\)/);
  assert.match(route, /publication\/update timestamps/);
  assert.match(route, /for \(let attempt = 1; attempt <= 3/);
  assert.match(history, /formatMarketResearchEvidenceLevel/);
  assert.match(read('.env.example'), /Market Research live check/);
  assert.match(read('README.md'), /Jina Reader/);
});
