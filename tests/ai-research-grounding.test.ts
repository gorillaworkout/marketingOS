import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_RESEARCH_IMAGE_ONLY_PROMPT,
  AI_RESEARCH_MAX_OUTPUT_TOKENS,
  AI_RESEARCH_SYSTEM_PROMPT,
  buildGatewayMessages,
} from '../src/lib/ai-research';
import {
  AI_RESEARCH_CONTEXT_HEADER,
  AI_RESEARCH_NO_INVENT_FACTS,
  buildAiResearchChatMessages,
  buildSearchQueries,
  classifySourceOrigin,
  formatResearchContext,
  gatherAiResearchContext,
  htmlToPlainText,
  injectResearchContext,
  officialSeedUrls,
  parseDuckDuckGoResults,
  parseWikipediaExtract,
  parseWikipediaSearch,
  prefersIndonesiaSources,
  rankResearchSources,
  shouldResearchQuery,
  unwrapSearchResultUrl,
} from '../src/lib/ai-research-grounding';

const read = (path: string) => readFileSync(path, 'utf8');

const ddgHtml = `
<div class="result">
  <a rel="nofollow" class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.dupoin.co.id%2Ftentang">Dupoin Indonesia resmi</a>
  <a class="result__snippet">Broker berizin BAPPEBTI dengan kantor di Indonesia.</a>
</div>
<div class="result">
  <a class="result__a" href="https://www.cnbcindonesia.com/market/dupoin">CNBC Indonesia tentang Dupoin</a>
  <a class="result__snippet">Liputan pasar Indonesia.</a>
</div>
<div class="result">
  <a class="result__a" href="https://127.0.0.1/secret">Blocked</a>
</div>
`;

const officialHtml = `<html><head><title>Dupoin Futures Indonesia</title></head><body>
<p>Dupoin Futures adalah pialang berjangka yang terdaftar dan diawasi BAPPEBTI.</p>
<p>Informasi resmi perusahaan hanya berasal dari situs ini.</p>
</body></html>`;

test('research query helpers prefer Indonesia sources and skip trivial turns', () => {
  assert.equal(prefersIndonesiaSources('Apa fakta resmi Dupoin Indonesia?'), true);
  assert.equal(prefersIndonesiaSources('What moved gold overnight?'), false);
  assert.equal(shouldResearchQuery('hi'), false);
  assert.equal(shouldResearchQuery(AI_RESEARCH_IMAGE_ONLY_PROMPT), false);
  assert.equal(shouldResearchQuery('Apa fakta resmi Dupoin Indonesia?'), true);
  assert.ok(buildSearchQueries('Apa fakta resmi Dupoin?').some(query => /dupoin\.co\.id/i.test(query)));
  assert.deepEqual(officialSeedUrls('Ceritakan Dupoin Indonesia'), [
    'https://www.dupoin.co.id/',
    'https://www.dupoin.com/',
  ]);
});

test('search parsers unwrap public results and drop private hosts', () => {
  assert.equal(
    unwrapSearchResultUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.dupoin.co.id%2F'),
    'https://www.dupoin.co.id/',
  );
  assert.equal(unwrapSearchResultUrl('https://127.0.0.1/secret'), null);
  assert.equal(classifySourceOrigin('https://www.dupoin.co.id/tentang'), 'indonesia');
  assert.equal(classifySourceOrigin('https://www.reuters.com/markets'), 'international');
  assert.equal(classifySourceOrigin('https://identity.com/about'), 'international');

  const parsed = parseDuckDuckGoResults(ddgHtml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].url, 'https://www.dupoin.co.id/tentang');
  assert.match(parsed[0].snippet, /BAPPEBTI/);
  assert.equal(htmlToPlainText('<p>Hello <b>world</b></p>'), 'Hello world');
});

test('Wikipedia parsers keep extracts as grounded snippets', () => {
  const hits = parseWikipediaSearch({
    query: { search: [{ title: 'Dupoin', snippet: 'Perusahaan <span>pialang</span> Indonesia' }] },
  });
  assert.equal(hits[0].title, 'Dupoin');
  assert.equal(hits[0].snippet, 'Perusahaan pialang Indonesia');

  const extract = parseWikipediaExtract({
    query: { pages: { '1': { title: 'Dupoin', extract: 'Dupoin adalah pialang berjangka di Indonesia.' } } },
  });
  assert.ok(extract);
  assert.match(extract!.url, /wikipedia\.org\/wiki\/Dupoin/);
  assert.match(extract!.snippet, /pialang berjangka/);
});

