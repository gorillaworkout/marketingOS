import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  countArticleWords,
  normalizeArticleMarketNewsInput,
  repairArticleCitations,
  repairArticleStructure,
  validateGeneratedArticle,
} from '../src/lib/article-market-news';

const paaQuestions = [
  'Apa yang memengaruhi S&P 500 hari ini?',
  'Mengapa saham teknologi menekan S&P 500?',
  'Bagaimana suku bunga memengaruhi S&P 500?',
  'Apakah S&P 500 akan naik minggu ini?',
  'Apa risiko trading indeks S&P 500?',
];

const sources = [
  {
    outlet: 'Reuters',
    title: 'S&P 500 slips as tech weighs',
    url: 'https://www.reuters.com/markets/us/sp500-2026-11-13/',
    publishedAt: '2026-11-13T21:35',
    verifiedFacts: 'Open-web full-page excerpt: The S&P 500 fell 0,8% to 6.512,4 points on Thursday as technology shares weighed on the index.',
  },
  {
    outlet: 'Kontan',
    title: 'Wall Street melemah',
    url: 'https://investasi.kontan.co.id/news/wall-street-melemah',
    publishedAt: '2026-11-13T22:10',
    verifiedFacts: 'Wall Street ditutup melemah karena investor menunggu data inflasi dan sinyal suku bunga dari The Fed.',
  },
];

const input = normalizeArticleMarketNewsInput({
  keyword: 'S&P 500',
  researchDate: '2026-11-14',
  angle: 'Tekanan saham teknologi dan respons trader.',
  competitorHeadings: Array.from({ length: 5 }, (_, i) => `Competitor ${i + 1}:\nH1: S&P 500\nH2: Faktor\nH3: Risiko`).join('\n\n'),
  paaQuestions,
  noCompetitorBroker: true,
  factsVerified: true,
  sources: sources.map(source => ({ ...source, publishedAt: source.publishedAt.replace('2026-11-13', '2026-11-14') })),
}, '2026-11-14');

const TITLE = 'S&P 500 Melemah karena Saham Teknologi';
const filler = (n: number) => Array.from({ length: n }, () => 'pasar').join(' ');
const cta = 'Buka akun Dupoin untuk memantau pergerakan pasar dengan pengelolaan risiko.';
const cited = 'Indeks S&P 500 turun 0,8% ke 6.512,4 poin (Reuters, 14 Nov 2026), sementara investor menunggu data inflasi (Kontan, 14 Nov 2026).';

/** A weak-model draft with every production failure at once. */
function brokenDraft(): string {
  return [
    '# Wall Street Hari Ini',
    '',
    'Pasar saham Amerika bergerak hati-hati pada akhir pekan.',
    '',
    cited,
    '',
    '# Analisis Teknikal',
    filler(700),
    '',
    `## ${paaQuestions[0]}`,
    'Saham teknologi menekan indeks karena investor menunggu data inflasi.',
    '',
    `## ${paaQuestions[0]}`,
    'Jawaban duplikat.',
    '',
    '## Mengapa saham teknologi menekan indeks S&P 500?',
    'Valuasi tinggi membuat saham teknologi sensitif terhadap suku bunga.',
    '',
    '## Apa kata analis?',
    'Analis menilai pasar menunggu sinyal The Fed.',
    '',
    cta,
    '',
    '## Sources',
    'Reuters — https://www.reuters.com/markets/us/sp500-2026-11-13/',
  ].join('\n');
}

test('fixture reproduces the four structure failures from production', () => {
  const result = validateGeneratedArticle(TITLE, brokenDraft(), input);
  assert.ok(result.violations.includes('Article Markdown must contain exactly one H1 matching the title.'));
  assert.ok(result.violations.includes('Use exactly the five supplied PAA questions, once each and verbatim, as question headings.'));
  assert.ok(result.violations.includes('Main keyword is missing from the first prose paragraph.'));
  assert.ok(result.violations.includes('Every reference outlet, publication date, and URL must be listed in the Sources section.'));
});

