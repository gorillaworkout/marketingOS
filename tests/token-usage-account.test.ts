import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/app/api/dashboard/tokens/route.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/app/dashboard/tokens/page.tsx'), 'utf8');

test('token usage API returns provider and account source for each log', () => {
  assert.match(route, /provider/);
  assert.match(route, /account_source/);
  assert.match(route, /task_type/);
});

test('token usage API includes an account-level usage breakdown', () => {
  assert.match(route, /accountBreakdown/);
  assert.match(route, /GROUP BY account_source, provider/);
});

test('token usage page renders account and provider information', () => {
  assert.match(page, />Account</);
  assert.match(page, />Provider</);
  assert.match(page, /accountBreakdown/);
});
