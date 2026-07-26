import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/app/api/dashboard/tokens/route.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/app/dashboard/tokens/page.tsx'), 'utf8');

test('token usage API returns the MarketingOS user account for each log', () => {
  assert.match(route, /JOIN users/);
  assert.match(route, /username/);
  assert.match(route, /user_name/);
});

test('token usage API returns provider information for each log', () => {
  assert.match(route, /provider/);
  assert.match(route, /task_type/);
});

test('token usage API includes a user-account-level usage breakdown', () => {
  assert.match(route, /accountBreakdown/);
  assert.match(route, /GROUP BY u\.username, u\.name, l\.provider/);
});

test('token usage page shows the user account and provider without source labels', () => {
  assert.match(page, />User Account</);
  assert.match(page, />Provider</);
  assert.doesNotMatch(page, />Source</);
  assert.match(page, /accountBreakdown/);
});
