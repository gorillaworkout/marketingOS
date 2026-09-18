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
  AI_RESEARCH_DEFAULT_TEMPERATURE,
  AI_RESEARCH_GROUNDED_PERSON_HEADER,
  AI_RESEARCH_GROUNDED_PERSON_MUST_ANSWER,
  AI_RESEARCH_MAX_SOURCES,
  AI_RESEARCH_NO_INVENT_FACTS,
  AI_RESEARCH_OTHER_PUBLIC_TRACE_PREFIX,
  AI_RESEARCH_PERSON_FACT_PREFIX,
  AI_RESEARCH_PERSON_HIT_TEMPERATURE,
  AI_RESEARCH_PERSON_NAME_HIT,
  AI_RESEARCH_SYNTHESIZE_ALL_TRACES,
  buildAiResearchChatMessages,
  buildFallbackSearchQueries,
  buildNewsRssQueries,
  buildOpenWebSearchQueries,
  buildSearchQueries,
  buildWikipediaQueries,
  classifySourceOrigin,
  DDG_HTML_BLOCKED_WARNING,
  diversifyResearchSources,
  extractGroundedPersonFacts,
  extractPersonNameCandidates,
  extractFetchedContent,
  extractRelevantWindow,
  formatGroundedPersonInstruction,
  formatResearchContext,
  gatherAiResearchContext,
  extractPageSnippet,
  htmlToPlainText,
  injectResearchContext,
  isDeepPersonResearch,
  isDuckDuckGoAnomalyPage,
  isEmptyOrLoginWallSource,
  isHighValuePersonTraceHost,
  isLikelyLoginWallHost,
  isOpenWebPersonTrace,
  isOrganicSearchNameHit,
  jinaReaderUrl,
  mentionsPersonName,
  mergeOrganicSearchHits,
  officialSeedUrls,
  parseBraveResults,
  parseDuckDuckGoInstantAnswer,
  parseDuckDuckGoResults,
  parseNewsRss,
  parseSerperResults,
  parseTavilyResults,
  parseWikidataEntities,
  parseWikidataSearch,
  parseWikipediaExtract,
  parseWikipediaOpensearch,
  parseWikipediaSearch,
  prefersIndonesiaSources,
  rankResearchSources,
  researchSourceHost,
  selectFetchCandidates,
  selectFinalResearchSources,
  SERPER_EXHAUSTED_WARNING,
  shouldResearchQuery,
  resolveAiResearchTemperature,
  sourceMentionsPersonName,
  sourcesHaveUsefulHits,
  sourcesMentionPersonName,
  trimPersonRosterNoise,
  unwrapSearchResultUrl,
  wikipediaSearchHosts,
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
  const dupoinSeeds = officialSeedUrls('Ceritakan Dupoin Indonesia');
  assert.ok(dupoinSeeds.includes('https://www.dupoin.co.id/'));
  assert.ok(dupoinSeeds.includes('https://www.dupoin.co.id/about-us/licenses'));
  assert.ok(dupoinSeeds.includes('https://www.dupoin.com/'));
  assert.ok(dupoinSeeds.some(url => /bappebti\.go\.id/i.test(url)));
  assert.ok(dupoinSeeds.some(url => /about-us|tentang/i.test(url)));
  assert.ok(AI_RESEARCH_MAX_SOURCES >= 12);
});

test('search parsers unwrap public results and drop private hosts', () => {
  assert.equal(
    unwrapSearchResultUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.dupoin.co.id%2F'),
    'https://www.dupoin.co.id/',
  );
  assert.equal(
    unwrapSearchResultUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.dupoin.co.id%2Fabout%2Dus%2Flicenses&rut=abc'),
    'https://www.dupoin.co.id/about-us/licenses',
  );
  assert.equal(unwrapSearchResultUrl('https://127.0.0.1/secret'), null);
  assert.equal(classifySourceOrigin('https://www.dupoin.co.id/tentang'), 'indonesia');
  assert.equal(classifySourceOrigin('https://www.reuters.com/markets'), 'international');
  assert.equal(classifySourceOrigin('https://identity.com/about'), 'international');

  const parsed = parseDuckDuckGoResults(ddgHtml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].url, 'https://www.dupoin.co.id/tentang');
  assert.match(parsed[0].snippet, /BAPPEBTI/);

  const liveStyle = parseDuckDuckGoResults(`
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.dupoin.co.id%2Fabout%2Dus%2Flicenses&amp;rut=abc">Licenses and Regulated Broker</a>
      </h2>
      <a class="result__snippet">PT Dupoin Futures Indonesia is fully licensed.</a>
    </div>
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fid.wikipedia.org%2Fwiki%2FDupoin">Wikipedia Dupoin</a>
      </h2>
    </div>
  `);
  assert.equal(liveStyle.length, 2);
  assert.equal(liveStyle[0].url, 'https://www.dupoin.co.id/about-us/licenses');
  assert.match(liveStyle[0].snippet, /fully licensed/);
  assert.equal(htmlToPlainText('<p>Hello <b>world</b></p>'), 'Hello world');
});

test('page extraction prefers meta and buried company-license facts over nav chrome', () => {
  const html = `<html><head><title>Licenses | Dupoin</title>
    <meta name="description" content="Explore our licenses and regulations.">
    </head><body>
    <header>English Bahasa Indonesia Sign In Sign Up Products Forex Metals</header>
    ${'Menu utama navigasi '.repeat(80)}
    <div>PT Dupoin Futures Indonesia is fully licensed and regulated by BAPPEBTI, OJK, and BI.</div>
    </body></html>`;
  const extracted = extractPageSnippet(html, 'Apa fakta resmi Dupoin Indonesia?');
  assert.equal(extracted.title, 'Licenses | Dupoin');
  assert.match(extracted.snippet, /BAPPEBTI/);
  assert.match(extracted.snippet, /licenses and regulations/i);
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

  const open = parseWikipediaOpensearch([
    'Dupoin',
    ['Dupoin Futures Indonesia'],
    ['Perusahaan pialang berjangka'],
    ['https://id.wikipedia.org/wiki/Dupoin_Futures_Indonesia'],
  ]);
  assert.equal(open[0].title, 'Dupoin Futures Indonesia');
  assert.match(open[0].url, /Dupoin_Futures_Indonesia/);
});

test('ranking prefers snippet-rich official hits over empty regulator shells', () => {
  const ranked = rankResearchSources([
    { title: 'Empty Bappebti home', url: 'https://bappebti.go.id/', snippet: '', origin: 'indonesia' },
    { title: 'Dupoin licenses', url: 'https://www.dupoin.co.id/about-us/licenses', snippet: 'PT Dupoin Futures Indonesia is fully licensed and regulated by BAPPEBTI.', origin: 'indonesia' },
    { title: 'Sella listing', url: 'https://bappebti.go.id/pialang_berjangka/detail/423', snippet: 'Sella Susriana tercatat sebagai Wakil Pialang Berjangka pada PT Dupoin Futures Indonesia.', origin: 'indonesia' },
  ], true, 'sella susriana siapa sih jir di dupoin');
  assert.equal(ranked[0].url, 'https://bappebti.go.id/pialang_berjangka/detail/423');
  assert.ok(ranked.some(source => source.url.includes('dupoin.co.id')));
  assert.notEqual(ranked[0].snippet, '');
});

