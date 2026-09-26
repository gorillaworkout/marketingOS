import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_RESEARCH_KNOWLEDGE_TASK,
  extractPinnableClaims,
  knowledgeBriefFromFact,
  knowledgeGraphFocusUrl,
  normalizePinnedSourceUrls,
  parseStoredSourceUrls,
  prepareResearchKnowledgePin,
} from '../src/lib/knowledge-pin';
import { searchWatchTopic } from '../src/lib/ai-research-watch-search';
import {
  AI_RESEARCH_MAX_WATCHES,
  AI_RESEARCH_WATCH_BATCH_LIMIT,
  AI_RESEARCH_WATCH_DUE_HOURS,
  AI_RESEARCH_WATCH_MIN_INTERVAL_MS,
  buildWatchDigest,
  buildWatchQuery,
  diffWatchSnapshots,
  normalizeWatchKeywords,
  normalizeWatchTopic,
  snapshotFromHits,
  suggestWatchTopic,
  watchCronAuthorization,
} from '../src/lib/ai-research-watches';

const read = (path: string) => readFileSync(path, 'utf8');

test('research pins normalize facts, source URLs, and graph focus links', () => {
  const prepared = prepareResearchKnowledgePin({
    taskType: AI_RESEARCH_KNOWLEDGE_TASK,
    selectedOutput: 'Harga emas menguat\n\n\nmenurut sumber publik.',
    sourceUrls: ['https://www.reuters.com/markets/gold#headline', 'https://www.reuters.com/markets/gold'],
    conversationId: '11111111-1111-4111-8111-111111111111',
    projectId: '',
  });
  assert.equal(prepared.fact, 'Harga emas menguat\n\nmenurut sumber publik.');
  assert.equal(prepared.brief, 'Harga emas menguat menurut sumber publik.');
  assert.deepEqual(prepared.sourceUrls, ['https://www.reuters.com/markets/gold']);
  assert.equal(prepared.conversationId, '11111111-1111-4111-8111-111111111111');
  assert.equal(prepared.projectId, null);
  assert.equal(knowledgeBriefFromFact('x'.repeat(300)).length, 240);
  assert.deepEqual(parseStoredSourceUrls(JSON.stringify(prepared.sourceUrls)), prepared.sourceUrls);
  assert.match(knowledgeGraphFocusUrl('abc'), /\/dashboard\/knowledge-graph\?focus=abc/);
  assert.throws(() => prepareResearchKnowledgePin({ taskType: 'ai-research', selectedOutput: 'pendek' }), /Fact is too short/);
  assert.throws(() => normalizePinnedSourceUrls(['javascript:alert(1)']), /Source URL is not valid/);
  assert.throws(() => normalizePinnedSourceUrls(['http://localhost/secret']), /Source URL is not valid/);
  assert.throws(() => prepareResearchKnowledgePin({
    taskType: 'ai-research',
    selectedOutput: 'fakta yang cukup panjang',
    conversationId: 'nope',
  }), /Invalid id/);
});

test('cited claims can be pinned while uncited bullets stay out', () => {
  const claims = extractPinnableClaims([
    'Ringkasan tanpa sitasi yang tidak boleh jadi tombol fakta.',
    '',
    '- Harga emas menguat menurut liputan pasar. [Reuters](https://www.reuters.com/markets/gold)',
    '- Ini hanya opini internal tanpa sumber sama sekali.',
  ].join('\n'), [
    { title: 'Reuters emas', url: 'https://www.reuters.com/markets/gold' },
  ]);
  assert.equal(claims.length, 1);
  assert.match(claims[0].text, /Harga emas menguat/);
  assert.deepEqual(claims[0].sourceUrls, ['https://www.reuters.com/markets/gold']);
});

