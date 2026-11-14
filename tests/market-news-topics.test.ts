import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MARKET_RESEARCH_SYMBOLS } from '../src/lib/market-research-sources';
import { buildArticleMarketNewsPrompts } from '../src/lib/article-market-news';
import {
  ELIGIBLE_MARKET_NEWS_KEYWORDS,
  MARKET_NEWS_CATALOG_SYMBOLS,
  MARKET_NEWS_TOPICS,
  filterMarketNewsTopics,
  marketNewsCoverage,
  topicForKeyword,
} from '../src/lib/market-news-topics';

const catalog = new Set(Object.values(MARKET_RESEARCH_SYMBOLS).flat());

test('the topic catalog matches the market-news symbol list', () => {
  for (const symbol of MARKET_NEWS_CATALOG_SYMBOLS) assert.equal(catalog.has(symbol), true, symbol);
  for (const symbol of catalog) assert.equal(MARKET_NEWS_CATALOG_SYMBOLS.includes(symbol as typeof MARKET_NEWS_CATALOG_SYMBOLS[number]), true, symbol);
});

test('symbols map to catalog coverage or an explicit research fallback', () => {
  const expect = (keyword: string, symbol: string, coverage: 'catalog' | 'research-fallback') => {
    const topic = topicForKeyword(keyword);
    assert.ok(topic, keyword);
    assert.equal(topic.symbols.includes(symbol), true, keyword);
    assert.equal(marketNewsCoverage(topic), coverage, keyword);
  };
  expect('harga emas', 'XAUUSD', 'catalog');
  expect('harga perak', 'XAGUSD', 'research-fallback');
  expect('Tesla (TSLA)', 'TSLA', 'research-fallback');
  expect('Apple (AAPL)', 'AAPL', 'research-fallback');
  expect('Microsoft (MSFT)', 'MSFT', 'research-fallback');
  expect('Nvidia (NVDA)', 'NVDA', 'research-fallback');
  expect('Amazon (AMZN)', 'AMZN', 'research-fallback');
  expect('Meta Platforms (META)', 'META', 'research-fallback');
  expect('Alphabet (GOOGL)', 'GOOGL', 'research-fallback');
  expect('S&P 500', 'SPX', 'catalog');
  expect('NASDAQ', 'NDX', 'catalog');
  expect('Dow Jones', 'DJIA', 'catalog');
  expect('USD/JPY', 'JPY', 'catalog');
  expect('GBP/USD', 'GBP', 'catalog');
  expect('EUR/USD', 'EUR', 'catalog');
  expect('AUD/USD', 'AUD', 'catalog');
  expect('USD/IDR', 'IDR', 'catalog');
  expect('harga minyak', 'WTI', 'catalog');
  expect('rupiah', 'IDR', 'catalog');
  expect('dolar', 'USD', 'catalog');
  expect('wall street', 'US Stocks', 'catalog');
});

test('existing SOP phrases stay eligible and search finds a topic', () => {
  for (const phrase of ['emas', 'harga emas', 'xauusd', 'xau/usd', 'rupiah', 'dollar', 'dolar', 'wall street', 'minyak', 'harga minyak']) {
    assert.equal(ELIGIBLE_MARKET_NEWS_KEYWORDS.some(item => phrase.includes(item) || item.includes(phrase)), true, phrase);
    assert.ok(topicForKeyword(phrase), phrase);
  }
  assert.deepEqual(filterMarketNewsTopics('silver').map(topic => topic.id), ['silver']);
  assert.equal(MARKET_NEWS_TOPICS.filter(topic => topic.category === 'Stocks').length, 7);
});

test('the article prompt names the instrument and its topic context', () => {
  const input = {
    keyword: 'USD/JPY',
    researchDate: '2026-11-14',
    angle: 'What moved the pair today.',
    competitorHeadings: '',
    paaQuestions: [],
    sources: [],
    noCompetitorBroker: true,
    factsVerified: true,
  };
  const prompts = buildArticleMarketNewsPrompts(input);
  assert.match(prompts.userPrompt, /USD\/JPY/);
  assert.match(prompts.userPrompt, /Bank of Japan/);
  const silver = buildArticleMarketNewsPrompts({ ...input, keyword: 'harga perak' });
  assert.match(silver.userPrompt, /XAG\/USD/);
  assert.match(silver.userPrompt, /not in the existing market-news catalog/);
  const page = readFileSync('src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx', 'utf8');
  assert.match(page, /Search topics/);
  assert.match(page, /groupMarketNewsTopics/);
});
