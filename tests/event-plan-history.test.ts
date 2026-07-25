import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('History exposes Event Plan filter and renders the persisted multi-option Event Plan format', async () => {
  const page = await readFile(resolve(process.cwd(), 'src/app/dashboard/history/page.tsx'), 'utf8');
  assert.match(page, /Event Plans/);
  assert.match(page, /typeFilter === 'event-plan'/);
  assert.match(page, /data\.options\?\.\[0\]/);
});
