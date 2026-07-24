import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('standard department migration preserves members while defining Marketing, Settlement, and Finance', async () => {
  const sql = await readFile(new URL('../db/migrations/003_standard_departments.sql', import.meta.url), 'utf8');
  for (const department of ['Marketing', 'Settlement', 'Finance']) {
    assert.match(sql, new RegExp(`'${department}'`));
  }
  assert.match(sql, /UPDATE departments[\s\S]*name = 'Marketing'/);
  assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b/i);
});