test('numbered citations and named sources are pinnable while limitations are not', () => {
  const claims = extractPinnableClaims([
    'Gold rose to $2,650 per ounce on 25 September 2026 [1].',
    '',
    'Reuters also described the move as the largest daily gain this month.',
    '',
    '## Gaps and limitations',
    '',
    'Search rounds: 1 of 1. Claims outside the source excerpts are not verified [1].',
  ].join('\n'), [
    { title: 'Gold market wrap', url: 'https://www.reuters.com/markets/gold' },
  ]);
  assert.equal(claims.length, 2);
  assert.deepEqual(claims[0].sourceUrls, ['https://www.reuters.com/markets/gold']);
  assert.match(claims[1].text, /Reuters also described/);
  assert.equal(claims.some(claim => /not verified/i.test(claim.text)), false);
});

test('watch topics, diffs, and digests stay bounded', () => {
  assert.equal(normalizeWatchTopic('  emas   Antam  '), 'emas Antam');
  assert.throws(() => normalizeWatchTopic(' '), /Topic is required/);
  assert.deepEqual(normalizeWatchKeywords('emas, Rupiah, rupiah', 'emas'), ['Rupiah']);
  assert.equal(buildWatchQuery('emas', ['Rupiah']), 'emas Rupiah');
  assert.equal(suggestWatchTopic(`${'topik '.repeat(40)}`).length, 120);
  assert.equal(AI_RESEARCH_MAX_WATCHES, 20);
  assert.equal(AI_RESEARCH_WATCH_BATCH_LIMIT, 25);
  assert.equal(AI_RESEARCH_WATCH_DUE_HOURS, 20);
  assert.equal(AI_RESEARCH_WATCH_MIN_INTERVAL_MS, 45_000);

  const previous = snapshotFromHits([
    { title: 'Harga emas stabil', url: 'https://www.reuters.com/markets/gold', snippet: 'Stabil.' },
    { title: 'Lama hilang', url: 'https://example.com/lama', snippet: 'Lama.' },
  ], 'serper', new Date('2026-09-22T00:00:00Z'));
  const next = snapshotFromHits([
    { title: 'Harga emas menguat', url: 'https://www.reuters.com/markets/gold/', snippet: 'Menguat.' },
    { title: 'Rupiah melemah', url: 'https://www.cnbcindonesia.com/market/rupiah', snippet: 'Melemah.' },
  ], 'serper', new Date('2026-09-23T02:00:00Z'));
  const diff = diffWatchSnapshots(previous, next);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.updated.length, 1);
  assert.match(diff.added[0].url, /cnbcindonesia/);

  const digest = buildWatchDigest({
    topic: 'emas',
    keywords: ['Rupiah'],
    previous,
    next,
    checkedAt: new Date('2026-09-23T02:00:00Z'),
  });
  assert.match(digest, /Watch “emas”/);
  assert.match(digest, /WIB/);
  assert.match(digest, /1 new findings/);
  assert.match(digest, /Rupiah melemah/);
  assert.match(digest, /No longer listed/);

  const first = buildWatchDigest({
    topic: 'emas',
    keywords: [],
    previous: null,
    next,
    checkedAt: new Date('2026-09-23T02:00:00Z'),
  });
  assert.match(first, /First check/);

  const same = buildWatchDigest({
    topic: 'emas',
    keywords: [],
    previous: next,
    next,
    checkedAt: new Date('2026-09-23T03:00:00Z'),
  });
  assert.match(same, /No title or link changes/);
});

test('watch cron secret is required and compared exactly', () => {
  assert.equal(watchCronAuthorization('anything', ''), 'missing');
  assert.equal(watchCronAuthorization('secret', 'secret'), 'ok');
  assert.equal(watchCronAuthorization('secret', 'other'), 'rejected');
  assert.equal(watchCronAuthorization('', 'secret'), 'rejected');
});

