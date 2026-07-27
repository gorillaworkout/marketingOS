import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeArticleMarketNewsInput, normalizeResearchUrl, validateGeneratedArticle } from '../src/lib/article-market-news';
import { articleDocxFilename, buildArticleDocxBlob } from '../src/lib/article-market-news-docx';
import { buildCodexTextOnlyArgs } from '../src/lib/openai';

const read = (relative: string) => {
  const file = path.join(process.cwd(), relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

const page = read('src/app/dashboard/sop/page.tsx');
const generator = read('src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx');
const route = read('src/app/api/article-market-news/generate/route.ts');
const openai = read('src/lib/openai.ts');

const competitorHeadings = Array.from({ length: 5 }, (_, index) => `Competitor ${index + 1}:\nH1: Harga Emas\nH2: Faktor Utama\nH3: Risiko Pasar`).join('\n\n');
const rawInput = {
  keyword: 'Harga Emas',
  researchDate: '2026-07-27',
  angle: 'Permintaan emas dan respons trader.',
  competitorHeadings,
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
  }],
};

function compliantArticle(): string {
  const lead = 'Harga Emas menjadi perhatian pelaku pasar berdasarkan fakta yang telah diverifikasi operator dari laporan Kontan pada 2026-07-27.';
  const body = Array.from({ length: 770 }, () => 'pasar').join(' ');
  const faqs = rawInput.paaQuestions.map(question => `## ${question}\nJawaban merujuk pada fakta sumber dan menekankan disiplin risiko.`).join('\n\n');
  return `# Harga Emas dan Permintaan Pasar\n\n${lead}\n\n## Analisis Pasar\n${body}\n\n${faqs}\n\n## Sources\nKontan — 2026-07-27 — https://investasi.kontan.co.id/news/harga-emas\n\nBuka akun Dupoin untuk memantau peluang pasar dengan pengelolaan risiko.`;
}

test('page exposes the admin Article Market News generation workflow', () => {
  assert.match(page, /ArticleMarketNewsGenerator/);
  assert.match(generator, /Generate Article/);
  assert.match(generator, /exactly 5 articles/);
  assert.match(generator, /People Also Ask/);
  assert.match(generator, /Verified Facts/);
});

test('route is admin-only, Codex-only, tool-disabled, and never fetches submitted URLs', () => {
  assert.match(route, /requireAdmin\(request\)/);
  assert.match(route, /getModelProvider\(model\) !== 'codex'/);
  assert.match(route, /gpt-5\.6-sol/);
  assert.match(route, /codexTextOnly: true/);
  assert.match(route, /jsonRepairAttempts: 0/);
  assert.match(route, /attempt <= 3/);
  assert.match(openai, /jsonRepairAttempts \?\? 1\) === 0/);
  assert.match(route, /RETRY FEEDBACK FROM THE DETERMINISTIC PUBLICATION GATE/);
  assert.match(route, /metaDescription\.length > 155/);
  assert.match(route, /validateGeneratedArticle/);
  assert.doesNotMatch(route, /fetchResearchSource|fetch\(source\.url/);
  const args = buildCodexTextOnlyArgs('gpt-5.6-sol', '/tmp/empty');
  for (const feature of ['shell_tool', 'unified_exec', 'browser_use', 'computer_use', 'apps', 'plugins', 'tool_call_mcp_elicitation']) {
    assert.ok(args.some((value, index) => value === '--disable' && args[index + 1] === feature));
  }
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('read-only'));
});

