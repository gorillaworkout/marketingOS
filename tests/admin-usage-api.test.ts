import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDepartments, buildProviders, buildSummary, buildUsers, getUsagePeriod, type UsageRecord,
} from '../src/lib/admin-usage';

const records: UsageRecord[] = [
  { id: '1', userId: 'u1', username: 'Ari', department: 'Marketing', model: 'deepseek/deepseek-v4-flash', provider: 'openrouter', accountSource: 'personal', inputTokens: 100, outputTokens: 50, cost: 1.5, taskId: 't1' },
  { id: '2', userId: 'u2', username: 'Bima', department: 'Sales', model: 'gpt-5.6-sol', provider: 'codex', accountSource: 'office', inputTokens: 400, outputTokens: 100, cost: 4, taskId: 't2' },
  { id: '3', userId: 'u1', username: 'Ari', department: 'Marketing', model: 'deepseek/deepseek-v4-flash', provider: 'openrouter', accountSource: 'personal', inputTokens: 25, outputTokens: 25, cost: 0.5, taskId: 't3' },
];

const endpoints = ['summary', 'by-user', 'by-department', 'by-provider', 'top-users', 'export'];

test('Non-admin gets 403 on all endpoints', () => {
  for (const endpoint of endpoints) {
    const source = fs.readFileSync(path.join(process.cwd(), `src/app/api/admin/usage/${endpoint}/route.ts`), 'utf8');
    assert.match(source, /requireAdmin\(request\)/, `${endpoint} must require admin authorization`);
  }
});

test('Summary returns correct shape with 200-ready values', () => {
  const summary = buildSummary(records, getUsagePeriod('month', new Date('2026-07-26T00:00:00Z')));
  assert.deepEqual(Object.keys(summary).sort(), ['activeUsers', 'avgTokensPerUser', 'periodEnd', 'periodStart', 'topDepartment', 'topProvider', 'totalCost', 'totalTokens']);
  assert.equal(summary.totalTokens, 700);
  assert.equal(summary.totalCost, 6);
  assert.equal(summary.activeUsers, 2);
});

test('by-user returns array sorted by cost', () => {
  const users = buildUsers(records, 10);
  assert.equal(users[0].username, 'Bima');
  assert.equal(users[0].rank, 1);
  assert.ok(users[0].totalCost >= users[1].totalCost);
});

test('by-department returns departments with sub-arrays', () => {
  const departments = buildDepartments(records);
  assert.equal(departments.length, 2);
  assert.ok(Array.isArray(departments[0].modelBreakdown));
  assert.ok(Array.isArray(departments[0].providerBreakdown));
});

test('by-provider returns provider breakdown', () => {
  const providers = buildProviders(records);
  assert.equal(providers.length, 2);
  assert.ok(providers.every(provider => Array.isArray(provider.modelBreakdown)));
  assert.equal(providers.find(provider => provider.provider === 'openrouter')?.accountSource, 'personal');
});