test('topic search prefers Serper and falls back to news RSS', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes('google.serper.dev/search')) {
      return new Response(JSON.stringify({
        organic: [{
          title: 'Harga emas hari ini',
          link: 'https://www.reuters.com/markets/gold',
          snippet: 'Emas menguat di pasar spot menurut laporan Reuters hari ini.',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const serper = await searchWatchTopic('emas', {
    fetchImpl,
    searchApiKeys: { serper: 'test-key' },
    enrichThinSnippets: false,
    timeoutMs: 1_000,
  });
  assert.equal(serper.ok, true);
  assert.equal(serper.provider, 'serper');
  assert.match(serper.hits[0].url, /reuters\.com/);
  assert.equal(calls.some(url => url.includes('news.google.com')), false);

  const rssFetch: typeof fetch = async input => {
    const url = String(input);
    if (url.includes('google.serper.dev/search')) return new Response('quota', { status: 429 });
    if (url.includes('news.google.com/rss')) {
      return new Response(`<?xml version="1.0"?><rss><channel><item>
        <title>Harga emas naik</title>
        <link>https://news.google.com/rss/articles/abc</link>
        <source url="https://www.cnbcindonesia.com/market/emas">CNBC</source>
        <description>Emas menguat pada perdagangan hari ini.</description>
      </item></channel></rss>`, { status: 200, headers: { 'content-type': 'application/xml' } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const fallback = await searchWatchTopic('emas', {
    fetchImpl: rssFetch,
    searchApiKeys: { serper: 'test-key' },
    enrichThinSnippets: false,
    timeoutMs: 1_000,
  });
  assert.equal(fallback.provider, 'news-rss');
  assert.match(fallback.hits[0].url, /cnbcindonesia\.com/);
  assert.match(fallback.warning || '', /Serper/);
});

test('pin and watch wiring reuses knowledge writes and documents the daily check', () => {
  const save = read('src/app/api/knowledge/save/route.ts');
  const pinSave = read('src/lib/knowledge-pin-save.ts');
  const auth = read('src/lib/auth.ts');
  const watches = read('src/app/api/ai-research/watches/route.ts');
  const run = read('src/app/api/ai-research/watches/run/route.ts');
  const migration = read('db/migrations/017_ai_research_knowledge_watches.sql');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const pinUi = read('src/components/AiResearchPinFact.tsx');
  const watchUi = read('src/components/AiResearchWatchPanel.tsx');
  const graph = read('src/app/dashboard/knowledge-graph/page.tsx');
  const graphApi = read('src/app/api/admin/knowledge-graph/route.ts');
  const script = read('scripts/run-ai-research-watches.ts');
  const pkg = read('package.json');

  assert.match(auth, /\/api\/knowledge\/save/);
  assert.match(save, /getSession\(request\)/);
  assert.match(save, /savePinnedResearchFact/);
  assert.match(save, /generateContent/);
  assert.match(pinSave, /INSERT INTO knowledge_entries/);
  assert.match(pinSave, /source_urls/);
  assert.match(pinSave, /conversation_id/);
  assert.match(pinSave, /project_id/);
  assert.match(pinSave, /knowledge_edges/);
  assert.doesNotMatch(pinSave, /INTO user_style_preferences|UPDATE user_style_preferences/);
  assert.match(pinUi, /Pin to Knowledge Graph/);
  assert.match(pinUi, /Save fact/);
  assert.match(pinUi, /\/api\/knowledge\/save/);
  assert.match(pinUi, /Open in Knowledge Graph/);
  assert.match(page, /Watches/);
  assert.match(page, /AiResearchPinFact/);
  assert.match(watchUi, /Check now/);
  assert.match(watchUi, /Pause/);
  assert.match(watchUi, /Watch topic/);
  assert.match(watches, /requireFeature\(request, 'ai-research'\)/);
  assert.match(run, /watchCronAuthorization/);
  assert.match(run, /npm run research:watches/);
  assert.doesNotMatch(run, /getSession\(/);
  assert.match(migration, /ALTER TABLE knowledge_entries/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_research_watches/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(graphApi, /source_urls/);
  assert.match(graphApi, /fact_text/);
  assert.match(graph, /focus/);
  assert.match(graph, /Sources/);
  assert.match(script, /runDueResearchWatches/);
  assert.match(pkg, /"research:watches": "tsx scripts\/run-ai-research-watches.ts"/);
});
