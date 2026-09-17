import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');

test('admin AI Research API is admin-only, lists across users, and loads images only on detail', async () => {
  const route = await read('src/app/api/admin/ai-research/route.ts');
  assert.match(route, /requireAdmin\(request\)/);
  assert.match(route, /JOIN users u ON u\.id = c\.user_id/);
  assert.match(route, /jsonb_array_elements\(c\.messages\)/);
  assert.match(route, /jsonb_array_length\(c\.messages\)/);
  assert.match(route, /c\.user_id = \?/);
  assert.match(route, /ILIKE \?/);
  assert.match(route, /searchParams\.get\('userId'\)/);
  assert.match(route, /searchParams\.get\('title'\)/);
  assert.match(route, /parseStoredMessages\(row\.messages\)/);
  assert.match(route, /dataUrl/);
  assert.doesNotMatch(route, /GORILLAWORKOUT_API_KEY|OPENROUTER_API_KEY|password_hash/);
  assert.doesNotMatch(route, /requireFeature\(request, 'ai-research'\)/);
  assert.doesNotMatch(route, /WHERE c\.user_id = auth/);
  assert.doesNotMatch(route, /SELECT c\.id, c\.user_id, u\.name AS user_name, u\.username, c\.model, c\.updated_at,\s*c\.messages/);
});

test('admin AI Research page is a read-only list and thread viewer', async () => {
  const page = await read('src/app/dashboard/ai-research/admin/page.tsx');
  assert.match(page, /PageHeader/);
  assert.match(page, /PageStack/);
  assert.match(page, /Filter by user/);
  assert.match(page, /Search title/);
  assert.match(page, /\/api\/admin\/ai-research/);
  assert.match(page, /Read-only thread/);
  assert.match(page, /image\.dataUrl/);
  assert.doesNotMatch(page, /\/api\/ai-research\/chat/);
  assert.doesNotMatch(page, /handleSend|fileToChatImage|New Conversation/);
});

test('admin AI Research nav is admin-only and does not steal the user chat item', async () => {
  const layout = await read('src/app/dashboard/layout.tsx');
  assert.match(layout, /href: '\/dashboard\/ai-research\/admin', label: 'AI Research log'/);
  assert.match(layout, /adminOnly: true/);
  assert.match(layout, /\/dashboard\/ai-research\/admin/);
  assert.match(layout, /isNavActive/);
  assert.match(layout, /href: '\/dashboard\/ai-research', label: 'AI Research'/);
});

test('user AI Research chat stays scoped to the signed-in user', async () => {
  const chat = await read('src/app/api/ai-research/chat/route.ts');
  assert.match(chat, /requireFeature\(request, 'ai-research'\)/);
  assert.match(chat, /WHERE user_id = \?/);
  assert.match(chat, /WHERE id = \? AND user_id = \?/);
  assert.doesNotMatch(chat, /requireAdmin\(request\)/);
});
