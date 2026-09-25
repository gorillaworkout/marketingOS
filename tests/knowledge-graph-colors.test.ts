import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACCOUNT_FEATURE_LABELS } from '../src/lib/authorization';
import {
  DUPOIN_TEAL,
  KNOWLEDGE_FEATURE_COLORS,
  KNOWLEDGE_FEATURE_OTHER,
  knowledgeFeatureColor,
  knowledgeFeatureColorWithAlpha,
  knowledgeFeatureKey,
  knowledgeFeatureLabel,
  knowledgeFeaturesInGraph,
} from '../src/lib/knowledge-graph-colors';
import { KNOWLEDGE_TASK_TYPES } from '../src/lib/knowledge-task-types';

function rgbDistance(left: string, right: string): number {
  const parse = (hex: string) => [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const [lr, lg, lb] = parse(left);
  const [rr, rg, rb] = parse(right);
  return Math.hypot(lr - rr, lg - rg, lb - rb);
}

test('each knowledge task type has one fixed color, with Dupoin teal on AI Research', () => {
  assert.equal(DUPOIN_TEAL, '#2EB5C4');
  assert.equal(KNOWLEDGE_FEATURE_COLORS['ai-research'], DUPOIN_TEAL);
  const keys = [...KNOWLEDGE_TASK_TYPES, KNOWLEDGE_FEATURE_OTHER];
  assert.deepEqual(Object.keys(KNOWLEDGE_FEATURE_COLORS).sort(), [...keys].sort());
  const colors = keys.map(key => KNOWLEDGE_FEATURE_COLORS[key]);
  assert.equal(new Set(colors).size, colors.length);
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      assert.ok(rgbDistance(colors[i], colors[j]) >= 70, `${colors[i]} and ${colors[j]} are too similar`);
    }
  }
  for (const taskType of KNOWLEDGE_TASK_TYPES) {
    assert.equal(knowledgeFeatureKey(taskType), taskType);
    assert.equal(knowledgeFeatureLabel(taskType), ACCOUNT_FEATURE_LABELS[taskType]);
    assert.equal(knowledgeFeatureColor(taskType), KNOWLEDGE_FEATURE_COLORS[taskType]);
    assert.match(knowledgeFeatureLabel(taskType), /^[A-Za-z0-9 &]+$/);
  }
});

test('missing and unknown task types share the Other color', () => {
  assert.equal(knowledgeFeatureKey(''), KNOWLEDGE_FEATURE_OTHER);
  assert.equal(knowledgeFeatureKey(null), KNOWLEDGE_FEATURE_OTHER);
  assert.equal(knowledgeFeatureKey('  image-gen  '), KNOWLEDGE_FEATURE_OTHER);
  assert.equal(knowledgeFeatureLabel('image-gen'), 'Other');
  assert.equal(knowledgeFeatureLabel(undefined), 'Other');
  assert.equal(knowledgeFeatureColor(''), knowledgeFeatureColor('not-a-feature'));
  assert.equal(knowledgeFeatureColorWithAlpha('social-post', 0.4), 'rgba(192, 132, 252, 0.4)');
  assert.equal(knowledgeFeatureColorWithAlpha('social-post', 4), 'rgba(192, 132, 252, 1)');
});

test('legend lists only features present, in stable product order', () => {
  const swatches = knowledgeFeaturesInGraph(['internal-docs', 'social-post', 'nope', 'social-post', 'ai-research']);
  assert.deepEqual(swatches.map(item => item.key), ['social-post', 'ai-research', 'internal-docs', 'other']);
  assert.deepEqual(swatches.map(item => item.label), ['Social Post', 'AI Research', 'FAQ & Guides', 'Other']);
  assert.equal(swatches.find(item => item.key === 'ai-research')?.color, DUPOIN_TEAL);
  assert.deepEqual(knowledgeFeaturesInGraph([]), []);
});

test('knowledge graph paints nodes from the feature palette and shows a legend', async () => {
  const [page, canvas, legend] = await Promise.all([
    readFile('src/app/dashboard/knowledge-graph/page.tsx', 'utf8'),
    readFile('src/app/dashboard/knowledge-graph/KnowledgeGraphCanvas.tsx', 'utf8'),
    readFile('src/app/dashboard/knowledge-graph/KnowledgeFeatureLegend.tsx', 'utf8'),
  ]);
  assert.match(canvas, /knowledgeFeatureColor\(node\.taskType\)/);
  assert.match(canvas, /knowledgeFeatureColorWithAlpha/);
  assert.doesNotMatch(canvas, /palette\[departmentIndex/);
  assert.match(page, /KnowledgeFeatureLegend/);
  assert.match(page, /knowledgeFeatureLabel\(item\.name\)/);
  assert.match(page, /Filter by source feature/);
  assert.match(legend, /aria-label="Source features"/);
  assert.match(legend, /knowledgeFeaturesInGraph/);
});
