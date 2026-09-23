import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildArticleMarketNewsPrompts, DUPOIN_ACCOUNT_CTA_SENTENCE, ensureEndingDupoinAccountCta, normalizeArticleMarketNewsInput, normalizeResearchUrl, parseGeneratedArticle, repairLooseJson, validateGeneratedArticle } from '../src/lib/article-market-news';
import { articleDocxFilename, buildArticleDocxBlob } from '../src/lib/article-market-news-docx';

const read = (relative: string) => {
  const file = path.join(process.cwd(), relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

const page = read('src/app/dashboard/sop/page.tsx');
const generator = read('src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx');
const route = read('src/app/api/article-market-news/generate/route.ts');
const openai = read('src/lib/openai.ts');
const historyPage = read('src/app/dashboard/history/page.tsx');
const articleHistoryMigration = read('db/migrations/007_article_market_news_history.sql');

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
  return `# Harga Emas dan Permintaan Pasar\n\n${lead}\n\n## Analisis Pasar\n${body}\n\n${faqs}\n\nBuka akun Dupoin untuk memantau peluang pasar dengan pengelolaan risiko.\n\n## Sources\nKontan — 2026-07-27 — https://investasi.kontan.co.id/news/harga-emas`;
}

test('parses article JSON wrapped in reasoning prose or markdown fences', () => {
  const article = {
    title: 'Harga Emas Hari Ini',
    metaDescription: 'Ringkasan harga emas.',
    articleMarkdown: '# Harga Emas Hari Ini\n\nIsi dengan {kurung} literal.',
  };
  const json = JSON.stringify(article);

  assert.deepEqual(parseGeneratedArticle(json), article);
  const withLiteralFence = { ...article, articleMarkdown: '# Harga Emas\n\n```json\n{"example":true}\n```' };
  assert.deepEqual(parseGeneratedArticle(JSON.stringify(withLiteralFence)), withLiteralFence);
  assert.deepEqual(parseGeneratedArticle(`\uFEFF<think>draft analysis</think>\n\`\`\`json\n${json}\n\`\`\``), article);
  assert.deepEqual(parseGeneratedArticle(`Here is the revised draft:\n${json}\nDone.`), article);
  assert.deepEqual(parseGeneratedArticle(`Reasoning metadata: {}\nFinal answer:\n${json}`), article);
  assert.deepEqual(parseGeneratedArticle(`Sure.\n\`\`\`json\n${json}\n\`\`\`\nThanks.`), article);

  const aliased = {
    Title: 'Harga Emas Hari Ini',
    meta_description: 'Ringkasan harga emas.',
    article_markdown: '# Harga Emas Hari Ini\n\nIsi dengan {kurung} literal.',
  };
  const aliasedParsed = parseGeneratedArticle(JSON.stringify(aliased));
  assert.equal(aliasedParsed.title, article.title);
  assert.equal(aliasedParsed.metaDescription, article.metaDescription);
  assert.equal(aliasedParsed.articleMarkdown, article.articleMarkdown);

  const escaped = { ...article, articleMarkdown: '# Harga Emas Hari Ini\n\nDia berkata "aman" di C:\\\\drafts\\{final\\}.' };
  assert.deepEqual(
    parseGeneratedArticle(`<think>{"title":"Draft","metaDescription":"Draft","articleMarkdown":"# Draft"}</think>\nFinal answer:\n${JSON.stringify(escaped)}`),
    escaped,
  );
  assert.deepEqual(parseGeneratedArticle(`${json}\n${json}`), article);
  assert.throws(() => parseGeneratedArticle(`${json}\n${JSON.stringify(escaped)}`), /ambiguous article format/i);
  assert.throws(() => parseGeneratedArticle('no JSON object here'), /invalid article format/i);
  assert.throws(() => parseGeneratedArticle('metadata only: {"status":"ready"}'), /invalid article format/i);
});

test('parses Claude-style almost-JSON with raw newlines, interior quotes, and trailing commas', () => {
  const article = {
    title: 'Harga Emas Hari Ini',
    metaDescription: 'Ringkasan harga emas untuk trader pemula.',
    articleMarkdown: '# Harga Emas Hari Ini\n\nDia berkata "aman" di pasar.\n\n## Sources\nKontan',
  };

  // Claude often pretty-prints articleMarkdown with literal newlines + unescaped quotes.
  const claudeShaped = `{
  "title": "${article.title}",
  "metaDescription": "${article.metaDescription}",
  "articleMarkdown": "# Harga Emas Hari Ini

Dia berkata "aman" di pasar.

## Sources
Kontan",
  "excerpt": "Ringkasan singkat",
}`;

  assert.throws(() => JSON.parse(claudeShaped), SyntaxError);
  assert.deepEqual(parseGeneratedArticle(claudeShaped), {
    title: article.title,
    metaDescription: article.metaDescription,
    articleMarkdown: article.articleMarkdown,
    excerpt: 'Ringkasan singkat',
  });

  const fencedClaude = `<think>drafting</think>\n\`\`\`json\n${claudeShaped}\n\`\`\``;
  assert.equal(parseGeneratedArticle(fencedClaude).articleMarkdown, article.articleMarkdown);

  const repaired = repairLooseJson(claudeShaped);
  assert.doesNotThrow(() => JSON.parse(repaired));
  assert.match(repaired, /\\"aman\\"/);
  assert.doesNotMatch(repaired, /,\s*}/);
});

