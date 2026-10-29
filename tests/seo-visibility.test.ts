import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AVAILABLE_MODELS } from '../src/lib/openai';
import {
  DEFAULT_SETTINGS, DEFAULT_VISIBILITY_MODELS, HARD_MAX_CHECKS, VISIBILITY_DISCLAIMER,
  detectMentions, effectiveBrandTerms, extractUrls, firstIndexOf, listItems, parseClassifierOutput, parseCompetitor,
  parsePromptCsv, parsePromptInput, parseSettingsInput, parseTermList, planChecks, rate,
} from '../src/lib/seo/visibility';
import { executeChecks, runStatus, siteHostFor, type AskFn } from '../src/lib/seo/visibility-run';
import type { NewCheck } from '../src/lib/seo/visibility-store';
import { SEEDED_SOP_IDS, parseSopInput, sopInstructions } from '../src/lib/seo/sops';
import { parseCreateRequest, buildDraftPrompt } from '../src/lib/seo/content-prompt';
import { isDashboardNavItemVisible } from '../src/lib/authorization';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const migration = read('db/migrations/038_seo_ai_visibility_sops.sql');

// ---------- Migration 038 ----------

test('038 is transactional, idempotent and has no ? placeholders', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;\s*$/m);
  assert.ok(!migration.includes('?'), 'scripts/migrate.ts would rewrite ? into $n');
  for (const statement of migration.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^(;]*/g) ?? []) {
    assert.match(statement, /IF NOT EXISTS/, statement);
  }
  assert.match(migration, /ADD COLUMN IF NOT EXISTS sop_id/);
  assert.match(migration, /ON CONFLICT \(id\) DO NOTHING/);
  assert.ok(!/DROP\s/i.test(migration), 'forward-only, no drops');
});

test('038 defines the AI visibility tables, the overlap lock and the default models', () => {
  for (const table of ['seo_ai_prompts', 'seo_ai_visibility_settings', 'seo_ai_runs', 'seo_ai_checks', 'seo_sops']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
  }
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_ai_runs_one_running ON seo_ai_runs \(site_id\) WHERE status = 'running'/);
  for (const column of ['response TEXT', 'mentioned BOOLEAN', 'rank_in_answer INTEGER', 'cited_urls TEXT[]', 'answered_model TEXT']) {
    assert.ok(migration.includes(column), column);
  }
  for (const model of DEFAULT_VISIBILITY_MODELS) assert.ok(migration.includes(`'${model}'`), model);
  assert.match(migration, /max_checks_per_run INTEGER NOT NULL DEFAULT 60 CHECK \(max_checks_per_run BETWEEN 1 AND 300\)/);
});

test('038 seeds the five SOP templates with fixed ids', () => {
  for (const id of SEEDED_SOP_IDS) assert.ok(migration.includes(`'${id}'`), id);
  for (const title of ['On-page SEO checklist', 'Content refresh', 'Internal linking', 'Schema and structured data', 'Keyword research from Search Console']) {
    assert.ok(migration.includes(`'${title}'`), title);
  }
});

// ---------- Settings and prompt input ----------

test('default models are the three gateway models and all exist in the catalog', () => {
  assert.deepEqual([...DEFAULT_VISIBILITY_MODELS], ['cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash']);
  const ids = new Set(AVAILABLE_MODELS.map(model => model.id));
  for (const model of [...DEFAULT_SETTINGS.models, DEFAULT_SETTINGS.classifierModel]) assert.ok(ids.has(model), model);
  assert.equal(DEFAULT_SETTINGS.maxChecksPerRun, 60);
  assert.equal(DEFAULT_SETTINGS.classifierEnabled, false);
});

