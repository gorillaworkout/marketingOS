import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { jakartaDate, normalizeArticleMarketNewsInput } from '../src/lib/article-market-news';
import {
  ARTICLE_MARKET_NEWS_EXAMPLE_ANGLE,
  ARTICLE_MARKET_NEWS_EXAMPLE_COMPETITORS,
  ARTICLE_MARKET_NEWS_EXAMPLE_KEYWORD,
  ARTICLE_MARKET_NEWS_EXAMPLE_PAA,
  exampleCompetitorHeadings,
  examplePaaText,
  formatExampleCompetitorHeadings,
  formatExamplePaaText,
} from '../src/lib/article-market-news-example';

const generator = readFileSync(path.join(process.cwd(), 'src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx'), 'utf8');

test('example filler formats five ordered competitor structures and five unique PAA questions', () => {
  assert.equal(ARTICLE_MARKET_NEWS_EXAMPLE_COMPETITORS.length, 5);
  assert.equal(ARTICLE_MARKET_NEWS_EXAMPLE_PAA.length, 5);
  assert.equal(exampleCompetitorHeadings, formatExampleCompetitorHeadings());
  assert.equal(examplePaaText, formatExamplePaaText());

  const blocks = exampleCompetitorHeadings.split('\n\n');
  assert.equal(blocks.length, 5);
  const headings = blocks.map((block, index) => {
    assert.match(block, new RegExp(`^Competitor ${index + 1}:\\nH1: \\S`));
    assert.match(block, /\nH2: \S/);
    assert.match(block, /\nH3: \S/);
    return {
      h1: block.match(/H1: (.+)/)?.[1],
      h2: block.match(/H2: (.+)/)?.[1],
      h3: block.match(/H3: (.+)/)?.[1],
    };
  });
  assert.equal(new Set(headings.map(heading => heading.h1)).size, 5);
  assert.equal(new Set(headings.map(heading => heading.h2)).size, 5);
  assert.equal(new Set(headings.map(heading => heading.h3)).size, 5);

  const paaQuestions = examplePaaText.split('\n').map(value => value.trim()).filter(Boolean);
  assert.deepEqual(paaQuestions, [...ARTICLE_MARKET_NEWS_EXAMPLE_PAA]);
  assert.equal(new Set(paaQuestions).size, 5);
  assert.ok(paaQuestions.every(question => question.endsWith('?') && !/^\d+\./.test(question)));

  const labeledCompetitors = new Set(
    [...exampleCompetitorHeadings.matchAll(/(?:competitor|artikel)\s*([1-5])\s*:/gi)].map(match => match[1]),
  );
  assert.equal(labeledCompetitors.size, 5);

  const input = normalizeArticleMarketNewsInput({
    keyword: ARTICLE_MARKET_NEWS_EXAMPLE_KEYWORD,
    researchDate: jakartaDate(),
    angle: ARTICLE_MARKET_NEWS_EXAMPLE_ANGLE,
    competitorHeadings: exampleCompetitorHeadings,
    paaQuestions,
    sources: [],
    noCompetitorBroker: false,
    factsVerified: false,
  });
  assert.equal(input.keyword, ARTICLE_MARKET_NEWS_EXAMPLE_KEYWORD);
  assert.equal(input.competitorHeadings, exampleCompetitorHeadings);
  assert.deepEqual(input.paaQuestions, paaQuestions);
  assert.deepEqual(input.sources, []);
});

test('generator shows the shared examples and Fill example fills both fields', () => {
  assert.match(generator, /exampleCompetitorHeadings/);
  assert.match(generator, /examplePaaText/);
  assert.match(generator, /setKeyword\(ARTICLE_MARKET_NEWS_EXAMPLE_KEYWORD\)/);
  assert.match(generator, /setAngle\(ARTICLE_MARKET_NEWS_EXAMPLE_ANGLE\)/);
  assert.match(generator, /setCompetitorHeadings\(exampleCompetitorHeadings\)/);
  assert.match(generator, /setPaaText\(examplePaaText\)/);
  assert.match(generator, /\{exampleCompetitorHeadings\}/);
  assert.match(generator, /\{examplePaaText\}/);
  assert.match(generator, /Fill example/);
  assert.match(generator, /Copy structure/);
  assert.match(generator, /Copy PAA/);
  assert.match(generator, /5 competitor structures/);
  assert.match(generator, /5 PAA questions/);
});
