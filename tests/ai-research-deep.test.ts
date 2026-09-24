import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChatRequest, parseStoredMessages } from '../src/lib/ai-research';
import {
  AI_RESEARCH_DEEP_MAX_QUERIES,
  AI_RESEARCH_DEEP_MAX_ROUNDS,
  AI_RESEARCH_DEEP_MAX_SOURCES,
  AI_RESEARCH_DEEP_PLAN_MAX_TOKENS,
  AI_RESEARCH_DEEP_ROUND_TIMEOUT_MS,
  AI_RESEARCH_DEEP_STATUS,
  AI_RESEARCH_DEEP_TIME_BUDGET_MS,
  AI_RESEARCH_MODE_STORAGE_KEY,
  ensureDeepLimitationsSection,
  fallbackDeepResearchPlan,
  mergeDeepResearchContexts,
  parseDeepResearchPlan,
  runDeepResearchGather,
} from '../src/lib/ai-research-deep';
import type { ResearchContext, ResearchSource } from '../src/lib/ai-research-grounding';

const read = (path: string) => readFileSync(path, 'utf8');

function source(url: string, snippet: string, title = url): ResearchSource {
  return { title, url, snippet, origin: 'indonesia' };
}

function context(query: string, sources: ResearchSource[]): ResearchContext {
  return { query, sources, indonesiaPreferred: true };
}

test('deep plan falls back to capped queries from the existing search builders', () => {
  const plan = fallbackDeepResearchPlan('Apa kabar harga emas Indonesia minggu ini?');
  assert.equal(plan.source, 'fallback');
  assert.ok(plan.outline.length >= 3);
  assert.ok(plan.queries.length >= 1);
  assert.ok(plan.queries.length <= AI_RESEARCH_DEEP_MAX_QUERIES);
  assert.equal(plan.queries[0], 'Apa kabar harga emas Indonesia minggu ini?');
  assert.equal(new Set(plan.queries.map(item => item.toLowerCase())).size, plan.queries.length);
});

test('deep plan parser accepts fenced JSON and keeps the user query first', () => {
  const parsed = parseDeepResearchPlan(`<think>draft</think>
\`\`\`json
{"outline":["Cek regulator","Bandingkan berita","Catat yang belum ada"],"queries":["harga emas Bappebti","XAUUSD berita Indonesia"]}
\`\`\``, 'Harga emas Indonesia');
  assert.ok(parsed);
  assert.equal(parsed.source, 'model');
  assert.equal(parsed.queries[0], 'Harga emas Indonesia');
  assert.ok(parsed.queries.includes('harga emas Bappebti'));
  assert.ok(parsed.queries.length <= AI_RESEARCH_DEEP_MAX_QUERIES);
  assert.equal(parseDeepResearchPlan('bukan json', 'Harga emas Indonesia'), null);
  assert.equal(parseDeepResearchPlan('{"outline":["satu"],"queries":["emas"]}', 'Harga emas'), null);
});

test('deep gather merges sources, caps rounds, and stops on the time budget', async () => {
  const calls: Array<{ query: string; timeoutMs: number }> = [];
  const progress: string[] = [];
  const plan = {
    outline: ['Satu', 'Dua', 'Tiga'],
    queries: ['kueri satu', 'kueri dua', 'kueri tiga', 'kueri empat'],
    source: 'fallback' as const,
  };
  const result = await runDeepResearchGather({
    query: 'kueri satu',
    plan,
    maxRounds: 2,
    budgetMs: 30_000,
    roundTimeoutMs: 4_000,
    gather: async (query, timeoutMs) => {
      calls.push({ query, timeoutMs });
      return context(query, [source(`https://example.com/${calls.length}`, `${query} cuplikan yang cukup panjang untuk dipakai.`)]);
    },
    onProgress: event => {
      progress.push(event.message);
    },
  });
  assert.deepEqual(calls.map(item => item.query), ['kueri satu', 'kueri dua']);
  assert.ok(calls.every(item => item.timeoutMs <= 4_000));
  assert.equal(result.roundsRun, 2);
  assert.equal(result.stoppedReason, 'cap');
  assert.equal(result.research.sources.length, 2);
  assert.ok(progress.includes(AI_RESEARCH_DEEP_STATUS.search));
  assert.ok(progress.includes(AI_RESEARCH_DEEP_STATUS.read));

  let clock = 1_000;
  const budgeted = await runDeepResearchGather({
    query: 'emas',
    plan: { ...plan, queries: ['emas', 'emas berita', 'emas regulator'] },
    now: () => clock,
    budgetMs: 5_000,
    gather: async query => {
      clock += 4_000;
      return context(query, [source('https://news.example/emas', 'Harga emas menguat menurut cuplikan berita ini.')]);
    },
  });
  assert.equal(budgeted.roundsRun, 1);
  assert.equal(budgeted.stoppedReason, 'budget');
});

