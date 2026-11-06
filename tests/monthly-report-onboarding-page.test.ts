import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('first-time deposits panel does not show a Micro / Standard stat', async () => {
  const source = await readFile('src/app/dashboard/monthly-report/page.tsx', 'utf8');
  const start = source.indexOf('title="First-time deposits"');
  const end = source.indexOf('Total Real Account — breakdown');
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /Micro \/ Standard/);
});

test('approver description says Final Rejected is staff manual KYC', async () => {
  const page = await readFile('src/app/dashboard/monthly-report/page.tsx', 'utf8');
  const exp = await readFile('src/lib/monthly-report/export.ts', 'utf8');
  const sentence = 'Final Rejected = manual KYC rejections by staff (Approval Method Manual, Steps manual_kyc, Approved Status Failed/Rejected), by Finished Time (else Create Time).';
  assert.ok(page.includes(sentence));
  assert.ok(exp.includes(sentence));
});

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
