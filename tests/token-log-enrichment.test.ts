import { describe, it } from 'node:test';
import assert from 'node:assert';

void describe('Token Log Enrichment', () => {
  const { getModelProvider, AVAILABLE_MODELS } = require('@/lib/openai');

  void it('maps each model to correct provider', () => {
    for (const m of AVAILABLE_MODELS) {
      const provider = getModelProvider(m.id);
      assert.strictEqual(provider, m.provider, `${m.id} → ${provider} (expected ${m.provider})`);
    }
  });

  void it('maps account_source correctly per provider', () => {
    for (const m of AVAILABLE_MODELS) {
      const provider = getModelProvider(m.id);
      const source = 'office';
      assert.strictEqual(provider, 'gorillaworkout');
      assert.strictEqual(source, 'office');
    }
  });

  void it('reports only the generation gateway provider', () => {
    const providers = new Set(AVAILABLE_MODELS.map(m => m.provider));
    assert(providers.has('gorillaworkout'), 'missing gorillaworkout');
    assert.strictEqual(providers.size, 1);
  });

  void it('each caller passes taskType in options', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');

    const expected: Array<[string, string, string]> = [
      ['src/app/api/social-post/generate/route.ts', "taskType:\\s*'social-post'", 'social-post'],
      ['src/app/api/video-script/generate/route.ts', "taskType:\\s*'video-script'", 'video-script'],
      ['src/app/api/event-plan/generate/route.ts', "taskType:\\s*'event-plan'", 'event-plan'],
      ['src/app/api/article-market-news/generate/route.ts', "taskType:\\s*'article-market-news'", 'article-market-news'],
      ['src/app/api/market-research/generate/route.ts', "taskType:\\s*'market-research'", 'market-research'],
      ['src/app/api/ai-research/chat/route.ts', "taskType:\\s*'ai-research'", 'ai-research'],
      ['src/app/api/generate-image/route.ts', "taskType:\\s*'image-gen'", 'image-gen'],
    ];
    for (const [file, pattern, label] of expected) {
      const matches = read(file).match(new RegExp(pattern, 'g'));
      assert(matches, `${label} route missing taskType`);
      assert(matches.length >= 1, `${label} route has ${matches.length} taskType refs (expected ≥1)`);
    }

    const social = read('src/app/api/social-post/generate/route.ts');
    const generateContentCalls = social.match(/generateContent\(/g) || [];
    const socialTaskTypes = social.match(/taskType:\s*'social-post'/g) || [];
    assert.equal(generateContentCalls.length, socialTaskTypes.length, 'social-post image-prompt must log as social-post');

    const knowledgeSave = read('src/app/api/knowledge/save/route.ts');
    assert.match(knowledgeSave, /generateContent/);
    assert.match(knowledgeSave, /taskType: analysisFeature/);
    const knowledgeAnalyze = read('src/app/api/knowledge/analyze/route.ts');
    assert.match(knowledgeAnalyze, /generateContent/);
    assert.match(knowledgeAnalyze, /taskType: 'social-post'/);

    const image = read('src/app/api/generate-image/route.ts');
    assert.match(image, /logTokenUsage/);
    assert.match(image, /parseImageGenerationUsage/);
    assert.doesNotMatch(image, /INSERT INTO token_logs/);
  });

  void it('token_logs INSERT includes new columns via the shared helper', () => {
    const tokenLog = require('fs').readFileSync(
      require('path').join(__dirname, '../src/lib/token-log.ts'),
      'utf-8'
    );
    const openai = require('fs').readFileSync(
      require('path').join(__dirname, '../src/lib/openai.ts'),
      'utf-8'
    );
    assert.match(openai, /logTokenUsage/);
    assert.match(openai, /resolveTokenUsage/);
    const inserts = tokenLog.match(/INSERT INTO token_logs \(/g);
    assert(inserts, 'No INSERT INTO token_logs found');
    assert(inserts.length >= 1, `Found ${inserts.length} INSERT statements`);

    const insertLines = tokenLog.match(/INSERT INTO token_logs \([^)]+\)/g) || [];
    for (const line of insertLines) {
      assert(line.includes('provider'), `Missing provider column: ${line}`);
      assert(line.includes('account_source'), `Missing account_source column: ${line}`);
      assert(line.includes('department_id'), `Missing department_id column: ${line}`);
      assert(line.includes('task_type'), `Missing task_type column: ${line}`);
    }
  });
});
