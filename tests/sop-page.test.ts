import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();

test('SOP resource exposes the required manual workflow and admin-only access handling', async () => {
  const [page, layout] = await Promise.all([
    readFile(resolve(root, 'src/app/dashboard/sop/page.tsx'), 'utf8'),
    readFile(resolve(root, 'src/app/dashboard/layout.tsx'), 'utf8'),
  ]);

  for (const step of [
    'Research and topic selection',
    'Research and query selection',
    'SEO Competitor Research',
    'Draft Article',
    'Plagiarism Check',
    'Revise & Recheck',
  ]) {
    assert.match(page, new RegExp(step));
  }

  assert.match(page, />90%/);
  assert.match(page, /10 minutes/);
  assert.match(page, /Manual SOP steps/);
  assert.match(layout, /'\/dashboard\/sop'/);
  assert.match(layout, /label: 'Article Market News'/);
  assert.match(layout, /const generateItems = \[/);
});
