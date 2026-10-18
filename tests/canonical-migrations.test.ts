import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, CLAUDE_OPUS_5_5_MODEL, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_5_MODEL, CLAUDE_SONNET_5_MODEL } from '../src/lib/openai';
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from '../src/lib/image-models';
import { GENERATION_FEATURES } from '../src/lib/authorization';

const migrate = readFileSync('scripts/migrate.ts', 'utf8');
const aiResearch = readFileSync('db/migrations/012_ai_research_conversations.sql', 'utf8');
const imageAssignments = readFileSync('db/migrations/013_image_model_assignments.sql', 'utf8');
const catalog = new Set(AVAILABLE_MODELS.map(model => model.id));
const RETIRED_SONNET_46 = 'ag/claude-sonnet-4-6';
const RETIRED_SPARK = 'cx/gpt-5.3-codex-spark';

function missingFromCurrentCatalog(ids: string[]): string[] {
  return ids.filter(id => id !== RETIRED_SONNET_46 && id !== RETIRED_SPARK && !catalog.has(id));
}

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
  const missing = missingFromCurrentCatalog(quoted);
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
  assert.match(restore, /\/dashboard\/models/);
  assert.match(executable, /kimi\/%/);
  assert.match(executable, /tr\/moonshotai\/%/);
  assert.match(executable, /cmc\/moonshotai\/%/);
  assert.doesNotMatch(executable, /kimi\/k3|kimi\/kimi/);
  const quoted = [...executable.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)]
    .map(match => match[1])
    .filter(id => !id.includes('%'));
  const missing = missingFromCurrentCatalog(quoted);
  assert.deepEqual(missing, [], '014 would write models that are not in AVAILABLE_MODELS');
});

