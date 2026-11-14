import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  enforceMetaText,
  headingWarnings,
  META_DESCRIPTION_MAX,
  META_TITLE_MAX,
  parseSubkeywords,
  subkeywordCoverage,
} from '../src/lib/seo/content-studio.ts';
import { buildDraftPrompt, parseCreateRequest, parseDraftOutput } from '../src/lib/seo/content-prompt.ts';
import { markdownToHtml, renderHtmlExport } from '../src/lib/seo/markdown.ts';

test('subkeywords are trimmed, unique, and capped', () => {
  const keywords = parseSubkeywords([' Gold ', 'gold', 'a'.repeat(50), 'silver', 'oil', 'fx', 'bonds', 'rates', 'crypto', 'extra']);
  assert.equal(keywords.length, 8);
  assert.equal(keywords[0], 'Gold');
  assert.equal(keywords[1].length, 40);
  assert.equal(keywords.includes('extra'), false);
});

test('meta title and description stay inside the limits', () => {
  assert.equal(enforceMetaText('  hello  ', META_TITLE_MAX), 'hello');
  assert.equal(enforceMetaText('x'.repeat(80), META_TITLE_MAX).length, META_TITLE_MAX);
  assert.equal(enforceMetaText('y'.repeat(200), META_DESCRIPTION_MAX).length, META_DESCRIPTION_MAX);
  const parsed = parseDraftOutput(JSON.stringify({ title: 'T'.repeat(90), meta_description: 'M'.repeat(180), body_markdown: '# Article' }), 'gold');
  assert.equal(parsed.title.length, META_TITLE_MAX);
  assert.equal(parsed.metaDescription.length, META_DESCRIPTION_MAX);
});

test('heading hierarchy warns without blocking a valid article', () => {
  assert.deepEqual(headingWarnings('# Title\n\n## Section\n\n### Detail\n\n#### Note'), []);
  const warnings = headingWarnings('## Missing\n\n# One\n\n# Two\n\n#### Skip');
  assert.equal(warnings.some(warning => warning.includes('more than one H1')), true);
  assert.equal(warnings.some(warning => warning.includes('skips')), true);
});

test('subkeyword coverage checks headings and body', () => {
  const coverage = subkeywordCoverage('# Gold price\n\nSilver is steady.', ['gold', 'silver', 'oil']);
  assert.equal(coverage[0].inHeading, true);
  assert.equal(coverage[1].covered, true);
  assert.equal(coverage[1].inHeading, false);
  assert.equal(coverage[2].covered, false);
});

test('intent, language, and tables change the prompt', () => {
  const parsed = parseCreateRequest({ keyword: 'gold', intent: 'transactional', language: 'en', includeTable: true, subkeywords: '["xauusd"]' });
  assert.ok(!('error' in parsed));
  if ('error' in parsed) return;
  const prompt = buildDraftPrompt({
    siteName: 'Dupoin', siteUrl: 'https://dupoin.com', keyword: parsed.keyword,
    caseStudy: null, targetPageUrl: null, intent: parsed.intent, language: parsed.language,
    includeTable: parsed.includeTable, subkeywords: parsed.subkeywords,
  });
  assert.deepEqual(parsed.subkeywords, ['xauusd']);
  assert.match(prompt.user, /transactional/);
  assert.match(prompt.user, /English/);
  assert.match(prompt.user, /Markdown table/);
  assert.match(prompt.user, /xauusd/);
  assert.match(prompt.system, /exactly one H1/);
});

test('markdown tables render as HTML for preview and ICA export', () => {
  const html = markdownToHtml('| Plan | Price |\n| --- | --- |\n| Starter | 10 |');
  assert.match(html, /<table><thead><tr><th>Plan<\/th><th>Price<\/th><\/tr><\/thead><tbody><tr><td>Starter<\/td><td>10<\/td><\/tr><\/tbody><\/table>/);
  const exported = renderHtmlExport({ title: 'Plans', slug: 'plans', meta_description: 'Compare plans', body_markdown: '| Plan | Price |\n| --- | --- |\n| Starter | 10 |' });
  assert.match(exported, /<table>/);
  assert.match(exported, /<h1>Plans<\/h1>/);
  assert.match(exported, /<title>Plans<\/title>/);
  assert.match(exported, /<meta name="description" content="Compare plans">/);
});

test('Content Studio form and export keep the new fields', () => {
  const form = readFileSync(new URL('../src/app/dashboard/seo/content/page.tsx', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../src/lib/seo/content-store.ts', import.meta.url), 'utf8');
  assert.match(form, /Include table/);
  assert.match(form, /Audience language/);
  assert.match(store, /subkeywords/);
});
