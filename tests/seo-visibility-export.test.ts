import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  aliasCollisions, buildGapReport, classifyTopic, containsCompetitor, isCombinedPrompt, narrowAliasReason, pickBrandLabel,
  rankEntities, sanitizeGapSummary, scrubCompetitors, splitQuestions, type GapInput,
} from '../src/lib/seo/visibility-gaps';
import { gapReportCsv, gapReportPdf, gapReportXlsx, pdfText, safeCell } from '../src/lib/seo/visibility-export';
import { FIXTURE_INPUT, FIXTURE_MODELS } from './fixtures/ai-visibility-gaps';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const [CLAUDE, GPT, GEMINI] = FIXTURE_MODELS;
const report = buildGapReport(FIXTURE_INPUT);

// ---------- Rank recompute ----------

test('rankEntities ranks list items and keeps configured competitors and unconfigured heads', () => {
  const text = [
    'Pilihan organisasi:',
    '1. **Rival Cheer Federation Indonesia (RCF)** – federasi.',
    '2. **Jakarta Cheer Club** – klub.',
    '3. **ICA** – asosiasi.',
  ].join('\n');
  const ranked = rankEntities(text, ['ICA'], ['RCF|Rival Cheer Federation Indonesia']);
  assert.deepEqual(ranked.map(entity => [entity.name, entity.rank, entity.isBrand, entity.configured]), [
    ['RCF', 1, false, true], ['Jakarta Cheer Club', 2, false, false], ['ICA', 3, true, true],
  ]);
});

test('rankEntities uses first-mention order for prose and ignores a brand alias inside a competitor name', () => {
  const prose = rankEntities('RCF runs events. ICA also exists.', ['ICA'], ['RCF']);
  assert.deepEqual(prose.map(entity => [entity.name, entity.rank]), [['RCF', 1], ['ICA', 2]]);
  const masked = rankEntities('Rival Cheer Federation Indonesia is active.', ['Cheer Federation Indonesia'], ['RCF|Rival Cheer Federation Indonesia']);
  assert.equal(masked.some(entity => entity.isBrand), false);
});

// ---------- Prompt rules ----------

test('combined prompts are detected and split', () => {
  assert.equal(isCombinedPrompt('Sertifikasi juri cheerleading di Indonesia'), false);
  assert.equal(isCombinedPrompt('What is X? Who runs Y?'), true);
  const parts = splitQuestions('Klub cheerleading terbaik di Indonesia, Aturan dan kategori lomba cheerleading di Indonesia, Event cheerleading terbesar di Indonesia 2026');
  assert.equal(parts.length, 3);
});

test('alias collisions and narrow aliases are flagged', () => {
  assert.deepEqual(aliasCollisions(['ICA', 'Cheer Federation Indonesia'], ['RCF|Rival Cheer Federation Indonesia']).map(hit => hit.alias), ['Cheer Federation Indonesia']);
  assert.deepEqual(aliasCollisions(['ICA', 'Indonesian Cheer Association'], ['RCF|Rival Cheer Federation Indonesia']), []);
  assert.match(narrowAliasReason(['ICA'], 'ICA', 4) ?? '', /Only "ICA"/);
  assert.match(narrowAliasReason(['ICA', 'IC'], 'ICA', 2) ?? '', /acronyms/);
  assert.equal(narrowAliasReason(['ICA', 'Indonesian Cheer Association', 'indonesiancheer.org'], 'ICA', 4), null);
});

test('topics are classified from the prompt text', () => {
  assert.equal(classifyTopic('Sertifikasi juri cheerleading di Indonesia'), 'certification');
  assert.equal(classifyTopic('Organisasi cheerleading resmi di Indonesia apa saja'), 'recognition');
  assert.equal(classifyTopic('Bagaimana timnas cheerleading Indonesia dipilih untuk ICU World Championship'), 'international');
  assert.equal(classifyTopic('Bagaimana cara mendaftarkan tim cheerleading sekolah ke kompetisi resmi'), 'competition');
  assert.equal(classifyTopic('Aturan dan kategori lomba cheerleading di Indonesia'), 'rules');
  assert.equal(classifyTopic('Di mana tempat belajar cheerleading di Jakarta'), 'clubs');
  assert.equal(classifyTopic('Apa perbedaan ICA dan RCF dalam cheerleading Indonesia'), 'comparison');
});

