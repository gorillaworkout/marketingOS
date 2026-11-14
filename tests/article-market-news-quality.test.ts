import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ARTICLE_COMPLETION_MAX_TOKENS,
  MIN_DATED_RESEARCH_SOURCES,
  buildArticleExpandPrompt,
  citationParenthetical,
  countArticleWords,
  datedSourceCount,
  repairArticleCitations,
  stripUnsupportedProductNames,
  strongestAvailableArticleModel,
  type ArticleSourceInput,
} from '../src/lib/article-market-news.ts';

const silver = (facts: string): ArticleSourceInput => ({
  outlet: 'Reuters',
  title: 'Silver demand',
  url: 'https://reuters.example/silver',
  publishedAt: '2026-11-13T08:00:00+07:00',
  verifiedFacts: facts,
});

test('a short draft expands in place and a combined topic gets a section each', () => {
  const prompt = buildArticleExpandPrompt({
    keyword: 'harga perak + Apple (AAPL)',
    articleMarkdown: 'Silver moved. '.repeat(40),
    wordCount: 283,
    sourceBlock: 'Reuters: Silver prices climbed after industrial demand improved.',
  });
  assert.match(prompt, /Keep every existing sentence/);
  assert.match(prompt, /Do not regenerate the article from scratch/);
  assert.match(prompt, /Silver/);
  assert.match(prompt, /Apple/);
  assert.ok(countArticleWords('word '.repeat(283)) < 800);
  assert.ok(ARTICLE_COMPLETION_MAX_TOKENS >= 12_000);
  assert.equal(strongestAvailableArticleModel('cc/claude-sonnet-5-5', ['cc/claude-sonnet-5-5']), 'cc/claude-opus-5-5');
  assert.equal(strongestAvailableArticleModel('cc/claude-sonnet-5-5', ['cc/claude-sonnet-5-5', 'cc/claude-opus-5-5']), 'cx/gpt-5.6-sol');
});

test('missing inline attributions are inserted, and unused sources are dropped', () => {
  const used = silver('Silver prices climbed after industrial demand improved.');
  const unused: ArticleSourceInput = {
    outlet: 'Kontan',
    title: 'Unrelated',
    url: 'https://kontan.example/unused',
    publishedAt: '2026-11-13T09:00:00+07:00',
    verifiedFacts: 'A completely different nickel inventory story.',
  };
  const markdown = [
    '# Harga perak',
    '',
    'Silver prices climbed after industrial demand improved.',
    '',
    '## Sources',
    `- ${used.outlet} ${used.url}`,
    `- ${unused.outlet} ${unused.url}`,
  ].join('\n');
  const repaired = repairArticleCitations(markdown, [used, unused]);
  assert.equal(citationParenthetical(used), '(Reuters, 13 Nov 2026)');
  assert.match(repaired.markdown, /\(Reuters, 13 Nov 2026\)/);
  assert.deepEqual(repaired.inserted, ['Reuters']);
  assert.deepEqual(repaired.dropped, ['Kontan']);
  assert.equal(repaired.sources.some(source => source.outlet === 'Kontan'), false);
  assert.doesNotMatch(repaired.markdown, /kontan\.example\/unused/);
});

test('an invented product name is removed when it is not in the sources', () => {
  const article = 'Apple reported quarterly revenue. The company launched the iPhone Duo for traders. Demand stayed firm.';
  const corpus = 'Apple reported quarterly revenue. Demand stayed firm.';
  const stripped = stripUnsupportedProductNames(article, corpus);
  assert.deepEqual(stripped.removed, ['iPhone Duo']);
  assert.doesNotMatch(stripped.markdown, /iPhone Duo/);
  assert.match(stripped.markdown, /quarterly revenue/);
});

test('research-fallback articles ask for three dated sources and the client reattaches to the job', () => {
  assert.equal(datedSourceCount([{ publishedAt: '2026-11-13T00:00:00' }]), 1);
  assert.equal(MIN_DATED_RESEARCH_SOURCES, 3);
  const route = readFileSync('src/app/api/article-market-news/generate/route.ts', 'utf8');
  const page = readFileSync('src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx', 'utf8');
  assert.match(route, /minimumDatedSources: researchFallback \? MIN_DATED_RESEARCH_SOURCES/);
  assert.match(route, /buildArticleExpandPrompt/);
  assert.match(route, /repairArticleCitations/);
  assert.match(route, /stripUnsupportedProductNames/);
  assert.match(route, /X-Accel-Buffering': 'no'/);
  assert.match(route, /: keepalive/);
  assert.match(route, /jobId/);
  assert.match(page, /generate\?jobId=/);
  assert.match(page, /Reattaching to the server job/);
});