test('settings validate models against the catalog and bound the cap', () => {
  assert.deepEqual(parseSettingsInput({ models: ['ag/gemini-3-flash', 'ag/gemini-3-flash'], maxChecksPerRun: 30 }),
    { models: ['ag/gemini-3-flash'], classifierEnabled: false, classifierModel: 'ag/gemini-3-flash', maxChecksPerRun: 30 });
  assert.match((parseSettingsInput({ models: ['nope/model'] }) as { error: string }).error, /Unknown model/);
  assert.match((parseSettingsInput({ models: [] }) as { error: string }).error, /at least one/);
  assert.match((parseSettingsInput({ models: ['ag/gemini-3-flash'], maxChecksPerRun: HARD_MAX_CHECKS + 1 }) as { error: string }).error, /between 1 and 300/);
});

test('prompt input trims, dedupes terms and requires a prompt', () => {
  assert.deepEqual(parsePromptInput({ prompt: '  best  cheer club in Jakarta ', brandTerms: 'ICA, ica; Indonesian Cheer', competitors: ['Foo|FooCheer', ''] }), {
    prompt: 'best cheer club in Jakarta', brandTerms: ['ICA', 'Indonesian Cheer'], competitors: ['Foo|FooCheer'], active: true,
  });
  assert.equal((parsePromptInput({ prompt: ' ' }) as { error: string }).error, 'prompt is required');
  assert.equal((parsePromptInput({ prompt: 'x', active: false }) as { active: boolean }).active, false);
  assert.ok('error' in (parseTermList(Array.from({ length: 21 }, (_, i) => `t${i}`), 'Brand terms') as object));
});

test('prompt CSV import reads prompt, brand_terms, competitors and active', () => {
  const result = parsePromptCsv('prompt,brand_terms,competitors,active\n"Best cheer clubs, Jakarta",ICA;Indonesian Cheer,Foo|FooCheer;Bar,yes\n,ICA,,\nBest cheer clubs  Jakarta,,,\nCheer camp,,,no\n');
  assert.equal(result.dataRows, 4);
  assert.deepEqual(result.rows.map(row => row.prompt), ['Best cheer clubs, Jakarta', 'Best cheer clubs Jakarta', 'Cheer camp']);
  assert.deepEqual(result.rows[0].brandTerms, ['ICA', 'Indonesian Cheer']);
  assert.deepEqual(result.rows[0].competitors, ['Foo|FooCheer', 'Bar']);
  assert.equal(result.rows[2].active, false);
  assert.deepEqual(result.errors, [{ line: 3, error: 'prompt is required' }]);
  assert.match(parsePromptCsv('question\nHi\n').rows[0].prompt, /Hi/);
  assert.match(parsePromptCsv('foo\nbar\n').errors[0].error, /prompt/);
});

// ---------- Detection ----------

test('term matching is case-insensitive whole-term and Unicode aware', () => {
  assert.equal(firstIndexOf('We love ica events', ['ICA']), 8);
  assert.equal(firstIndexOf('Africa and Jamaica', ['ICA']), -1);
  assert.equal(firstIndexOf('Café Señor', ['señor']), 5);
  assert.equal(firstIndexOf('Indonesian   Cheer Association', ['Indonesian Cheer']), 0);
  assert.equal(firstIndexOf('price (USD) rises', ['(USD)']), 6);
});

test('cited URLs are extracted, de-duplicated and stripped of trailing punctuation', () => {
  const text = 'See [ICA](https://indonesiancheer.org/events). Also https://www.indonesiancheer.org/a, and https://foo.com/x?y=1. Again https://foo.com/x?y=1';
  assert.deepEqual(extractUrls(text), ['https://indonesiancheer.org/events', 'https://www.indonesiancheer.org/a', 'https://foo.com/x?y=1']);
});

test('list items are detected for numbered and bulleted answers', () => {
  const text = 'Top clubs:\n1. Alpha\n2. Beta\n   more on beta\n3. Gamma\n\nSummary text';
  const items = listItems(text);
  assert.equal(items.length, 3);
  assert.ok(text.slice(items[1].start, items[1].end).includes('more on beta'));
  assert.ok(!text.slice(items[2].start, items[2].end).includes('Summary'));
});

