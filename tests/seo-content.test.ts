import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_FEATURE_ASSIGNMENTS, FEATURE_METADATA, GENERATION_FEATURES, accountFeatureForGeneration } from '../src/lib/model-routing';
import { CLAUDE_SONNET_5_5_MODEL } from '../src/lib/openai';
import {
  CONTENT_ACTIONS, CONTENT_STATUSES, canApprove, editResetsStatus, transitionStatus,
} from '../src/lib/seo/content-status';
import { diffStats, lineDiff } from '../src/lib/seo/diff';
import { escapeHtml, markdownToHtml, renderHtmlExport, renderMarkdownExport } from '../src/lib/seo/markdown';
import {
  MAX_BODY_LENGTH, buildDraftPrompt, buildRewritePrompt, parseCreateRequest, parseDraftOutput, slugify,
} from '../src/lib/seo/content-prompt';
import { isDashboardNavItemVisible } from '../src/lib/authorization';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const migration = read('db/migrations/037_seo_content_studio.sql');
const executable = migration.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');

// ---------- Model routing ----------

test('seo-content is a model-routed generation feature defaulting to Sonnet 5.5', () => {
  assert.ok(GENERATION_FEATURES.includes('seo-content'));
  assert.equal(FEATURE_METADATA['seo-content'].key, 'seo-content');
  assert.equal(FEATURE_METADATA['seo-content'].label, 'SEO Content Studio');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['seo-content'].defaultModel, CLAUDE_SONNET_5_5_MODEL);
  assert.ok(DEFAULT_FEATURE_ASSIGNMENTS['seo-content'].allowedModels.includes(CLAUDE_SONNET_5_5_MODEL));
});

test('seo-content model preference is unlocked by the SEO OS account feature', () => {
  assert.equal(accountFeatureForGeneration('seo-content'), 'seo');
  assert.equal(accountFeatureForGeneration('event-plan'), 'event-plan');
});

// ---------- Migration 037 ----------

