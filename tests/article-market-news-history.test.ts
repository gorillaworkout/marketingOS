import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ARTICLE_MARKET_NEWS_HISTORY_TYPE,
  isArticleMarketNewsHistoryType,
  restoreArticleMarketNews,
} from '../src/lib/article-market-news-history';

const read = (relative: string) => {
  const file = path.join(process.cwd(), relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

const generator = read('src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx');
const page = read('src/app/dashboard/sop/page.tsx');
const route = read('src/app/api/article-market-news/generate/route.ts');
const historyApi = read('src/app/api/dashboard/history/route.ts');

const persistedInput = {
  keyword: 'harga emas',
  researchDate: '2026-07-27',
  angle: 'Permintaan emas dan respons trader.',
  competitorHeadings: 'Competitor 1:\nH1: Harga Emas\nH2: Faktor\nH3: Risiko',
  paaQuestions: [
    'Apa yang memengaruhi harga emas?',
    'Mengapa bank sentral membeli emas?',
    'Bagaimana permintaan memengaruhi emas?',
    'Apakah ETF memengaruhi permintaan emas?',
    'Apa risiko trading XAUUSD?',
  ],
  noCompetitorBroker: true,
  factsVerified: true,
  sources: [{
    outlet: 'Kontan',
    title: 'Harga Emas Menguat 1.234',
    url: 'https://investasi.kontan.co.id/news/harga-emas',
    publishedAt: '2026-07-27T09:30',
    verifiedFacts: 'Harga emas menguat pada nilai 1.234 menurut laporan Kontan dan permintaan tetap diperhatikan pelaku pasar.',
    provenance: 'automated' as const,
  }],
};

const persistedArticle = {
  title: 'Harga Emas Menguat',
  metaDescription: 'Ringkasan pergerakan harga emas hari ini.',
  articleMarkdown: '# Harga Emas Menguat\n\nHarga emas menjadi perhatian pasar.',
  excerpt: 'Emas menguat.',
  sourcesCited: ['Kontan — 2026-07-27 — https://investasi.kontan.co.id/news/harga-emas'],
  wordCount: 6,
};

function persistedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-amn-1',
    title: 'Article Market News: Harga Emas Menguat',
    brief: persistedInput.angle,
    created_at: '2026-07-27T02:30:00.000Z',
    type: ARTICLE_MARKET_NEWS_HISTORY_TYPE,
    output_data: JSON.stringify({
      article: persistedArticle,
      input: persistedInput,
      model: 'cc/claude-sonnet-5',
      qc: { titleWithin60Characters: true },
      ...overrides,
    }),
  };
}

test('history type filter matches generate persistence and the dashboard query', () => {
  assert.equal(ARTICLE_MARKET_NEWS_HISTORY_TYPE, 'article-market-news');
  assert.equal(isArticleMarketNewsHistoryType('article-market-news'), true);
  assert.equal(isArticleMarketNewsHistoryType('market-research'), false);
  assert.equal(isArticleMarketNewsHistoryType('sop'), false);
  assert.match(route, /'article-market-news'/);
  assert.match(route, /INSERT INTO tasks/);
  assert.match(historyApi, /searchParams\.get\('type'\)/);
  assert.match(historyApi, /AND type = \?/);
  assert.match(generator, /\/api\/dashboard\/history\?type=\$\{ARTICLE_MARKET_NEWS_HISTORY_TYPE\}/);
  assert.match(generator, /\/dashboard\/history\?type=\$\{ARTICLE_MARKET_NEWS_HISTORY_TYPE\}/);
  assert.match(page, /\/dashboard\/history\?type=article-market-news/);
});

test('restore maps persisted Article Market News output and resets fact review', () => {
  const restored = restoreArticleMarketNews(persistedTask());
  assert.equal(restored.result.title, 'Harga Emas Menguat');
  assert.equal(restored.result.metaDescription, 'Ringkasan pergerakan harga emas hari ini.');
  assert.equal(restored.result.articleMarkdown, persistedArticle.articleMarkdown);
  assert.equal(restored.result.excerpt, 'Emas menguat.');
  assert.deepEqual(restored.result.sourcesCited, persistedArticle.sourcesCited);
  assert.equal(restored.result.wordCount, 6);
  assert.equal(restored.result.model, 'cc/claude-sonnet-5');
  assert.equal(restored.result.historyId, 'task-amn-1');
  assert.equal(restored.keyword, 'harga emas');
  assert.equal(restored.researchDate, '2026-07-27');
  assert.equal(restored.angle, persistedInput.angle);
  assert.equal(restored.competitorHeadings, persistedInput.competitorHeadings);
  assert.equal(restored.paaText, persistedInput.paaQuestions.join('\n'));
  assert.equal(restored.sources[0]?.outlet, 'Kontan');
  assert.equal(restored.sources[0]?.provenance, 'automated');
  assert.equal(restored.generatedInput.keyword, 'harga emas');
  assert.equal(restored.generatedInput.factsVerified, true);
  assert.equal(restored.result.normalizedInput.researchDate, '2026-07-27');
  assert.equal(restored.factReviewConfirmed, false);
  assert.equal(restored.noCompetitorBroker, true);
});

test('restore rejects incomplete or malformed saved articles', () => {
  assert.throws(() => restoreArticleMarketNews({
    id: 'broken',
    title: 'Broken',
    created_at: '2026-07-27T00:00:00.000Z',
    output_data: '{',
  }), /incomplete/i);
  assert.throws(() => restoreArticleMarketNews({
    id: 'missing-article',
    title: 'Missing',
    created_at: '2026-07-27T00:00:00.000Z',
    output_data: JSON.stringify({ input: persistedInput, model: 'x' }),
  }), /incomplete/i);
  assert.throws(() => restoreArticleMarketNews({
    id: 'missing-input',
    title: 'Missing',
    created_at: '2026-07-27T00:00:00.000Z',
    output_data: JSON.stringify({ article: persistedArticle, model: 'x' }),
  }), /incomplete/i);
});

test('Article Market News page restores recent history and clears the fact-review gate', () => {
  assert.match(generator, /Recent Generated/);
  assert.match(generator, /restoreArticleMarketNews/);
  assert.match(generator, /restoreHistory/);
  assert.match(generator, /setFactReviewConfirmed\(false\)/);
  assert.match(generator, /setFactReviewConfirmed\(restored\.factReviewConfirmed\)/);
  assert.match(generator, /View all history/);
  assert.match(generator, /Belum ada Article Market News tersimpan|No saved Article Market News yet/);
  assert.match(generator, /recentError/);
  assert.match(generator, /response\.ok/);
  assert.match(generator, /void fetchRecent\(\)/);
  assert.match(page, /Buka history/);
});