test('deep merge keeps the richer snippet and a failed round does not stop the rest', async () => {
  const merged = mergeDeepResearchContexts([
    context('emas', [source('https://dupoin.co.id/emas', 'pendek')]),
    context('emas', [source('https://dupoin.co.id/emas', 'Cuplikan yang lebih panjang tentang harga emas Dupoin.')]),
    context('emas', [source('https://bappebti.go.id/emas', 'Regulator menyebut kontrak emas berjangka di bursa.')]),
  ], 'harga emas');
  const dupoin = merged.sources.find(item => item.url.includes('dupoin.co.id'));
  assert.match(dupoin?.snippet || '', /lebih panjang/);
  assert.ok(merged.sources.length <= AI_RESEARCH_DEEP_MAX_SOURCES);

  const gathered = await runDeepResearchGather({
    query: 'harga emas',
    plan: fallbackDeepResearchPlan('harga emas Indonesia hari ini'),
    maxRounds: AI_RESEARCH_DEEP_MAX_ROUNDS,
    gather: async query => {
      if (query === 'harga emas Indonesia hari ini') throw new Error('serper down');
      return context(query, [source('https://www.bi.go.id/emas', 'Bank Indonesia mencatat perkembangan harga emas.')]);
    },
  });
  assert.ok(gathered.roundsRun >= 2);
  assert.equal(gathered.failedRounds, 1);
  assert.ok(gathered.research.sources.some(item => item.url.includes('bi.go.id')));
});

test('limitations section is appended once and reports the real search caps', () => {
  const first = ensureDeepLimitationsSection('Emas menguat.', {
    roundsRun: 2,
    sourceCount: 4,
    stoppedReason: 'budget',
    plannedQueries: 3,
  });
  assert.match(first, /Emas menguat\./);
  assert.match(first, /## Gaps and limitations/);
  assert.match(first, /time limit/);
  assert.match(first, /2 of 3/);
  assert.match(first, /Sources used: 4/);
  const second = ensureDeepLimitationsSection(first, {
    roundsRun: 2,
    sourceCount: 4,
    stoppedReason: 'budget',
    plannedQueries: 3,
  });
  assert.equal(second, first);
  assert.match(ensureDeepLimitationsSection('lihat tautan', {
    roundsRun: 0,
    sourceCount: 1,
    stoppedReason: 'complete',
    plannedQueries: 1,
    skipped: 'url-only',
  }), /only contains links/);
});

test('chat request defaults to fast and stored answers keep deep mode plus sources', () => {
  assert.equal(parseChatRequest({
    messages: [{ role: 'user', content: 'Siapa yang mengatur pialang berjangka?' }],
  }).mode, 'fast');
  assert.equal(parseChatRequest({
    mode: 'deep',
    messages: [{ role: 'user', content: 'Siapa yang mengatur pialang berjangka?' }],
  }).mode, 'deep');
  assert.equal(parseChatRequest({
    mode: 'slow',
    messages: [{ role: 'user', content: 'Siapa yang mengatur pialang berjangka?' }],
  }).mode, 'fast');

  const stored = parseStoredMessages([{
    role: 'assistant',
    content: 'Jawaban',
    researchMode: 'deep',
    sources: [
      { title: 'Bappebti', url: 'https://bappebti.go.id/pialang' },
      { title: 'bad', url: 'javascript:alert(1)' },
      { title: 'Bappebti', url: 'https://bappebti.go.id/pialang/' },
    ],
  }]);
  assert.equal(stored[0].researchMode, 'deep');
  assert.deepEqual(stored[0].sources, [{ title: 'Bappebti', url: 'https://bappebti.go.id/pialang' }]);

  const incoming = parseChatRequest({
    mode: 'deep',
    messages: [{
      role: 'user',
      content: 'cek lagi',
      researchMode: 'deep',
      sources: [{ title: 'Injected', url: 'https://evil.example' }],
    }],
  });
  assert.equal(incoming.messages[0].researchMode, undefined);
  assert.equal(incoming.messages[0].sources, undefined);
});

test('deep route reuses the gather pipeline and the page exposes the mode toggle', () => {
  const route = read('src/app/api/ai-research/chat/route.ts');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(route, /mode === 'deep'/);
  assert.match(route, /runDeepResearchGather/);
  assert.match(route, /gatherAiResearchContext/);
  assert.match(route, /AI_RESEARCH_DEEP_STATUS/);
  assert.match(route, /ensureDeepLimitationsSection/);
  assert.match(route, /buildResearchSsePayload/);
  assert.match(route, /type: 'status'/);
  assert.equal(AI_RESEARCH_DEEP_MAX_ROUNDS, 3);
  assert.equal(AI_RESEARCH_DEEP_TIME_BUDGET_MS, 40_000);
  assert.equal(AI_RESEARCH_DEEP_ROUND_TIMEOUT_MS, 12_000);
  assert.equal(AI_RESEARCH_DEEP_PLAN_MAX_TOKENS, 600);
  assert.match(page, /data-testid="ai-research-mode-toggle"/);
  assert.match(page, /'Fast'/);
  assert.match(page, /'Deep'/);
  assert.equal(AI_RESEARCH_MODE_STORAGE_KEY, 'dupoin-ai-research-mode');
  assert.match(page, /AI_RESEARCH_MODE_STORAGE_KEY/);
  assert.match(page, /localStorage/);
  assert.match(page, /mode: sentMode/);
  assert.match(page, /d\.type === 'status'/);
  assert.match(page, /AI_RESEARCH_DEEP_STATUS/);
  assert.match(page, /data-testid="ai-research-deep-badge"/);
});