test('ranking boosts snippets that contain both the person name and a role needle', () => {
  const ranked = rankResearchSources([
    {
      title: 'Company page name only',
      url: 'https://www.dupoin.co.id/team',
      snippet: 'Sella Susriana disebutkan di halaman perusahaan tanpa konteks jabatan resmi.',
      origin: 'indonesia',
    },
    {
      title: 'Company page roster',
      url: 'https://www.dupoin.co.id/about-us',
      snippet: 'Sella Susriana tercatat sebagai wakil pialang di PT Dupoin Futures Indonesia.',
      origin: 'indonesia',
    },
  ], true, 'sella susriana siapa sih jir di dupoin');
  assert.equal(ranked[0].url, 'https://www.dupoin.co.id/about-us');
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

test('fetch selection keeps official seeds as a floor and prefers diverse web domains', () => {
  const sources = [
    { title: 'Bappebti home', url: 'https://bappebti.go.id/', snippet: '', origin: 'indonesia' as const },
    { title: 'Bappebti dupoin', url: 'https://bappebti.go.id/pialang_berjangka/detail/423', snippet: '', origin: 'indonesia' as const },
    { title: 'Bappebti wakil', url: 'https://bappebti.go.id/pialang_berjangka_wakil_pialang', snippet: '', origin: 'indonesia' as const },
    { title: 'Dupoin home', url: 'https://www.dupoin.co.id/', snippet: '', origin: 'indonesia' as const },
    { title: 'Dupoin licenses', url: 'https://www.dupoin.co.id/about-us/licenses', snippet: '', origin: 'indonesia' as const },
    { title: 'News', url: 'https://www.cnbcindonesia.com/market/sella', snippet: 'Sella Susriana disebut di liputan pasar.', origin: 'indonesia' as const },
    { title: 'LinkedIn', url: 'https://www.linkedin.com/in/sella-susriana', snippet: 'Public profile mentioning Sella Susriana.', origin: 'international' as const },
    { title: 'Directory', url: 'https://www.bloomberg.com/profile/person/sella', snippet: 'Brief public bio of Sella Susriana.', origin: 'international' as const },
    { title: 'Kompas', url: 'https://www.kompas.com/sella-susriana', snippet: 'Berita tentang Sella Susriana.', origin: 'indonesia' as const },
  ];
  const fetched = selectFetchCandidates(sources, 'sella susriana siapa sih jir di dupoin', true, 8);
  const hosts = new Set(fetched.map(source => researchSourceHost(source.url)));
  assert.ok(fetched.some(source => source.url.includes('bappebti.go.id')), 'official seeds remain a floor');
  assert.ok(fetched.some(source => source.url.includes('cnbcindonesia.com')));
  assert.ok(fetched.some(source => source.url.includes('linkedin.com')));
  assert.ok(hosts.size >= 4, `expected diverse hosts, got ${[...hosts].join(', ')}`);
  const diversified = diversifyResearchSources(fetched, 6, 2);
  assert.ok(diversified.filter(source => researchSourceHost(source.url) === 'bappebti.go.id').length <= 2);
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
  assert.match(String(messages[1].content), /Synthesize a rich answer/);
  assert.equal(String(messages[1].content).includes(AI_RESEARCH_PERSON_NAME_HIT), false);
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
  assert.match(route, /type: 'research'/);
  assert.match(route, /sourceCount/);
  assert.match(route, /resolveAiResearchTemperature/);
  assert.doesNotMatch(route, /temperature:\s*0\.7/);
  assert.doesNotMatch(route, /max_tokens:\s*2000/);
  const envExample = read('.env.example');
  assert.match(envExample, /SERPER_API_KEY=/);
  assert.match(envExample, /BRAVE_SEARCH_API_KEY=/);
  assert.match(envExample, /TAVILY_API_KEY=/);
  assert.match(envExample, /Brave is not required/);
  assert.match(envExample, /Serper free tier/);
  assert.match(lib, /Jangan mengarang fakta perusahaan/);
  assert.match(lib, /utamakan sumber Indonesia/);
  assert.equal(AI_RESEARCH_MAX_OUTPUT_TOKENS, 4000);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /Cantumkan sitasi/);
});

const sellaQuery = 'sella susriana siapa sih jir di dupoin';

const sellaDdgHtml = `
<div class="result">
  <a rel="nofollow" class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fbappebti.go.id%2Fpialang_berjangka%2Fdetail%2F423">Bappebti - PT Dupoin Futures Indonesia</a>
  <a class="result__snippet">Sella Susriana tercatat sebagai Wakil Pialang Berjangka pada PT Dupoin Futures Indonesia di database Bappebti.</a>
</div>
<div class="result">
  <a class="result__a" href="https://www.dupoin.co.id/about-us">Tim dan perizinan Dupoin</a>
  <a class="result__snippet">Halaman resmi PT Dupoin Futures Indonesia.</a>
</div>
<div class="result">
  <a class="result__a" href="https://www.linkedin.com/in/sella-susriana">Sella Susriana | Public profile</a>
  <a class="result__snippet">Public LinkedIn mention of Sella Susriana in financial services.</a>
</div>
`;

const sellaBappebtiHtml = `<html><head><title>Bappebti - PT Dupoin Futures Indonesia</title></head><body>
<h1>PT DUPOIN FUTURES INDONESIA</h1>
<h2>WAKIL PIALANG</h2>
<p>Daftar wakil pialang berjangka terdaftar Bappebti:</p>
<ul>
  <li>Gunawan Herman</li>
  <li>Sella Susriana</li>
  <li>Andy Nugraha Sentosa</li>
</ul>
<p>Sella Susriana tercatat sebagai Wakil Pialang Berjangka di PT Dupoin Futures Indonesia.</p>
</body></html>`;

test('person + Dupoin queries extract names and run a multi-query regulator browse', () => {
  assert.deepEqual(extractPersonNameCandidates(sellaQuery), ['Sella Susriana']);
  assert.equal(isDeepPersonResearch(sellaQuery), true);
  assert.equal(shouldResearchQuery(sellaQuery), true);
  assert.equal(extractPersonNameCandidates('Apa fakta resmi Dupoin Indonesia?').length, 0);

  const queries = buildSearchQueries(sellaQuery);
  assert.ok(queries.length >= 5, `expected a broad query set, got ${queries.length}`);
  assert.ok(queries.some(query => /^"Sella Susriana"$/i.test(query)));
  assert.ok(queries.some(query => /"Sella Susriana" Dupoin/i.test(query)));
  assert.ok(queries.some(query => /"Sella Susriana" Bappebti/i.test(query)));
  assert.ok(queries.some(query => /site:bappebti\.go\.id/i.test(query)));
  assert.ok(queries.some(query => /wakil pialang/i.test(query)));
  assert.ok(queries.some(query => /linkedin\.com|berita OR news/i.test(query)));
  assert.ok(queries.some(query => /CPNS|Kemdikbud|freelancer/i.test(query)));
  assert.ok(queries.some(query => /ilmu tanah|administrasi|KYC/i.test(query)));
  assert.ok(queries.some(query => /Universitas Andalas|unand|scholar/i.test(query)));

  const openWeb = buildOpenWebSearchQueries(sellaQuery);
  assert.ok(openWeb.some(query => /^"Sella Susriana"$/i.test(query)), 'Serper must run a bare-name query');
  assert.ok(openWeb.some(query => /Sella Susriana/i.test(query)));
  assert.ok(openWeb.some(query => /CPNS|freelancer/i.test(query)));
  assert.ok(openWeb.some(query => /Universitas Andalas|unand|scholar/i.test(query)));
  assert.ok(openWeb.some(query => /news OR berita OR linkedin/i.test(query)));
  assert.ok(!openWeb.every(query => /site:/i.test(query)), 'open-web queries must not be site-restricted');
  assert.ok(openWeb.length >= 5, `expected more open-web person queries, got ${openWeb.length}`);

  const wikiQueries = buildWikipediaQueries(sellaQuery);
  assert.ok(wikiQueries.some(query => /Sella Susriana/i.test(query)));
  assert.ok(wikiQueries.some(query => /Dupoin Futures Indonesia/i.test(query)));
  assert.ok(wikiQueries.some(query => /Bappebti/i.test(query)));
  assert.deepEqual(wikipediaSearchHosts(true), ['id.wikipedia.org', 'en.wikipedia.org']);
  assert.deepEqual(wikipediaSearchHosts(false), ['en.wikipedia.org', 'id.wikipedia.org']);
  assert.ok(buildNewsRssQueries(sellaQuery).some(query => /Sella Susriana/i.test(query)));

  const fallback = buildFallbackSearchQueries(sellaQuery);
  assert.ok(fallback.length >= 1);
  assert.ok([...queries, ...fallback].some(query => /site:bappebti\.go\.id/i.test(query)));

  const seeds = officialSeedUrls(sellaQuery);
  assert.ok(seeds.some(url => /bappebti\.go\.id/i.test(url)));
  assert.ok(seeds.some(url => /pialang_berjangka/i.test(url)));
  assert.ok(seeds.some(url => /dupoin\.co\.id/i.test(url)));
});

test('Sella Susriana + Dupoin research grounds Bappebti wakil pialang hits instead of an empty refuse', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('html.duckduckgo.com')) {
      return new Response(sellaDdgHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('api.php')) {
      return new Response(JSON.stringify({ query: { search: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('bappebti.go.id')) {
      return new Response(sellaBappebtiHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('linkedin.com')) {
      return new Response('<html><title>Sella Susriana</title><body>Public profile mentioning Sella Susriana in financial services.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext(sellaQuery, { fetchImpl, timeoutMs: 8_000 });
  const grounded = formatResearchContext(result);
  const ddgQueries = calls
    .filter(url => url.includes('html.duckduckgo.com'))
    .map(url => decodeURIComponent(new URL(url).searchParams.get('q') || ''));

  assert.ok(ddgQueries.length >= 5, `expected multi-query browse, got ${ddgQueries.length}`);
  assert.ok(ddgQueries.some(query => /Sella Susriana/i.test(query)));
  assert.ok(ddgQueries.some(query => /bappebti/i.test(query)));
  assert.ok(calls.some(url => /bappebti\.go\.id/i.test(url)));
  assert.ok(result.sources.length >= 2);
  assert.ok(result.sources.some(source => /bappebti\.go\.id/i.test(source.url)));
  assert.ok(result.sources.some(source => /Sella Susriana/i.test(source.snippet)));
  assert.ok(result.sources.some(source => /wakil pialang/i.test(source.snippet)));
  assert.equal(sourcesHaveUsefulHits(result), true);
  assert.match(grounded, /bappebti/i);
  assert.match(grounded, /wakil pialang/i);
  assert.match(grounded, /Sella Susriana/);
  assert.match(grounded, /Synthesize a rich answer/);
  assert.equal(grounded.includes(AI_RESEARCH_PERSON_NAME_HIT), true);
  assert.equal(sourcesMentionPersonName(result), true);
  assert.doesNotMatch(grounded, /No web sources were retrieved/);

  const messages = buildAiResearchChatMessages({
    systemPrompt: AI_RESEARCH_SYSTEM_PROMPT,
    history: [],
    incoming: [{ role: 'user', content: sellaQuery }],
    research: result,
  });
  assert.match(String(messages[1].content), /GROUNDING_SOURCES/);
  assert.match(String(messages[1].content), /Bappebti|bappebti/);
  const lastUserIdx = messages.map(message => message.role).lastIndexOf('user');
  assert.ok(lastUserIdx > 0);
  assert.match(String(messages[lastUserIdx].content), new RegExp(sellaQuery));
  assert.equal(messages[lastUserIdx - 1].role, 'system');
  assert.match(String(messages[lastUserIdx - 1].content), new RegExp(AI_RESEARCH_GROUNDED_PERSON_HEADER));
  assert.match(String(messages[lastUserIdx - 1].content), /PERSON_FACT: Sella Susriana \| Wakil Pialang/i);
  assert.match(String(messages[lastUserIdx].content), /PERSON_FACT: Sella Susriana \| Wakil Pialang/i);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /apa yang sumber sebutkan/);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /belum terverifikasi/);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /LinkedIn publik|berita, direktori/);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /belum ada sumber publik terverifikasi/);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /daftar CPNS|profil freelancer/);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /Jangan menggabungkan identitas/);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /[Pp]engguna yang memutuskan/);
});