test('structure repair fixes H1, PAA headings, keyword lead and Sources deterministically', () => {
  const { markdown, repairs } = repairArticleStructure(TITLE, brokenDraft(), input);
  const result = validateGeneratedArticle(TITLE, markdown, input);
  assert.deepEqual(result.violations, []);
  assert.ok(repairs.length >= 4);
  const h1 = markdown.match(/^# .+$/gm) || [];
  assert.deepEqual(h1, [`# ${TITLE}`]);
  assert.match(markdown, /^## Analisis Teknikal$/m);
  for (const question of paaQuestions) {
    assert.equal(markdown.split('\n').filter(line => line === `## ${question}` || line === `### ${question}`).length, 1, question);
  }
  assert.doesNotMatch(markdown, /^##+ Mengapa saham teknologi menekan indeks S&P 500\?$/m);
  assert.doesNotMatch(markdown, /^##+ Apa kata analis\?$/m);
  assert.doesNotMatch(markdown, /Jawaban duplikat/);
  // The CTA stays the last prose paragraph before Sources.
  assert.match(markdown, new RegExp(`${cta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n## Sources`));
  const sourcesSection = markdown.slice(markdown.indexOf('## Sources'));
  for (const source of input.sources) {
    assert.ok(sourcesSection.includes(source.outlet));
    assert.ok(sourcesSection.includes(source.url));
    assert.ok(sourcesSection.includes(source.publishedAt.slice(0, 10)));
  }
  // Idempotent.
  assert.equal(repairArticleStructure(TITLE, markdown, input).markdown, markdown);
});

test('structure repair inserts a missing title H1 and keeps question headings intact after citation repair', () => {
  const draft = brokenDraft().replace('# Wall Street Hari Ini\n\n', '');
  const citations = repairArticleCitations(draft, input.sources);
  assert.match(citations.markdown, new RegExp(`^## ${paaQuestions[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), 'citation repair must not glue headings to prose');
  const { markdown } = repairArticleStructure(TITLE, citations.markdown, { ...input, sources: citations.sources });
  assert.ok(markdown.startsWith(`# ${TITLE}\n\n`));
  assert.deepEqual(validateGeneratedArticle(TITLE, markdown, { ...input, sources: citations.sources }).violations, []);
});

test('the numeric check ignores date fragments, times, URLs and citations', () => {
  const draft = repairArticleStructure(TITLE, brokenDraft(), input).markdown.replace(
    cited,
    `${cited} Data per 2026-11-13 pukul 21:35 WIB, diperbarui 2026-11-10, 2026-11-12, 2026-11-11, 2026-11-09, 2026-11-08, 2026-11-07 dan 13/11/2026 serta 17 November 2026; lihat https://example.com/2026-11-17/a-35.`,
  );
  const result = validateGeneratedArticle(TITLE, draft, input);
  assert.deepEqual(result.unsupportedNumbers, []);
});

test('the numeric check matches Indonesian and English number formats', () => {
  const base = repairArticleStructure(TITLE, brokenDraft(), input).markdown;
  const english = base.replace('turun 0,8% ke 6.512,4 poin', 'turun 0.8% ke 6,512.4 poin');
  assert.deepEqual(validateGeneratedArticle(TITLE, english, input).unsupportedNumbers, []);
  const yen = normalizeArticleMarketNewsInput({
    keyword: 'USD/JPY',
    researchDate: '2026-11-14',
    angle: 'Yen melemah.',
    competitorHeadings: Array.from({ length: 5 }, (_, i) => `Competitor ${i + 1}:\nH1: USD/JPY\nH2: Faktor\nH3: Risiko`).join('\n\n'),
    paaQuestions: paaQuestions.map(q => q.replace(/S&P 500/g, 'USD/JPY')),
    noCompetitorBroker: true,
    factsVerified: true,
    sources: [{ ...input.sources[0], verifiedFacts: 'Open-web search snippet: USD/JPY traded at 157.72 after the Bank of Japan meeting.' }],
  }, '2026-11-14');
  const yenTitle = 'USD/JPY Bertahan di Atas 157';
  const yenDraft = `# ${yenTitle}\n\nUSD/JPY bergerak di 157,72 (Reuters, 14 Nov 2026).\n\n${filler(820)}\n\n${cta}\n\n## Sources`;
  const yenResult = validateGeneratedArticle(yenTitle, yenDraft, yen);
  assert.ok(!yenResult.unsupportedNumbers.includes('157,72'));
  // A number truly absent from the sources is still flagged.
  const invented = base.replace('turun 0,8%', 'turun 3,9%');
  assert.ok(validateGeneratedArticle(TITLE, invented, input).unsupportedNumbers.includes('3,9%'));
});

test('a real problem the repair cannot fix still fails the gate', () => {
  const short = repairArticleStructure(TITLE, `# ${TITLE}\n\n${cited}\n\n${cta}\n\n## Sources`, input).markdown;
  assert.ok(countArticleWords(short) < 800);
  assert.ok(validateGeneratedArticle(TITLE, short, input).violations.some(v => /too short/.test(v)));
});

test('the route runs structure repair as the last step before the gate', () => {
  const route = readFileSync('src/app/api/article-market-news/generate/route.ts', 'utf8');
  const repairAt = route.lastIndexOf('repairArticleStructure(');
  const gateAt = route.indexOf('validation = validateGeneratedArticle(');
  assert.ok(repairAt > 0 && repairAt < gateAt);
  assert.ok(route.indexOf('fitArticleMarkdownWordCount(') < repairAt);
  assert.ok(route.indexOf('repairArticleCitations(') < repairAt);
});
