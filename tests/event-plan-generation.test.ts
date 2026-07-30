import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();

test('Event Plan client consumes its SSE generator and exposes structured IDR/date inputs', async () => {
  const page = await readFile(resolve(root, 'src/app/dashboard/event-plan/page.tsx'), 'utf8');
  assert.match(page, /getReader\(\)/);
  assert.match(page, /data: /);
  assert.doesNotMatch(page, /const data = await res\.json\(\);/);
  assert.match(page, /type="date"/);
  assert.match(page, /formatIDR/);
  assert.match(page, /Budget breakdown/i);
});

test('Event Plan generator requires a Rupiah budget breakdown contract', async () => {
  const route = await readFile(resolve(root, 'src/app/api/event-plan/generate/route.ts'), 'utf8');
  assert.match(route, /"currency": "IDR"/);
  assert.match(route, /"items": \[/);
  assert.match(route, /"estimatedCost"/);
  assert.match(route, /Budget ceiling/);
  assert.match(route, /extractBalancedJsonObject/);
  assert.match(route, /buildPreliminaryBudget/);
  assert.doesNotMatch(route, /const budgetMatch =/);
});