test('detectMentions finds the brand, its list rank, citations and competitors', () => {
  const response = 'Here are good options:\n1. **FooCheer** - big club\n2. Bar Spirit\n3. **ICA** (https://indonesiancheer.org) - national body\n\nBaz is also known.';
  const result = detectMentions({ response, brandTerms: ['ICA'], competitors: ['Foo|FooCheer', 'Bar Spirit', 'Baz', 'Nope'], siteHost: 'indonesiancheer.org' });
  assert.equal(result.mentioned, true);
  assert.equal(result.rankInAnswer, 3);
  assert.equal(result.siteCited, true);
  assert.deepEqual(result.citedUrls, ['https://indonesiancheer.org']);
  assert.deepEqual(result.competitorsMentioned, ['Foo', 'Bar Spirit', 'Baz']);
});

test('without a list, rank is the order of first mention among brand and competitors', () => {
  const result = detectMentions({ response: 'Foo and Bar are popular; ICA governs the sport.', brandTerms: ['ICA'], competitors: ['Foo', 'Bar'], siteHost: 'indonesiancheer.org' });
  assert.equal(result.rankInAnswer, 3);
  const none = detectMentions({ response: 'Foo is great.', brandTerms: ['ICA'], competitors: ['Foo'], siteHost: 'indonesiancheer.org' });
  assert.equal(none.mentioned, false);
  assert.equal(none.rankInAnswer, null);
});

test('a citation of the site or its host name counts as a mention', () => {
  assert.equal(detectMentions({ response: 'Source: https://events.indonesiancheer.org/x', brandTerms: ['Nope'], competitors: [], siteHost: 'indonesiancheer.org' }).mentioned, true);
  assert.equal(detectMentions({ response: 'Visit indonesiancheer.org for rules', brandTerms: [], competitors: [], siteHost: 'indonesiancheer.org' }).mentioned, true);
  assert.equal(detectMentions({ response: 'Visit notindonesiancheer.org', brandTerms: [], competitors: [], siteHost: 'indonesiancheer.org' }).mentioned, false);
});

test('brand terms default to the site name; competitor aliases use the first name', () => {
  assert.deepEqual(effectiveBrandTerms([], 'ICA Cheerleading'), ['ICA Cheerleading']);
  assert.deepEqual(effectiveBrandTerms(['ICA'], 'ICA Cheerleading'), ['ICA']);
  assert.deepEqual(parseCompetitor('Foo | FooCheer|'), { name: 'Foo', terms: ['Foo', 'FooCheer'] });
});

test('site host comes from the sc-domain property, else the site URL', () => {
  assert.equal(siteHostFor({ site_url: 'https://www.dupoin.co.id/', gsc_property: null }), 'dupoin.co.id');
  assert.equal(siteHostFor({ site_url: 'https://indonesiancheer.org/', gsc_property: 'sc-domain:indonesiancheer.org' }), 'indonesiancheer.org');
});

test('classifier verdicts are accepted only with a real quote from the answer', () => {
  const answer = 'The Indonesian cheer federation runs nationals.';
  assert.deepEqual(parseClassifierOutput('```json\n{"mentioned": true, "evidence": "Indonesian cheer  federation"}\n```', answer), { mentioned: true, evidence: 'Indonesian cheer  federation' });
  assert.deepEqual(parseClassifierOutput('{"mentioned": true, "evidence": "ICA is great"}', answer), { mentioned: false, evidence: null });
  assert.deepEqual(parseClassifierOutput('not json', answer), { mentioned: false, evidence: null });
  assert.deepEqual(parseClassifierOutput('{"mentioned": false, "evidence": ""}', answer), { mentioned: false, evidence: null });
});

// ---------- Planning ----------

