import assert from 'node:assert/strict';
import test from 'node:test';
import { guardGeneratedText, mergeBrandFacts } from '../src/lib/brand-fact-guard.ts';
import { headingWarnings, META_DESCRIPTION_MAX, META_TITLE_MAX } from '../src/lib/seo/content-studio.ts';
import { parseDraftOutput } from '../src/lib/seo/content-prompt.ts';
import { markdownToHtml, repairMarkdownLayout } from '../src/lib/seo/markdown.ts';

const ARTICLE = [
  '# Panduan Trading Emas untuk Pemula',
  '',
  'Trading emas adalah cara populer untuk berinvestasi.',
  '',
  '## Apa itu trading emas?',
  '',
  'Ini platform terbaik untuk semua. Emas diperdagangkan sebagai kontrak.',
  '',
  '### Risiko utama',
  '',
  '- Volatilitas harga',
  '- Leverage',
  '',
  '| Aspek | Emas |',
  '| --- | --- |',
  '| Risiko | Tinggi |',
  '',
  'Selalu gunakan manajemen risiko.',
].join('\n');

test('the claim guard keeps headings, lists, and tables on their own lines', () => {
  const guarded = guardGeneratedText(ARTICLE, mergeBrandFacts(''));
  assert.ok(guarded.warnings.length > 0);
  assert.doesNotMatch(guarded.text, /terbaik/);
  assert.match(guarded.text, /^# Panduan Trading Emas untuk Pemula$/m);
  assert.match(guarded.text, /^## Apa itu trading emas\?$/m);
  assert.match(guarded.text, /^### Risiko utama$/m);
  assert.match(guarded.text, /^- Leverage$/m);
  assert.match(guarded.text, /^\| --- \| --- \|$/m);
  assert.match(guarded.text, /^Emas diperdagangkan sebagai kontrak\.$/m);
  assert.deepEqual(headingWarnings(guarded.text), []);
});

test('a guarded line keeps its block marker when only one sentence is removed', () => {
  const guarded = guardGeneratedText('- Broker terbaik. Emas likuid.\n- Kedua', '');
  assert.equal(guarded.text, '- Emas likuid.\n- Kedua');
});

test('a flattened article is repaired into H1-H3, paragraphs, lists and a table', () => {
  const flat = ARTICLE.replace(/\n+/g, ' ');
  const repaired = repairMarkdownLayout(flat);
  assert.match(repaired, /^# Panduan Trading Emas untuk Pemula$/m);
  assert.match(repaired, /^## Apa itu trading emas\?$/m);
  assert.match(repaired, /^### Risiko utama$/m);
  assert.match(repaired, /^- Volatilitas harga$/m);
  assert.match(repaired, /^- Leverage$/m);
  assert.match(repaired, /^\| Aspek \| Emas \|$/m);
  assert.match(repaired, /^\| --- \| --- \|$/m);
  assert.match(repaired, /^\| Risiko \| Tinggi \|$/m);
  assert.match(repaired, /^Selalu gunakan manajemen risiko\.$/m);
  assert.deepEqual(headingWarnings(repaired), []);
  const html = markdownToHtml(repaired);
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  assert.match(html, /<h2>Apa itu trading emas\?<\/h2>/);
  assert.match(html, /<h3>Risiko utama<\/h3>/);
  assert.match(html, /<table>/);
  assert.match(html, /<ul>/);
});

test('repairMarkdownLayout leaves well-formed Markdown untouched', () => {
  assert.equal(repairMarkdownLayout(ARTICLE), ARTICLE);
  const code = '# T\n\n```\n# not a heading ## x\n```\n';
  assert.equal(repairMarkdownLayout(code), code);
});

test('literal \\n escapes in a model body become real newlines', () => {
  const repaired = repairMarkdownLayout('# Title\\n\\n## Section\\n\\nBody text.');
  assert.equal(repaired, '# Title\n\n## Section\n\nBody text.');
});

test('a sentence-case flat heading ends where the paragraph starts', () => {
  const repaired = repairMarkdownLayout('# Cara memilih broker teregulasi Broker yang diawasi BAPPEBTI wajib memisahkan dana. ## Kesimpulan Pilih broker dengan hati-hati.');
  assert.match(repaired, /^# Cara memilih broker teregulasi$/m);
  assert.match(repaired, /^Broker yang diawasi BAPPEBTI wajib memisahkan dana\.$/m);
  assert.match(repaired, /^## Kesimpulan$/m);
});

test('parseDraftOutput repairs a flat body and keeps meta limits', () => {
  const parsed = parseDraftOutput(JSON.stringify({
    title: 'T'.repeat(90), meta_description: 'M'.repeat(180),
    body_markdown: ARTICLE.replace(/\n+/g, ' '),
  }), 'emas');
  assert.equal(parsed.title.length, META_TITLE_MAX);
  assert.equal(parsed.metaDescription.length, META_DESCRIPTION_MAX);
  assert.deepEqual(headingWarnings(parsed.bodyMarkdown), []);
  assert.match(parsed.bodyMarkdown, /^## Apa itu trading emas\?$/m);
});

// ---- Event Plan quotation rows keep focus while typing ----
import { readFileSync } from 'node:fs';
test('quotation rows are not keyed by their editable item text', () => {
  const source = readFileSync('src/components/event-quotation-table.tsx', 'utf8');
  assert.doesNotMatch(source, /key=\{`\$\{line\.item\}/);
  assert.match(source, /<tr key=\{index\}/);
});

// ---- AI Models: a passing test supersedes the stale stored error ----
import { providerErrorAppliesTo, providerErrorClearedBy } from '../src/lib/llm-auth.ts';
const STALE = 'HTTP 503: [claude/claude-sonnet-5-5] [401]: authentication_error: OAuth access token has expired. Re-authenticate.';
test('a passing Dupoin test clears a stored error that names the same model', () => {
  assert.equal(providerErrorClearedBy(STALE, 'cc/claude-sonnet-5-5'), true);
  assert.equal(providerErrorClearedBy(STALE, 'cc/claude-opus-5-5'), false);
  assert.equal(providerErrorClearedBy('Gateway timeout', 'cc/claude-opus-5-5'), true);
  assert.equal(providerErrorClearedBy(null, 'cc/claude-sonnet-5-5'), false);
});
test('the stored provider error only marks Dupoin rows tested before it', () => {
  const failover = '2026-11-12T04:17:00.000Z';
  assert.equal(providerErrorAppliesTo({ provider: 'dupoin', testedAt: '2026-11-14T03:34:52.000Z' }, failover), false);
  assert.equal(providerErrorAppliesTo({ provider: 'dupoin', testedAt: '2026-11-11T00:00:00.000Z' }, failover), true);
  assert.equal(providerErrorAppliesTo({ provider: 'openrouter', testedAt: '2026-11-11T00:00:00.000Z' }, failover), false);
});
test('the probe route clears the stored error after a passing test', () => {
  const route = readFileSync('src/app/api/admin/llm-provider/probe/route.ts', 'utf8');
  assert.match(route, /clearProviderLastError\(\)/);
  assert.match(route, /clearedProviderError/);
  const page = readFileSync('src/app/dashboard/models/page.tsx', 'utf8');
  assert.match(page, /clearedProviderError === true/);
  assert.match(page, /providerErrorAppliesTo\(row, provider\?\.status\.lastFailoverAt\)/);
});

// ---- Social Post: scraped page metadata never becomes a source card ----
import { isScrapedMetadata, researchSocialPostWeb } from '../src/lib/social-post-research.ts';
const YT_JUNK = 'cbox":true,"att_web_record_metrics":true,"attmusi":true,"bg_st_hr":false,"browse_next_continuations_migration_playlist":true';
test('metadata blobs are recognised and normal prose is not', () => {
  assert.equal(isScrapedMetadata(YT_JUNK), true);
  assert.equal(isScrapedMetadata('{"@context":"https://schema.org","@type":"VideoObject","name":"x"}'), true);
  assert.equal(isScrapedMetadata('A beginner trading routine starts with a written plan, a risk limit per trade, and a weekly review.'), false);
});
test('research drops metadata snippets and does not scrape video pages', async () => {
  const calls: string[] = [];
  const res = (body: string, type = 'text/html') => ({ ok: true, status: 200, url: '', headers: new Headers({ 'content-type': type }), body: null, text: async () => body }) as Response;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('google.serper.dev')) return res(JSON.stringify({ organic: [
      { title: 'Trading routine for beginners', link: 'https://www.youtube.com/watch?v=abc', snippet: 'Build a daily trading learning routine: review charts, journal trades, and set a risk limit.' },
      { title: 'Junk page', link: 'https://junk.example/a', snippet: YT_JUNK },
      { title: 'Learning routine guide', link: 'https://guide.example/routine', snippet: 'short' },
    ] }), 'application/json');
    if (url === 'https://junk.example/a') return res(`<html><head><title>Junk</title></head><body><script>var x=1</script><p>${YT_JUNK}${YT_JUNK}</p></body></html>`);
    if (url === 'https://guide.example/routine') return res('<html><head><title>Learning routine guide</title></head><body><p>A trading learning routine for beginners: study one concept per day, practise on paper, and review every trade in a journal.</p></body></html>');
    return res('missing');
  };
  const research = await researchSocialPostWeb({ brief: 'Trading learning routine for beginners', platform: 'Instagram', fetchImpl, serperApiKey: 'k', enableJina: false });
  assert.equal(calls.some(url => url.includes('youtube.com')), false);
  assert.equal(research.sources.some(source => isScrapedMetadata(source.snippet || '')), false);
  assert.equal(research.sources.some(source => source.url === 'https://junk.example/a'), false);
  const video = research.sources.find(source => source.url.includes('youtube.com'));
  assert.match(video?.snippet || '', /journal trades/);
  assert.ok(research.sources.some(source => source.url === 'https://guide.example/routine'));
});

// ---- SEO Audit / Keyword Gap: time and page caps ----
import { crawlSite, type AuditFetch } from '../src/lib/seo/audit-crawl.ts';
import { GAP_COMPETITOR_PAGE_CAP, StepTimeoutError, withTimeout } from '../src/lib/seo/time-budget.ts';
test('a crawl stops at its deadline and reports a partial result', async () => {
  let served = 0;
  const fetchPage: AuditFetch = async (url: string) => {
    served += 1;
    await new Promise(resolve => setTimeout(resolve, 15));
    const n = Number(new URL(url).pathname.slice(1)) || 0;
    if (url.endsWith('robots.txt') || url.endsWith('sitemap.xml')) return { status: 404, headers: {} as Record<string, string>, body: '', location: null };
    return { status: 200, headers: { 'content-type': 'text/html' }, body: `<html><body><a href="/${n + 1}">n</a><a href="/${n + 2}">m</a></body></html>`, location: null };
  };
  const crawl = await crawlSite({ startUrl: 'https://big.example/', maxPages: 200, fetchPage, delayMs: 0, concurrency: 1, lookup: async () => ['93.184.216.34'], deadlineAt: Date.now() + 120 });
  assert.equal(crawl.timedOut, true);
  assert.ok(crawl.pages.length < 20, `crawled ${crawl.pages.length}`);
  assert.ok(served < 25);
  const full = await crawlSite({ startUrl: 'https://big.example/', maxPages: 3, fetchPage, delayMs: 0, lookup: async () => ['93.184.216.34'] });
  assert.equal(full.timedOut, false);
});
test('slow steps time out with a clear message', async () => {
  await assert.rejects(withTimeout(new Promise(resolve => setTimeout(resolve, 200)), 20, 'The summary'), (error: unknown) => error instanceof StepTimeoutError && /The summary timed out/.test(String((error as Error).message)));
  assert.equal(await withTimeout(Promise.resolve(5), 50, 'x'), 5);
  assert.ok(GAP_COMPETITOR_PAGE_CAP <= 50);
});
test('keyword gap and audit wire the caps and surface partial status', () => {
  const gap = readFileSync('src/lib/seo/keyword-gap-run.ts', 'utf8');
  assert.match(gap, /deadlineAt: Date\.now\(\) \+ GAP_COMPETITOR_CRAWL_MS/);
  assert.match(gap, /crawl\.timedOut/);
  const audit = readFileSync('src/lib/seo/audit-run.ts', 'utf8');
  assert.match(audit, /AUDIT_CRAWL_BUDGET_MS/);
  assert.match(audit, /PSI_QUOTA_MESSAGE\}\. Continuing/);
  for (const route of ['src/app/api/seo/audit/[id]/route.ts', 'src/app/api/seo/keyword-gap/[id]/route.ts']) {
    assert.match(readFileSync(route, 'utf8'), /expireStale(?:Audits|Gaps)\(\)/);
  }
});
test('a crawl that reaches its page cap with links still queued finishes (was hanging forever)', async () => {
  const fetchPage: AuditFetch = async (url: string) => url.endsWith('.txt') || url.endsWith('.xml')
    ? { status: 404, headers: {} as Record<string, string>, body: '', location: null }
    : { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body><a href="/a">a</a><a href="/b">b</a></body></html>', location: null };
  const outcome = await Promise.race([
    crawlSite({ startUrl: 'https://cap.example/', maxPages: 1, fetchPage, delayMs: 0, lookup: async () => ['93.184.216.34'] }).then(crawl => crawl.pages.length),
    new Promise(resolve => setTimeout(() => resolve('hung'), 2000)),
  ]);
  assert.equal(outcome, 1);
});
