import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_RESEARCH_UI_SNIPPET_MAX,
  applyPinnedResearchSources,
  buildResearchSsePayload,
  normalizeInspectorSource,
  parsePinnedSourceUrls,
  resolveResearchGatherStatus,
  serializeInspectorSources,
  truncateResearchSnippet,
} from '../src/lib/ai-research-inspector';
import { parseChatRequest } from '../src/lib/ai-research';
import type { ResearchContext } from '../src/lib/ai-research-grounding';

const read = (path: string) => readFileSync(path, 'utf8');

const sellaContext: ResearchContext = {
  query: 'Sella Susriana siapa di Dupoin?',
  indonesiaPreferred: true,
  sources: [
    {
      title: 'Bappebti - PT Dupoin Futures Indonesia',
      url: 'https://bappebti.go.id/pialang_berjangka/detail/423',
      origin: 'indonesia',
      snippet: 'Sella Susriana tercatat sebagai Wakil Pialang Berjangka pada PT Dupoin Futures Indonesia. '.repeat(20),
    },
    {
      title: 'EPrints University of Andalas',
      url: 'https://scholar.unand.ac.id/id/eprint/sella-susriana',
      origin: 'indonesia',
      snippet: 'Sella Susriana, Universitas Andalas, repositori karya ilmiah.',
    },
    {
      title: 'Freelancer profile',
      url: 'https://www.freelancer.co.nz/u/sellasusriana',
      origin: 'international',
      snippet: 'Sella Susriana member since 2019.',
    },
  ],
};

test('truncateResearchSnippet keeps short text and ellipsizes long excerpts for the UI payload', () => {
  assert.equal(truncateResearchSnippet('  cuplikan singkat  '), 'cuplikan singkat');
  const long = 'kata '.repeat(200);
  const truncated = truncateResearchSnippet(long);
  assert.ok(truncated.length <= AI_RESEARCH_UI_SNIPPET_MAX);
  assert.ok(truncated.endsWith('…'));
  assert.ok(truncated.length < long.trim().length);
});

test('serializeInspectorSources labels official roster vs other public traces without dropping any URL', () => {
  const sources = serializeInspectorSources(sellaContext);
  assert.equal(sources.length, 3);
  assert.deepEqual(sources.map(source => source.url), sellaContext.sources.map(source => source.url));

  const bappebti = sources.find(source => source.url.includes('bappebti.go.id'));
  assert.ok(bappebti);
  assert.equal(bappebti.origin, 'indonesia');
  assert.equal(bappebti.originChip, 'official');
  assert.equal(bappebti.official, true);
  assert.equal(bappebti.traceKind, 'person_fact');
  assert.ok(bappebti.snippet.length <= AI_RESEARCH_UI_SNIPPET_MAX);

  const unand = sources.find(source => source.url.includes('unand.ac.id'));
  assert.ok(unand);
  assert.equal(unand.originChip, 'indonesia');
  assert.equal(unand.traceKind, 'other_public_trace');

  const freelancer = sources.find(source => source.url.includes('freelancer.co.nz'));
  assert.ok(freelancer);
  assert.equal(freelancer.originChip, 'international');
  assert.equal(freelancer.traceKind, 'other_public_trace');
});

test('buildResearchSsePayload includes sources[], sourceCount, and grounding status', () => {
  const ok = buildResearchSsePayload({ query: sellaContext.query, research: sellaContext, failed: false });
  assert.equal(ok.type, 'research');
  assert.equal(ok.grounding, 'ok');
  assert.equal(ok.sourceCount, 3);
  assert.equal(ok.sources.length, 3);
  for (const source of ok.sources) {
    assert.equal(typeof source.title, 'string');
    assert.equal(typeof source.url, 'string');
    assert.ok(source.origin === 'indonesia' || source.origin === 'international');
    assert.equal(typeof source.snippet, 'string');
    assert.ok(source.snippet.length <= AI_RESEARCH_UI_SNIPPET_MAX);
  }

  const skipped = buildResearchSsePayload({ query: 'hi', research: { query: 'hi', sources: [], indonesiaPreferred: false }, failed: false });
  assert.equal(skipped.grounding, 'skipped');
  assert.equal(skipped.sourceCount, 0);
  assert.deepEqual(skipped.sources, []);

  const empty = buildResearchSsePayload({
    query: 'Apa fakta resmi Dupoin Indonesia?',
    research: { query: 'Apa fakta resmi Dupoin Indonesia?', sources: [], indonesiaPreferred: true },
    failed: false,
  });
  assert.equal(empty.grounding, 'empty');

  const failed = buildResearchSsePayload({ query: sellaContext.query, research: sellaContext, failed: true });
  assert.equal(failed.grounding, 'failed');
  assert.equal(failed.sourceCount, 0);
  assert.deepEqual(failed.sources, []);
});

