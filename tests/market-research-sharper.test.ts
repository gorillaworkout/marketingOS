import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MARKET_RESEARCH_SYMBOLS,
  classifySymbols,
  isHighImportanceHeadline,
  limitIndonesianOrigin,
} from '../src/lib/market-research-sources';
import { validateAndHydrateMarketResearchSelection } from '../src/lib/market-research';

test('symbol taxonomy covers the sharpened product list', () => {
  assert.deepEqual(MARKET_RESEARCH_SYMBOLS.Forex, ['AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'JPY', 'NZD', 'USD', 'IDR']);
  assert.deepEqual(MARKET_RESEARCH_SYMBOLS.Commodity, ['XAUUSD', 'WTI']);
  assert.deepEqual(MARKET_RESEARCH_SYMBOLS['US Indices'], ['DJIA', 'SPX', 'NDX']);
  assert.deepEqual(MARKET_RESEARCH_SYMBOLS['US Stocks'], ['US Stocks']);
});

test('classifies headlines to exact symbols and rejects Antam retail gold pricing', () => {
  assert.deepEqual(classifySymbols('Fed holds rates, dollar index climbs'), ['USD']);
  assert.deepEqual(classifySymbols('Gold XAU/USD hits record after CPI'), ['XAUUSD']);
  assert.deepEqual(classifySymbols('WTI crude rises on OPEC+ supply cut'), ['WTI']);
  assert.deepEqual(classifySymbols('Nasdaq 100 rallies as Nvidia earnings beat'), ['NDX']);
  assert.deepEqual(classifySymbols('Harga emas Antam hari ini naik Rp10.000'), []);
  assert.deepEqual(classifySymbols('Rupiah menguat terhadap dolar AS'), ['IDR']);
});

test('keeps only high-importance economic categories', () => {
  assert.equal(isHighImportanceHeadline('US nonfarm payrolls beat forecasts'), true);
  assert.equal(isHighImportanceHeadline('BoJ governor speech signals policy shift'), true);
  assert.equal(isHighImportanceHeadline('10-year Treasury yields jump after auction'), true);
  assert.equal(isHighImportanceHeadline('Housing starts rebound in August'), true);
  assert.equal(isHighImportanceHeadline('Analyst predicts gold could reach 4000'), false);
});

test('allows at most one Indonesian-origin article', () => {
  const rows = [
    { url: 'a', origin: 'indonesia' as const },
    { url: 'b', origin: 'indonesia' as const },
    { url: 'c', origin: 'international' as const },
    { url: 'd', origin: 'international' as const },
  ];
  const kept = limitIndonesianOrigin(rows);
  assert.equal(kept.filter(row => row.origin === 'indonesia').length, 1);
  assert.equal(kept.length, 3);
});

test('selection accepts up to ten items and rejects duplicate symbols', () => {
  const topics = [
    'nonfarm payrolls release',
    'consumer price index print',
    'treasury auction demand',
    'building permits report',
    'michigan sentiment survey',
    'ism manufacturing index',
    'quarterly gdp revision',
    'governor policy testimony',
    'bond yield curve shift',
    'retail sales breakdown',
  ];
  const candidates = topics.map((topic, index) => ({
    id: `id${index}`,
    outlet: 'Reuters',
    title: `${topic} ${MARKET_RESEARCH_SYMBOLS.Forex[index % 9]}`,
    url: `https://www.reuters.com/markets/story-${index}`,
    publishedAt: '2026-09-03T09:30',
    updatedAt: null,
    categories: ['Forex' as const],
    symbols: [MARKET_RESEARCH_SYMBOLS.Forex[index % 9]],
    origin: 'international' as const,
    importanceCategory: 'Central Bank',
    evidence: `Publisher RSS headline: ${topic} data confirmed.`,
    evidenceLevel: 'publisher-metadata' as const,
  }));

  const item = (index: number) => ({
    candidateId: `id${index}`,
    eventKey: `${topics[index]}-confirmed-${MARKET_RESEARCH_SYMBOLS.Forex[index % 9]}`.toLowerCase(),
    productCategory: 'Forex',
    symbol: candidates[index].symbols[0],
    mainEvent: `Rilis ${topics[index]} resmi terkonfirmasi otoritas.`,
    latestFactualDevelopment: `Rincian ${topics[index]} dipublikasikan sesuai jadwal.`,
    marketRelevance: `Menggerakkan ekspektasi ${topics[index]} bagi trader.`,
  });

  const nine = validateAndHydrateMarketResearchSelection(
    { items: Array.from({ length: 9 }, (_, index) => item(index)) },
    candidates,
  );
  assert.equal(nine.items.length, 9);
  assert.equal(nine.items[0].symbol, 'AUD');

  // topic 9 reuses AUD (index 9 % 9 === 0) -> duplicate symbol must be rejected.
  assert.throws(
    () => validateAndHydrateMarketResearchSelection({ items: [item(0), item(9)] }, candidates),
    /same symbol/i,
  );
  assert.throws(
    () => validateAndHydrateMarketResearchSelection(
      { items: Array.from({ length: 11 }, (_, index) => item(index % 10)) },
      candidates,
    ),
    /maximum of ten/i,
  );
});

test('history reads Market Research through a server-side type filter', async () => {
  const source = await readFile(resolve('src/app/dashboard/history/page.tsx'), 'utf8');
  assert.match(source, /type=\$\{encodeURIComponent\(typeFilter\)\}/);
  assert.doesNotMatch(source, /tasks\.filter\(task => task\.type === typeFilter\)/);
  assert.match(source, /res\.ok|response\.ok/);
});
