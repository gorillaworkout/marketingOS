import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, CLAUDE_OPUS_5_5_MODEL, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_5_MODEL, CLAUDE_SONNET_5_MODEL, PREFERRED_CODEX_MODEL } from '../src/lib/openai';
import { DEFAULT_FEATURE_ASSIGNMENTS } from '../src/lib/model-routing';
import { IMAGE_MODELS } from '../src/lib/image-models';

/**
 * Guards against the failure that broke AI Research: code shipped defaults
 * pointing at gateway models that had been retired upstream, so every
 * generation either errored or returned a retirement notice as its "answer".
 */

const catalog = new Set(AVAILABLE_MODELS.map(model => model.id));
const routing = readFileSync('src/lib/model-routing.ts', 'utf8');
const openai = readFileSync('src/lib/openai.ts', 'utf8');
const retirement = readFileSync('db/migrations/011_retire_dead_gateway_models.sql', 'utf8');
const restore = readFileSync('db/migrations/014_restore_codex_ai_research.sql', 'utf8');
const claude5 = readFileSync('db/migrations/015_add_claude_sonnet5_opus5.sql', 'utf8');
const claude55 = readFileSync('db/migrations/024_add_claude_sonnet55_opus55.sql', 'utf8');
const retire46 = readFileSync('db/migrations/025_retire_claude_sonnet_4_6.sql', 'utf8');
const retireSpark = existsSync('db/migrations/027_retire_codex_spark.sql')
  ? readFileSync('db/migrations/027_retire_codex_spark.sql', 'utf8')
  : '';

/** Historical migrations still write this id. Migration 025 removes it from live allowlists. */
const RETIRED_SONNET_46 = 'ag/claude-sonnet-4-6';
/** Historical migrations 014–025 still write this id. Migration 027 removes it from live allowlists. */
const RETIRED_SPARK = 'cx/gpt-5.3-codex-spark';

function missingFromCurrentCatalog(ids: string[]): string[] {
  return ids.filter(id => id !== RETIRED_SONNET_46 && id !== RETIRED_SPARK && !catalog.has(id));
}

function quotedModelIds(source: string): string[] {
  return [...source.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)]
    .map(match => match[1])
    .filter(id => !id.includes('%'));
}

test('every model id hardcoded in model-routing exists in the catalog', () => {
  const referenced = [...new Set(quotedModelIds(routing))];
  assert.ok(referenced.length > 0, 'test would be vacuous with no ids');
  const missing = referenced.filter(id => !catalog.has(id));
  assert.deepEqual(missing, [], 'routing references models that are not in AVAILABLE_MODELS');
  assert.ok(!referenced.includes(RETIRED_SONNET_46), 'routing must not allow Claude Sonnet 4.6');
});

test('the openai.ts fallback model exists in the catalog', () => {
  const match = openai.match(/const PRIMARY_MODEL = '([^']+)'/);
  assert.ok(match, 'PRIMARY_MODEL must be declared');
  assert.ok(catalog.has(match![1]), `PRIMARY_MODEL ${match![1]} is not in AVAILABLE_MODELS`);
});

test('every AI Research route fallback model exists in the catalog', () => {
  const route = readFileSync('src/app/api/ai-research/chat/route.ts', 'utf8');
  for (const id of quotedModelIds(route)) {
    assert.ok(catalog.has(id), `ai-research route references retired model ${id}`);
  }
});

test('the retirement migration only writes models that exist in the catalog', () => {
  const referenced = [...new Set(quotedModelIds(retirement))];
  assert.ok(referenced.length > 0);
  // 011 filters by the allowlist that was live then. Sonnet 4.6 was on that
  // list; migration 025 removes it, so it is no longer in AVAILABLE_MODELS.
  const missing = missingFromCurrentCatalog(referenced);
  assert.deepEqual(missing, [], 'migration would write models that are not in AVAILABLE_MODELS');
  assert.ok(referenced.includes(RETIRED_SONNET_46), '011 historically wrote Sonnet 4.6; 025 retires it');
});