test('planChecks asks every selected prompt on every model and rotates by last check', () => {
  const prompts = [
    { id: 'a', lastCheckedAt: '2026-10-20T00:00:00Z', createdAt: '2026-01-01' },
    { id: 'b', lastCheckedAt: null, createdAt: '2026-02-01' },
    { id: 'c', lastCheckedAt: '2026-10-01T00:00:00Z', createdAt: '2026-03-01' },
  ];
  const models = ['m1', 'm2', 'm3'];
  const plan = planChecks(prompts, models, 6);
  assert.deepEqual(plan.checks.map(c => `${c.promptId}:${c.model}`), ['b:m1', 'b:m2', 'b:m3', 'c:m1', 'c:m2', 'c:m3']);
  assert.equal(plan.skippedPrompts, 1);
  assert.equal(planChecks(prompts, models, 100).checks.length, 9);
  assert.deepEqual(planChecks(prompts, models, 2).checks.map(c => c.model), ['m1', 'm2']);
  assert.equal(planChecks(prompts, models, 10_000).checks.length, 9);
  assert.equal(planChecks([], models, 60).checks.length, 0);
});

test('rate rounds to one decimal and is null without data', () => {
  assert.equal(rate(1, 3), 33.3);
  assert.equal(rate(0, 0), null);
});

// ---------- Execution ----------

function fakeRun(ask: AskFn, classifierEnabled = false) {
  const saved: NewCheck[] = [];
  const progress: number[] = [];
  const promise = executeChecks({
    runId: 'run1',
    site: { id: 's1', name: 'ICA Cheerleading', site_url: 'https://indonesiancheer.org/', gsc_property: 'sc-domain:indonesiancheer.org' },
    prompts: new Map([['p1', { id: 'p1', prompt: 'Best cheer org', brand_terms: ['ICA'], competitors: ['Foo'] }]]),
    checks: [{ promptId: 'p1', model: 'm1' }, { promptId: 'p1', model: 'm2' }, { promptId: 'p1', model: 'm3' }],
    settings: { classifierEnabled, classifierModel: 'cls' },
    concurrency: 2,
  }, {
    ask,
    saveCheck: async check => { saved.push(check); },
    progress: async p => { progress.push(p.done + p.failed); },
  });
  return { promise, saved, progress };
}

test('executeChecks stores answers, fallbacks and errors per model', async () => {
  const ask: AskFn = async model => {
    if (model === 'm3') throw new Error('gateway 503');
    return { content: model === 'm1' ? '1. Foo\n2. ICA' : 'Foo only', model: model === 'm2' ? 'fallback-x' : model, inputTokens: 10, outputTokens: 20, cost: 0.01, fallbackLabel: model === 'm2' ? 'm2 -> fallback-x' : null };
  };
  const { promise, saved, progress } = fakeRun(ask);
  const result = await promise;
  assert.deepEqual(result, { done: 2, failed: 1, cost: 0.02 });
  assert.equal(progress.length, 3);
  const byModel = Object.fromEntries(saved.map(check => [check.model, check]));
  assert.equal(byModel.m1.mentioned, true);
  assert.equal(byModel.m1.rankInAnswer, 2);
  assert.equal(byModel.m1.detection, 'terms');
  assert.deepEqual(byModel.m1.competitorsMentioned, ['Foo']);
  assert.equal(byModel.m2.answeredModel, 'fallback-x');
  assert.equal(byModel.m2.mentioned, false);
  assert.equal(byModel.m3.error, 'gateway 503');
  assert.equal(byModel.m3.mentioned, null);
  assert.equal(runStatus(result, 3), 'partial');
  assert.equal(runStatus({ done: 0, failed: 3, cost: 0 }, 3), 'failed');
  assert.equal(runStatus({ done: 3, failed: 0, cost: 0 }, 3), 'succeeded');
});

