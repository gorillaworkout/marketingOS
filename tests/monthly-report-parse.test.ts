import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_HEADERS, SYNTHETIC_ROWS, buildWorkbookBuffer, syntheticOnboardingWorkbook,
} from './fixtures/monthly-report-onboarding';
import {
  DEFAULT_SOURCE_OFFSET, eventKey, offsetFromFileName, parseOffset, parseOnboardingWorkbook, wallClockToIso,
} from '../src/lib/monthly-report/onboarding-parse';

test('default source offset is +07:00 (WIB); a file name suffix can still be read for display', () => {
  assert.equal(offsetFromFileName('real_account_conversion_report_2026-11-02T19_00_22+08_00.xlsx'), '+08:00');
  assert.equal(offsetFromFileName('report_2026-11-02T19:00:22+07:00.xlsx'), '+07:00');
  assert.equal(offsetFromFileName('report-05_30.xlsx'), null);
  assert.equal(offsetFromFileName('export.xlsx'), null);
  assert.equal(DEFAULT_SOURCE_OFFSET, '+07:00');
  assert.equal(parseOffset('+08:00'), 480);
  assert.equal(parseOffset('-03:30'), -210);
  assert.equal(parseOffset('+0800'), 480);
  assert.equal(parseOffset('08:00'), null);
  assert.equal(parseOffset('+15:00'), null);
});

test('wall-clock export times convert to UTC with the source offset', () => {
  assert.equal(wallClockToIso({ y: 2026, m: 10, d: 1, hh: 0, mm: 10, ss: 23 }, 480), '2026-09-30T16:10:23.000Z');
  assert.equal(wallClockToIso({ y: 2026, m: 10, d: 1, hh: 0, mm: 10, ss: 23 }, 420), '2026-09-30T17:10:23.000Z');
});

test('parses the onboarding export format and normalizes every column', () => {
  const result = parseOnboardingWorkbook(syntheticOnboardingWorkbook(), { offset: '+08:00' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.sheetName, 'Query result');
  assert.equal(result.rows.length, SYNTHETIC_ROWS.length);
  const activated = result.rows[1];
  assert.deepEqual(activated, {
    documentId: '5000002', eventAt: '2026-09-30T16:15:01.000Z', uid: '900001', isFirstAccount: true,
    tradingAccountNo: '7000001', approvalMethod: 'Auto', step: 'auto_add_account', stepStatus: 'Approved',
    accountStatus: 'Real Account Activated', remarks: 'Completed',
  });
  assert.equal(result.rows[0].isFirstAccount, null);
  assert.equal(result.rows[0].tradingAccountNo, null);
  assert.equal(result.rows[5].isFirstAccount, false);
  assert.equal(result.rows[10].remarks, 'ok');
  assert.equal(result.summary.rows, 11);
  assert.equal(result.summary.invalid, 0);
  assert.deepEqual(result.summary.wibRange, { from: '2026-09-30', to: '2026-10-31' });
  assert.equal(result.summary.byStep.manual_kyc, 3);
  assert.equal(result.summary.byStepStatus.Rejected, 2);
});

test('text timestamps (YYYY-MM-DD HH:mm:ss) are accepted too', () => {
  const buffer = buildWorkbookBuffer(SYNTHETIC_ROWS.slice(0, 2), { dateAsText: true });
  const result = parseOnboardingWorkbook(buffer, { offset: '+07:00' });
  assert.equal(result.rows[0].eventAt, '2026-09-30T17:10:23.000Z');
});

test('headers are validated (order and case are free, missing columns reject the file)', () => {
  const shuffled = [...ONBOARDING_HEADERS].reverse().map(h => h.toUpperCase());
  const rows = SYNTHETIC_ROWS.map(row => [...row].reverse());
  const ok = parseOnboardingWorkbook(buildWorkbookBuffer(rows, { headers: shuffled }), { offset: '+08:00' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.rows[1].documentId, '5000002');

  const missing = parseOnboardingWorkbook(buildWorkbookBuffer([], { headers: ONBOARDING_HEADERS.slice(0, 9) }), { offset: '+08:00' });
  assert.match(missing.errors.join(' '), /Missing column: Remarks/);
  assert.equal(missing.rows.length, 0);
});

test('invalid rows and in-file duplicate events are skipped and reported (first copy wins)', () => {
  const rows: unknown[][] = [
    SYNTHETIC_ROWS[0],
    ['not a date', 1, 6000001, '', '', 'Auto', 'auto_kyc', 'Approved', 'KYC Done', ''],
    ['2026-10-02 10:00:00', 1, '', '', '', 'Auto', 'auto_kyc', 'Approved', 'KYC Done', ''],
    [...SYNTHETIC_ROWS[0].slice(0, 9), 'second copy differs'],
    SYNTHETIC_ROWS[0],
    ['2026-10-03 10:00:00', 2, 6000002, '', '', 'Robot', 'new_step', 'Approved', 'KYC Done', ''],
  ];
  const result = parseOnboardingWorkbook(buildWorkbookBuffer(rows), { offset: '+08:00' });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].remarks, 'Ekyc Status:Success;');
  assert.equal(result.summary.invalid, 2);
  assert.equal(result.summary.duplicatesInFile, 2);
  assert.equal(result.summary.conflictingDuplicatesInFile, 1);
  assert.match(result.issues[0].message, /Date Time/);
  assert.equal(result.issues[0].row, 3);
  assert.match(result.issues[1].message, /Document ID/);
  assert.deepEqual(result.summary.unknownValues, { 'Approval Method': ['Robot'], Steps: ['new_step'] });
});

test('one Document ID with events at different times or steps keeps every event', () => {
  const rows: unknown[][] = [
    ['2026-09-30 23:00:00', 1, 6100001, '', '', 'Manual', 'manual_kyc', 'Pending', 'KYC Pending', ''],
    ['2026-10-02 09:00:00', 1, 6100001, '', '', 'Manual', 'manual_kyc', 'Approved', 'KYC Done', ''],
    ['2026-10-02 09:00:00', 1, 6100001, '', '', 'Manual', 'manual_video_verify', 'Approved', 'Video Done', ''],
  ];
  const result = parseOnboardingWorkbook(buildWorkbookBuffer(rows), { offset: '+07:00' });
  assert.equal(result.rows.length, 3);
  assert.equal(result.summary.duplicatesInFile, 0);
  assert.equal(new Set(result.rows.map(eventKey)).size, 3);
  assert.equal(eventKey(result.rows[0]), '6100001|2026-09-30T16:00:00.000Z|manual_kyc');
});

test('a bad offset is an error', () => {
  const result = parseOnboardingWorkbook(syntheticOnboardingWorkbook(), { offset: 'GMT+8' });
  assert.match(result.errors.join(' '), /offset/i);
});
