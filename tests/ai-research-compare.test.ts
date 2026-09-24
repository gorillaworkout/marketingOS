import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAiResearchChatBody } from '../src/lib/ai-research-request';
import {
  AI_RESEARCH_COMPARE_SECTIONS,
  buildCompareSystemAddendum,
  buildCompareUserPrompt,
  mergeCompareResearch,
  parseCompareSides,
} from '../src/lib/ai-research-compare';
import type { ResearchContext, ResearchSource } from '../src/lib/ai-research-grounding';

const read = (path: string) => readFileSync(path, 'utf8');

function source(partial: Partial<ResearchSource> & Pick<ResearchSource, 'url'>): ResearchSource {
  return {
    title: partial.title || partial.url,
    url: partial.url,
    snippet: partial.snippet || 'Cuplikan sumber yang cukup panjang untuk dibandingkan secara adil.',
    origin: partial.origin || 'indonesia',
  };
}

function context(query: string, sources: ResearchSource[]): ResearchContext {
  return { query, sources, indonesiaPreferred: true };
}

test('compare request requires both sides and keeps them trimmed', () => {
  assert.equal(parseCompareSides(undefined), undefined);
  assert.deepEqual(parseCompareSides({ a: '  emas Antam ', b: 'emas Pegadaian' }), {
    a: 'emas Antam',
    b: 'emas Pegadaian',
  });
  assert.throws(() => parseCompareSides({ a: 'emas', b: '   ' }), /entity A and entity B/i);
  assert.throws(() => parseCompareSides('emas vs perak'), /not valid/i);

  const parsed = parseAiResearchChatBody({
    compare: { a: 'klaim A', b: 'klaim B' },
    messages: [{ role: 'user', content: 'bandingkan' }],
  });
  assert.deepEqual(parsed.compare, { a: 'klaim A', b: 'klaim B' });
  assert.equal(parseAiResearchChatBody({
    messages: [{ role: 'user', content: 'bukan perbandingan' }],
  }).compare, undefined);
});

test('compare prompt asks for structured sections and forbids invented prices', () => {
  const prompt = buildCompareUserPrompt('harga emas Antam', 'harga emas Pegadaian', 'fokus spread');
  assert.match(prompt, /A: harga emas Antam/);
  assert.match(prompt, /B: harga emas Pegadaian/);
  assert.match(prompt, /Focus: fokus spread/);
  assert.match(prompt, /Do not invent prices or facts/);

  const addendum = buildCompareSystemAddendum({ a: 'Dupoin', b: 'Kompetitor X' });
  for (const section of AI_RESEARCH_COMPARE_SECTIONS) {
    assert.match(addendum, new RegExp(`## ${section}`));
  }
  assert.match(addendum, /Do not invent prices, figures, dates, or facts/);
  assert.match(addendum, /no evidence found in the sources/);
  assert.match(addendum, /\[Side A\]/);
  assert.match(addendum, /\[Side B\]/);
});

test('compare merge tags each side, dedupes URLs, and does not invent sources', () => {
  const shared = source({
    url: 'https://bappebti.go.id/emas',
    title: 'Bappebti',
    snippet: 'Regulator menyebut kontrak emas.',
  });
  const onlyA = source({
    url: 'https://antam.com/harga',
    title: 'Antam',
    snippet: 'Harga yang tertulis di halaman Antam.',
  });
  const onlyB = source({
    url: 'https://pegadaian.co.id/emas',
    title: 'Pegadaian',
    snippet: 'Harga yang tertulis di halaman Pegadaian.',
    origin: 'indonesia',
  });
  const merged = mergeCompareResearch({
    aLabel: 'emas Antam',
    bLabel: 'emas Pegadaian',
    aResearch: context('emas Antam', [onlyA, shared]),
    bResearch: context('emas Pegadaian', [shared, onlyB, source({ url: 'https://example.com/extra', snippet: 'tambahan' })]),
    maxSources: 3,
  });

  assert.equal(merged.sources.length, 3);
  const byUrl = new Map(merged.sources.map(item => [item.url, item.snippet]));
  assert.match(byUrl.get('https://antam.com/harga') || '', /\[Side A\]/);
  assert.match(byUrl.get('https://pegadaian.co.id/emas') || '', /\[Side B\]/);
  assert.match(byUrl.get('https://bappebti.go.id/emas') || '', /\[Side A and B\]/);
  assert.equal(byUrl.has('https://example.com/extra'), false);
  assert.doesNotMatch(merged.sources.map(item => item.snippet).join('\n'), /Rp\s?\d/);

  const empty = mergeCompareResearch({
    aLabel: 'A',
    bLabel: 'B',
    aResearch: null,
    bResearch: context('B', []),
  });
  assert.deepEqual(empty.sources, []);
});

test('compare mode is wired to the fast gather pipeline and the composer', () => {
  const route = read('src/app/api/ai-research/chat/route.ts');
  const page = read('src/app/dashboard/ai-research/page.tsx');
  assert.match(route, /mode === 'deep' && !compare/);
  assert.match(route, /buildCompareSearchQuery\(compare\.a\)/);
  assert.match(route, /buildCompareSearchQuery\(compare\.b\)/);
  assert.match(route, /mergeCompareResearch/);
  assert.match(route, /buildCompareSystemAddendum\(compare\)/);
  assert.match(route, /parseAiResearchChatBody as parseChatRequest/);
  assert.match(page, /data-testid="ai-research-compare-toggle"/);
  assert.match(page, />\s*Compare\s*</);
  assert.match(page, /data-testid="ai-research-compare-fields"/);
  assert.match(page, /aria-label="Entity or claim A"/);
  assert.match(page, /aria-label="Entity or claim B"/);
  assert.match(page, /buildCompareUserPrompt/);
  assert.match(page, /compare: compareRequest/);
  assert.match(page, /compareRequest \? 'fast' : researchMode/);
});