test('input gate requires same-day WIB-local sources and five competitor structures', () => {
  const input = normalizeArticleMarketNewsInput(rawInput, '2026-07-27');
  assert.equal(input.sources.length, 1);
  assert.equal(input.paaQuestions.length, 5);
  assert.throws(() => normalizeArticleMarketNewsInput({ ...rawInput, competitorHeadings: 'Competitor 1:\nH1: A\nH2: B\nH3: C' }, '2026-07-27'), /exactly five/);
  assert.throws(() => normalizeArticleMarketNewsInput({ ...rawInput, competitorHeadings: competitorHeadings.split('\n\n').reverse().join('\n\n') }, '2026-07-27'), /ordered/);
  assert.throws(() => normalizeArticleMarketNewsInput({ ...rawInput, sources: [{ ...rawInput.sources[0], publishedAt: '2026-07-27T23:30:00Z' }] }, '2026-07-27'), /local WIB format/);
  assert.throws(() => normalizeArticleMarketNewsInput(rawInput, '2026-07-28'), /today in WIB/);
});

test('input gate rejects duplicate PAA, oversized facts, and missing attestation', () => {
  assert.throws(() => normalizeArticleMarketNewsInput({ ...rawInput, paaQuestions: Array(5).fill(rawInput.paaQuestions[0]) }, '2026-07-27'), /exact and unique/);
  assert.throws(() => normalizeArticleMarketNewsInput({ ...rawInput, paaQuestions: rawInput.paaQuestions.map((question, index) => index === 0 ? question.slice(0, -1) : question) }, '2026-07-27'), /ending with/);
  assert.throws(() => normalizeArticleMarketNewsInput({ ...rawInput, sources: [{ ...rawInput.sources[0], verifiedFacts: 'x'.repeat(5_001) }] }, '2026-07-27'), /character limit/);
  assert.throws(() => normalizeArticleMarketNewsInput({ ...rawInput, factsVerified: false }, '2026-07-27'), /facts and quotes were verified/);
});

test('citation URL gate rejects loopback, private, link-local, metadata, and special IPv6', () => {
  for (const url of [
    'http://127.0.0.1/a', 'http://10.0.0.1/a', 'http://169.254.169.254/latest',
    'http://192.168.1.1/a', 'http://[::1]/a', 'http://metadata.google.internal/a',
  ]) assert.throws(() => normalizeResearchUrl(url), /private|special-use/);
  assert.match(normalizeResearchUrl('https://investasi.kontan.co.id/news/a'), /^https:/);
});

