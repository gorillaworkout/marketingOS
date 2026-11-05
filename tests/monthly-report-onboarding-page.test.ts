import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('onboarding KPI row is four full-width cards and the page opens on the current WIB month', async () => {
  const source = await readFile('src/app/dashboard/monthly-report/page.tsx', 'utf8');

  assert.match(source, /className="grid grid-cols-2 md:grid-cols-4"/);
  assert.doesNotMatch(source, /md:grid-cols-5/);

  const start = source.indexOf('function initialInput()');
  const end = source.indexOf('export default function');
  assert.ok(start >= 0 && end > start, 'initialInput() must stay on the onboarding page');
  const fn = source.slice(start, end);
  assert.match(fn, /todayWib\(\)/);
  assert.match(fn, /preset:\s*'month'/);
  assert.match(fn, /\$\{today\.slice\(0,\s*7\)\}-01/);
  assert.doesNotMatch(fn, /setUTCMonth|lastMonth|last complete month/);
});
