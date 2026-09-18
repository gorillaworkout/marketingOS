import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AVAILABLE_MODELS } from '../src/lib/openai';

const read = (relative: string) => {
  const file = path.join(process.cwd(), relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

const openai = read('src/lib/openai.ts');
const routing = read('src/lib/model-routing.ts');
const settingsRoute = read('src/app/api/settings/model/route.ts');
const assignmentRoute = read('src/app/api/admin/model-assignments/route.ts');
const modelsRoute = read('src/app/api/models/route.ts');
const modelsPage = read('src/app/dashboard/models/page.tsx');
const layout = read('src/app/dashboard/layout.tsx');
const migration = read('db/migrations/009_feature_model_assignments.sql');
const socialRoute = read('src/app/api/social-post/generate/route.ts');
const socialPage = read('src/app/dashboard/social-post/page.tsx');
const videoPage = read('src/app/dashboard/video-script/page.tsx');
const embeddings = read('src/lib/embeddings.ts');
const knowledgeSave = read('src/app/api/knowledge/save/route.ts');
const knowledgeAnalyze = read('src/app/api/knowledge/analyze/route.ts');
const database = read('src/lib/database.ts');
const articleRoute = read('src/app/api/article-market-news/generate/route.ts');
const researchRoute = read('src/app/api/market-research/generate/route.ts');
const gatewayConfig = read('src/lib/gateway-config.ts');
const envExample = read('.env.example');
const restoreMigration = read('db/migrations/014_restore_codex_ai_research.sql');

test('MarketingOS exposes GorillaWorkout as its only generation gateway', () => {
  assert.match(openai, /export type ModelProvider = 'gorillaworkout'/);
  assert.doesNotMatch(openai, /callCodex|callClaude|OPENROUTER_API_KEY|OPENAI_BASE_URL/);
  assert.doesNotMatch(openai, /provider === 'codex'|provider === 'claude-code'/);
  assert.match(modelsRoute, /GorillaWorkout LLM/);
  assert.doesNotMatch(modelsRoute, /OpenRouter|Claude Code|ChatGPT Plus|getOpenRouterLivePrice/);
  assert.doesNotMatch(layout, /OpenRouter|Claude Code|Codex.*ChatGPT subscription/);
});

test('feature model routing defines one allowlist for every generation workflow', () => {
  for (const feature of ['social-post', 'video-script', 'event-plan', 'article-market-news', 'market-research', 'ai-research']) {
    assert.match(routing, new RegExp(`'${feature}'`));
  }
  assert.match(routing, /feature_model_assignments/);
  assert.match(routing, /task_model_preferences/);
  assert.match(routing, /allowedModels/);
  assert.match(routing, /defaultModel/);
});

test('admin assignment API is protected and only accepts GorillaWorkout catalog models', () => {
  assert.match(assignmentRoute, /requireAdmin\(request\)/);
  assert.match(assignmentRoute, /AVAILABLE_MODELS/);
  assert.match(assignmentRoute, /feature_model_assignments/);
  assert.match(assignmentRoute, /Invalid feature|Invalid model/);
});

test('user model preference API only returns and accepts models allowed for that feature', () => {
  assert.match(settingsRoute, /getFeatureModelOptions/);
  assert.match(settingsRoute, /resolveFeatureModel/);
  assert.match(settingsRoute, /Model is not enabled for this feature/);
  assert.doesNotMatch(settingsRoute, /preferred_model/);
});

test('models page is a dedicated learning and assignment workspace while layout stays navigation-only', () => {
  assert.match(modelsPage, /Model library/i);
  assert.match(modelsPage, /Allowed models/i);
  assert.match(modelsPage, /Organization default/i);
  assert.match(modelsPage, /Social Post/);
  assert.match(modelsPage, /Video Script/);
  assert.match(layout, /href: '\/dashboard\/models', label: 'Models'/);
  assert.doesNotMatch(layout, /Feature model preferences/i);
  assert.doesNotMatch(layout, /Generation model/);
});

test('migration is additive and preserves historical preferences', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS feature_model_assignments/);
  assert.match(migration, /ALTER TABLE task_model_preferences/);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE/i);
});