test('015 adds Claude Sonnet 5 and Opus 5 to every feature, drops residual Kimi, and is idempotent', () => {
  const claude5 = readFileSync('db/migrations/015_add_claude_sonnet5_opus5.sql', 'utf8');
  const executable = withoutSqlComments(claude5);
  assert.match(claude5, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(claude5, /ON CONFLICT \(feature_key\) DO NOTHING/);
  assert.doesNotMatch(claude5, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(executable, /cc\/claude-sonnet-5/);
  assert.match(executable, /cc\/claude-opus-5/);
  assert.match(executable, /ag\/claude-sonnet-4-6/);
  assert.match(executable, /lr\/claude-sonnet-4\.5/);
  assert.match(executable, /'ai-research'/);
  assert.match(executable, /kimi\/%/);
  assert.match(executable, /tr\/moonshotai\/%/);
  assert.match(executable, /cmc\/moonshotai\/%/);
  assert.doesNotMatch(executable, /kimi\/k3|kimi\/kimi/);
  assert.doesNotMatch(executable, /cc\/claude-fable|cc\/claude-haiku/);
  for (const feature of GENERATION_FEATURES) {
    assert.match(claude5, new RegExp(`'${feature}'`));
  }
  const quoted = [...executable.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)]
    .map(match => match[1])
    .filter(id => !id.includes('%'));
  assert.ok(quoted.includes(CLAUDE_SONNET_5_MODEL));
  assert.ok(quoted.includes(CLAUDE_OPUS_5_MODEL));
  const missing = missingFromCurrentCatalog(quoted);
  assert.deepEqual(missing, [], '015 would write models that are not in AVAILABLE_MODELS');
});

test('024 adds Claude Sonnet 5.5 and Opus 5.5 to every feature, keeps older Claude ids, and is idempotent', () => {
  const claude55 = readFileSync('db/migrations/024_add_claude_sonnet55_opus55.sql', 'utf8');
  const executable = withoutSqlComments(claude55);
  assert.match(claude55, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(claude55, /ON CONFLICT \(feature_key\) DO NOTHING/);
  assert.doesNotMatch(claude55, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(executable, /'cc\/claude-sonnet-5'/);
  assert.match(executable, /'cc\/claude-opus-5'/);
  assert.match(executable, /cc\/claude-sonnet-5-5/);
  assert.match(executable, /cc\/claude-opus-5-5/);
  assert.match(executable, /ag\/claude-sonnet-4-6/);
  assert.match(executable, /lr\/claude-sonnet-4\.5/);
  assert.match(executable, /'ai-research'/);
  assert.match(executable, /kimi\/%/);
  assert.match(executable, /tr\/moonshotai\/%/);
  assert.match(executable, /cmc\/moonshotai\/%/);
  assert.match(claude55, /chat\/completions was not verified/);
  assert.doesNotMatch(executable, /kimi\/k3|kimi\/kimi/);
  assert.doesNotMatch(executable, /cc\/claude-fable|cc\/claude-haiku/);
  for (const feature of GENERATION_FEATURES) {
    assert.match(claude55, new RegExp(`'${feature}'`));
  }
  const quoted = [...executable.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)]
    .map(match => match[1])
    .filter(id => !id.includes('%'));
  assert.ok(quoted.includes(CLAUDE_SONNET_5_MODEL));
  assert.ok(quoted.includes(CLAUDE_OPUS_5_MODEL));
  assert.ok(quoted.includes(CLAUDE_SONNET_5_5_MODEL));
  assert.ok(quoted.includes(CLAUDE_OPUS_5_5_MODEL));
  const missing = missingFromCurrentCatalog(quoted);
  assert.deepEqual(missing, [], '024 would write models that are not in AVAILABLE_MODELS');
});

test('025 removes Claude Sonnet 4.6, keeps Sonnet 5.5 and Opus 5.5, and is idempotent', () => {
  const retire46 = readFileSync('db/migrations/025_retire_claude_sonnet_4_6.sql', 'utf8');
  const executable = withoutSqlComments(retire46);
  assert.match(retire46, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(retire46, /ON CONFLICT \(feature_key\) DO NOTHING/);
  assert.doesNotMatch(retire46, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(executable, /model <> 'ag\/claude-sonnet-4-6'/);
  assert.match(executable, /WHEN default_model = 'ag\/claude-sonnet-4-6' THEN 'cc\/claude-sonnet-5-5'/);
  assert.match(executable, /preference\.model = 'ag\/claude-sonnet-4-6'/);
  assert.match(executable, /cc\/claude-sonnet-5-5/);
  assert.match(executable, /cc\/claude-opus-5-5/);
  assert.match(executable, /'cc\/claude-sonnet-5'/);
  assert.match(executable, /'cc\/claude-opus-5'/);
  assert.match(executable, /lr\/claude-sonnet-4\.5/);
  assert.match(executable, /image_model_assignments/);
  assert.match(retire46, /503 on 2026-10-02/);
  assert.doesNotMatch(executable, /kimi\/k3|kimi\/kimi/);
  const seeded = executable.split(/INSERT INTO feature_model_assignments/)[1]?.split(/UPDATE task_model_preferences/)[0] ?? '';
  assert.doesNotMatch(seeded, /ag\/claude-sonnet-4-6/);
  assert.match(seeded, /'cc\/claude-sonnet-5-5'/);
  for (const feature of GENERATION_FEATURES) {
    assert.match(retire46, new RegExp(`'${feature}'`));
  }
  const quoted = [...executable.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)]
    .map(match => match[1])
    .filter(id => !id.includes('%') && !IMAGE_MODELS.includes(id));
  assert.ok(quoted.includes(CLAUDE_SONNET_5_5_MODEL));
  assert.ok(quoted.includes(CLAUDE_OPUS_5_5_MODEL));
  assert.ok(quoted.includes(RETIRED_SONNET_46));
  const missing = missingFromCurrentCatalog(quoted);
  assert.deepEqual(missing, [], '025 would write chat models that are not in AVAILABLE_MODELS');
});

test('027 removes Codex Spark from allowlists and is idempotent', () => {
  const retireSpark = existsSync('db/migrations/027_retire_codex_spark.sql')
    ? readFileSync('db/migrations/027_retire_codex_spark.sql', 'utf8')
    : '';
  const executable = withoutSqlComments(retireSpark);
  assert.match(retireSpark, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(retireSpark, /ON CONFLICT \(feature_key\) DO NOTHING/);
  assert.doesNotMatch(retireSpark, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(executable, /model <> 'cx\/gpt-5\.3-codex-spark'/);
  assert.match(executable, /WHEN default_model = 'cx\/gpt-5\.3-codex-spark'/);
  assert.match(executable, /WHEN 'ai-research' THEN 'cx\/gpt-5\.6-sol'/);
  assert.match(executable, /ELSE default_model/);
  assert.match(executable, /preference\.model = 'cx\/gpt-5\.3-codex-spark'/);
  assert.match(executable, /cx\/gpt-5\.6-terra/);
  assert.match(executable, /cx\/gpt-5\.6-luna/);
  assert.match(retireSpark, /ChatGPT-account Codex login/);
  const seeded = executable.split(/INSERT INTO feature_model_assignments/)[1]?.split(/UPDATE task_model_preferences/)[0] ?? '';
  assert.doesNotMatch(seeded, /cx\/gpt-5\.3-codex-spark/);
  assert.match(seeded, /'cx\/gpt-5\.6-sol'/);
  for (const feature of GENERATION_FEATURES) {
    assert.match(retireSpark, new RegExp(`'${feature}'`));
  }
  const quoted = [...executable.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)]
    .map(match => match[1])
    .filter(id => !id.includes('%'));
  assert.ok(quoted.includes(RETIRED_SPARK));
  assert.ok(quoted.includes('cx/gpt-5.6-sol'));
  const missing = missingFromCurrentCatalog(quoted);
  assert.deepEqual(missing, [], '027 would write models that are not in AVAILABLE_MODELS');
});

test('026 adds per-user AI Research memory and is idempotent', () => {
  const memory = readFileSync('db/migrations/026_ai_research_memory.sql', 'utf8');
  const executable = withoutSqlComments(memory);
  assert.match(memory, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(memory, /CREATE TABLE IF NOT EXISTS ai_research_qa_index/);
  assert.match(memory, /CREATE TABLE IF NOT EXISTS user_memories/);
  assert.match(memory, /ai_memory_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(memory, /UNIQUE \(user_id, content_hash\)/);
  assert.match(memory, /REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(memory, /CREATE INDEX IF NOT EXISTS idx_ai_research_qa_user/);
  assert.match(memory, /CREATE INDEX IF NOT EXISTS idx_user_memories_user/);
  assert.match(executable, /'role'/);
  assert.match(executable, /'interest'/);
  assert.match(executable, /'preference'/);
  assert.match(executable, /'style'/);
  assert.match(executable, /'context'/);
  assert.doesNotMatch(executable, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('028 adds chat_imports and is idempotent', () => {
  const sql = readFileSync('db/migrations/028_chat_imports.sql', 'utf8');
  const executable = withoutSqlComments(sql);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS chat_imports/);
  assert.match(sql, /user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /source TEXT NOT NULL CHECK \(source IN \('codex', 'claude', 'text'\)\)/);
  assert.match(sql, /parser TEXT NOT NULL CHECK \(parser IN \('codex', 'claude', 'text'\)\)/);
  assert.match(sql, /parser_fallback BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(sql, /status TEXT NOT NULL CHECK \(status IN \('review', 'extract_failed', 'approved', 'chat_only'\)\)/);
  assert.match(sql, /draft JSONB NOT NULL DEFAULT '\{"facts":\[\],"qa":\[\]\}'::jsonb/);
  assert.match(sql, /knowledge_entry_id TEXT REFERENCES knowledge_entries\(id\) ON DELETE SET NULL/);
  assert.match(sql, /UNIQUE \(user_id, content_hash\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_chat_imports_user/);
  assert.match(sql, /ON chat_imports \(user_id, created_at DESC\)/);
  assert.doesNotMatch(executable, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.doesNotMatch(executable, /ALTER TABLE knowledge_entries/);
});

test('029 adds user_api_tokens and is idempotent', () => {
  const sql = readFileSync('db/migrations/029_user_api_tokens.sql', 'utf8');
  const executable = withoutSqlComments(sql);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_api_tokens/);
  assert.match(sql, /user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /name TEXT NOT NULL/);
  assert.match(sql, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(sql, /token_prefix TEXT NOT NULL/);
  assert.match(sql, /last_used_at TIMESTAMPTZ/);
  assert.match(sql, /revoked_at TIMESTAMPTZ/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_user_api_tokens_user/);
  assert.match(sql, /ON user_api_tokens \(user_id, created_at DESC\)/);
  assert.doesNotMatch(executable, /DROP TABLE|DELETE FROM|TRUNCATE/i);
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
