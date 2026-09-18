import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHealthReport } from '../src/lib/health';
import { GET } from '../src/app/api/health/route';

function assertNoSecrets(body: Record<string, unknown>) {
  const serialized = JSON.stringify(body).toLowerCase();
  assert.doesNotMatch(serialized, /password|secret|api[_-]?key|database_url|token/);
  assert.deepEqual(Object.keys(body).sort(), ['db', 'ok', 'timestamp']);
}

test('health report is ok when the database ping succeeds', async () => {
  const { report, status } = await buildHealthReport(async () => ({ ok: 1 }));
  assert.equal(status, 200);
  assert.equal(report.ok, true);
  assert.equal(report.db, 'ok');
  assert.match(report.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assertNoSecrets(report);
});

test('health report is 503 when the database ping fails', async () => {
  const { report, status } = await buildHealthReport(async () => {
    throw new Error('DATABASE_URL is required to use the database. Run npm run db:migrate first.');
  });
  assert.equal(status, 503);
  assert.equal(report.ok, false);
  assert.equal(report.db, 'error');
  assert.match(report.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assertNoSecrets(report);
  assert.doesNotMatch(JSON.stringify(report), /DATABASE_URL/);
});

test('GET /api/health is unauthenticated and returns the expected shape', async () => {
  const route = readFileSync('src/app/api/health/route.ts', 'utf8');
  assert.doesNotMatch(route, /getSession|requireAdmin|requireFeature/);
  assert.match(route, /buildHealthReport/);
  assert.match(route, /no-store/);

  const response = await GET();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.ok, false);
  assert.equal(body.db, 'error');
  assert.equal(typeof body.timestamp, 'string');
  assertNoSecrets(body);
});
