/**
 * Duplicate handling for onboarding imports, on synthetic data only. The
 * in-memory store mirrors `INSERT … ON CONFLICT (document_id, event_at, step)
 * DO NOTHING`: an event is stored once, the first copy wins, and nothing is
 * ever overwritten. The DB version of the same checks runs in
 * scripts/verify-monthly-report-migration.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkbookBuffer, type FixtureRow } from './fixtures/monthly-report-onboarding';
import { aggregateEventsByDay, distinctActivatedAccounts, sumDaily } from '../src/lib/monthly-report/metrics';
import { eventKey, parseOnboardingWorkbook, wibDate, type OnboardingRow } from '../src/lib/monthly-report/onboarding-parse';
import { insertOnboardingSql, ONBOARDING_EVENT_KEY } from '../src/lib/monthly-report/store';

const row = (at: string, doc: number, step: string, status: string, accountStatus = '', account = '', first = ''): FixtureRow =>
  [at, 1, doc, first, account, step.startsWith('manual') ? 'Manual' : 'Auto', step, status, accountStatus, ''];

// Synthetic months. Document 8000001 has a September and an October event (a
// cross-file Document ID with different events); 8000002 is in both files with
// the same event (an overlapping export).
const SEPTEMBER: FixtureRow[] = [
  row('2026-09-03 10:00:00', 8000001, 'manual_kyc', 'Pending', 'KYC Pending'),
  row('2026-09-30 23:50:00', 8000002, 'auto_add_account', 'Approved', 'Real Account Activated', '7100002', 'True'),
  row('2026-09-10 08:00:00', 8000003, 'manual_kyc', 'Rejected', 'Registration Failed'),
  row('2026-09-11 08:00:00', 8000004, 'manual_kyc', 'Approved', 'KYC Done'),
];
const OCTOBER: FixtureRow[] = [
  row('2026-10-02 09:00:00', 8000001, 'manual_kyc', 'Approved', 'KYC Done'),
  row('2026-09-30 23:50:00', 8000002, 'auto_add_account', 'Approved', 'Real Account Activated', '7100002', 'True'),
  row('2026-10-05 12:00:00', 8000005, 'auto_add_account', 'Approved', 'Real Account Activated', '7100005', 'True'),
  row('2026-10-06 12:00:00', 8000006, 'manual_kyc', 'Rejected', 'Registration Failed'),
];

const parse = (rows: FixtureRow[]) => {
  const result = parseOnboardingWorkbook(buildWorkbookBuffer(rows), { offset: '+07:00' });
  assert.deepEqual(result.errors, []);
  return result;
};

function importInto(store: Map<string, OnboardingRow>, rows: OnboardingRow[]) {
  let inserted = 0;
  for (const r of rows) {
    const key = eventKey(r);
    if (store.has(key)) continue;
    store.set(key, r);
    inserted += 1;
  }
  return { inserted, skippedDuplicate: rows.length - inserted };
}

function monthNumbers(store: Map<string, OnboardingRow>, month: string) {
  const rows = [...store.values()].filter(r => wibDate(r.eventAt).startsWith(month));
  const sum = sumDaily(aggregateEventsByDay(rows));
  const activated = distinctActivatedAccounts(rows);
  const tra = activated + sum.manualKycApproved;
  return { registrations: rows.length, activated, manual: sum.manualKycApproved, tra, rejected: sum.kycRejected, pending: rows.length - tra - sum.kycRejected };
}

test('re-importing the same file inserts nothing and reports every row as a duplicate', () => {
  const store = new Map<string, OnboardingRow>();
  const sep = parse(SEPTEMBER).rows;
  assert.deepEqual(importInto(store, sep), { inserted: 4, skippedDuplicate: 0 });
  assert.deepEqual(importInto(store, sep), { inserted: 0, skippedDuplicate: 4 });
  assert.equal(store.size, 4);
});

test('same Document ID with a different event in another file is kept; the identical event is skipped', () => {
  const store = new Map<string, OnboardingRow>();
  importInto(store, parse(SEPTEMBER).rows);
  assert.deepEqual(importInto(store, parse(OCTOBER).rows), { inserted: 3, skippedDuplicate: 1 });
  const events = [...store.values()].filter(r => r.documentId === '8000001').map(r => r.stepStatus).sort();
  assert.deepEqual(events, ['Approved', 'Pending']);
});

test('exact duplicates inside one file are dropped before insert', () => {
  const parsed = parse([...SEPTEMBER, SEPTEMBER[0], SEPTEMBER[2]]);
  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.summary.duplicatesInFile, 2);
  assert.equal(parsed.summary.conflictingDuplicatesInFile, 0);
});

test('month numbers do not depend on import order', () => {
  const files = { sep: parse(SEPTEMBER).rows, oct: parse(OCTOBER).rows };
  const orders = [['sep', 'oct', 'sep'], ['oct', 'sep'], ['oct', 'sep', 'oct', 'sep']] as const;
  const results = orders.map(order => {
    const store = new Map<string, OnboardingRow>();
    for (const name of order) importInto(store, files[name]);
    return { size: store.size, sep: monthNumbers(store, '2026-09'), oct: monthNumbers(store, '2026-10') };
  });
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(results[0].size, 7);
  assert.deepEqual(results[0].sep, { registrations: 4, activated: 1, manual: 1, tra: 2, rejected: 1, pending: 1 });
  assert.deepEqual(results[0].oct, { registrations: 3, activated: 1, manual: 1, tra: 2, rejected: 1, pending: 0 });
});

test('the insert statement never overwrites a stored event', () => {
  const sql = insertOnboardingSql(2);
  assert.ok(sql.includes('ON CONFLICT (document_id, event_at, step) DO NOTHING'), sql);
  assert.doesNotMatch(sql, /DO UPDATE/);
  assert.deepEqual([...ONBOARDING_EVENT_KEY], ['document_id', 'event_at', 'step']);
});

test('upload offset: explicit wins, else +07:00; the file name suffix is reported, never applied', async () => {
  const { resolveUploadOffset } = await import('../src/lib/monthly-report/upload-offset');
  const name = 'real_account_conversion_report_2026-11-02T19_00_22+08_00.xlsx';
  assert.deepEqual(resolveUploadOffset(null, name), { offset: '+07:00', from: 'default', fileNameOffset: '+08:00' });
  assert.deepEqual(resolveUploadOffset('+0800', 'export.xlsx'), { offset: '+08:00', from: 'explicit', fileNameOffset: null });
  assert.ok('error' in resolveUploadOffset('GMT+8', name));
});
