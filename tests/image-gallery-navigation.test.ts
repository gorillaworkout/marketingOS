import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('admin Resources navigation exposes the Image Gallery page', async () => {
  const layout = await readFile(resolve(process.cwd(), 'src/app/dashboard/layout.tsx'), 'utf8');
  assert.match(layout, /href: '\/dashboard\/images', label: 'Image Gallery'/);
  assert.match(layout, /const resourceItems = \[/);
});
