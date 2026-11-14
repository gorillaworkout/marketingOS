import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectConflictingMetricValues,
  finalizeArticleForPublication,
  normalizeArticleMarketNewsInput,
  validateGeneratedArticle,
} from '../src/lib/article-market-news';
import { restoreArticleMarketNews } from '../src/lib/article-market-news-history';
import {
  SILVER_APPLE_TITLE, SILVER_TITLE, SPX_TITLE,
  appleEpsConflict, draft, silverAppleInput, silverAppleLead, silverInput, silverInvented, silverLead,
  spxFred, spxFredSourceLine, spxInput, spxLead,
} from './fixtures/market-news-final-repair';

test('fixtures: the clean drafts pass the publication gate', () => {
  assert.deepEqual(validateGeneratedArticle(SILVER_TITLE, draft(SILVER_TITLE, silverInput, silverLead), silverInput).violations, []);
  assert.deepEqual(validateGeneratedArticle(SPX_TITLE, draft(SPX_TITLE, spxInput, spxLead), spxInput).violations, []);
  assert.deepEqual(validateGeneratedArticle(SILVER_APPLE_TITLE, draft(SILVER_APPLE_TITLE, silverAppleInput, silverAppleLead), silverAppleInput).violations, []);
});

test('Silver: an invented 2.73% stays strictly flagged, and the final repair drops its sentence', () => {
  const broken = draft(SILVER_TITLE, silverInput, silverLead, [silverInvented]);
  const before = validateGeneratedArticle(SILVER_TITLE, broken, silverInput);
  assert.deepEqual(before.unsupportedNumbers, ['2.73%']);
  assert.ok(before.violations.includes('Unsupported numeric claims detected: 2.73%.'));
  const fixed = finalizeArticleForPublication(SILVER_TITLE, broken, silverInput);
  assert.deepEqual(fixed.validation.violations, []);
  assert.doesNotMatch(fixed.markdown, /2\.73/);
  assert.match(fixed.markdown, /Harga Silver naik 1,9%/, 'supported sentences survive');
  assert.ok(fixed.repairs.some(r => /number/i.test(r)));
  assert.deepEqual(finalizeArticleForPublication(SILVER_TITLE, fixed.markdown, fixed.input).markdown, fixed.markdown, 'idempotent');
});

test('percent normalization: 2.73% = 2,73% = 2.73 percent = 2,73 persen = 0.0273, and 2.74% is still unsupported', () => {
  const withFact = (facts: string) => normalizeArticleMarketNewsInput({
    ...silverInput,
    sources: [{ ...silverInput.sources[0], verifiedFacts: `${silverInput.sources[0].verifiedFacts} Weekly gain: ${facts}.` }, silverInput.sources[1]],
  }, '2026-11-14');
  const sentence = (claim: string) => draft(SILVER_TITLE, silverInput, silverLead, [`Secara mingguan, Silver naik ${claim} (Reuters, 14 Nov 2026).`]);
  for (const fact of ['2.73%', '2,73%', '2.73 percent', '0.0273']) {
    const input = withFact(fact);
    for (const claim of ['2.73%', '2,73%', '2.73 persen', '2,73 persen', '2.73 percent']) {
      assert.deepEqual(validateGeneratedArticle(SILVER_TITLE, sentence(claim), input).unsupportedNumbers, [], `${claim} vs source ${fact}`);
    }
    assert.ok(validateGeneratedArticle(SILVER_TITLE, sentence('2.74%'), input).unsupportedNumbers.length > 0, `2.74% vs source ${fact}`);
  }
});

test('S&P 500: a FRED reference outside the research list is flagged, then dropped with its Sources line', () => {
  const broken = draft(SPX_TITLE, spxInput, spxLead, [spxFred], [spxFredSourceLine]);
  const before = validateGeneratedArticle(SPX_TITLE, broken, spxInput);
  assert.ok(before.violations.some(v => /FRED/.test(v) && /research list/.test(v)), before.violations.join(' | '));
  const fixed = finalizeArticleForPublication(SPX_TITLE, broken, spxInput);
  assert.deepEqual(fixed.validation.violations, []);
  assert.doesNotMatch(fixed.markdown, /FRED|fred\.stlouisfed/);
});

