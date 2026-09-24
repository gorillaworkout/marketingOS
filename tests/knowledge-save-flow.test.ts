import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const page = readFileSync(path.join(process.cwd(), 'src/app/dashboard/social-post/page.tsx'), 'utf8');

test('Social Post explains that generation alone does not train Knowledge', () => {
  assert.match(page, /Not in Knowledge yet/);
  assert.match(page, /Choose one approved output/);
  assert.match(page, /Choose and save to Knowledge/i);
});

test('Knowledge save failures are visible and can be retried', () => {
  assert.match(page, /knowledgeError/);
  assert.match(page, /if \(!res\.ok\)/);
  assert.match(page, /setSelectedIndex\(null\)/);
  assert.match(page, /Could not save to Knowledge/);
});
