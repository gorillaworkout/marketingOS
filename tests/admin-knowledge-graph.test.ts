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
  assert.doesNotMatch(page, /🕸️|📊|📈|✨|🔥/);
});