test('migration 011 is forward-only and never drops user data', () => {
  assert.doesNotMatch(retirement, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(retirement, /BEGIN;[\s\S]*COMMIT;/);
});

test('AI Research defaults include GPT-5.6 Sol, Claude 5, and no Kimi', () => {
  const assignment = DEFAULT_FEATURE_ASSIGNMENTS['ai-research'];
  assert.equal(assignment.defaultModel, PREFERRED_CODEX_MODEL);
  assert.ok(assignment.allowedModels.includes(PREFERRED_CODEX_MODEL));
  assert.ok(!assignment.allowedModels.includes(RETIRED_SPARK));
  assert.ok(assignment.allowedModels.includes('cx/gpt-5.6-terra'));
  assert.ok(assignment.allowedModels.includes('cx/gpt-5.6-luna'));
  assert.ok(assignment.allowedModels.includes('ag/gemini-3-flash'));
  assert.ok(assignment.allowedModels.includes(CLAUDE_SONNET_5_MODEL));
  assert.ok(assignment.allowedModels.includes(CLAUDE_OPUS_5_MODEL));
  assert.ok(assignment.allowedModels.includes(CLAUDE_SONNET_5_5_MODEL));
  assert.ok(assignment.allowedModels.includes(CLAUDE_OPUS_5_5_MODEL));
  assert.ok(!assignment.allowedModels.includes(RETIRED_SONNET_46));
  assert.notEqual(assignment.defaultModel, CLAUDE_SONNET_5_5_MODEL);
  assert.notEqual(assignment.defaultModel, CLAUDE_OPUS_5_5_MODEL);
  assert.notEqual(assignment.defaultModel, RETIRED_SONNET_46);
  assert.ok(assignment.allowedModels.includes(assignment.defaultModel));
  assert.ok(assignment.allowedModels.every(id => catalog.has(id)));
  assert.ok(!assignment.allowedModels.some(id =>
    id.startsWith('kimi/') || id.startsWith('tr/') || id.startsWith('cmc/moonshotai/') || id.toLowerCase().includes('kimi')));
});

test('every workflow allowlist includes Sol, Claude 5, and Claude 5.5 and drops Spark and Sonnet 4.6', () => {
  for (const [feature, assignment] of Object.entries(DEFAULT_FEATURE_ASSIGNMENTS)) {
    assert.ok(assignment.allowedModels.includes(PREFERRED_CODEX_MODEL), `${feature} missing Sol`);
    assert.ok(!assignment.allowedModels.includes(RETIRED_SPARK), `${feature} still allows Codex Spark`);
    assert.ok(assignment.allowedModels.includes(CLAUDE_SONNET_5_MODEL), `${feature} missing Claude Sonnet 5`);
    assert.ok(assignment.allowedModels.includes(CLAUDE_OPUS_5_MODEL), `${feature} missing Claude Opus 5`);
    assert.ok(assignment.allowedModels.includes(CLAUDE_SONNET_5_5_MODEL), `${feature} missing Claude Sonnet 5.5`);
    assert.ok(assignment.allowedModels.includes(CLAUDE_OPUS_5_5_MODEL), `${feature} missing Claude Opus 5.5`);
    assert.ok(!assignment.allowedModels.includes(RETIRED_SONNET_46), `${feature} still allows Sonnet 4.6`);
    assert.ok(assignment.allowedModels.includes(assignment.defaultModel), `${feature} default outside allowlist`);
    assert.notEqual(assignment.defaultModel, CLAUDE_OPUS_5_5_MODEL, `${feature} should not default to Opus 5.5`);
    assert.notEqual(assignment.defaultModel, RETIRED_SONNET_46, `${feature} should not default to Sonnet 4.6`);
    if (feature === 'article-market-news' || feature === 'market-research') {
      assert.equal(assignment.defaultModel, CLAUDE_SONNET_5_5_MODEL, `${feature} should default to Sonnet 5.5`);
      assert.ok(assignment.allowedModels.includes('lr/claude-sonnet-4.5'), `${feature} must keep Sonnet 4.5`);
    } else {
      assert.notEqual(assignment.defaultModel, CLAUDE_SONNET_5_5_MODEL, `${feature} should keep its existing default`);
    }
    if (feature !== 'ai-research') {
      assert.notEqual(assignment.defaultModel, PREFERRED_CODEX_MODEL, `${feature} should keep its existing default`);
      assert.notEqual(assignment.defaultModel, CLAUDE_SONNET_5_MODEL, `${feature} should keep its existing default`);
      assert.notEqual(assignment.defaultModel, CLAUDE_OPUS_5_MODEL, `${feature} should keep its existing default`);
    }
  }
});

test('the Codex restore migration only writes catalog models and never writes Kimi', () => {
  const referenced = [...new Set(quotedModelIds(restore))];
  assert.ok(referenced.includes(PREFERRED_CODEX_MODEL));
  const missing = missingFromCurrentCatalog(referenced);
  assert.deepEqual(missing, [], '014 would write models that are not in AVAILABLE_MODELS');
  assert.doesNotMatch(restore.replace(/--.*$/gm, ''), /kimi\/k|tr\/moonshotai\/kimi/);
  assert.match(restore, /kimi\/%/);
  assert.match(restore, /tr\/moonshotai\/%/);
  assert.match(restore, /cmc\/moonshotai\/%/);
  assert.match(restore, /cx\/gpt-5\.3-codex-spark/);
  assert.doesNotMatch(restore, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(restore, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(restore, /ON CONFLICT \(feature_key\) DO NOTHING/);
});

test('the Claude 5 restore migration only writes catalog models and never writes Kimi', () => {
  const referenced = [...new Set(quotedModelIds(claude5))];
  assert.ok(referenced.includes(CLAUDE_SONNET_5_MODEL));
  assert.ok(referenced.includes(CLAUDE_OPUS_5_MODEL));
  const missing = missingFromCurrentCatalog(referenced);
  assert.deepEqual(missing, [], '015 would write models that are not in AVAILABLE_MODELS');
  assert.doesNotMatch(claude5.replace(/--.*$/gm, ''), /kimi\/k|tr\/moonshotai\/kimi/);
  assert.doesNotMatch(claude5.replace(/--.*$/gm, ''), /cc\/claude-fable|cc\/claude-haiku/);
  assert.match(claude5, /kimi\/%/);
  assert.match(claude5, /tr\/moonshotai\/%/);
  assert.match(claude5, /cmc\/moonshotai\/%/);
  assert.match(claude5, /cc\/claude-sonnet-5/);
  assert.match(claude5, /cc\/claude-opus-5/);
  assert.match(claude5, /ag\/claude-sonnet-4-6/);
  assert.match(claude5, /lr\/claude-sonnet-4\.5/);
  assert.match(claude5, /'ai-research'/);
  assert.doesNotMatch(claude5, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(claude5, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(claude5, /ON CONFLICT \(feature_key\) DO NOTHING/);
});

test('the Claude 5.5 migration only writes catalog models and never writes Kimi', () => {
  const referenced = [...new Set(quotedModelIds(claude55))];
  assert.ok(referenced.includes(CLAUDE_SONNET_5_MODEL));
  assert.ok(referenced.includes(CLAUDE_OPUS_5_MODEL));
  assert.ok(referenced.includes(CLAUDE_SONNET_5_5_MODEL));
  assert.ok(referenced.includes(CLAUDE_OPUS_5_5_MODEL));
  const missing = missingFromCurrentCatalog(referenced);
  assert.deepEqual(missing, [], '024 would write models that are not in AVAILABLE_MODELS');
  assert.doesNotMatch(claude55.replace(/--.*$/gm, ''), /kimi\/k|tr\/moonshotai\/kimi/);
  assert.doesNotMatch(claude55.replace(/--.*$/gm, ''), /cc\/claude-fable|cc\/claude-haiku/);
  assert.match(claude55, /kimi\/%/);
  assert.match(claude55, /tr\/moonshotai\/%/);
  assert.match(claude55, /cmc\/moonshotai\/%/);
  assert.match(claude55, /'cc\/claude-sonnet-5'/);
  assert.match(claude55, /'cc\/claude-opus-5'/);
  assert.match(claude55, /cc\/claude-sonnet-5-5/);
  assert.match(claude55, /cc\/claude-opus-5-5/);
  assert.match(claude55, /ag\/claude-sonnet-4-6/);
  assert.match(claude55, /lr\/claude-sonnet-4\.5/);
  assert.match(claude55, /'ai-research'/);
  assert.match(claude55, /GET https:\/\/llmdupoin\.gorillaworkout\.id\/v1\/models/);
  assert.match(claude55, /chat\/completions was not verified/);
  assert.doesNotMatch(claude55, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(claude55, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(claude55, /ON CONFLICT \(feature_key\) DO NOTHING/);
});

test('migration 025 removes Sonnet 4.6, keeps Claude 5.5, and only writes catalog models', () => {
  const referenced = [...new Set(quotedModelIds(retire46))];
  assert.ok(referenced.includes(CLAUDE_SONNET_5_5_MODEL));
  assert.ok(referenced.includes(CLAUDE_OPUS_5_5_MODEL));
  assert.ok(referenced.includes(CLAUDE_SONNET_5_MODEL));
  assert.ok(referenced.includes(CLAUDE_OPUS_5_MODEL));
  assert.ok(referenced.includes('lr/claude-sonnet-4.5'));
  assert.ok(referenced.includes(RETIRED_SONNET_46), '025 must name Sonnet 4.6 in order to remove it');
  const imageIds = new Set<string>(IMAGE_MODELS);
  const missing = missingFromCurrentCatalog(referenced.filter(id => !imageIds.has(id)));
  assert.deepEqual(missing, [], '025 would write models that are not in AVAILABLE_MODELS');
  const executable = retire46.replace(/--.*$/gm, '');
  const seeded = executable.split(/INSERT INTO feature_model_assignments/)[1]?.split(/UPDATE task_model_preferences/)[0] ?? '';
  assert.doesNotMatch(seeded, /ag\/claude-sonnet-4-6/);
  assert.match(seeded, /cc\/claude-sonnet-5-5/);
  assert.match(seeded, /cc\/claude-opus-5-5/);
  assert.match(executable, /model <> 'ag\/claude-sonnet-4-6'/);
  assert.match(executable, /WHEN default_model = 'ag\/claude-sonnet-4-6' THEN 'cc\/claude-sonnet-5-5'/);
  assert.match(executable, /preference\.model = 'ag\/claude-sonnet-4-6'/);
  assert.match(retire46, /503 on 2026-10-02/);
  assert.doesNotMatch(executable, /kimi\/k|tr\/moonshotai\/kimi/);
  assert.match(retire46, /kimi\/%/);
  assert.doesNotMatch(retire46, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(retire46, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(retire46, /ON CONFLICT \(feature_key\) DO NOTHING/);
  for (const feature of ['social-post', 'video-script', 'event-plan', 'article-market-news', 'market-research', 'ai-research']) {
    assert.match(retire46, new RegExp(`'${feature}'`));
  }
});

test('catalog itself contains Codex, Claude 5, Claude 5.5, and excludes Spark, Kimi, and Sonnet 4.6', () => {
  assert.ok(catalog.has(PREFERRED_CODEX_MODEL));
  assert.ok(catalog.has('cx/gpt-5.6-terra'));
  assert.ok(catalog.has('cx/gpt-5.6-luna'));
  assert.ok(!catalog.has(RETIRED_SPARK));
  assert.ok(catalog.has(CLAUDE_SONNET_5_MODEL));
  assert.ok(catalog.has(CLAUDE_OPUS_5_MODEL));
  assert.ok(catalog.has(CLAUDE_SONNET_5_5_MODEL));
  assert.ok(catalog.has(CLAUDE_OPUS_5_5_MODEL));
  assert.ok(!catalog.has(RETIRED_SONNET_46));
  assert.ok(![...catalog].some(id => id.includes('claude-opus-4-6') || id.includes('claude-sonnet-4-6')));
  assert.ok(catalog.has('lr/claude-sonnet-4.5'));
  assert.ok([...catalog].some(id => id.startsWith('cx/')));
  assert.ok(![...catalog].some(id =>
    id.startsWith('kimi/') || id.startsWith('tr/') || id.startsWith('cmc/moonshotai/') || id.toLowerCase().includes('kimi')));
  assert.ok(![...catalog].some(id => id.startsWith('cc/') && id !== CLAUDE_SONNET_5_MODEL && id !== CLAUDE_OPUS_5_MODEL && id !== CLAUDE_SONNET_5_5_MODEL && id !== CLAUDE_OPUS_5_5_MODEL), 'unrequested cc/* stay out');
  assert.ok(![...catalog].some(id => id.endsWith('-review')), 'do not dump unverified *-review Codex ids');
});

test('migration 027 removes Codex Spark, keeps other defaults, and only writes catalog models', () => {
  const referenced = [...new Set(quotedModelIds(retireSpark))];
  assert.ok(referenced.includes(RETIRED_SPARK), '027 must name Codex Spark in order to remove it');
  assert.ok(referenced.includes(PREFERRED_CODEX_MODEL));
  const missing = missingFromCurrentCatalog(referenced);
  assert.deepEqual(missing, [], '027 would write models that are not in AVAILABLE_MODELS');
  const executable = retireSpark.replace(/--.*$/gm, '');
  const seeded = executable.split(/INSERT INTO feature_model_assignments/)[1]?.split(/UPDATE task_model_preferences/)[0] ?? '';
  assert.doesNotMatch(seeded, /cx\/gpt-5\.3-codex-spark/);
  assert.match(seeded, /cx\/gpt-5\.6-sol/);
  assert.match(executable, /model <> 'cx\/gpt-5\.3-codex-spark'/);
  assert.match(executable, /WHEN default_model = 'cx\/gpt-5\.3-codex-spark'/);
  assert.match(executable, /WHEN 'ai-research' THEN 'cx\/gpt-5\.6-sol'/);
  assert.match(executable, /ELSE default_model/);
  assert.match(executable, /preference\.model = 'cx\/gpt-5\.3-codex-spark'/);
  assert.match(executable, /model = assignment\.default_model/);
  assert.doesNotMatch(retireSpark, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(retireSpark, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(retireSpark, /ON CONFLICT \(feature_key\) DO NOTHING/);
  assert.match(retireSpark, /ChatGPT-account Codex login/);
  for (const feature of ['social-post', 'video-script', 'event-plan', 'article-market-news', 'market-research', 'ai-research']) {
    assert.match(retireSpark, new RegExp(`'${feature}'`));
  }
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['ai-research'].defaultModel, PREFERRED_CODEX_MODEL);
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['social-post'].defaultModel, 'ag/gemini-3-flash');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['video-script'].defaultModel, 'ag/gemini-3-flash');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['event-plan'].defaultModel, 'ag/gemini-3.1-pro-low');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['article-market-news'].defaultModel, CLAUDE_SONNET_5_5_MODEL);
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['market-research'].defaultModel, CLAUDE_SONNET_5_5_MODEL);
});