test('long Bappebti broker pages keep wakil pialang heading with a late person name', () => {
  const earlyChrome = 'Navigasi beranda berita pengumuman pasar fisik '.repeat(220);
  const rekeningPad = 'Nomor rekening bank penampung dana nasabah BCA 1234567890 Mandiri 0987654321 '.repeat(360);
  const html = `<html><head><title>Bappebti - PT Dupoin Futures Indonesia</title></head><body>
    <div>${earlyChrome}</div>
    <h2>WAKIL PIALANG</h2>
    <p>Daftar wakil pialang berjangka terdaftar Bappebti:</p>
    <ul><li>Gunawan Herman</li><li>Andy Nugraha Sentosa</li></ul>
    <div>${rekeningPad}</div>
    <p>Sella Susriana</p>
    <p>Lulu Sakinah rekening penampung lanjutan</p>
  </body></html>`;

  const body = htmlToPlainText(html);
  const headingAt = body.toLowerCase().indexOf('wakil pialang');
  const nameAt = body.toLowerCase().indexOf('sella susriana');
  assert.ok(headingAt >= 0 && nameAt > headingAt);
  assert.ok(nameAt - headingAt > 2_200, `expected a distant roster heading, gap was ${nameAt - headingAt}`);

  const naiveStart = Math.max(0, nameAt - 800);
  const naiveWindow = body.slice(naiveStart, naiveStart + 2_200);
  assert.match(naiveWindow, /Sella Susriana/);
  assert.doesNotMatch(naiveWindow, /wakil pialang/i);

  const window = extractRelevantWindow(body, sellaQuery);
  assert.match(window, /Sella Susriana/);
  assert.match(window, /wakil pialang/i);
  assert.match(window, /\[Section: Wakil Pialang\]/i);
  assert.doesNotMatch(window, /1234567890/);
  assert.doesNotMatch(window, /Nomor rekening bank penampung/i);

  const extracted = extractPageSnippet(html, sellaQuery);
  assert.match(extracted.snippet, /Sella Susriana/);
  assert.match(extracted.snippet, /wakil pialang/i);
  assert.doesNotMatch(extracted.snippet, /1234567890/);

  const research = {
    query: sellaQuery,
    indonesiaPreferred: true,
    sources: [{
      title: extracted.title || 'Bappebti - PT Dupoin Futures Indonesia',
      url: 'https://bappebti.go.id/pialang_berjangka/detail/423',
      snippet: extracted.snippet,
      origin: 'indonesia' as const,
    }],
  };
  const facts = extractGroundedPersonFacts(research);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].name, 'Sella Susriana');
  assert.match(facts[0].section || '', /Wakil Pialang/i);
  assert.equal(facts[0].url, 'https://bappebti.go.id/pialang_berjangka/detail/423');

  const instruction = formatGroundedPersonInstruction(facts);
  assert.ok(instruction);
  assert.match(instruction!, new RegExp(AI_RESEARCH_GROUNDED_PERSON_HEADER));
  assert.equal(instruction!.includes(AI_RESEARCH_GROUNDED_PERSON_MUST_ANSWER), true);
  assert.match(instruction!, /Cite that URL\. Do not say unconfirmed \/ tidak terkonfirmasi/);
  assert.match(instruction!, /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.match(instruction!, /bappebti\.go\.id\/pialang_berjangka\/detail\/423/);
  assert.doesNotMatch(instruction!, /If a fact is missing from the sources, say the grounded sources do not confirm it/);
  assert.doesNotMatch(instruction!, /Prefer summarizing grounded hits over saying no verified source was found/);

  const grounded = formatResearchContext(research);
  assert.match(grounded, /Sella Susriana/);
  assert.match(grounded, /wakil pialang/i);
  assert.equal(grounded.includes(AI_RESEARCH_PERSON_NAME_HIT), true);
  assert.equal(grounded.includes(AI_RESEARCH_GROUNDED_PERSON_MUST_ANSWER), true);
  assert.match(grounded, /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.equal(sourcesMentionPersonName(research), true);
  assert.match(grounded, /Synthesize a rich answer/);

  const messages = buildAiResearchChatMessages({
    systemPrompt: AI_RESEARCH_SYSTEM_PROMPT,
    history: [
      { role: 'user', content: 'halo' },
      { role: 'assistant', content: 'Halo, ada yang bisa dibantu?' },
    ],
    incoming: [{ role: 'user', content: sellaQuery }],
    research,
  });
  const lastUserIdx = messages.map(message => message.role).lastIndexOf('user');
  assert.match(String(messages[lastUserIdx].content), new RegExp(sellaQuery));
  assert.match(String(messages[lastUserIdx].content), /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.equal(messages[lastUserIdx - 1].role, 'system');
  assert.equal(messages[lastUserIdx - 1].content, instruction);
  assert.match(String(messages[1].content), /GROUNDING_SOURCES/);
  assert.ok(String(messages[1].content).includes(AI_RESEARCH_GROUNDED_PERSON_MUST_ANSWER));
});

test('long 14-source grounding still pins a short roster fact next to the latest user turn', () => {
  const pad = 'Nomor rekening bank penampung dana nasabah BCA 1234567890 Mandiri 0987654321 '.repeat(28);
  const sources = Array.from({ length: 14 }, (_, index) => {
    if (index === 0) {
      return {
        title: 'Bappebti - PT Dupoin Futures Indonesia',
        url: 'https://bappebti.go.id/pialang_berjangka/detail/423',
        snippet: `[Section: Wakil Pialang] Daftar wakil pialang berjangka: Gunawan Herman ${pad} Sella Susriana Andy Nugraha Sentosa`,
        origin: 'indonesia' as const,
      };
    }
    return {
      title: `Background source ${index}`,
      url: `https://www.dupoin.co.id/page-${index}`,
      snippet: pad,
      origin: 'indonesia' as const,
    };
  });
  const research = {
    query: sellaQuery,
    indonesiaPreferred: true,
    sources,
  };
  const grounded = formatResearchContext(research);
  assert.ok(grounded.length > 20_000, `expected a bulky grounding block, got ${grounded.length}`);
  assert.match(grounded, /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.equal(grounded.includes(AI_RESEARCH_GROUNDED_PERSON_MUST_ANSWER), true);

  const messages = buildAiResearchChatMessages({
    systemPrompt: AI_RESEARCH_SYSTEM_PROMPT,
    history: [],
    incoming: [{ role: 'user', content: sellaQuery }],
    research,
  });
  const lastUserIdx = messages.map(message => message.role).lastIndexOf('user');
  const adjacent = String(messages[lastUserIdx - 1].content);
  const userTurn = String(messages[lastUserIdx].content);
  assert.match(userTurn, new RegExp(sellaQuery));
  assert.match(userTurn, /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.equal(messages[lastUserIdx - 1].role, 'system');
  assert.ok(adjacent.length < 1_200, `adjacent instruction must stay short, got ${adjacent.length}`);
  assert.match(adjacent, new RegExp(AI_RESEARCH_GROUNDED_PERSON_HEADER));
  assert.match(adjacent, new RegExp(AI_RESEARCH_PERSON_FACT_PREFIX));
  assert.equal(adjacent.includes(AI_RESEARCH_GROUNDED_PERSON_MUST_ANSWER), true);
  assert.match(adjacent, /Cite that URL\. Do not say unconfirmed \/ tidak terkonfirmasi/);
  assert.match(adjacent, /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.match(adjacent, /bappebti\.go\.id\/pialang_berjangka\/detail\/423/);
  assert.doesNotMatch(adjacent, /If a fact is missing from the sources, say the grounded sources do not confirm it/);
  assert.doesNotMatch(adjacent, /Background source 13/);
  assert.ok(String(messages[1].content).length > 20_000);
  assert.equal(resolveAiResearchTemperature(research), AI_RESEARCH_PERSON_HIT_TEMPERATURE);
  assert.equal(resolveAiResearchTemperature({
    query: 'Apa fakta resmi Dupoin Indonesia?',
    indonesiaPreferred: true,
    sources: [{ title: 'Dupoin', url: 'https://www.dupoin.co.id/', snippet: 'Pialang berjangka.', origin: 'indonesia' }],
  }), AI_RESEARCH_DEFAULT_TEMPERATURE);
  assert.match(trimPersonRosterNoise(`${pad} Sella Susriana`), /Sella Susriana/);
  assert.doesNotMatch(trimPersonRosterNoise(`${pad} Sella Susriana`), /1234567890/);
});

const sellaMultiTraceResearch = {
  query: sellaQuery,
  indonesiaPreferred: true,
  sources: [
    {
      title: 'Bappebti - PT Dupoin Futures Indonesia',
      url: 'https://bappebti.go.id/pialang_berjangka/detail/423',
      snippet: '[Section: Wakil Pialang] Sella Susriana tercatat sebagai Wakil Pialang Berjangka pada PT Dupoin Futures Indonesia.',
      origin: 'indonesia' as const,
    },
    {
      title: 'Pengumuman CPNS Kemdikbudristek 2024',
      url: 'https://sscasn.bkn.go.id/formasi/2024/sella-susriana',
      snippet: 'Sella Susriana — formasi Pranata Laboratorium Pendidikan Ahli Pertama, CPNS Kemdikbudristek 2024.',
      origin: 'indonesia' as const,
    },
    {
      title: 'Profil freelancer Sella Susriana',
      url: 'https://www.sribulancer.com/id/public/sella-susriana',
      snippet: 'Sella Susriana, lulusan Ilmu Tanah Universitas Andalas, mengerjakan administrasi dan KYC.',
      origin: 'indonesia' as const,
    },
  ],
};

test('multi-source person fixture keeps PERSON_FACT and requires covering other traces', () => {
  const facts = extractGroundedPersonFacts(sellaMultiTraceResearch);
  assert.ok(facts.some(fact => /bappebti\.go\.id/i.test(fact.url) && /Wakil Pialang/i.test(fact.section || '')));
  assert.ok(facts.some(fact => /sscasn\.bkn\.go\.id|bkn\.go\.id/i.test(fact.url)));
  assert.ok(facts.some(fact => /sribulancer\.com/i.test(fact.url)));

  const instruction = formatGroundedPersonInstruction(facts);
  assert.ok(instruction);
  assert.match(instruction!, /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.equal(instruction!.includes(AI_RESEARCH_GROUNDED_PERSON_MUST_ANSWER), true);
  assert.match(instruction!, /dump every OTHER_PUBLIC_TRACE/i);
  assert.match(instruction!, /may or may not be the same person/i);
  assert.match(instruction!, /Do not withhold other traces/);
  assert.doesNotMatch(instruction!, /MUST answer from this roster fact/);
  assert.match(instruction!, new RegExp(`${AI_RESEARCH_OTHER_PUBLIC_TRACE_PREFIX} Sella Susriana`));
  assert.match(instruction!, /OTHER_PUBLIC_TRACE:.*sscasn\.bkn\.go\.id|OTHER_PUBLIC_TRACE:.*sribulancer\.com/);
  assert.match(instruction!, /sscasn\.bkn\.go\.id/);
  assert.match(instruction!, /sribulancer\.com/);

  const grounded = formatResearchContext(sellaMultiTraceResearch);
  assert.match(grounded, /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.equal(grounded.includes(AI_RESEARCH_SYNTHESIZE_ALL_TRACES), true);
  assert.match(grounded, /OTHER_PUBLIC_TRACE:/);
  assert.match(grounded, /do not withhold, over-curate, or save traces for later/);
  assert.match(grounded, /Pranata Laboratorium Pendidikan Ahli Pertama/);
  assert.match(grounded, /Ilmu Tanah Universitas Andalas/);
  assert.match(grounded, /administrasi dan KYC/);
  assert.match(grounded, /sscasn\.bkn\.go\.id|bkn\.go\.id/);
  assert.match(grounded, /sribulancer\.com/);

  const messages = buildAiResearchChatMessages({
    systemPrompt: AI_RESEARCH_SYSTEM_PROMPT,
    history: [],
    incoming: [{ role: 'user', content: sellaQuery }],
    research: sellaMultiTraceResearch,
  });
  const blob = messages.map(message => String(message.content)).join('\n');
  assert.match(blob, /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.match(blob, /OTHER_PUBLIC_TRACE:/);
  assert.match(blob, new RegExp(AI_RESEARCH_SYNTHESIZE_ALL_TRACES.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(blob, /bappebti\.go\.id/);
  assert.match(blob, /sscasn\.bkn\.go\.id|bkn\.go\.id/);
  assert.match(blob, /sribulancer\.com/);
  const hosts = new Set(sellaMultiTraceResearch.sources.map(source => researchSourceHost(source.url)));
  assert.ok(hosts.size >= 3, `expected multiple domains in the fixture, got ${[...hosts].join(', ')}`);
});

test('final source selection reserves CPNS and freelancer traces instead of official-only crowding', () => {
  const crowded = [
    ...sellaMultiTraceResearch.sources,
    { title: 'Bappebti home', url: 'https://bappebti.go.id/', snippet: 'Portal resmi Bappebti.', origin: 'indonesia' as const },
    { title: 'Bappebti list', url: 'https://bappebti.go.id/pialang_berjangka', snippet: 'Daftar pialang berjangka.', origin: 'indonesia' as const },
    { title: 'Dupoin home', url: 'https://www.dupoin.co.id/', snippet: 'PT Dupoin Futures Indonesia terdaftar BAPPEBTI.', origin: 'indonesia' as const },
    { title: 'Dupoin licenses', url: 'https://www.dupoin.co.id/about-us/licenses', snippet: 'Lisensi Bappebti Dupoin.', origin: 'indonesia' as const },
    { title: 'Dupoin about', url: 'https://www.dupoin.co.id/about-us', snippet: 'Tentang Dupoin Futures.', origin: 'indonesia' as const },
    { title: 'Wikipedia Bappebti', url: 'https://id.wikipedia.org/wiki/Bappebti', snippet: 'Regulator perdagangan berjangka.', origin: 'indonesia' as const },
    { title: 'Wikipedia Dupoin', url: 'https://id.wikipedia.org/wiki/Dupoin', snippet: 'Perusahaan pialang.', origin: 'indonesia' as const },
  ];
  const selected = selectFinalResearchSources(crowded, sellaQuery, true, 8);
  assert.ok(selected.some(source => /bappebti\.go\.id\/pialang_berjangka\/detail\/423/.test(source.url)));
  assert.ok(selected.some(source => /sscasn\.bkn\.go\.id|bkn\.go\.id/.test(source.url)), 'CPNS listing must survive official crowding');
  assert.ok(selected.some(source => /sribulancer\.com/.test(source.url)), 'freelancer profile must survive official crowding');
  const fetched = selectFetchCandidates(crowded, sellaQuery, true, 8);
  assert.ok(fetched.some(source => /sscasn\.bkn\.go\.id|bkn\.go\.id/.test(source.url)));
  assert.ok(fetched.some(source => /sribulancer\.com/.test(source.url)));
});

test('Serper-like organic name hits survive official seeds and Facebook/YouTube crowding', () => {
  const liveMix = [
    { title: 'Bappebti Dupoin', url: 'https://bappebti.go.id/pialang_berjangka/detail/423', snippet: 'Sella Susriana tercatat sebagai Wakil Pialang.', origin: 'indonesia' as const },
    { title: 'Bappebti home', url: 'https://bappebti.go.id/', snippet: 'Portal resmi Bappebti.', origin: 'indonesia' as const },
    { title: 'Dupoin home', url: 'https://www.dupoin.co.id/', snippet: 'PT Dupoin Futures Indonesia.', origin: 'indonesia' as const },
    { title: 'Dupoin licenses', url: 'https://www.dupoin.co.id/about-us/licenses', snippet: 'Lisensi Bappebti.', origin: 'indonesia' as const },
    { title: 'Wikipedia Bappebti', url: 'https://id.wikipedia.org/wiki/Bappebti', snippet: 'Regulator PBK Indonesia.', origin: 'indonesia' as const },
    { title: 'Facebook Dupoin', url: 'https://www.facebook.com/dupoin', snippet: 'Sella Susriana mentioned on a Dupoin page.', origin: 'international' as const },
    { title: 'YouTube clip', url: 'https://www.youtube.com/watch?v=sella', snippet: 'Video mentioning Sella Susriana.', origin: 'international' as const },
    { title: 'Pinterest pin', url: 'https://www.pinterest.com/pin/sella', snippet: 'Sella Susriana pin.', origin: 'international' as const },
    { title: 'Sella Susriana | cake.me', url: 'https://www.cake.me/sella-susriana', snippet: 'Public resume for Sella Susriana, administrasi and KYC.', origin: 'international' as const },
    { title: 'Freelancer Sella Susriana', url: 'https://www.freelancer.co.nz/u/sellasusriana', snippet: 'Sella Susriana freelancer profile, Ilmu Tanah Universitas Andalas.', origin: 'international' as const },
    { title: 'Scholar Unand', url: 'https://scholar.unand.ac.id/sella-susriana', snippet: 'Sella Susriana, Ilmu Tanah, Universitas Andalas.', origin: 'indonesia' as const },
  ];
  const selected = selectFinalResearchSources(liveMix, sellaQuery, true, 14);
  const urls = selected.map(source => source.url).join(' ');
  assert.ok(/bappebti\.go\.id\/pialang_berjangka\/detail\/423/.test(urls), 'official roster stays');
  assert.ok(/cake\.me/.test(urls), 'cake.me resume must be reserved');
  assert.ok(/freelancer\.co\.nz/.test(urls), 'freelancer.co.nz must be reserved');
  assert.ok(/scholar\.unand\.ac\.id/.test(urls), 'Unand scholar page must be reserved');
  const fetched = selectFetchCandidates(liveMix, sellaQuery, true, 12);
  const fetchUrls = fetched.map(source => source.url).join(' ');
  assert.ok(/cake\.me/.test(fetchUrls));
  assert.ok(/freelancer\.co\.nz/.test(fetchUrls));
  assert.ok(/scholar\.unand\.ac\.id/.test(fetchUrls));

  const research = {
    query: sellaQuery,
    indonesiaPreferred: true,
    sources: selected.filter(source => (
      /bappebti\.go\.id\/pialang_berjangka\/detail\/423|cake\.me|freelancer\.co\.nz|scholar\.unand\.ac\.id/.test(source.url)
    )),
  };
  const grounded = formatResearchContext(research);
  assert.match(grounded, /PERSON_FACT: Sella Susriana \| Wakil Pialang/);
  assert.equal(grounded.includes(AI_RESEARCH_SYNTHESIZE_ALL_TRACES), true);
  assert.match(grounded, /cake\.me/);
  assert.match(grounded, /freelancer\.co\.nz/);
  assert.match(grounded, /scholar\.unand\.ac\.id/);
});

test('URL slugs and compact handles count as open-web person traces', () => {
  const cake = {
    title: 'CakeResume',
    url: 'https://www.cake.me/sella-susriana',
    snippet: 'View resume.',
    origin: 'international' as const,
    discoveredVia: 'search-api' as const,
  };
  const freelancer = {
    title: 'Freelancer',
    url: 'https://www.freelancer.co.nz/u/sellasusriana',
    snippet: 'Member since 2019.',
    origin: 'international' as const,
    discoveredVia: 'search-api' as const,
  };
  const unand = {
    title: 'EPrints University of Andalas',
    url: 'https://scholar.unand.ac.id/id/eprint/sella-susriana',
    snippet: 'Preview.',
    origin: 'indonesia' as const,
    discoveredVia: 'search-api' as const,
  };
  assert.equal(mentionsPersonName(cake.url, 'Sella Susriana'), true);
  assert.equal(mentionsPersonName(freelancer.url, 'Sella Susriana'), true);
  assert.equal(isHighValuePersonTraceHost(cake.url), true);
  assert.equal(isHighValuePersonTraceHost(freelancer.url), true);
  assert.equal(isHighValuePersonTraceHost(unand.url), true);
  assert.equal(sourceMentionsPersonName(cake, sellaQuery), true);
  assert.equal(sourceMentionsPersonName(freelancer, sellaQuery), true);
  assert.equal(sourceMentionsPersonName(unand, sellaQuery), true);
  assert.equal(isOpenWebPersonTrace(cake, sellaQuery), true);
  assert.equal(isOpenWebPersonTrace(freelancer, sellaQuery), true);
  assert.equal(isOpenWebPersonTrace(unand, sellaQuery), true);
  assert.equal(isOrganicSearchNameHit(cake, sellaQuery), true);

  const reserved = selectFinalResearchSources([
    { title: 'Bappebti Dupoin', url: 'https://bappebti.go.id/pialang_berjangka/detail/423', snippet: 'Sella Susriana tercatat sebagai Wakil Pialang.', origin: 'indonesia' },
    { title: 'Bappebti home', url: 'https://bappebti.go.id/', snippet: 'Portal resmi Bappebti.', origin: 'indonesia' },
    { title: 'Dupoin home', url: 'https://www.dupoin.co.id/', snippet: 'PT Dupoin Futures Indonesia.', origin: 'indonesia' },
    { title: 'Facebook Dupoin', url: 'https://www.facebook.com/dupoin', snippet: 'Sella Susriana mentioned on a Dupoin page.', origin: 'international' },
    { title: 'YouTube clip', url: 'https://www.youtube.com/watch?v=sella', snippet: 'Video mentioning Sella Susriana.', origin: 'international' },
    cake,
    freelancer,
    unand,
  ], sellaQuery, true, 14);
  const reservedUrls = reserved.map(source => source.url).join(' ');
  assert.ok(/cake\.me/.test(reservedUrls));
  assert.ok(/freelancer\.co\.nz/.test(reservedUrls));
  assert.ok(/scholar\.unand\.ac\.id/.test(reservedUrls));
});

test('Serper organic name hits survive failed fetches and emit OTHER_PUBLIC_TRACE', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('google.serper.dev/search')) {
      assert.equal((init?.headers as Record<string, string>)?.['X-API-KEY'] || (init?.headers as Headers | undefined)?.get?.('X-API-KEY'), 'organic-keep-serper');
      return new Response(JSON.stringify({
        organic: [
          {
            title: 'Bappebti Dupoin',
            link: 'https://bappebti.go.id/pialang_berjangka/detail/423',
            snippet: 'Sella Susriana tercatat sebagai wakil pialang.',
          },
          {
            title: 'CakeResume',
            link: 'https://www.cake.me/sella-susriana',
            snippet: 'Sign up to see Sella Susriana resume for administrasi and KYC.',
          },
          {
            title: 'EPrints University of Andalas',
            link: 'https://scholar.unand.ac.id/id/eprint/sella-susriana',
            snippet: 'Preview.',
          },
          {
            title: 'Freelancer',
            link: 'https://www.freelancer.co.nz/u/sellasusriana',
            snippet: 'Member since 2019.',
          },
          {
            title: 'Facebook Dupoin',
            link: 'https://www.facebook.com/dupoin',
            snippet: 'Sella Susriana mentioned on a Dupoin page.',
          },
          {
            title: 'YouTube clip',
            link: 'https://www.youtube.com/watch?v=sella',
            snippet: 'Video mentioning Sella Susriana.',
          },
          {
            title: 'Wikipedia Bappebti',
            link: 'https://id.wikipedia.org/wiki/Bappebti',
            snippet: 'Regulator perdagangan berjangka Indonesia.',
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('html.duckduckgo.com')) {
      return new Response(ddgAnomalyHtml, { status: 202, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('cake.me') || url.includes('unand.ac.id') || url.includes('freelancer.co.nz')) {
      return new Response('not found', { status: 404 });
    }
    if (url.startsWith('https://r.jina.ai/') && /cake\.me|unand|freelancer/.test(url)) {
      return new Response('not found', { status: 404 });
    }
    if (url.includes('bappebti.go.id') && !url.startsWith('https://r.jina.ai/')) {
      return new Response(sellaBappebtiHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('facebook.com') || url.includes('youtube.com')) {
      return new Response('<html><title>Social</title><body>Sella Susriana mentioned on a public Dupoin social page with extra commentary.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('id.wikipedia.org') && url.includes('prop=extracts')) {
      return new Response(JSON.stringify({
        query: { pages: { '1': { title: 'Bappebti', extract: 'Bappebti mengawasi pialang berjangka di Indonesia.' } } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('api.php') || url.includes('api.duckduckgo.com') || url.includes('wikidata.org') || url.includes('news.google.com')) {
      return new Response(JSON.stringify({ query: { search: [] }, search: [], Heading: '', AbstractText: '', Results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext(sellaQuery, {
    fetchImpl,
    timeoutMs: 8_000,
    searchApiKeys: { serper: 'organic-keep-serper' },
    logger: { warn() { /* DDG blocked; Serper supplies organic URLs */ } },
  });
  const urls = result.sources.map(source => source.url).join(' ');
  assert.ok(calls.some(url => url.includes('google.serper.dev/search')));
  assert.ok(/bappebti\.go\.id\/pialang_berjangka\/detail\/423/.test(urls), 'official Bappebti floor stays');
  assert.ok(/cake\.me/.test(urls), 'cake.me Serper organic must survive failed fetch');
  assert.ok(/freelancer\.co\.nz/.test(urls), 'freelancer.co.nz Serper organic must survive failed fetch');
  assert.ok(/scholar\.unand\.ac\.id/.test(urls), 'Unand scholar Serper organic must survive failed fetch');

  const cake = result.sources.find(source => source.url.includes('cake.me'));
  const freelancer = result.sources.find(source => source.url.includes('freelancer.co.nz'));
  const unand = result.sources.find(source => source.url.includes('scholar.unand.ac.id'));
  assert.ok(cake);
  assert.match(cake!.snippet, /Sella Susriana|administrasi|KYC/i);
  assert.ok(freelancer);
  assert.ok(freelancer!.snippet.trim().length > 0, 'freelancer keeps the Serper snippet');
  assert.ok(unand);
  assert.ok(unand!.snippet.trim().length > 0, 'Unand keeps the Serper snippet');

  const facts = extractGroundedPersonFacts(result);
  assert.ok(facts.some(fact => /bappebti\.go\.id/.test(fact.url)), `missing bappebti fact: ${facts.map(fact => fact.url).join(' ')}`);
  assert.ok(facts.some(fact => /cake\.me/.test(fact.url)), `missing cake fact: ${facts.map(fact => fact.url).join(' ')}`);
  assert.ok(facts.some(fact => /freelancer\.co\.nz/.test(fact.url)), `missing freelancer fact: ${facts.map(fact => fact.url).join(' ')}`);
  assert.ok(facts.some(fact => /scholar\.unand\.ac\.id/.test(fact.url)), `missing unand fact: ${facts.map(fact => fact.url).join(' ')}`);

  const grounded = formatResearchContext(result);
  assert.match(grounded, /PERSON_FACT: Sella Susriana/, `grounded missing PERSON_FACT:\n${grounded.slice(0, 1500)}`);
  assert.match(grounded, /OTHER_PUBLIC_TRACE:.*cake\.me|OTHER_PUBLIC_TRACE:.*freelancer|OTHER_PUBLIC_TRACE:.*unand/, `grounded missing OTHER_PUBLIC_TRACE:\n${grounded.slice(0, 2000)}`);
  assert.match(grounded, /cake\.me/);
  assert.match(grounded, /freelancer\.co\.nz/);
  assert.match(grounded, /scholar\.unand\.ac\.id/);

  const messages = buildAiResearchChatMessages({
    systemPrompt: AI_RESEARCH_SYSTEM_PROMPT,
    history: [],
    incoming: [{ role: 'user', content: sellaQuery }],
    research: result,
  });
  const blob = messages.map(message => String(message.content)).join('\n');
  assert.match(blob, /PERSON_FACT: Sella Susriana/);
  assert.match(blob, /OTHER_PUBLIC_TRACE:/);
  assert.match(blob, /cake\.me/);
  assert.match(blob, /freelancer\.co\.nz/);
  assert.match(blob, /scholar\.unand\.ac\.id/);
  const otherTraceLines = blob.split('\n').filter(line => line.startsWith('OTHER_PUBLIC_TRACE:'));
  assert.ok(otherTraceLines.length >= 3, `expected OTHER_PUBLIC_TRACE rows for organic hosts, got ${otherTraceLines.join(' | ')}`);
  assert.ok(otherTraceLines.some(line => /cake\.me/.test(line)));
  assert.ok(otherTraceLines.some(line => /freelancer\.co\.nz/.test(line)));
  assert.ok(otherTraceLines.some(line => /unand/.test(line)));
});

test('mergeOrganicSearchHits injects unfetched Serper name hits using search snippets', () => {
  const fetched = [
    {
      title: 'Bappebti - PT Dupoin Futures Indonesia',
      url: 'https://bappebti.go.id/pialang_berjangka/detail/423',
      snippet: '[Section: Wakil Pialang] Sella Susriana tercatat sebagai Wakil Pialang.',
      origin: 'indonesia' as const,
    },
    {
      title: 'Dupoin home',
      url: 'https://www.dupoin.co.id/',
      snippet: 'PT Dupoin Futures Indonesia terdaftar BAPPEBTI dengan kantor di Jakarta.',
      origin: 'indonesia' as const,
    },
  ];
  const discovered = [
    ...fetched,
    {
      title: 'CakeResume',
      url: 'https://www.cake.me/sella-susriana',
      snippet: 'Sign up to see Sella Susriana resume for administrasi and KYC.',
      origin: 'international' as const,
      discoveredVia: 'search-api' as const,
    },
    {
      title: 'Freelancer',
      url: 'https://www.freelancer.co.nz/u/sellasusriana',
      snippet: 'Member since 2019.',
      origin: 'international' as const,
      discoveredVia: 'search-api' as const,
    },
    {
      title: 'EPrints University of Andalas',
      url: 'https://scholar.unand.ac.id/id/eprint/sella-susriana',
      snippet: 'Preview.',
      origin: 'indonesia' as const,
      discoveredVia: 'search-api' as const,
    },
  ];
  const merged = mergeOrganicSearchHits(fetched, discovered, sellaQuery);
  assert.ok(merged.some(source => source.url.includes('cake.me') && /Sella Susriana/i.test(source.snippet)));
  assert.ok(merged.some(source => source.url.includes('freelancer.co.nz')));
  assert.ok(merged.some(source => source.url.includes('scholar.unand.ac.id')));
});

test('AI Research UI shows a thinking bubble before tokens and keeps the stream cursor after', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(page, /loading && !streaming/);
  assert.match(page, /ai-research-thinking/);
  assert.match(page, /ai-research-typing-dots/);
  assert.match(page, /Sedang meneliti/);
  assert.match(page, /d\.type === 'research'/);
  assert.match(page, /sourceCount/);
  assert.match(page, /ai-research-stream-cursor/);
  assert.match(page, /animate-spin/);
});

const ddgAnomalyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>DuckDuckGo</title>
  <script src="/anomaly.js"></script>
  <link rel="canonical" href="https://duckduckgo.com/?cc=botnet">
</head>
<body>Unfortunately, bots have been using this resource.</body>
</html>`;

const sellaJinaMarkdown = `Title: Bappebti - PT Dupoin Futures Indonesia

URL Source: https://bappebti.go.id/pialang_berjangka/detail/423

Markdown Content:
PT DUPOIN FUTURES INDONESIA
##### WAKIL PIALANG ###### Gunawan Herman ###### Andy Nugraha Sentosa ###### Sella Susriana ###### Lulu Sakinah
Sella Susriana tercatat sebagai Wakil Pialang Berjangka pada PT Dupoin Futures Indonesia.
`;

function tlsLeafError(): never {
  const error = new TypeError('fetch failed');
  Object.assign(error, { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } });
  throw error;
}

test('detects DDG anomaly pages and never wraps private URLs with Jina', () => {
  assert.equal(isDuckDuckGoAnomalyPage(ddgAnomalyHtml), true);
  assert.equal(isDuckDuckGoAnomalyPage(ddgHtml), false);
  assert.equal(
    jinaReaderUrl('https://bappebti.go.id/pialang_berjangka/detail/423'),
    'https://r.jina.ai/https://bappebti.go.id/pialang_berjangka/detail/423',
  );
  assert.equal(jinaReaderUrl('http://127.0.0.1/secret'), null);
  assert.equal(jinaReaderUrl('http://169.254.169.254/latest/meta-data'), null);
  assert.equal(jinaReaderUrl('http://192.168.1.8/admin'), null);
  assert.equal(jinaReaderUrl('https://r.jina.ai/https://example.com'), null);
  const extracted = extractFetchedContent(sellaJinaMarkdown, sellaQuery, 'text/plain');
  assert.match(extracted.snippet, /Sella Susriana/);
  assert.match(extracted.snippet, /Wakil Pialang/i);
});

test('structured search parsers keep public hits from Instant Answer and optional APIs', () => {
  const instant = parseDuckDuckGoInstantAnswer({
    Heading: 'Bappebti',
    AbstractText: 'Badan Pengawas Perdagangan Berjangka Komoditi.',
    AbstractURL: 'https://id.wikipedia.org/wiki/Bappebti',
    Results: [{ Text: 'Dupoin - pialang', FirstURL: 'https://www.dupoin.co.id/' }],
    RelatedTopics: [{ Text: 'blocked', FirstURL: 'https://127.0.0.1/x' }],
  });
  assert.ok(instant.some(source => source.url.includes('wikipedia.org')));
  assert.ok(instant.some(source => source.url.includes('dupoin.co.id')));
  assert.ok(!instant.some(source => source.url.includes('127.0.0.1')));

  const serper = parseSerperResults({
    organic: [
      { title: 'Wakil pialang Dupoin', link: 'https://bappebti.go.id/pialang_berjangka/detail/423', snippet: 'Sella Susriana tercatat sebagai wakil pialang.' },
      { title: 'Nope', link: 'https://html.duckduckgo.com/html/?q=x', snippet: 'search' },
      { title: 'IG', link: 'https://www.instagram.com/p/abc123/', snippet: 'Log in to Instagram to see photos and videos.' },
    ],
    news: [
      { title: 'CNBC Dupoin', link: 'https://www.cnbcindonesia.com/market/dupoin', snippet: 'Liputan pialang berjangka.' },
    ],
    knowledgeGraph: {
      title: 'Bappebti',
      description: 'Badan Pengawas Perdagangan Berjangka Komoditi.',
      website: 'https://www.bappebti.go.id/',
      descriptionLink: 'https://id.wikipedia.org/wiki/Bappebti',
    },
  });
  assert.ok(serper.some(source => source.url.includes('bappebti.go.id/pialang_berjangka')));
  assert.ok(serper.some(source => source.url.includes('cnbcindonesia.com')));
  assert.ok(serper.some(source => source.url.includes('wikipedia.org')));
  assert.ok(!serper.some(source => source.url.includes('instagram.com')));
  assert.ok(!serper.some(source => source.url.includes('html.duckduckgo.com')));
  assert.match(serper.find(source => source.url.includes('pialang_berjangka'))!.snippet, /Sella Susriana/);

  const brave = parseBraveResults({
    web: { results: [{ title: 'Dupoin', url: 'https://www.dupoin.co.id/about-us', description: 'Lisensi Bappebti.' }] },
  });
  assert.equal(brave[0].url, 'https://www.dupoin.co.id/about-us');

  const tavily = parseTavilyResults({
    results: [{ title: 'OJK', url: 'https://www.ojk.go.id/', content: 'Pengawasan pasar keuangan.' }],
  });
  assert.equal(tavily[0].origin, 'indonesia');
});

test('DDG bot-challenge still gathers Sella via seeds, Wikipedia, and Jina-backed Bappebti', async () => {
  const warnings: string[] = [];
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://r.jina.ai/')) {
      assert.doesNotMatch(JSON.stringify(init?.headers || {}), /Mozilla/i);
    }
    if (url.includes('html.duckduckgo.com')) {
      return new Response(ddgAnomalyHtml, { status: 202, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('api.duckduckgo.com')) {
      return new Response(JSON.stringify({
        Heading: '', AbstractText: '', AbstractURL: '', Results: [], RelatedTopics: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('api.php') && url.includes('list=search')) {
      const srsearch = decodeURIComponent(new URL(url).searchParams.get('srsearch') || '');
      if (/dupoin/i.test(srsearch)) {
        return new Response(JSON.stringify({
          query: { search: [{ title: 'Dupoin Futures Indonesia', snippet: 'Pialang berjangka di Jakarta' }] },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (/bappebti/i.test(srsearch)) {
        return new Response(JSON.stringify({
          query: { search: [{ title: 'Badan Pengawas Perdagangan Berjangka Komoditi', snippet: 'Regulator PBK' }] },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ query: { search: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('api.php') && url.includes('prop=extracts')) {
      if (/Dupoin/i.test(url)) {
        return new Response(JSON.stringify({
          query: { pages: { '1': { title: 'Dupoin Futures Indonesia', extract: 'PT Dupoin Futures Indonesia adalah pialang berjangka di Jakarta di bawah pengawasan Bappebti.' } } },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        query: { pages: { '2': { title: 'Badan Pengawas Perdagangan Berjangka Komoditi', extract: 'Bappebti mengawasi pialang berjangka dan wakil pialang di Indonesia.' } } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://r.jina.ai/')) {
      if (url.includes('bappebti.go.id')) {
        return new Response(sellaJinaMarkdown, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return new Response('Title: Dupoin\n\nPT Dupoin Futures Indonesia regulated by BAPPEBTI.', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    if (url.includes('bappebti.go.id') && !url.includes('ceklegalitas')) {
      tlsLeafError();
    }
    if (url.includes('ceklegalitas.bappebti.go.id')) {
      return new Response('<html><title>Cek Legalitas</title><body>Layanan cek legalitas pelaku usaha Bappebti.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext(sellaQuery, {
    fetchImpl,
    timeoutMs: 8_000,
    logger: { warn: (message: unknown) => warnings.push(String(message)) },
  });
  const grounded = formatResearchContext(result);
  const ddgHtmlCalls = calls.filter(url => url.includes('html.duckduckgo.com'));

  assert.ok(ddgHtmlCalls.length >= 1);
  assert.ok(ddgHtmlCalls.length < 5, 'anomaly pages must fail fast instead of scraping every DDG HTML variant');
  assert.ok(warnings.some(message => message.includes(DDG_HTML_BLOCKED_WARNING)));
  assert.ok(calls.some(url => url.startsWith('https://r.jina.ai/') && url.includes('bappebti.go.id')));
  assert.ok(!calls.some(url => url.startsWith('https://r.jina.ai/http://127.')));
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.some(source => /bappebti\.go\.id/i.test(source.url)));
  assert.ok(result.sources.some(source => /Sella Susriana/i.test(source.snippet)));
  assert.ok(result.sources.some(source => /wakil pialang/i.test(source.snippet)));
  assert.ok(!result.sources.some(source => source.url.startsWith('https://r.jina.ai/')));
  assert.equal(sourcesHaveUsefulHits(result), true);
  assert.match(grounded, /Sella Susriana/);
  assert.match(grounded, /Synthesize a rich answer/);
  assert.doesNotMatch(grounded, /No web sources were retrieved/);

  const messages = buildAiResearchChatMessages({
    systemPrompt: AI_RESEARCH_SYSTEM_PROMPT,
    history: [],
    incoming: [{ role: 'user', content: sellaQuery }],
    research: result,
  });
  assert.match(String(messages[1].content), /Sella Susriana/);
  assert.match(String(messages[1].content), /wakil pialang/i);
});

test('TLS leaf-signature failures fall back to Jina Reader for official pages', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('html.duckduckgo.com')) {
      return new Response(ddgAnomalyHtml, { status: 202, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('api.duckduckgo.com') || url.includes('api.php')) {
      return new Response(JSON.stringify({ query: { search: [] }, Heading: '', AbstractText: '', Results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.startsWith('https://r.jina.ai/https://www.dupoin.co.id')) {
      return new Response('Title: Licenses | Dupoin\n\nPT Dupoin Futures Indonesia is fully licensed and regulated by BAPPEBTI.', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    if (url.startsWith('https://r.jina.ai/') && url.includes('bappebti.go.id')) {
      return new Response(sellaJinaMarkdown, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      tlsLeafError();
    }
    if (url.includes('bappebti.go.id')) {
      tlsLeafError();
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext('Apa fakta resmi Dupoin Indonesia?', {
    fetchImpl,
    timeoutMs: 8_000,
    logger: { warn() { /* expected DDG block */ } },
  });
  assert.ok(calls.some(url => url.startsWith('https://r.jina.ai/https://www.dupoin.co.id')));
  assert.ok(result.sources.some(source => source.url.includes('dupoin.co.id') && /BAPPEBTI/i.test(source.snippet)));
  assert.ok(!result.sources.some(source => source.url.startsWith('https://r.jina.ai/')));
});

test('native Bappebti HTTP 200 is used first; Jina remains fallback only', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('html.duckduckgo.com')) {
      return new Response(ddgAnomalyHtml, { status: 202, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('api.duckduckgo.com') || url.includes('api.php')) {
      return new Response(JSON.stringify({ query: { search: [] }, Heading: '', AbstractText: '', Results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('bappebti.go.id') && !url.startsWith('https://r.jina.ai/')) {
      return new Response(sellaBappebtiHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext(sellaQuery, {
    fetchImpl,
    timeoutMs: 8_000,
    logger: { warn() { /* DDG blocked */ } },
  });
  assert.ok(calls.some(url => url.includes('bappebti.go.id') && !url.startsWith('https://r.jina.ai/')));
  assert.ok(!calls.some(url => url.startsWith('https://r.jina.ai/') && url.includes('bappebti.go.id')));
  assert.ok(result.sources.some(source => /Sella Susriana/i.test(source.snippet)));
});

test('optional Serper API is used when DDG HTML is blocked', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('html.duckduckgo.com')) {
      return new Response(ddgAnomalyHtml, { status: 202, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('google.serper.dev/search')) {
      assert.equal((init?.headers as Record<string, string>)?.['X-API-KEY'] || (init?.headers as Headers | undefined)?.get?.('X-API-KEY'), 'test-serper');
      return new Response(JSON.stringify({
        organic: [
          {
            title: 'Bappebti Dupoin',
            link: 'https://bappebti.go.id/pialang_berjangka/detail/423',
            snippet: 'Daftar wakil pialang PT Dupoin Futures Indonesia.',
          },
          {
            title: 'Sella Susriana | LinkedIn',
            link: 'https://www.linkedin.com/in/sella-susriana',
            snippet: 'Public LinkedIn profile mentioning Sella Susriana in financial services.',
          },
          {
            title: 'CNBC: Dupoin dan wakil pialang',
            link: 'https://www.cnbcindonesia.com/market/sella-susriana',
            snippet: 'Liputan Sella Susriana di industri pialang berjangka.',
          },
          {
            title: 'Bloomberg profile',
            link: 'https://www.bloomberg.com/profile/person/sella-susriana',
            snippet: 'Public directory mention of Sella Susriana.',
          },
          {
            title: 'CPNS Kemdikbudristek 2024',
            link: 'https://sscasn.bkn.go.id/formasi/2024/sella-susriana',
            snippet: 'Sella Susriana — Pranata Laboratorium Pendidikan Ahli Pertama, CPNS Kemdikbudristek 2024.',
          },
          {
            title: 'Freelancer Sella Susriana',
            link: 'https://www.sribulancer.com/id/public/sella-susriana',
            snippet: 'Sella Susriana, Ilmu Tanah Universitas Andalas, administrasi dan KYC.',
          },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://r.jina.ai/') && url.includes('bappebti.go.id')) {
      return new Response(sellaJinaMarkdown, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (url.includes('linkedin.com')) {
      return new Response('<html><title>Sella Susriana</title><body>Public profile mentioning Sella Susriana in financial services at a futures brokerage.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('cnbcindonesia.com')) {
      return new Response('<html><title>CNBC</title><body>Liputan Sella Susriana sebagai wakil pialang dan jejak publik di industri berjangka Indonesia.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('bloomberg.com')) {
      return new Response('<html><title>Bloomberg</title><body>Public directory listing for Sella Susriana with a professional biography excerpt.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('sscasn.bkn.go.id') || url.includes('bkn.go.id')) {
      return new Response('<html><title>CPNS 2024</title><body>Sella Susriana tercatat pada formasi Pranata Laboratorium Pendidikan Ahli Pertama CPNS Kemdikbudristek 2024.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('sribulancer.com')) {
      return new Response('<html><title>Freelancer</title><body>Sella Susriana, lulusan Ilmu Tanah Universitas Andalas, mengerjakan administrasi dan KYC.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('api.php') || url.includes('api.duckduckgo.com')) {
      return new Response(JSON.stringify({ query: { search: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('bappebti.go.id')) tlsLeafError();
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext(sellaQuery, {
    fetchImpl,
    timeoutMs: 8_000,
    searchApiKeys: { serper: 'test-serper' },
    logger: { warn() { /* DDG still blocked; Serper supplies URLs */ } },
  });
  const hosts = new Set(result.sources.map(source => researchSourceHost(source.url)));
  const serperCalls = calls.filter(url => url.includes('google.serper.dev/search'));
  const ddgHtmlCalls = calls.filter(url => url.includes('html.duckduckgo.com'));
  assert.ok(serperCalls.length >= 2, `Serper must run multiple open-web queries, got ${serperCalls.length}`);
  assert.equal(ddgHtmlCalls.length, 0, 'Serper hits skip DuckDuckGo HTML');
  assert.ok(!calls.some(url => url.includes('api.search.brave.com')), 'Brave is not required');
  assert.ok(calls.some(url => url.includes('google.serper.dev/search')));
  assert.ok(result.sources.some(source => /Sella Susriana/i.test(source.snippet)));
  assert.ok(result.sources.some(source => /bappebti\.go\.id/i.test(source.url)), 'official seeds remain a floor');
  assert.ok(result.sources.some(source => source.url.includes('linkedin.com') || source.url.includes('cnbcindonesia.com') || source.url.includes('bloomberg.com')));
  assert.ok(
    result.sources.some(source => /sscasn\.bkn\.go\.id|bkn\.go\.id/.test(source.url)),
    'CPNS listing from Serper must survive ranking and host caps',
  );
  assert.ok(
    result.sources.some(source => source.url.includes('sribulancer.com')),
    'freelancer profile from Serper must survive ranking and host caps',
  );
  assert.ok(hosts.size >= 4, `search APIs must keep diverse domains, got ${[...hosts].join(', ')}`);
  assert.match(formatResearchContext(result), /Synthesize a rich answer/);
  assert.match(formatResearchContext(result), new RegExp(AI_RESEARCH_NO_INVENT_FACTS));
});

const instagramLoginHtml = `<html><head><title>Instagram</title></head><body>
<h1>Log in to Instagram</h1>
<p>See photos and videos from your friends.</p>
<form><input placeholder="Phone number, username, or email"><button>Log in</button></form>
<p>Sign up to see photos and videos.</p>
</body></html>`;

const newsRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Google News</title>
<item>
  <title>Sella Susriana disebut wakil pialang Dupoin - CNBC Indonesia</title>
  <link>https://www.cnbcindonesia.com/market/sella-susriana-dupoin</link>
  <description>Liputan Sella Susriana sebagai wakil pialang di PT Dupoin Futures Indonesia.</description>
</item>
<item>
  <title>Login bait</title>
  <link>https://www.instagram.com/p/hidden/</link>
  <description>Log in to Instagram to continue.</description>
</item>
</channel></rss>`;

test('detects Instagram login walls and keeps official pages', () => {
  assert.equal(isLikelyLoginWallHost('https://www.instagram.com/p/abc/'), true);
  assert.equal(isLikelyLoginWallHost('https://www.dupoin.co.id/'), false);
  assert.equal(isEmptyOrLoginWallSource(instagramLoginHtml, 'https://www.instagram.com/p/abc/', 'Instagram'), true);
  assert.equal(isEmptyOrLoginWallSource(officialHtml, 'https://www.dupoin.co.id/', 'Dupoin'), false);

  const wikiHits = parseWikidataSearch({
    search: [{
      id: 'Q123456',
      label: 'Bappebti',
      description: 'Indonesian commodity futures regulator',
      concepturi: 'https://www.wikidata.org/wiki/Q123456',
    }],
  });
  assert.equal(wikiHits[0].id, 'Q123456');
  assert.match(wikiHits[0].url, /wikidata\.org\/wiki\/Q123456/);

  const entities = parseWikidataEntities({
    entities: {
      Q123456: {
        id: 'Q123456',
        labels: { id: { value: 'Bappebti' }, en: { value: 'Bappebti' } },
        descriptions: { en: { value: 'Indonesian futures regulator' } },
        sitelinks: {
          idwiki: { title: 'Badan Pengawas Perdagangan Berjangka Komoditi' },
          enwiki: { title: 'Commodity Futures Trading Regulatory Agency' },
        },
      },
    },
  });
  assert.ok(entities.some(source => source.url.includes('id.wikipedia.org')));
  assert.ok(entities.some(source => source.url.includes('en.wikipedia.org')));

  const rss = parseNewsRss(newsRssXml);
  assert.equal(rss.length, 1);
  assert.equal(rss[0].url, 'https://www.cnbcindonesia.com/market/sella-susriana-dupoin');
  assert.match(rss[0].snippet, /wakil pialang/);
});

test('prefers Serper early for open-web queries and does not call Brave', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('api.search.brave.com') || url.includes('api.tavily.com')) {
      throw new Error('Brave/Tavily must not be required');
    }
    if (url.includes('google.serper.dev/search')) {
      assert.equal((init?.headers as Record<string, string>)?.['X-API-KEY'] || (init?.headers as Headers | undefined)?.get?.('X-API-KEY'), 'early-serper');
      return new Response(JSON.stringify({
        organic: [
          { title: 'Bappebti Dupoin', link: 'https://bappebti.go.id/pialang_berjangka/detail/423', snippet: 'Sella Susriana tercatat sebagai wakil pialang.' },
          { title: 'CNBC', link: 'https://www.cnbcindonesia.com/market/sella', snippet: 'Liputan Sella Susriana di industri pialang.' },
          { title: 'LinkedIn', link: 'https://www.linkedin.com/in/sella-susriana', snippet: 'Public profile mentioning Sella Susriana.' },
        ],
        news: [
          { title: 'Berita Dupoin', link: 'https://www.kontan.co.id/dupoin-sella', snippet: 'Sella Susriana disebut di berita pasar.' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('html.duckduckgo.com')) {
      return new Response(ddgAnomalyHtml, { status: 202, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('bappebti.go.id') && !url.startsWith('https://r.jina.ai/')) {
      return new Response(sellaBappebtiHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('cnbcindonesia.com') || url.includes('kontan.co.id')) {
      return new Response('<html><title>News</title><body>Liputan Sella Susriana sebagai wakil pialang Dupoin di pasar berjangka Indonesia.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('linkedin.com')) {
      return new Response('<html><title>Sella</title><body>Public profile mentioning Sella Susriana in financial services.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext(sellaQuery, {
    fetchImpl,
    timeoutMs: 8_000,
    searchApiKeys: { serper: 'early-serper' },
  });
  const serperIdx = calls.findIndex(url => url.includes('google.serper.dev/search'));
  const ddgIdx = calls.findIndex(url => url.includes('html.duckduckgo.com'));
  assert.ok(serperIdx >= 0, 'Serper must run');
  assert.equal(ddgIdx, -1, 'successful Serper path skips DDG HTML');
  assert.ok(serperIdx === 0 || calls.slice(0, serperIdx).every(url => !url.includes('html.duckduckgo.com')));
  assert.ok(!calls.some(url => url.includes('api.search.brave.com')));
  assert.ok(result.sources.some(source => /Sella Susriana/i.test(source.snippet)));
  assert.ok(result.sources.some(source => /bappebti\.go\.id|cnbcindonesia|kontan|linkedin/i.test(source.url)));
  assert.match(formatResearchContext(result), /Synthesize a rich answer/);
  assert.doesNotMatch(formatResearchContext(result), /No web sources were retrieved/);
});

test('Serper exhaustion uses free Wikipedia, Wikidata, Instant Answer, and news RSS', async () => {
  const warnings: string[] = [];
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('google.serper.dev/search')) {
      return new Response('quota exceeded', { status: 429, headers: { 'content-type': 'text/plain' } });
    }
    if (url.includes('api.search.brave.com')) {
      throw new Error('Brave must not be the Serper fallback');
    }
    if (url.includes('html.duckduckgo.com')) {
      return new Response(ddgAnomalyHtml, { status: 202, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('wikidata.org') && url.includes('wbsearchentities')) {
      return new Response(JSON.stringify({
        search: [{
          id: 'Q390858',
          label: 'Bappebti',
          description: 'Indonesian commodity futures regulator',
          concepturi: 'https://www.wikidata.org/wiki/Q390858',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('wikidata.org') && url.includes('wbgetentities')) {
      return new Response(JSON.stringify({
        entities: {
          Q390858: {
            id: 'Q390858',
            labels: { id: { value: 'Bappebti' } },
            descriptions: { id: { value: 'Regulator perdagangan berjangka Indonesia' } },
            sitelinks: { idwiki: { title: 'Bappebti' }, enwiki: { title: 'Bappebti' } },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('news.google.com/rss')) {
      return new Response(newsRssXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }
    if (url.includes('api.duckduckgo.com')) {
      return new Response(JSON.stringify({
        Heading: 'Bappebti',
        AbstractText: 'Badan Pengawas Perdagangan Berjangka Komoditi mengawasi pialang berjangka.',
        AbstractURL: 'https://id.wikipedia.org/wiki/Bappebti',
        Results: [],
        RelatedTopics: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('id.wikipedia.org') && url.includes('list=search')) {
      return new Response(JSON.stringify({
        query: { search: [{ title: 'Bappebti', snippet: 'Regulator PBK Indonesia' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('en.wikipedia.org') && url.includes('list=search')) {
      return new Response(JSON.stringify({
        query: { search: [{ title: 'Bappebti', snippet: 'Indonesian futures regulator' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('api.php') && url.includes('prop=extracts')) {
      const host = url.includes('en.wikipedia.org') ? 'en.wikipedia.org' : 'id.wikipedia.org';
      return new Response(JSON.stringify({
        query: { pages: { '1': { title: 'Bappebti', extract: `Bappebti mengawasi pialang berjangka di Indonesia (${host}).` } } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('cnbcindonesia.com')) {
      return new Response('<html><title>CNBC</title><body>Liputan Sella Susriana sebagai wakil pialang di PT Dupoin Futures Indonesia.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('bappebti.go.id') && !url.startsWith('https://r.jina.ai/')) {
      return new Response(sellaBappebtiHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.startsWith('https://r.jina.ai/') && url.includes('bappebti.go.id')) {
      return new Response(sellaJinaMarkdown, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext(sellaQuery, {
    fetchImpl,
    timeoutMs: 8_000,
    searchApiKeys: { serper: 'exhausted-serper' },
    logger: { warn: (message: unknown) => warnings.push(String(message)) },
  });
  const grounded = formatResearchContext(result);
  assert.ok(warnings.some(message => message.includes(SERPER_EXHAUSTED_WARNING)));
  assert.ok(calls.some(url => url.includes('id.wikipedia.org')));
  assert.ok(calls.some(url => url.includes('en.wikipedia.org')));
  assert.ok(calls.some(url => url.includes('wikidata.org') && url.includes('wbsearchentities')));
  assert.ok(calls.some(url => url.includes('news.google.com/rss')));
  assert.ok(calls.some(url => url.includes('api.duckduckgo.com')));
  assert.ok(!calls.some(url => url.includes('api.search.brave.com')));
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.some(source => /bappebti|dupoin|Sella Susriana/i.test(`${source.snippet} ${source.url}`)));
  assert.equal(sourcesHaveUsefulHits(result), true);
  assert.match(grounded, /Synthesize a rich answer/);
  assert.match(grounded, new RegExp(AI_RESEARCH_NO_INVENT_FACTS));
  assert.doesNotMatch(grounded, /No web sources were retrieved/);
});

test('free path without Serper still uses Wikipedia languages, Wikidata, and news RSS', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('google.serper.dev') || url.includes('api.search.brave.com')) {
      throw new Error('paid search must not be required on the free path');
    }
    if (url.includes('html.duckduckgo.com')) {
      return new Response(ddgAnomalyHtml, { status: 202, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('wikidata.org') && url.includes('wbsearchentities')) {
      return new Response(JSON.stringify({
        search: [{ id: 'Q390858', label: 'Bappebti', description: 'Regulator PBK', concepturi: 'https://www.wikidata.org/wiki/Q390858' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('wikidata.org') && url.includes('wbgetentities')) {
      return new Response(JSON.stringify({
        entities: {
          Q390858: {
            id: 'Q390858',
            labels: { id: { value: 'Bappebti' } },
            descriptions: { id: { value: 'Regulator perdagangan berjangka' } },
            sitelinks: { idwiki: { title: 'Bappebti' } },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('news.google.com/rss')) {
      return new Response(newsRssXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }
    if (url.includes('api.duckduckgo.com')) {
      return new Response(JSON.stringify({
        Heading: 'Bappebti',
        AbstractText: 'Regulator pialang berjangka.',
        AbstractURL: 'https://id.wikipedia.org/wiki/Bappebti',
        Results: [],
        RelatedTopics: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('wikipedia.org') && url.includes('list=search')) {
      return new Response(JSON.stringify({
        query: { search: [{ title: 'Bappebti', snippet: 'Regulator PBK' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('api.php') && url.includes('prop=extracts')) {
      return new Response(JSON.stringify({
        query: { pages: { '1': { title: 'Bappebti', extract: 'Bappebti mengawasi pialang berjangka dan wakil pialang di Indonesia.' } } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('cnbcindonesia.com')) {
      return new Response('<html><title>CNBC</title><body>Liputan Sella Susriana sebagai wakil pialang Dupoin.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('bappebti.go.id')) {
      return new Response(sellaBappebtiHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext(sellaQuery, {
    fetchImpl,
    timeoutMs: 8_000,
    searchApiKeys: { serper: '', brave: '', tavily: '' },
    logger: { warn() { /* DDG blocked */ } },
  });
  assert.ok(!calls.some(url => url.includes('google.serper.dev')));
  assert.ok(!calls.some(url => url.includes('api.search.brave.com')));
  assert.ok(calls.some(url => url.includes('id.wikipedia.org')));
  assert.ok(calls.some(url => url.includes('en.wikipedia.org')));
  assert.ok(calls.some(url => url.includes('wikidata.org')));
  assert.ok(calls.some(url => url.includes('news.google.com/rss')));
  assert.ok(result.sources.length > 0);
  assert.equal(sourcesHaveUsefulHits(result), true);
  assert.match(formatResearchContext(result), /Synthesize a rich answer/);
});

test('gather skips Instagram login-wall hits even when search returns them', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('html.duckduckgo.com')) {
      return new Response(`
        <div class="result">
          <a class="result__a" href="https://www.instagram.com/p/dupoin-sella">Instagram post</a>
          <a class="result__snippet">See photos and videos from Dupoin.</a>
        </div>
        <div class="result">
          <a class="result__a" href="https://www.dupoin.co.id/about-us">Dupoin resmi</a>
          <a class="result__snippet">PT Dupoin Futures Indonesia terdaftar BAPPEBTI.</a>
        </div>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('instagram.com')) {
      return new Response(instagramLoginHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('dupoin.co.id') || url.includes('dupoin.com')) {
      return new Response(officialHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('bappebti.go.id')) {
      return new Response(sellaBappebtiHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await gatherAiResearchContext('Apa fakta resmi Dupoin Indonesia?', { fetchImpl, timeoutMs: 8_000 });
  assert.ok(!calls.some(url => url.includes('instagram.com')), 'login-wall hosts are not fetched');
  assert.ok(!result.sources.some(source => source.url.includes('instagram.com')));
  assert.ok(result.sources.some(source => source.url.includes('dupoin.co.id')));
  assert.ok(!result.sources.some(source => /log in to instagram/i.test(source.snippet)));
});
