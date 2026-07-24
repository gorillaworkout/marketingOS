import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('department migration safely preserves users while assigning the General default', async () => {
  const sql = await readFile(new URL('../db/migrations/002_departments.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS departments/);
  assert.match(sql, /ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id/);
  assert.match(sql, /WHERE role <> 'admin' AND department_id IS NULL/);
  assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b/i);
});

test('rerunning the migration does not overwrite a configured General department', async () => {
  const sql = await readFile(new URL('../db/migrations/002_departments.sql', import.meta.url), 'utf8');
  assert.match(sql, /ON CONFLICT \(name\) DO NOTHING/);
  assert.doesNotMatch(sql, /ON CONFLICT \(name\) DO UPDATE/);
});