test('brand label prefers the full name whose initials match the acronym', () => {
  assert.equal(pickBrandLabel([['ICA', 'Federasi Cheerleading Indonesia', 'Indonesian Cheer Association', 'indonesiancheer.org']], 'ICA').label, 'Indonesian Cheer Association (ICA)');
});

test('scrubCompetitors removes names, acronyms and domains', () => {
  const competitor = ['F', 'C', 'S', 'I'].join('');
  const terms = [competitor, 'Federasi Cheerleading Seluruh Indonesia'];
  const out = scrubCompetitors(`Apa perbedaan ICA dan ${competitor} (Federasi Cheerleading Seluruh Indonesia) di ${competitor.toLowerCase()}.or.id?`, terms, 'id');
  assert.equal(containsCompetitor(out, terms), false, out);
  assert.match(out, /organisasi lain/);
});

// ---------- Report ----------

test('summary: latest vs lifetime per model, fallbacks and errors excluded, weakest model', () => {
  const byModel = Object.fromEntries(report.summary.byModel.map(row => [row.model, row]));
  assert.equal(byModel[CLAUDE].latestRate, 25);
  assert.equal(byModel[GPT].latestAnswers, 3, 'fallback answer excluded');
  assert.equal(byModel[GPT].fallbacks, 1);
  assert.equal(byModel[GPT].lifetimeRate, 75);
  assert.equal(byModel[GEMINI].errors, 1);
  assert.equal(report.summary.weakestModel, CLAUDE);
  assert.deepEqual(report.summary.zeroVisibility.map(prompt => prompt.id), ['p-judge', 'p-combo']);
});

test('prompt gaps list who AI named instead and which sources it cited', () => {
  const official = report.prompts.find(prompt => prompt.id === 'p-official')!;
  assert.equal(official.status, 'partial');
  assert.deepEqual(official.namedInstead.map(entity => entity.name), ['RCF', 'Persatuan Cheer Sekolah', 'Jakarta Cheer Club']);
  assert.deepEqual(official.sourcesWhenMissing, ['rcf-indonesia.or.id', 'id.wikipedia.org']);
  assert.equal(official.cells[GPT]?.mentioned, true);
  const combo = report.prompts.find(prompt => prompt.id === 'p-combo')!;
  assert.deepEqual(combo.flags.sort(), ['combined', 'narrow-aliases']);
  assert.ok(report.prompts.find(prompt => prompt.id === 'p-diff')!.flags.includes('leading'));
});

test('entity understanding is evidence-based per model', () => {
  const byModel = Object.fromEntries(report.entity.byModel.map(row => [row.model, row]));
  assert.equal(byModel[GPT].verdict, 'described-as-recognised');
  assert.equal(byModel[CLAUDE].otherBodyStatements.length, 1);
  assert.notEqual(byModel[CLAUDE].verdict, 'described-as-recognised');
  assert.equal(byModel[GEMINI].uncertainStatements.length, 1);
  for (const model of report.entity.byModel) {
    for (const quote of [...model.excerpts, ...model.recognisedStatements]) {
      assert.ok(FIXTURE_INPUT.latest.some(check => (check.response ?? '').replace(/\*\*/g, '').includes(quote.slice(0, 30))), `quote comes from a stored answer: ${quote}`);
    }
  }
  assert.equal(report.entity.expansions.length, 2);
  assert.ok(report.entity.contradictions.some(text => /expands the acronym/.test(text)));
  assert.ok(report.entity.contradictions.some(text => /disagree on the official body/.test(text)));
});

// ---------- Recommendation rules ----------