test('resolveResearchGatherStatus distinguishes skipped, empty, failed, and ok', () => {
  assert.equal(resolveResearchGatherStatus({ query: 'hi', failed: false, sourceCount: 0 }), 'skipped');
  assert.equal(resolveResearchGatherStatus({ query: sellaContext.query, failed: false, sourceCount: 0 }), 'empty');
  assert.equal(resolveResearchGatherStatus({ query: sellaContext.query, failed: true, sourceCount: 3 }), 'failed');
  assert.equal(resolveResearchGatherStatus({ query: sellaContext.query, failed: false, sourceCount: 3 }), 'ok');
});

test('parsePinnedSourceUrls rejects junk and applyPinnedResearchSources filters with a full-list fallback', () => {
  assert.deepEqual(parsePinnedSourceUrls(null), []);
  assert.deepEqual(parsePinnedSourceUrls(['not-a-url', 'javascript:alert(1)', 12, 'https://bappebti.go.id/pialang']), [
    'https://bappebti.go.id/pialang',
  ]);

  const pinned = applyPinnedResearchSources(sellaContext, ['https://scholar.unand.ac.id/id/eprint/sella-susriana']);
  assert.equal(pinned.sources.length, 1);
  assert.ok(pinned.sources[0].url.includes('unand.ac.id'));

  const fallback = applyPinnedResearchSources(sellaContext, ['https://example.com/missing']);
  assert.equal(fallback.sources.length, 3);
});

test('normalizeInspectorSource infers official chips from Bappebti hosts when fields are missing', () => {
  const inferred = normalizeInspectorSource({
    title: 'Bappebti',
    url: 'https://bappebti.go.id/pialang_berjangka/detail/423',
    origin: 'indonesia',
    snippet: 'Wakil Pialang',
  });
  assert.ok(inferred);
  assert.equal(inferred.official, true);
  assert.equal(inferred.originChip, 'official');
  assert.equal(normalizeInspectorSource({ title: 'nope' }), null);
});

test('parseChatRequest accepts pinnedSourceUrls without breaking the existing body shape', () => {
  const parsed = parseChatRequest({
    conversationId: 'conv-1',
    pinnedSourceUrls: ['https://bappebti.go.id/pialang', 'ftp://bad.example'],
    messages: [{ role: 'user', content: 'Sella Susriana siapa di Dupoin?' }],
  });
  assert.equal(parsed.conversationId, 'conv-1');
  assert.deepEqual(parsed.pinnedSourceUrls, ['https://bappebti.go.id/pialang', 'ftp://bad.example']);
  const omitted = parseChatRequest({
    messages: [{ role: 'user', content: 'halo dunia trading emas' }],
  });
  assert.deepEqual(omitted.pinnedSourceUrls, []);
});

test('chat route SSE research event serializes sources and does not treat a client id as exists', () => {
  const route = read('src/app/api/ai-research/chat/route.ts');
  assert.match(route, /buildResearchSsePayload/);
  assert.match(route, /grounding/);
  assert.match(route, /sources/);
  assert.match(route, /sourceCount/);
  assert.match(route, /Boolean\(history\)/);
  assert.doesNotMatch(route, /persistConversation\([^)]*Boolean\(conversationId\)/);
  assert.match(route, /if \(updated > 0\) return;/);
  assert.match(route, /pinnedSourceUrls/);
  assert.match(route, /applyPinnedResearchSources/);
});

test('AI Research page and panel show every grounded source in the inspector UI', () => {
  const page = read('src/app/dashboard/ai-research/page.tsx');
  const panel = read('src/components/AiResearchSourcesPanel.tsx');
  const inspector = read('src/lib/ai-research-inspector.ts');
  assert.match(page, /AiResearchSourcesPanel/);
  assert.match(page, /Sources used/);
  assert.match(page, /pinnedSourceUrls/);
  assert.match(page, /RESEARCH_FAILED_BANNER/);
  assert.match(page, /RESEARCH_DISCONNECT_BANNER/);
  assert.match(page, /streamCompleted/);
  assert.match(panel, /Sources used/);
  assert.match(panel, /PERSON_FACT/);
  assert.match(panel, /OTHER_PUBLIC_TRACE/);
  assert.match(panel, /Official Dupoin\/Bappebti roster/);
  assert.match(panel, /Other public trace/);
  assert.match(panel, /Pin this source/);
  assert.match(inspector, /No sources/);
  assert.match(inspector, /Source search failed/);
  assert.match(inspector, /Web research skipped/);
});
