import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS } from '../src/lib/openai';
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from '../src/lib/image-models';
import { GENERATION_FEATURES } from '../src/lib/authorization';

const migrate = readFileSync('scripts/migrate.ts', 'utf8');
const aiResearch = readFileSync('db/migrations/012_ai_research_conversations.sql', 'utf8');
const imageAssignments = readFileSync('db/migrations/013_image_model_assignments.sql', 'utf8');
const catalog = new Set(AVAILABLE_MODELS.map(model => model.id));

function withoutSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

test('migrate.ts only applies canonical db/migrations SQL files', () => {
  assert.match(migrate, /path\.join\(process\.cwd\(\), 'db\/migrations'\)/);
  assert.doesNotMatch(migrate, /join\(process\.cwd\(\), 'migrations'\)/);
});

test('012 creates ai_research_conversations and expands department features idempotently', () => {
  const executable = withoutSqlComments(aiResearch);
  assert.match(aiResearch, /CREATE TABLE IF NOT EXISTS ai_research_conversations/);
  assert.match(aiResearch, /CREATE INDEX IF NOT EXISTS idx_ai_research_conv_user/);
  assert.match(aiResearch, /DROP CONSTRAINT IF EXISTS departments_permitted_features_valid/);
  assert.match(aiResearch, /ON CONFLICT \(feature_key\) DO NOTHING/);
  assert.doesNotMatch(executable, /pecut-free/);
  assert.doesNotMatch(executable, /ag\/gemini-3-flash-agent/);
  for (const feature of GENERATION_FEATURES) {
    assert.match(aiResearch, new RegExp(`'${feature}'`));
  }
  assert.match(aiResearch, /"ag\/gemini-3-flash"/);
  assert.match(aiResearch, /"ag\/gemini-3\.6-flash-high"/);
  assert.match(aiResearch, /"ag\/claude-sonnet-4-6"/);
  assert.match(aiResearch, /"ag\/gemini-3\.1-pro-low"/);

  const quoted = [...executable.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)].map(match => match[1]);
  const missing = quoted.filter(id => !catalog.has(id));
  assert.deepEqual(missing, [], '012 would write models that are not in AVAILABLE_MODELS');
});

test('014 restores Codex on AI Research, drops residual Kimi, and is idempotent', () => {
  const restore = readFileSync('db/migrations/014_restore_codex_ai_research.sql', 'utf8');
  const executable = withoutSqlComments(restore);
  assert.match(restore, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(restore, /ON CONFLICT \(feature_key\) DO NOTHING/);
  assert.doesNotMatch(restore, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(executable, /cx\/gpt-5\.6-sol/);
  assert.match(executable, /cx\/gpt-5\.3-codex-spark/);
  assert.match(executable, /cx\/gpt-5\.6-terra/);
  assert.match(executable, /cx\/gpt-5\.6-luna/);
  assert.match(executable, /feature_key = 'ai-research'/);
  assert.match(executable, /kimi\/%/);
  assert.match(executable, /tr\/moonshotai\/%/);
  assert.match(executable, /cmc\/moonshotai\/%/);
  assert.doesNotMatch(executable, /kimi\/k3|kimi\/kimi/);
  const quoted = [...executable.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)]
    .map(match => match[1])
    .filter(id => !id.includes('%'));
  const missing = quoted.filter(id => !catalog.has(id));
  assert.deepEqual(missing, [], '014 would write models that are not in AVAILABLE_MODELS');
});

test('013 creates image_model_assignments with the current catalog and is safe on existing prod', () => {
  const executable = withoutSqlComments(imageAssignments);
  assert.match(imageAssignments, /CREATE TABLE IF NOT EXISTS image_model_assignments/);
  assert.match(imageAssignments, /ON CONFLICT \(id\) DO NOTHING/);
  const seeded = executable.split(/UPDATE image_model_assignments/)[0];
  assert.doesNotMatch(seeded, /gpt-5\.6-terra|gpt-image-2/);
  assert.match(imageAssignments, /LIKE '%gpt-5\.6-terra%'/);
  assert.match(imageAssignments, new RegExp(DEFAULT_IMAGE_MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const id of IMAGE_MODELS) {
    assert.match(imageAssignments, new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