test('S&P 500: a FRED reference reported by a listed source gets that source attributed inline', () => {
  const input = normalizeArticleMarketNewsInput({
    ...spxInput,
    sources: [{ ...spxInput.sources[0], verifiedFacts: `${spxInput.sources[0].verifiedFacts} FRED data show the 10-year Treasury yield rose this week.` }, spxInput.sources[1]],
  }, '2026-11-14');
  const broken = draft(SPX_TITLE, input, spxLead, [spxFred]);
  const before = validateGeneratedArticle(SPX_TITLE, broken, input);
  assert.ok(before.violations.some(v => /FRED/.test(v)), before.violations.join(' | '));
  const fixed = finalizeArticleForPublication(SPX_TITLE, broken, input);
  assert.deepEqual(fixed.validation.violations, []);
  assert.match(fixed.markdown, /Menurut data FRED, [^\n]*\(Reuters, 14 Nov 2026\)\./);
  assert.equal(fixed.input.sources.length, 2);
});

test('S&P 500: FRED as a listed research source is already attributed and stays', () => {
  const fredSource = {
    outlet: 'FRED', title: 'Market Yield on U.S. Treasury Securities at 10-Year', url: 'https://fred.stlouisfed.org/series/DGS10',
    publishedAt: '2026-11-14T08:00', verifiedFacts: 'FRED series DGS10 shows the 10-year Treasury yield and its recent rise in obligasi markets.',
  };
  const input = normalizeArticleMarketNewsInput({ ...spxInput, sources: [...spxInput.sources, fredSource] }, '2026-11-14');
  const md = draft(SPX_TITLE, input, spxLead, [spxFred]);
  assert.deepEqual(validateGeneratedArticle(SPX_TITLE, md, input).violations, []);
  assert.equal(finalizeArticleForPublication(SPX_TITLE, md, input).markdown, md);
});

test('Silver + Apple: conflicting EPS values are detected and the one matching a source is kept', () => {
  const broken = draft(SILVER_APPLE_TITLE, silverAppleInput, silverAppleLead, [appleEpsConflict]);
  const conflicts = detectConflictingMetricValues(broken, silverAppleInput);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].metric, 'EPS');
  assert.deepEqual([...conflicts[0].values].sort(), ['1,58', '1,64']);
  const before = validateGeneratedArticle(SILVER_APPLE_TITLE, broken, silverAppleInput);
  assert.ok(before.violations.some(v => /Conflicting values/.test(v) && /EPS/.test(v)), before.violations.join(' | '));
  const fixed = finalizeArticleForPublication(SILVER_APPLE_TITLE, broken, silverAppleInput);
  assert.deepEqual(fixed.validation.violations, []);
  assert.match(fixed.markdown, /EPS US\$1,64/);
  assert.doesNotMatch(fixed.markdown, /1,58/);
});

test('conflicting values that both appear in the sources, but neither paired with the metric, are both dropped', () => {
  const input = normalizeArticleMarketNewsInput({
    ...silverAppleInput,
    sources: [
      { ...silverAppleInput.sources[0], verifiedFacts: 'Open-web full-page excerpt: Apple shares closed at 1.70 above the 1.66 level as silver rose 1,9%.' },
      silverAppleInput.sources[1],
    ],
  }, '2026-11-14');
  const lead = 'Silver Apple menjadi sorotan karena saham Apple naik 2% (CNBC, 14 Nov 2026), sementara silver naik 1,9% (Reuters, 14 Nov 2026).';
  const broken = draft(SILVER_APPLE_TITLE, input, lead, ['EPS Apple tercatat 1,70 pada kuartal ini.', 'Laporan lain menyebut EPS Apple 1,66.']);
  assert.equal(detectConflictingMetricValues(broken, input).length, 1);
  const fixed = finalizeArticleForPublication(SILVER_APPLE_TITLE, broken, input);
  assert.deepEqual(fixed.validation.violations, []);
  assert.doesNotMatch(fixed.markdown, /EPS Apple/);
});

