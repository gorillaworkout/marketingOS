import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_RESEARCH_SYSTEM_PROMPT, buildGatewayMessages } from '../src/lib/ai-research';
import { formatResearchContext } from '../src/lib/ai-research-grounding';
import { fetchAiResearchContextUrls } from '../src/lib/ai-research-url-fetch';
import {
  AI_RESEARCH_MAX_CONTEXT_URLS,
  AI_RESEARCH_URL_ONLY_PROMPT,
  AI_RESEARCH_URL_TRUNCATION_NOTE,
  applyContextUrlsToIncoming,
  contextPageText,
  contextUrlBlockReason,
  isUrlOnlyQuery,
  mergeContextUrlSources,
  scanContextUrls,
} from '../src/lib/ai-research-urls';

const read = (path: string) => readFileSync(path, 'utf8');
const publicLookup = async () => ['1.1.1.1'];

function htmlResponse(html: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

test('context URL scan keeps public http(s), blocks internal targets, and caps at 3', () => {
  const scan = scanContextUrls([
    'Ringkas https://example.com/emas).',
    'dan https://dupoin.co.id/about',
    'https://example.com/emas',
    'http://127.0.0.1/admin',
    'http://10.1.2.3/secret',
    'http://192.168.1.20/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/',
    'file:///etc/passwd',
    'https://user:pass@example.com/hidden',
    'http://intranet/admin',
    'https://example.com/tiga',
    'https://example.com/empat',
  ].join(' '));

  assert.deepEqual(scan.accepted.map(item => item.url), [
    'https://example.com/emas',
    'https://dupoin.co.id/about',
    'https://example.com/tiga',
  ]);
  assert.equal(scan.accepted.length, AI_RESEARCH_MAX_CONTEXT_URLS);
  assert.equal(scan.overflow[0]?.url, 'https://example.com/empat');
  const blocked = scan.blocked.map(item => item.url).join(' ');
  assert.match(blocked, /127\.0\.0\.1/);
  assert.match(blocked, /10\.1\.2\.3/);
  assert.match(blocked, /192\.168\.1\.20/);
  assert.match(blocked, /169\.254\.169\.254/);
  assert.match(blocked, /file:\/\/\/etc\/passwd/);
  assert.match(blocked, /intranet/);
  assert.equal(contextUrlBlockReason('http://2130706433/'), 'address is not public');
  assert.equal(contextUrlBlockReason('http://[::ffff:10.0.0.1]/'), 'address is not public');
  assert.equal(contextUrlBlockReason('https://example.com/ok'), null);
  assert.equal(scan.accepted[0]?.raw, 'https://example.com/emas');
  assert.equal(isUrlOnlyQuery('https://example.com/emas'), true);
  assert.equal(isUrlOnlyQuery('https://example.com/emas?'), true);
  assert.equal(isUrlOnlyQuery('lihat https://example.com/emas'), false);
});

test('fetched page text is truncated, cited, and merged ahead of web sources', () => {
  const long = `Emas menguat. ${'permintaan fisik '.repeat(800)}`;
  const page = contextPageText(`<html><head><title>Harga Emas</title></head><body><p>${long}</p></body></html>`, 'text/html', 180);
  assert.equal(page.title, 'Harga Emas');
  assert.equal(page.truncated, true);
  assert.match(page.text, new RegExp(AI_RESEARCH_URL_TRUNCATION_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const merged = mergeContextUrlSources({
    query: 'harga emas',
    indonesiaPreferred: true,
    sources: [
      { title: 'Lama', url: 'https://example.com/emas', snippet: 'cuplikan lama', origin: 'international' },
      { title: 'Berita', url: 'https://news.example/emas', snippet: 'berita', origin: 'international' },
    ],
  }, [{
    title: 'Harga Emas',
    url: 'https://example.com/emas',
    snippet: `[Tautan pengguna] ${page.text}`,
    origin: 'international',
  }], 'harga emas');
  assert.equal(merged?.sources[0]?.title, 'Harga Emas');
  assert.equal(merged?.sources.filter(source => source.url === 'https://example.com/emas').length, 1);
  assert.match(formatResearchContext(merged!), /https:\/\/example\.com\/emas/);
  assert.match(formatResearchContext(merged!), /Tautan pengguna/);
});

test('URL fetch uses the page, falls back to Jina, and fails soft on blocks, DNS, and redirects', async () => {
  const calls: string[] = [];
  const html = '<html><head><title>Outlook</title></head><body><p>Emas tetap menarik bagi investor Dupoin pada kuartal ini.</p></body></html>';
  const direct = await fetchAiResearchContextUrls('Apa isi https://example.com/emas?', {
    lookupImpl: publicLookup,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return htmlResponse(html);
    },
  });
  assert.deepEqual(calls, ['https://example.com/emas']);
  assert.equal(direct.failures.length, 0);
  assert.equal(direct.sources[0]?.title, 'Outlook');
  assert.match(direct.sources[0]?.snippet || '', /investor Dupoin/);
  assert.match(direct.sources[0]?.snippet || '', /\[Tautan pengguna\]/);

  const jinaCalls: string[] = [];
  const viaJina = await fetchAiResearchContextUrls('https://example.com/story', {
    lookupImpl: publicLookup,
    fetchImpl: async (url) => {
      const target = String(url);
      jinaCalls.push(target);
      if (target.startsWith('https://r.jina.ai/')) {
        return new Response([
          'Title: Cerita Emas',
          'URL Source: https://example.com/story',
          'Markdown Content:',
          'Harga emas dijaga oleh permintaan perhiasan dan bank sentral.',
        ].join('\n'), { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return htmlResponse('nope', 503);
    },
  });
  assert.ok(jinaCalls.some(url => url.startsWith('https://r.jina.ai/https://example.com/story')));
  assert.equal(viaJina.sources[0]?.url, 'https://example.com/story');
  assert.equal(viaJina.sources[0]?.title, 'Cerita Emas');
  assert.match(viaJina.sources[0]?.snippet || '', /bank sentral/);

  let privateFetches = 0;
  const blocked = await fetchAiResearchContextUrls('http://127.0.0.1/admin file:///etc/passwd', {
    lookupImpl: publicLookup,
    fetchImpl: async () => {
      privateFetches += 1;
      return htmlResponse(html);
    },
  });
  assert.equal(privateFetches, 0);
  assert.equal(blocked.sources.length, 0);
  assert.ok(blocked.failures.length >= 2);

  const redirected = await fetchAiResearchContextUrls('https://example.com/start', {
    lookupImpl: async (hostname) => (hostname === 'example.com' ? ['1.1.1.1'] : ['10.0.0.8']),
    fetchImpl: async (url) => {
      calls.push(`redirect:${url}`);
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
    },
  });
  assert.equal(redirected.sources.length, 0);
  assert.equal(redirected.failures[0]?.error, 'address is not public');
  assert.equal(calls.filter(url => url.includes('169.254')).length, 0);

  const dnsBlocked = await fetchAiResearchContextUrls('https://example.com/rebind', {
    lookupImpl: async () => ['192.168.1.9'],
    fetchImpl: async () => {
      throw new Error('should not fetch a private address');
    },
  });
  assert.equal(dnsBlocked.sources.length, 0);
  assert.equal(dnsBlocked.failures[0]?.error, 'address is not public');

  const incoming = applyContextUrlsToIncoming(
    [{ role: 'user', content: 'https://example.com/story' }],
    [{ url: 'http://127.0.0.1/admin', error: 'address is not public' }],
  );
  assert.match(incoming[0]?.content || '', new RegExp(AI_RESEARCH_URL_ONLY_PROMPT));
  assert.match(incoming[0]?.content || '', /Do not invent the contents of that page/);
  const gateway = buildGatewayMessages('system', [], incoming);
  assert.match(String(gateway[1]?.content), /127\.0\.0\.1/);
});

test('AI Research chat route grounds user URLs without dropping document attach', () => {
  const route = read('src/app/api/ai-research/chat/route.ts');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(route, /fetchAiResearchContextUrls/);
  assert.match(route, /mergeContextUrlSources/);
  assert.match(route, /applyContextUrlsToIncoming/);
  assert.match(route, /type: 'context-urls'/);
  assert.match(route, /gatherAiResearchContext/);
  assert.match(route, /hydrateMessageFiles/);
  assert.match(AI_RESEARCH_SYSTEM_PROMPT, /page text was truncated/);
  assert.match(page, /scanContextUrls/);
  assert.match(page, /data-testid="ai-research-context-links"/);
  assert.match(page, /data-testid="ai-research-url-error"/);
  assert.match(page, /d\.type === 'context-urls'/);
  assert.match(page, /Add a link as context/);
  assert.match(page, /if \(!files\.length\) return;/);
  assert.match(page, /onPaste=\{handleComposerPaste\}/);
  assert.match(page, /addAttachments\(files\)/);
  assert.match(page, /PDF, Word, or PowerPoint file\.\.\./);
  assert.doesNotMatch(read('src/lib/ai-research-urls.ts'), /node:dns|node:net/);
  assert.match(read('src/lib/ai-research-url-fetch.ts'), /node:dns\/promises/);
  assert.match(route, /ai-research-url-fetch/);
});
