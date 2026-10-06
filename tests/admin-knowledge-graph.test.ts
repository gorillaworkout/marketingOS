import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('admin knowledge graph is protected and organization-scoped', async () => {
  const route = await readFile('src/app/api/admin/knowledge-graph/route.ts', 'utf8');
  assert.match(route, /requireAdmin\(request\)/);
  assert.match(route, /JOIN users/);
  assert.match(route, /LEFT JOIN departments/);
  assert.doesNotMatch(route, /WHERE ke\.user_id =/);
});

test('admin navigation exposes a dedicated Knowledge Graph page', async () => {
  const layout = await readFile('src/app/dashboard/layout.tsx', 'utf8');
  assert.match(layout, /dashboard\/knowledge-graph/);
  assert.match(layout, /Knowledge Graph/);
});

test('learning health compares two real time windows and reports insufficient data honestly', async () => {
  const route = await readFile('src/app/api/admin/knowledge-graph/route.ts', 'utf8');
  const page = await readFile('src/app/dashboard/knowledge-graph/page.tsx', 'utf8');
  assert.match(route, /INTERVAL '60 days'/);
  assert.match(route, /INTERVAL '30 days'/);
  assert.match(route, /insufficient-data/);
  assert.match(route, /derivedEdges/);
  assert.match(route, /same_department/);
  assert.match(page, /learning health/i);
  assert.match(page, /More records do not imply better quality/);
});

test('knowledge graph uses a real interactive 3D canvas and restrained enterprise UI', async () => {
  const [page, canvas] = await Promise.all([
    readFile('src/app/dashboard/knowledge-graph/page.tsx', 'utf8'),
    readFile('src/app/dashboard/knowledge-graph/KnowledgeGraphCanvas.tsx', 'utf8'),
  ]);
  assert.match(page, /KnowledgeGraphCanvas/);
  assert.match(canvas, /<canvas/);
  assert.match(canvas, /rotationX/);
  assert.match(canvas, /rotationY/);
  assert.match(canvas, /Drag to rotate/);
  assert.match(canvas, /performance\.now/);
  assert.match(canvas, /createRadialGradient\(pulseX/);
  assert.doesNotMatch(page, /🕸️|📊|📈|✨|🔥/);
});

test('admin graph omits another user\'s imported chat from nodes, counts, and task types', async () => {
  const route = await readFile('src/app/api/admin/knowledge-graph/route.ts', 'utf8');
  const predicate = "task_type <> 'imported-chat' OR ke.user_id = ?";
  assert.match(route, new RegExp(predicate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(route, /source\.task_type <> 'imported-chat' OR source\.user_id = \?/);
  assert.match(route, /target\.task_type <> 'imported-chat' OR target\.user_id = \?/);
  assert.match(route, /ke\.task_id/);
  assert.match(route, /taskId:/);
  assert.match(route, /CASE WHEN ke\.task_type = 'ai-research' THEN LEFT\(ke\.selected_output, 2000\) ELSE NULL END AS fact_text/);
  assert.doesNotMatch(route, /WHERE ke\.user_id =/);
  assert.doesNotMatch(route, /chat_imports|transcript/);
  assert.match(route, /FROM tasks/);
  const page = await readFile('src/app/dashboard/knowledge-graph/page.tsx', 'utf8');
  const canvas = await readFile('src/app/dashboard/knowledge-graph/KnowledgeGraphCanvas.tsx', 'utf8');
  assert.match(page, /Filter by source feature/);
  assert.match(page, /knowledgeFeatureLabel\(item\.name\)/);
  assert.match(page, /selected\.taskType === 'imported-chat'/);
  assert.match(page, /selected\.taskId/);
  assert.match(page, /ImportedChatRecordActions/);
  assert.doesNotMatch(canvas, /#E11D48/);
  assert.match(canvas, /knowledgeFeatureColor\(node\.taskType\)/);
});
