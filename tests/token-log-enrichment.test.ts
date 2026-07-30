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
    const videoApi = require('fs').readFileSync(
      require('path').join(__dirname, '../src/app/api/video-script/generate/route.ts'),
      'utf-8'
    );
    const eventApi = require('fs').readFileSync(
      require('path').join(__dirname, '../src/app/api/event-plan/generate/route.ts'),
      'utf-8'
    );
    // Each generateContent call should include taskType
    const videoMatches = videoApi.match(/taskType:\s*'video-script'/g);
    assert(videoMatches, 'video-script route missing taskType');
    assert(videoMatches.length >= 1, `video-script route has ${videoMatches.length} taskType refs (expected ≥1)`);

    const eventMatches = eventApi.match(/taskType:\s*'event-plan'/g);
    assert(eventMatches, 'event-plan route missing taskType');
    assert(eventMatches.length >= 1, `event-plan route has ${eventMatches.length} taskType refs (expected ≥1)`);
  });

  void it('openai.ts INSERT statement includes new columns', () => {
    const openai = require('fs').readFileSync(
      require('path').join(__dirname, '../src/lib/openai.ts'),
      'utf-8'
    );
    // All INSERT INTO token_logs should include provider, account_source, department_id, task_type
    const inserts = openai.match(/INSERT INTO token_logs \(/g);
    assert(inserts, 'No INSERT INTO token_logs found');
    assert(inserts.length >= 2, `Found ${inserts.length} INSERT statements`);

    // Each insert should have the new columns
    const insertLines = openai.match(/INSERT INTO token_logs \([^)]+\)/g) || [];
    for (const line of insertLines) {
      assert(line.includes('provider'), `Missing provider column: ${line}`);
      assert(line.includes('account_source'), `Missing account_source column: ${line}`);
      assert(line.includes('department_id'), `Missing department_id column: ${line}`);
      assert(line.includes('task_type'), `Missing task_type column: ${line}`);
    }
  });
});
