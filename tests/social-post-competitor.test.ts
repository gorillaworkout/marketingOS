import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANALYZER_DIMENSIONS,
  approachInsight,
  buildCompetitorInsightsBlock,
  competitorFetchDecision,
  normalizeCaptionAnalysis,
  COMPETITOR_INSIGHT_MAX,
} from '../src/lib/social-post-competitor';

const source = 'Trade gold today with a guaranteed easy bonus and open the account from this exact caption line.';

test('competitor insights stay short and do not copy the source', () => {
  const copied = approachInsight({
    hookPattern: source,
    differentiationIdeas: ['Lead with a question instead of a bonus claim.'],
  }, source);
  assert.ok(copied.length <= COMPETITOR_INSIGHT_MAX);
  assert.doesNotMatch(copied, /guaranteed easy bonus/);
  assert.match(copied, /Lead with a question/);
  const block = buildCompetitorInsightsBlock(['A'.repeat(900), 'Second approach', 'Third approach', 'Fourth approach']);
  assert.equal((block.match(/^\d\./gm) || []).length, 3);
  assert.match(block, /Never copy their wording/);
  assert.ok(!block.includes('A'.repeat(COMPETITOR_INSIGHT_MAX + 1)));
});

test('social competitor URLs are never fetched and a read article is fetched once', () => {
  const social = competitorFetchDecision('https://www.instagram.com/p/abc', false);
  assert.equal('error' in social, true);
  const first = competitorFetchDecision('https://news.example/gold', false);
  assert.equal('action' in first && first.action, 'fetch');
  const again = competitorFetchDecision('https://news.example/gold', true);
  assert.equal('action' in again && again.action, 'skip');
});

test('caption analysis keeps six dimensions, including BAPPEBTI compliance', () => {
  const result = normalizeCaptionAnalysis({
    score: 140,
    summary: 'Clear, but the claim is too strong.',
    dimensions: { compliance: { score: 2, note: 'BAPPEBTI: no guaranteed-profit claims.' } },
    recommendations: [{ priority: 'high', issue: 'Profit promise', fix: 'Remove the guarantee.' }, { priority: 'urgent', issue: 'Tone', fix: 'Soften it.' }],
    rewrittenHook: 'A calmer hook',
    improvedCaption: 'Trade with a regulated broker.',
    suggestedHashtags: ['Dupoin', '#Dupoin'],
  }, [{ name: 'banned_words', label: 'Banned Words', passed: false, detail: 'Found a banned phrase.' }]);
  assert.equal(result.score, 100);
  assert.deepEqual(Object.keys(result.dimensions), [...ANALYZER_DIMENSIONS]);
  assert.match(result.dimensions.compliance.note, /BAPPEBTI/);
  assert.equal(result.recommendations[1].priority, 'medium');
  assert.deepEqual(result.suggestedHashtags, ['#dupoin']);
  assert.equal(result.checks[0].passed, false);
});

test('generation uses saved competitor insights and the analyzer is on the page', () => {
  const route = readFileSync('src/app/api/social-post/generate/route.ts', 'utf8');
  const page = readFileSync('src/app/dashboard/social-post/page.tsx', 'utf8');
  assert.match(route, /buildCompetitorInsightsBlock/);
  assert.match(route, /competitorRefIds: competitorIds/);
  assert.match(page, /Caption Analyzer/);
  assert.match(page, />\s*Analyze\s*</);
  assert.doesNotMatch(page, /Competitor — coming soon/);
  const analyzer = readFileSync('src/app/api/social-post/analyze-caption/route.ts', 'utf8');
  assert.match(analyzer, /getUserPreferredModel\(auth\.id, 'social-post'\)/);
  assert.match(analyzer, /caption_analyses/);
});