test('the optional classifier only runs when term matching found nothing', async () => {
  const calls: string[] = [];
  const ask: AskFn = async model => {
    calls.push(model);
    if (model === 'cls') return { content: '{"mentioned": true, "evidence": "the national cheer body"}', model, inputTokens: 1, outputTokens: 1, cost: 0.001, fallbackLabel: null };
    return { content: model === 'm1' ? 'ICA leads.' : 'Ask the national cheer body.', model, inputTokens: 1, outputTokens: 1, cost: 0.01, fallbackLabel: null };
  };
  const { promise, saved } = fakeRun(ask, true);
  await promise;
  assert.equal(calls.filter(model => model === 'cls').length, 2);
  const m2 = saved.find(check => check.model === 'm2')!;
  assert.equal(m2.mentioned, true);
  assert.equal(m2.detection, 'classifier');
  assert.equal(m2.rankInAnswer, null);
  assert.equal(m2.cost, 0.011);
});

// ---------- SOPs ----------

test('SOP input requires a title and a known category', () => {
  assert.deepEqual(parseSopInput({ title: ' Checklist ', category: 'on-page', bodyMd: 'a\r\nb' }), { title: 'Checklist', category: 'on-page', bodyMd: 'a\nb' });
  assert.equal((parseSopInput({ title: '' }) as { error: string }).error, 'title is required');
  assert.equal((parseSopInput({ title: 'x', category: 'bogus' }) as { error: string }).error, 'Unknown category');
  assert.equal((parseSopInput({ title: 'x' }) as { category: string }).category, 'other');
});

test('Content Studio accepts an SOP and puts it in the draft prompt', () => {
  const parsed = parseCreateRequest({ keyword: 'cheer camp', sopId: SEEDED_SOP_IDS[0] });
  assert.equal((parsed as { sopId: string | null }).sopId, SEEDED_SOP_IDS[0]);
  assert.equal((parseCreateRequest({ keyword: 'cheer camp' }) as { sopId: string | null }).sopId, null);
  const block = sopInstructions({ title: 'On-page SEO checklist', body_md: '- [ ] One H1' });
  assert.match(block, /On-page SEO checklist/);
  const prompt = buildDraftPrompt({ siteName: 'ICA', siteUrl: 'https://indonesiancheer.org/', keyword: 'cheer camp', caseStudy: null, targetPageUrl: null, instructions: block });
  assert.match(prompt.user, /One H1/);
  assert.ok(sopInstructions({ title: 't', body_md: 'x'.repeat(7000) }).includes('[SOP truncated]'));
});

// ---------- Wiring ----------

test('AI Visibility and SOP pages are in the SEO nav for SEO users', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /href: '\/dashboard\/seo\/visibility', label: 'AI Visibility'/);
  assert.match(layout, /href: '\/dashboard\/seo\/sops', label: 'SOPs'/);
  const item = { href: '/dashboard/seo/visibility', feature: 'seo' as const };
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: ['seo'] }), true);
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: ['social-post'] }), false);
});

test('the visibility page shows the required API disclaimer', () => {
  assert.equal(VISIBILITY_DISCLAIMER, 'Model answers via API, not what ChatGPT.com, Perplexity or Google AI Overviews show users.');
  const page = read('src/app/dashboard/seo/visibility/page.tsx');
  assert.match(page, /VISIBILITY_DISCLAIMER/);
});

test('Run now is admin-only and the cron script exists', () => {
  const runs = read('src/app/api/seo/visibility/runs/route.ts');
  assert.match(runs, /export async function POST[\s\S]*requireAdmin\(request\)/);
  assert.match(runs, /RunBusyError[\s\S]*409/);
  assert.ok(existsSync(path.join(root, 'scripts/seo-visibility.ts')));
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['seo:visibility'], 'tsx scripts/seo-visibility.ts');
});

test('SOP delete is admin-only', () => {
  const route = read('src/app/api/seo/sops/[id]/route.ts');
  assert.match(route, /export async function DELETE[\s\S]*requireAdmin\(request\)/);
});