test('recommendations never name competitors and never assert unverified status', () => {
  const text = JSON.stringify(report.recommendations);
  assert.equal(containsCompetitor(text, ['RCF', 'Rival Cheer Federation Indonesia']), false);
  assert.doesNotMatch(text, /is (officially|nationally) recogni[sz]ed|is the (official|recogni[sz]ed)|diakui (oleh )?negara/i);
  const ids = report.recommendations.map(rec => rec.id);
  for (const id of ['entity-official-status', 'entity-organization-schema', 'entity-international-membership', 'entity-wikidata', 'entity-news', 'entity-nap', 'entity-llms-txt', 'content-pages', 'content-faq-schema', 'third-party-sources', 'tracking-hygiene', 'entity-name-consistency']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.match(report.recommendations.find(rec => rec.id === 'entity-official-status')!.title, /Publish verifiable evidence/);
  assert.deepEqual(report.recommendations.map(rec => rec.priority), [...report.recommendations.map(rec => rec.priority)].sort((a, b) => ['high', 'medium', 'low'].indexOf(a) - ['high', 'medium', 'low'].indexOf(b)));
});

test('content pages split bundled prompts by topic and JSON-LD snippets are valid', () => {
  const pages = report.recommendations.find(rec => rec.id === 'content-pages')!.pages!;
  assert.deepEqual(pages.map(page => page.topic).sort(), ['certification', 'clubs', 'competition', 'recognition', 'rules']);
  for (const page of pages) assert.ok(page.faq.length >= 3 && page.faq.every(question => question.endsWith('?')));
  for (const rec of report.recommendations) if (rec.snippet?.language === 'json') JSON.parse(rec.snippet.code);
  const org = JSON.parse(report.recommendations.find(rec => rec.id === 'entity-organization-schema')!.snippet!.code);
  assert.equal(org.url, 'https://indonesiancheer.org/');
  assert.ok(!org.alternateName.includes('Cheer Federation Indonesia'), 'colliding alias left out');
  const thirdParty = report.recommendations.find(rec => rec.id === 'third-party-sources')!;
  assert.ok(thirdParty.actions.every(action => !/rcf/i.test(action)));
});

test('real-world shape: a competitor named in the prompt never reaches site copy', () => {
  const competitor = ['F', 'C', 'S', 'I'].join('');
  const input: GapInput = {
    ...FIXTURE_INPUT,
    prompts: [{ id: 'x', prompt: `Apa perbedaan ICA dan ${competitor} dalam cheerleading Indonesia`, brand_terms: ['ICA'], competitors: [`${competitor}|Federasi Cheerleading Seluruh Indonesia`], active: true }],
    latest: [{ id: 'k', prompt_id: 'x', model: CLAUDE, answered_model: CLAUDE, response: `${competitor} adalah federasi resmi. Lihat https://${competitor.toLowerCase()}.or.id`, mentioned: false, rank_in_answer: null, cited_urls: [`https://${competitor.toLowerCase()}.or.id`], site_cited: false, competitors_mentioned: [competitor], error: null, created_at: '2026-11-17T00:00:00Z' }],
    lifetime: [],
  };
  const out = buildGapReport(input);
  const copy = JSON.stringify(out.recommendations);
  assert.equal(new RegExp(competitor, 'i').test(copy), false, copy);
  assert.equal(sanitizeGapSummary(`- ${competitor} leads.\n- Publish evidence.`, out, input.prompts)?.includes(competitor), false);
});

// ---------- Export builders ----------

test('CSV: BOM, one row per prompt, formula guard', () => {
  const csv = gapReportCsv(report);
  assert.ok(csv.startsWith('\uFEFF"Prompt"'));
  assert.equal(csv.trim().split('\r\n').length, 1 + report.prompts.length);
  assert.equal(safeCell('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
});

test('XLSX has every sheet with data', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await gapReportXlsx(report) as unknown as ArrayBuffer);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['Summary', 'Prompts', 'Gaps', 'Entity understanding', 'Answers', 'Sources', 'Recommendations', 'Flags']);
  assert.equal(book.getWorksheet('Prompts')!.rowCount, 1 + report.prompts.length);
  assert.equal(book.getWorksheet('Answers')!.rowCount, 1 + report.answers.length);
  assert.ok(String(book.getWorksheet('Answers')!.getRow(2).getCell(10).value).length > 20, 'full answer text');
});

test('PDF renders and strips characters Helvetica cannot draw', async () => {
  const pdf = await gapReportPdf(report);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 5_000);
  assert.equal(pdfText('a → b ≤ c 🚀 “d”'), 'a -> b <= c  “d”');
});

// ---------- Wiring ----------

test('export route checks SEO access and the site, and the page shows Gaps & fixes', () => {
  const route = read('src/app/api/seo/visibility/export/route.ts');
  assert.match(route, /requireFeature\(request, 'seo'\)/);
  assert.match(route, /getSeoSite\(params.get\('siteId'\)\)/);
  assert.match(route, /'json', 'csv', 'xlsx', 'pdf'/);
  assert.match(read('src/app/dashboard/seo/visibility/page.tsx'), /<VisibilityGapsPanel siteId=\{site.id\}/);
  const service = read('src/lib/seo/visibility-gap-service.ts');
  assert.doesNotMatch(service, /treg/i, 'no treg');
  assert.doesNotMatch(service, /OPENROUTER|provider_?mode|paid_?openrouter/i, 'does not touch provider mode or the paid toggle');
});