test('recovers required fields from truncated Claude article JSON', () => {
  const truncated = `{
  "title": "Harga Emas Hari Ini",
  "metaDescription": "Ringkasan harga emas hari ini untuk pemula.",
  "articleMarkdown": "# Harga Emas Hari Ini

Paragraf pembuka yang cukup panjang untuk lolos ambang recovery.
## Analisis
Masih terpotong tanpa penutup`;
  assert.throws(() => JSON.parse(truncated), SyntaxError);
  const parsed = parseGeneratedArticle(truncated);
  assert.equal(parsed.title, 'Harga Emas Hari Ini');
  assert.equal(parsed.metaDescription, 'Ringkasan harga emas hari ini untuk pemula.');
  assert.match(String(parsed.articleMarkdown), /Paragraf pembuka/);
});

test('system prompt requires a bare JSON object response', () => {
  const input = normalizeArticleMarketNewsInput(rawInput, '2026-07-27');
  const { systemPrompt, userPrompt } = buildArticleMarketNewsPrompts(input);
  assert.match(systemPrompt, /no markdown fences/i);
  assert.match(systemPrompt, /first character of the response must be "\{"/i);
  assert.match(systemPrompt, /Encode every newline inside string values as \\n/i);
  assert.match(systemPrompt, /Escape every double quote inside string values as \\"/i);
  assert.match(systemPrompt, /immediately before the Sources or Sumber heading/i);
  assert.match(systemPrompt, /Buka, Mulai, Daftar, or Buat/);
  assert.match(systemPrompt, /Do not add prices, percentages, dates, or other numbers to the CTA/);
  assert.match(systemPrompt, new RegExp(DUPOIN_ACCOUNT_CTA_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(userPrompt, /last prose paragraph immediately before the Sources or Sumber heading/i);
});

test('page exposes the admin Article Market News generation workflow', () => {
  assert.match(generator, /Publication Time \(WIB\)/);
  assert.match(generator, /type="time"/);
  assert.match(generator, /Tanggal otomatis mengikuti Research Date/);
  assert.match(generator, /`\$\{researchDate\}T\$\{event\.target\.value\}`/);
  assert.doesNotMatch(generator, /type="datetime-local"/);
  assert.match(page, /ArticleMarketNewsGenerator/);
  assert.match(generator, /Generate Article/i);
  assert.match(generator, /exactly 5 articles/i);
  assert.match(generator, /People Also Ask/);
  assert.match(generator, /Verified Facts/);
});

test('route is feature-gated, gateway-routed, evidence-gated, and never fetches submitted URLs', () => {
  assert.match(route, /requireFeature\(request, 'article-market-news'\)/);
  assert.match(route, /parseGeneratedArticle\(generated\.content\)/);
  assert.match(route, /buildRepairPrompt\(/);
  assert.match(route, /getUserPreferredModel\(auth\.id, 'article-market-news'\)/);
  assert.doesNotMatch(route, /getModelProvider|codexTextOnly|gpt-5\.6-sol/);
  assert.match(route, /temperature: 0\.3/);
  assert.match(route, /jsonRepairAttempts: 0/);
  assert.match(route, /attempt <= 3/);
  assert.match(openai, /jsonRepairAttempts \?\? 1\) === 0/);
  assert.match(route, /ensureEndingDupoinAccountCta\(/);
  assert.match(route, /RETRY FEEDBACK FROM THE DETERMINISTIC PUBLICATION GATE/);
  assert.match(route, /Do not invent prices, percentages, dates, or other numbers/);
  assert.match(route, /Do not revise broken text/);
  assert.match(route, /Encode newlines as/);
  assert.match(route, /metaDescription\.length > 155/);
  assert.match(route, /validateGeneratedArticle/);
  assert.doesNotMatch(route, /fetchResearchSource|fetch\(source\.url/);
  assert.match(openai, /GORILLAWORKOUT_API_BASE/);
  assert.doesNotMatch(openai, /child_process|OPENROUTER_API_KEY/);
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

test('user references are optional because the server always performs automated research', () => {
  const withoutReferences = normalizeArticleMarketNewsInput({
    ...rawInput,
    sources: [],
    noCompetitorBroker: false,
    factsVerified: false,
  }, '2026-07-27');
  assert.deepEqual(withoutReferences.sources, []);
  assert.match(route, /researchArticleMarketNews/);
  assert.match(route, /automatedSources/);
  assert.match(route, /sources: \[\.\.\.automatedSources, \.\.\.input\.sources\]/);
  assert.match(generator, /Reference Articles \(Optional\)/i);
  assert.match(generator, /Isi contoh/i);
  assert.match(generator, /Lihat contoh input/);
  assert.doesNotMatch(generator, /sources\.length >= 1/);
});

test('successful articles are persisted and downloadable again from History', () => {
  assert.match(articleHistoryMigration, /article-market-news/);
  assert.match(route, /INSERT INTO tasks/);
  assert.match(route, /'article-market-news'/);
  assert.match(route, /historyId/);
  assert.match(historyPage, /article-market-news/);
  assert.match(historyPage, /buildArticleDocxBlob/);
  assert.match(historyPage, /Article Market News/);
  assert.match(historyPage, /Download DOCX/);
  assert.match(generator, /\/api\/dashboard\/history\?type=\$\{ARTICLE_MARKET_NEWS_HISTORY_TYPE\}/);
  assert.match(generator, /restoreArticleMarketNews/);
  assert.match(generator, /Recent Generated/);
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

test('publication gate accepts a Dupoin CTA before Sources and rejects a missing or soft ending', () => {
  const input = normalizeArticleMarketNewsInput(rawInput, '2026-07-27');
  const cta = 'Buka akun Dupoin untuk memantau peluang pasar dengan pengelolaan risiko.';
  const sourcesLast = [
    '# Harga Emas dan Permintaan Pasar',
    'Harga Emas dibahas menurut Kontan pada 27 Juli 2026.',
    cta,
    '## Sources',
    'Kontan — 2026-07-27 — https://investasi.kontan.co.id/news/harga-emas',
  ].join('\n\n');
  const lastBlock = sourcesLast.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean).at(-1) || '';
  assert.equal(lastBlock.startsWith('#'), false);
  assert.doesNotMatch(lastBlock, /Buka akun Dupoin/);
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', sourcesLast, input).qc.dupoinCtaIncluded, true);

  const sumberHeading = sourcesLast.replace('## Sources', '## Sumber');
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', sumberHeading, input).qc.dupoinCtaIncluded, true);

  const missingCta = sourcesLast.replace(`${cta}\n\n`, '');
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', missingCta, input).qc.dupoinCtaIncluded, false);

  const softEnding = sourcesLast.replace(cta, 'Pembaca dapat mempertimbangkan akun Dupoin sesuai kebutuhan masing-masing.');
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', softEnding, input).qc.dupoinCtaIncluded, false);

  const legacyAfterSources = sourcesLast.replace(`${cta}\n\n`, '') + `\n\n${cta}`;
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', legacyAfterSources, input).qc.dupoinCtaIncluded, true);

  const repaired = ensureEndingDupoinAccountCta(missingCta);
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', repaired, input).qc.dupoinCtaIncluded, true);
  assert.match(repaired, new RegExp(`${DUPOIN_ACCOUNT_CTA_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n## Sources`));
  assert.doesNotMatch(DUPOIN_ACCOUNT_CTA_SENTENCE, /\d/);
  assert.equal(repaired.slice(repaired.indexOf('## Sources')), missingCta.slice(missingCta.indexOf('## Sources')));
  assert.equal(ensureEndingDupoinAccountCta(repaired), repaired);
  assert.equal(ensureEndingDupoinAccountCta(sourcesLast), sourcesLast);
  const repairedSoft = ensureEndingDupoinAccountCta(softEnding);
  assert.match(repairedSoft, /Pembaca dapat mempertimbangkan akun Dupoin sesuai kebutuhan masing-masing\.\n\nBuka akun Dupoin/);
  assert.equal(validateGeneratedArticle('Harga Emas dan Permintaan Pasar', repairedSoft, input).qc.dupoinCtaIncluded, true);
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
  assert.match(generator, /setGeneratedInput\(\(event\.result as ArticleResult\)\.normalizedInput \|\| requestInput\)/);
  assert.match(route, /normalizedInput: effectiveInput/);
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