test('all generators resolve feature-level models through the gateway', () => {
  assert.match(socialRoute, /getUserPreferredModel\(userId, 'social-post'\)/);
  assert.doesNotMatch(socialRoute, /getUserPreferredModel\(userId, 'caption'\)|getUserPreferredModel\(userId, 'image-prompt'\)/);
  assert.doesNotMatch(articleRoute, /requires an office Codex|provider.*codex|gpt-5\.6-sol/);
  assert.doesNotMatch(researchRoute, /requires an office Codex|provider.*codex|gpt-5\.6-sol/);
});

test('active MarketingOS surfaces and embeddings do not retain direct provider paths', () => {
  assert.doesNotMatch(socialPage, /ChatGPT Plus|Claude Code|OpenRouter/);
  assert.doesNotMatch(videoPage, /ChatGPT Plus|Claude Code|OpenRouter/);
  assert.doesNotMatch(embeddings, /OPENROUTER_API_KEY|OPENAI_BASE_URL|openrouter\.ai/);
});

test('knowledge analysis resolves an allowed gateway model instead of a removed model ID', () => {
  assert.match(knowledgeSave, /getUserPreferredModel/);
  assert.match(knowledgeAnalyze, /getUserPreferredModel/);
  assert.doesNotMatch(knowledgeSave, /deepseek\/deepseek/);
  assert.doesNotMatch(knowledgeAnalyze, /deepseek\/deepseek/);
});

test('model governance fails closed on database errors', () => {
  assert.doesNotMatch(routing, /catch \{[\s\S]*catalog-backed defaults/);
  assert.doesNotMatch(routing, /catch \{[\s\S]*legacy preferences never override/);
});

test('assignment updates normalize stale preferences in one transaction', () => {
  assert.match(database, /executeTransaction/);
  assert.match(assignmentRoute, /executeTransaction/);
  assert.match(assignmentRoute, /UPDATE task_model_preferences/);
  assert.match(assignmentRoute, /NOT \(model = ANY/);
});

test('gateway defaults to llmdupoin and is overridable by env', () => {
  assert.match(gatewayConfig, /DEFAULT_GORILLAWORKOUT_API_BASE = 'https:\/\/llmdupoin\.gorillaworkout\.id\/v1'/);
  assert.match(gatewayConfig, /process\.env\.GORILLAWORKOUT_API_BASE/);
  assert.match(gatewayConfig, /process\.env\.GORILLAWORKOUT_API_KEY/);
  assert.doesNotMatch(gatewayConfig, /llm\.gorillaworkout\.id/);
  assert.match(openai, /from '@\/lib\/gateway-config'/);
  assert.doesNotMatch(openai, /https:\/\/llm\.gorillaworkout\.id/);
  assert.doesNotMatch(modelsRoute, /https:\/\/llm\.gorillaworkout\.id/);
  assert.match(envExample, /llmdupoin\.gorillaworkout\.id\/v1/);
  assert.match(envExample, /GORILLAWORKOUT_API_KEY=/);
  assert.doesNotMatch(envExample, /sk-[a-zA-Z0-9]/);
  const probe = read('scripts/probe-gateway-models.ts');
  assert.match(probe, /resolveGorillaWorkoutApiBase/);
  assert.match(probe, /GORILLAWORKOUT_API_KEY is not set/);
  assert.doesNotMatch(probe, /https:\/\/llm\.gorillaworkout\.id/);
});

test('AI Research routing restores Codex and never reintroduces Kimi', () => {
  assert.match(routing, /PREFERRED_CODEX_MODEL/);
  assert.match(routing, /cx\/gpt-5\.3-codex-spark/);
  assert.match(routing, /cx\/gpt-5\.6-terra/);
  assert.match(routing, /cx\/gpt-5\.6-luna/);
  assert.ok(!AVAILABLE_MODELS.some(model =>
    model.id.startsWith('kimi/') || model.id.startsWith('tr/') || model.id.startsWith('cmc/moonshotai/') || model.id.toLowerCase().includes('kimi')));
  assert.ok(AVAILABLE_MODELS.some(model => model.id === 'cx/gpt-5.6-sol'));
  assert.ok(AVAILABLE_MODELS.some(model => model.id === 'cx/gpt-5.3-codex-spark'));
  assert.match(openai, /cx\/gpt-5\.6-sol/);
  assert.match(modelsRoute, /AVAILABLE_MODELS/);
  assert.match(restoreMigration, /cx\/gpt-5\.6-sol/);
  assert.match(restoreMigration, /cx\/gpt-5\.3-codex-spark/);
  assert.match(restoreMigration, /feature_key = 'ai-research'/);
});