test('publication gate passes a compliant article', () => {
  const input = normalizeArticleMarketNewsInput(rawInput, '2026-07-27');
  const result = validateGeneratedArticle('Harga Emas dan Permintaan Pasar', compliantArticle(), input);
  assert.deepEqual(result.violations, []);
  assert.equal(result.qc.fivePaaIncluded, true);
  assert.equal(result.qc.articleH1MatchesTitle, true);
  assert.equal(result.qc.sourcesSectionIncluded, true);
  assert.equal(result.qc.sourcesCitedInProse, true);
  assert.equal(result.qc.allSourcesCited, true);
  assert.equal(result.qc.dupoinCtaIncluded, true);
  assert.equal(result.qc.allQuotesSourceBacked, true);
  const naturalDateArticle = compliantArticle().replaceAll('2026-07-27', '27 Juli 2026');
  assert.deepEqual(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', naturalDateArticle, input).violations, []);
});

test('publication gate rejects duplicate PAA headings and a fake Dupoin mention', () => {
  const input = normalizeArticleMarketNewsInput(rawInput, '2026-07-27');
  const duplicate = compliantArticle().replace('## Sources', `## ${rawInput.paaQuestions[0]}\nJawaban duplikat.\n\n## Sources`);
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', duplicate, input).qc.fivePaaIncluded, false);
  const fakeCta = compliantArticle().replace('Buka akun Dupoin untuk memantau peluang pasar dengan pengelolaan risiko.', 'Catatan Dupoin.');
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', fakeCta, input).qc.dupoinCtaIncluded, false);
  assert.equal(validateGeneratedArticle('Harga Emas dengan Judul Berbeda', compliantArticle(), input).qc.articleH1MatchesTitle, false);
  const sourceOnlyUrl = compliantArticle().replace('Kontan — 2026-07-27 — https://investasi.kontan.co.id/news/harga-emas', 'https://investasi.kontan.co.id/news/harga-emas');
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', sourceOnlyUrl, input).qc.allSourcesCited, false);
  const missingSourcesHeading = compliantArticle().replace('## Sources', '## Referensi');
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', missingSourcesHeading, input).qc.sourcesSectionIncluded, false);
  const compactBroker = compliantArticle().replace('## Sources', 'ICMarkets disebut dalam pembahasan.\n\n## Sources');
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', compactBroker, input).qc.noCompetitorBroker, false);
  const multiSentenceCta = compliantArticle().replace('Buka akun Dupoin untuk memantau peluang pasar dengan pengelolaan risiko.', 'Buka akun Dupoin. Kalimat kedua.');
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', multiSentenceCta, input).qc.dupoinCtaIncluded, false);
  const headingCta = compliantArticle().replace('Buka akun Dupoin untuk memantau peluang pasar dengan pengelolaan risiko.', '## Buka akun Dupoin sekarang.');
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', headingCta, input).qc.dupoinCtaIncluded, false);
});

test('publication gate preserves numeric and Unicode semantics and requires verbatim quotes', () => {
  const input = normalizeArticleMarketNewsInput(rawInput, '2026-07-27');
  const unsafe = compliantArticle().replace('## Sources', 'Klaim pasar berada di 12.34, USD2500, X9, Rp９９９９, harga mencapai 2026 dolar, disebut “klaim palsu”, ‘klaim palsu yang tidak bersumber’, dan «klaim guillemet palsu».\n\n## Sources');
  const result = validateGeneratedArticle('Harga Emas dan Permintaan Pasar', unsafe, input);
  assert.equal(result.qc.allNumbersSourceBacked, false);
  assert.equal(result.qc.allQuotesSourceBacked, false);
  for (const token of ['12.34', '2500', '9', '9999', '2026']) assert.ok(result.unsupportedNumbers.includes(token));
  assert.ok(result.unsupportedQuotes.includes('klaim palsu'));
  assert.ok(result.unsupportedQuotes.includes('klaim palsu yang tidak bersumber'));
  assert.ok(result.unsupportedQuotes.includes('klaim guillemet palsu'));
  const quotedTitleArticle = compliantArticle().replace('# Harga Emas dan Permintaan Pasar', '# Harga Emas klaim palsu');
  const unsafeTitle = validateGeneratedArticle('Harga Emas «klaim palsu»', quotedTitleArticle, input);
  assert.equal(unsafeTitle.qc.articleH1MatchesTitle, true);
  assert.equal(unsafeTitle.qc.allQuotesSourceBacked, false);
  assert.ok(unsafeTitle.unsupportedQuotes.includes('klaim palsu'));
  const unsafeMeta = validateGeneratedArticle('Harga Emas dan Permintaan Pasar', compliantArticle(), input, 'Harga menuju 9999 menurut “klaim meta palsu”.');
  assert.equal(unsafeMeta.qc.allNumbersSourceBacked, false);
  assert.equal(unsafeMeta.qc.allQuotesSourceBacked, false);
});

test('editable DOCX stays tied to immutable generation snapshot and manual fact review', async () => {
  assert.match(generator, /setGeneratedInput\(requestInput\)/);
  assert.match(generator, /validateGeneratedArticle\(result\.title, result\.articleMarkdown, generatedInput, result\.metaDescription \|\| ''\)/);
  assert.match(generator, /setFactReviewConfirmed\(false\)/);
  assert.match(generator, /!factReviewConfirmed/);
  assert.match(generator, /generatedInput\.keyword/);
  assert.match(generator, /Download locked/);

  const blob = await buildArticleDocxBlob('Harga Emas dan Permintaan Pasar', 'Ringkasan artikel.', compliantArticle());
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.ok(bytes.length > 1_000);
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
  assert.equal(articleDocxFilename('Harga Emas', '2026-07-27'), 'DUPOIN_Harga_Emas_ArticleMarketNews_V1_20260727.docx');
});