test('037 is transactional, idempotent and has no ? placeholders', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;/m);
  assert.doesNotMatch(executable, /\?/);
  assert.match(executable, /CREATE TABLE IF NOT EXISTS seo_content_drafts/);
  assert.match(executable, /CREATE TABLE IF NOT EXISTS seo_content_versions/);
  assert.doesNotMatch(executable, /CREATE TABLE seo_/);
  assert.doesNotMatch(executable, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  assert.doesNotMatch(executable, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('037 extends the task_type CHECK with seo-content and keeps every older type', () => {
  assert.match(executable, /DROP CONSTRAINT IF EXISTS task_model_preferences_task_type_check/);
  const check = executable.split('ADD CONSTRAINT task_model_preferences_task_type_check')[1] ?? '';
  for (const type of ['caption', 'image-prompt', ...GENERATION_FEATURES]) {
    assert.match(check, new RegExp(`'${type}'`), `CHECK is missing ${type}`);
  }
});

test('037 seeds the seo-content assignment without overwriting admin changes', () => {
  assert.match(executable, /INSERT INTO feature_model_assignments[\s\S]*'seo-content'[\s\S]*ON CONFLICT \(feature_key\) DO NOTHING/);
  assert.match(executable, /'cc\/claude-sonnet-5-5'/);
  const allowed = JSON.parse(executable.match(/'(\[[^\]]*\])'::jsonb/i)?.[1] ?? '[]') as string[];
  assert.deepEqual([...allowed].sort(), [...DEFAULT_FEATURE_ASSIGNMENTS['seo-content'].allowedModels].sort());
});

test('037 draft statuses match the app', () => {
  const statusCheck = executable.match(/status TEXT NOT NULL DEFAULT 'draft' CHECK \(status IN \(([^)]*)\)\)/)?.[1] ?? '';
  assert.deepEqual(statusCheck.split(',').map(value => value.trim().replace(/'/g, '')), [...CONTENT_STATUSES]);
});

// ---------- Status workflow ----------

test('statuses are draft, review, approved, queued, published', () => {
  assert.deepEqual([...CONTENT_STATUSES], ['draft', 'review', 'approved', 'queued', 'published']);
  assert.ok(CONTENT_ACTIONS.includes('approve'));
});

test('workflow moves draft -> review -> approved -> queued -> published', () => {
  assert.equal(transitionStatus('draft', 'submit'), 'review');
  assert.equal(transitionStatus('review', 'approve'), 'approved');
  assert.equal(transitionStatus('review', 'request-changes'), 'draft');
  assert.equal(transitionStatus('approved', 'queue'), 'queued');
  assert.equal(transitionStatus('queued', 'unqueue'), 'approved');
  assert.equal(transitionStatus('queued', 'publish'), 'published');
});

test('invalid transitions are rejected', () => {
  assert.deepEqual(transitionStatus('draft', 'approve'), { error: 'Cannot approve a draft item' });
  assert.ok(typeof transitionStatus('draft', 'publish') === 'object');
  assert.ok(typeof transitionStatus('approved', 'publish') === 'object');
  assert.ok(typeof transitionStatus('published', 'submit') === 'object');
});

test('authors cannot approve their own draft unless they are an admin', () => {
  assert.equal(canApprove({ id: 'u1', role: 'member' }, 'u1'), false);
  assert.equal(canApprove({ id: 'u2', role: 'member' }, 'u1'), true);
  assert.equal(canApprove({ id: 'u1', role: 'admin' }, 'u1'), true);
  assert.equal(canApprove({ id: 'u1', role: 'member' }, null), true);
});

test('editing reviewed, approved or queued content sends it back to draft', () => {
  assert.equal(editResetsStatus('draft'), 'draft');
  assert.equal(editResetsStatus('review'), 'draft');
  assert.equal(editResetsStatus('approved'), 'draft');
  assert.equal(editResetsStatus('queued'), 'draft');
  assert.equal(editResetsStatus('published'), 'published');
});

// ---------- Diff ----------

test('line diff marks added, removed and unchanged lines', () => {
  const diff = lineDiff('a\nb\nc', 'a\nB\nc\nd');
  assert.deepEqual(diff, [
    { type: 'same', text: 'a' },
    { type: 'remove', text: 'b' },
    { type: 'add', text: 'B' },
    { type: 'same', text: 'c' },
    { type: 'add', text: 'd' },
  ]);
  assert.deepEqual(diffStats(diff), { added: 2, removed: 1 });
  assert.deepEqual(lineDiff('same', 'same'), [{ type: 'same', text: 'same' }]);
  assert.deepEqual(lineDiff('', 'x'), [{ type: 'add', text: 'x' }]);
});

test('line diff stays bounded on very large inputs', () => {
  const big = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join('\n');
  const other = Array.from({ length: 5000 }, (_, index) => `row ${index}`).join('\n');
  const started = Date.now();
  const diff = lineDiff(big, other);
  assert.ok(Date.now() - started < 3000);
  assert.deepEqual(diffStats(diff), { added: 5000, removed: 5000 });
});

// ---------- Markdown / HTML export ----------

test('markdown renders headings, lists, emphasis, links and code', () => {
  const html = markdownToHtml('# Title\n\nSome **bold** and *it* with `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n[Link](https://indonesiancheer.org/a)\n\n> quote\n\n---\n\n```\nx < y\n```');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>it<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
  assert.match(html, /<ol>\n<li>first<\/li>\n<li>second<\/li>\n<\/ol>/);
  assert.match(html, /<a href="https:\/\/indonesiancheer.org\/a">Link<\/a>/);
  assert.match(html, /<blockquote><p>quote<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<pre><code>x &lt; y<\/code><\/pre>/);
});

test('markdown export escapes raw HTML and drops unsafe links', () => {
  const html = markdownToHtml('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](/relative) <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="\/relative">y<\/a>/);
  assert.equal(escapeHtml(`"'<>&`), '&quot;&#39;&lt;&gt;&amp;');
});

test('markdown and HTML exports carry title, description and slug', () => {
  const draft = { title: 'Cheer "Guide"', slug: 'cheer-guide', meta_description: 'All about cheer: rules', body_markdown: '## Intro\n\nHello' };
  const md = renderMarkdownExport(draft);
  assert.match(md, /^---\ntitle: "Cheer \\"Guide\\""\nslug: "cheer-guide"\ndescription: "All about cheer: rules"\n---\n\n## Intro/);
  const html = renderHtmlExport(draft);
  assert.match(html, /<title>Cheer &quot;Guide&quot;<\/title>/);
  assert.match(html, /<meta name="description" content="All about cheer: rules">/);
  assert.match(html, /<h2>Intro<\/h2>/);
});

// ---------- Prompting and AI output ----------

test('create requests need a keyword and accept a case study, queue item and guideline', () => {
  assert.deepEqual(parseCreateRequest({}), { error: 'keyword is required' });
  const parsed = parseCreateRequest({ keyword: '  lomba   cheers ', caseStudy: 'ICA Nationals 2026', queueItemId: 'q1', brandGuidelineId: 'default', mode: 'ai', instructions: 'Bahasa Indonesia' });
  assert.ok(!('error' in parsed));
  if ('error' in parsed) return;
  assert.equal(parsed.keyword, 'lomba cheers');
  assert.equal(parsed.caseStudy, 'ICA Nationals 2026');
  assert.equal(parsed.queueItemId, 'q1');
  assert.equal(parsed.brandGuidelineId, null);
  assert.equal(parsed.mode, 'ai');
  assert.equal((parseCreateRequest({ keyword: 'x', mode: 'blank' }) as { mode: string }).mode, 'blank');
  assert.ok('error' in parseCreateRequest({ keyword: 'x', caseStudy: 'y'.repeat(20001) }));
});

test('draft prompt includes keyword, case study, opportunity context and output contract', () => {
  const { system, user } = buildDraftPrompt({
    siteName: 'Indonesian Cheer Association', siteUrl: 'https://indonesiancheer.org/', keyword: 'lomba cheers',
    caseStudy: 'ICA Nationals had 120 teams.', targetPageUrl: 'https://indonesiancheer.org/events',
    opportunityType: 're-optimize', metrics: { position: 8.4, impressions: 1200 }, instructions: 'Write in Bahasa Indonesia',
  });
  assert.match(system, /SEO/);
  assert.match(system, /JSON/);
  assert.match(user, /lomba cheers/);
  assert.match(user, /ICA Nationals had 120 teams\./);
  assert.match(user, /re-optimize/);
  assert.match(user, /https:\/\/indonesiancheer.org\/events/);
  assert.match(user, /8\.4/);
  assert.match(user, /Bahasa Indonesia/);
});

test('rewrite prompt carries the current article and the instruction', () => {
  const { user } = buildRewritePrompt({ keyword: 'k', title: 'T', metaDescription: 'D', bodyMarkdown: '## Body', instruction: 'Shorter intro' });
  assert.match(user, /## Body/);
  assert.match(user, /Shorter intro/);
});

test('AI output is parsed from JSON, fenced JSON, or plain markdown', () => {
  const json = parseDraftOutput('{"title":"T","slug":"My Slug!","meta_description":"D","body_markdown":"## A"}', 'kw');
  assert.deepEqual(json, { title: 'T', slug: 'my-slug', metaDescription: 'D', bodyMarkdown: '## A' });
  const fenced = parseDraftOutput('```json\n{"title":"T2","body_markdown":"x"}\n```', 'kw');
  assert.equal(fenced.title, 'T2');
  assert.equal(fenced.slug, 't2');
  const plain = parseDraftOutput('# Plain Title\n\nBody text', 'my keyword');
  assert.equal(plain.title, 'Plain Title');
  assert.equal(plain.bodyMarkdown, '# Plain Title\n\nBody text');
  const empty = parseDraftOutput('{"title":""}', 'my keyword');
  assert.equal(empty.title, 'my keyword');
  assert.ok(parseDraftOutput('x'.repeat(MAX_BODY_LENGTH + 10), 'k').bodyMarkdown.length <= MAX_BODY_LENGTH);
});

test('slugify keeps ascii words and hyphens', () => {
  assert.equal(slugify('  Lomba Cheers 2026: Panduan Lengkap! '), 'lomba-cheers-2026-panduan-lengkap');
  assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
  assert.equal(slugify('***'), '');
});

// ---------- Wiring ----------

test('Content Studio pages and APIs are gated by the SEO feature', () => {
  for (const file of [
    'src/app/api/seo/content/route.ts',
    'src/app/api/seo/content/[id]/route.ts',
    'src/app/api/seo/content/[id]/rewrite/route.ts',
    'src/app/api/seo/content/[id]/versions/route.ts',
    'src/app/api/seo/content/[id]/export/route.ts',
  ]) {
    assert.match(read(file), /requireFeature\(request, 'seo'\)/, `${file} is not gated`);
  }
  const item = { href: '/dashboard/seo/content', feature: 'seo' as const };
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: ['seo'] }), true);
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: ['social-post'] }), false);
  assert.match(read('src/app/dashboard/layout.tsx'), /\/dashboard\/seo\/content/);
});

test('AI drafts go through generateContent with the seo-content task type (token_logs + fallback)', () => {
  const ai = read('src/lib/seo/content-ai.ts');
  assert.match(ai, /generateContent\(/);
  assert.match(ai, /taskType: 'seo-content'/);
  assert.match(ai, /getUserPreferredModel\([^)]*'seo-content'\)/);
  assert.match(ai, /DUPOIN_DEFAULT_BRAND_GUIDELINE/);
});