test('EPS actual vs estimate in one article is not a conflict', () => {
  const broken = draft(SILVER_APPLE_TITLE, silverAppleInput, silverAppleLead, ['Sebelumnya konsensus memperkirakan EPS Apple sekitar US$1,60.']);
  assert.deepEqual(detectConflictingMetricValues(broken, silverAppleInput), []);
});

test('the repair never makes a draft worse: an unfixable short draft keeps its original text', () => {
  const short = `# ${SILVER_TITLE}\n\n${silverLead}\n\n${silverInvented}\n\n## Sources`;
  const fixed = finalizeArticleForPublication(SILVER_TITLE, short, silverInput);
  assert.ok(fixed.validation.violations.some(v => /too short/.test(v)));
  assert.ok(fixed.validation.violations.length <= validateGeneratedArticle(SILVER_TITLE, short, silverInput).violations.length);
});

test('meta description: an unsupported number is removed from the meta too', () => {
  const md = draft(SILVER_TITLE, silverInput, silverLead);
  const meta = 'Silver naik 1,9% hari ini. Kenaikan mingguan 2.73% menarik minat trader.';
  assert.ok(validateGeneratedArticle(SILVER_TITLE, md, silverInput, meta).violations.length > 0);
  const fixed = finalizeArticleForPublication(SILVER_TITLE, md, silverInput, meta);
  assert.equal(fixed.metaDescription, 'Silver naik 1,9% hari ini.');
  assert.deepEqual(fixed.validation.violations, []);
});

test('the route runs the final repair right before the gate', () => {
  const route = readFileSync('src/app/api/article-market-news/generate/route.ts', 'utf8');
  const repairAt = route.indexOf('finalizeArticleForPublication(');
  const gateAt = route.indexOf('validation = finalized.validation');
  assert.ok(repairAt > 0 && repairAt < gateAt);
  assert.ok(route.lastIndexOf('repairArticleStructure(') < repairAt);
});

test('the download lock uses the same repair: the client and history restore finalize before validating', () => {
  const client = readFileSync('src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx', 'utf8');
  assert.match(client, /finalizeArticleForPublication\(/);
  const broken = draft(SILVER_TITLE, silverInput, silverLead, [silverInvented]);
  const restored = restoreArticleMarketNews({
    id: 't1', title: 'x', created_at: '2026-11-14',
    output_data: JSON.stringify({ article: { title: SILVER_TITLE, metaDescription: 'Silver naik 1,9% hari ini.', articleMarkdown: broken, wordCount: 900 }, input: silverInput, model: 'm', qc: {} }),
  });
  assert.doesNotMatch(restored.result.articleMarkdown, /2\.73/);
  assert.deepEqual(validateGeneratedArticle(restored.result.title, restored.result.articleMarkdown, restored.generatedInput, restored.result.metaDescription).violations, []);
});

test('requireClean: a draft the repair cannot fully clear is left untouched for the download lock', () => {
  const short = `# ${SILVER_TITLE}\n\n${silverLead}\n\n${silverInvented}\n\n## Sources`;
  const fixed = finalizeArticleForPublication(SILVER_TITLE, short, silverInput, '', { requireClean: true });
  assert.equal(fixed.markdown, short);
  assert.deepEqual(fixed.repairs, []);
});

test('ordinary words and market names are not treated as outlet references', () => {
  const md = draft(SPX_TITLE, spxInput, spxLead, ['Antara lain, trader juga memantau indeks Nikkei dan pergerakan dolar.']);
  assert.deepEqual(validateGeneratedArticle(SPX_TITLE, md, spxInput).violations, []);
});
