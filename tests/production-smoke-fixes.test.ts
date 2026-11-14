import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runWithModelFallback } from '../src/lib/model-fallback.ts';
import { authFailoverNotice, isAuthFailure, resetAuthCooldownForTests } from '../src/lib/llm-auth.ts';
import { classifyModelProbe } from '../src/lib/llm-provider.ts';
import { marketNewsCatalogNotice, combineMarketNewsTopics, MARKET_NEWS_TOPICS } from '../src/lib/market-news-topics.ts';
import { extractHashtags } from '../src/lib/social-post-brief.ts';
import { runQC } from '../src/lib/openai.ts';
import { PSI_QUOTA_MESSAGE, psiErrorMessage } from '../src/lib/seo/audit-psi.ts';

test('a 401 from the primary model fails over and explains the switch', async () => {
  resetAuthCooldownForTests();
  const tried: string[] = [];
  const outcome = await runWithModelFallback({
    chosenModel: 'cc/claude-sonnet-5-5',
    attempt: async model => {
      tried.push(model);
      if (model === 'cc/claude-sonnet-5-5') throw new Error('API error 401: authentication_error oauth token expired');
      return 'draft';
    },
  });
  assert.deepEqual(tried, ['cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol']);
  assert.equal(outcome.result, 'draft');
  assert.match(outcome.label || '', /Claude Sonnet 5\.5 token expired — switched to GPT-5\.6 Sol/);
  assert.match(outcome.label || '', /Please re-authenticate Claude Sonnet 5\.5 in AI Models/);
  assert.equal(authFailoverNotice('Claude Sonnet 5.5', 'GPT-5.6 Sol'), outcome.label);
  const skipped: string[] = [];
  await runWithModelFallback({
    chosenModel: 'cc/claude-sonnet-5-5',
    attempt: async model => {
      skipped.push(model);
      return 'next';
    },
  });
  assert.equal(skipped.includes('cc/claude-sonnet-5-5'), false);
  resetAuthCooldownForTests();
});

test('a 503 that wraps a 401 is an auth failure and the models page can badge it', () => {
  assert.equal(isAuthFailure(401, '{"error":{"type":"authentication_error"}}'), true);
  assert.equal(isAuthFailure(503, 'upstream returned 401 authentication_error'), true);
  assert.equal(isAuthFailure(503, 'gateway timeout'), false);
  assert.equal(classifyModelProbe(401, 'authentication_error'), 'auth_expired');
  const page = readFileSync('src/app/dashboard/models/page.tsx', 'utf8');
  assert.match(page, /Auth expired/);
});

test('caption hashtags count #dupoin inside the caption', () => {
  assert.deepEqual(extractHashtags('Trade with clarity #dupoin #Emas_2026'), ['#dupoin', '#Emas_2026']);
  const qc = runQC('Trade with clarity today #dupoin', [], 'Twitter/X');
  const check = qc.checks.find(item => item.name === 'hashtag_count');
  assert.match(check?.detail || '', /^1 hashtags/);
});

test('silver stays a research topic and the catalog note does not stop the draft', () => {
  const notice = marketNewsCatalogNotice('harga perak + Apple (AAPL)');
  assert.match(notice || '', /Silver/);
  assert.match(notice || '', /Apple/);
  assert.match(notice || '', /does not stop the draft/);
  const silver = MARKET_NEWS_TOPICS.find(topic => topic.id === 'silver');
  const apple = MARKET_NEWS_TOPICS.find(topic => topic.id === 'apple');
  assert.equal(combineMarketNewsTopics([silver!, apple!]), 'harga perak + Apple (AAPL)');
  const route = readFileSync('src/app/api/article-market-news/generate/route.ts', 'utf8');
  assert.match(route, /: keepalive/);
  assert.match(route, /step: 'notice'/);
});

test('PageSpeed 429 uses the quota message and keyword gap refreshes finished runs', () => {
  assert.equal(psiErrorMessage(429), PSI_QUOTA_MESSAGE);
  assert.match(PSI_QUOTA_MESSAGE, /add PAGESPEED_API_KEY or retry later/);
  const audit = readFileSync('src/lib/seo/audit-run.ts', 'utf8');
  assert.match(audit, /quotaExceeded = true/);
  const gap = readFileSync('src/app/dashboard/seo/keyword-gap/page.tsx', 'utf8');
  assert.match(gap, /else void loadList\(shownDomain\)/);
  const content = readFileSync('src/app/dashboard/seo/content/page.tsx', 'utf8');
  assert.match(content, /Site: \$\{site\.name\}/);
});