test('ranking prefers official and Indonesia sources for Indonesian queries', () => {
  const ranked = rankResearchSources([
    { title: 'Wire', url: 'https://www.reuters.com/markets/dupoin', snippet: 'International brief about the broker.', origin: 'international' },
    { title: 'Official', url: 'https://www.dupoin.co.id/', snippet: 'Halaman resmi Dupoin Futures Indonesia dan BAPPEBTI.', origin: 'indonesia' },
    { title: 'Local news', url: 'https://www.cnbcindonesia.com/market/x', snippet: 'Liputan singkat.', origin: 'indonesia' },
  ], true, 'Fakta Dupoin Indonesia');
  assert.equal(ranked[0].url, 'https://www.dupoin.co.id/');
  assert.equal(ranked[1].origin, 'indonesia');
});

test('injects research context into the chat path when sources are available', () => {
  const research = {
    query: 'Apa fakta resmi Dupoin Indonesia?',
    indonesiaPreferred: true,
    sources: [{
      title: 'Dupoin Futures Indonesia',
      url: 'https://www.dupoin.co.id/',
      snippet: 'Pialang berjangka terdaftar BAPPEBTI.',
      origin: 'indonesia' as const,
    }],
  };
  const messages = buildAiResearchChatMessages({
    systemPrompt: AI_RESEARCH_SYSTEM_PROMPT,
    history: [],
    incoming: [{ role: 'user', content: research.query }],
    research,
  });
  assert.equal(messages[0].content, AI_RESEARCH_SYSTEM_PROMPT);
  assert.match(String(messages[1].content), new RegExp(AI_RESEARCH_CONTEXT_HEADER));
  assert.match(String(messages[1].content), /dupoin\.co\.id/);
  assert.match(String(messages[1].content), /BAPPEBTI/);
  assert.match(String(messages[1].content), new RegExp(AI_RESEARCH_NO_INVENT_FACTS));
  assert.equal(messages[2].content, research.query);

  const withoutSources = injectResearchContext(
    buildGatewayMessages('system', [], [{ role: 'user', content: 'halo tim' }]),
    { query: 'halo tim', sources: [], indonesiaPreferred: true },
  );
  assert.equal(withoutSources.length, 2);
  assert.doesNotMatch(String(withoutSources[0].content), /GROUNDING_SOURCES/);
  assert.match(formatResearchContext({ query: 'x', sources: [], indonesiaPreferred: true }), /No web sources were retrieved/);
});

test('gatherAiResearchContext searches, fetches pages, and keeps official Indonesia facts', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('html.duckduckgo.com')) {
      return new Response(ddgHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('api.php') && url.includes('list=search')) {
      return new Response(JSON.stringify({
        query: { search: [{ title: 'Dupoin', snippet: 'Pialang Indonesia' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('api.php') && url.includes('prop=extracts')) {
      return new Response(JSON.stringify({
        query: { pages: { '12': { title: 'Dupoin', extract: 'Dupoin adalah pialang berjangka di Indonesia yang disebut di Wikipedia.' } } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('cnbcindonesia.com')) {
      return new Response('<html><title>CNBC</title><body>Liputan pasar Indonesia tentang Dupoin dan BAPPEBTI untuk trader ritel.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext('Apa fakta resmi Dupoin Indonesia?', { fetchImpl, timeoutMs: 8_000 });
  assert.equal(result.indonesiaPreferred, true);
  assert.ok(calls.some(url => url.includes('html.duckduckgo.com')));
  assert.ok(calls.some(url => url.includes('id.wikipedia.org')));
  assert.ok(result.sources.some(source => source.url.includes('dupoin.co.id')));
  assert.ok(result.sources.some(source => /BAPPEBTI|pialang berjangka/i.test(source.snippet)));
  assert.equal(result.sources[0].origin, 'indonesia');
});

test('AI Research chat route grounds answers, raises the token budget, and updates the system prompt', () => {
  const route = read('src/app/api/ai-research/chat/route.ts');
  const lib = read('src/lib/ai-research.ts');
  assert.match(route, /gatherAiResearchContext/);
  assert.match(route, /buildAiResearchChatMessages/);
  assert.match(route, /AI_RESEARCH_SYSTEM_PROMPT/);
  assert.match(route, /AI_RESEARCH_MAX_OUTPUT_TOKENS/);
  assert.match(route, /export const maxDuration = 60/);
  assert.doesNotMatch(route, /max_tokens:\s*2000/);
  assert.match(lib, /Jangan mengarang fakta perusahaan/);
  assert.match(lib, /utamakan sumber Indonesia/);
  assert.equal(AI_RESEARCH_MAX_OUTPUT_TOKENS, 4000);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /Cantumkan sitasi/);
});

test('AI Research UI shows a thinking bubble before tokens and keeps the stream cursor after', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /loading && !streaming/);
  assert.match(page, /ai-research-thinking/);
  assert.match(page, /ai-research-typing-dots/);
  assert.match(page, /Sedang meneliti/);
  assert.match(page, /ai-research-stream-cursor/);
  assert.match(page, /animate-spin/);
});
