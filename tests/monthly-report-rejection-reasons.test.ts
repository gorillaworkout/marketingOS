import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticUserApprovedWorkbook } from './fixtures/monthly-report-daily';
import {
  buildRejectionReasonsReport, isRejectionRow, isRobotRejection, mapRemarkToCategories,
} from '../src/lib/monthly-report/rejection-reasons';
import { buildApproverReport, DEPOSIT_ROBOT, parseUserApproved } from '../src/lib/monthly-report/user-approved-parse';

const parsed = parseUserApproved(syntheticUserApprovedWorkbook(), { offset: '+07:00' });
const rows = parsed.rows;

test('Deposit Robot rows are kept in storage but skipped from approver ranking', () => {
  assert.ok(rows.some(r => r.approver === DEPOSIT_ROBOT));
  const report = buildApproverReport(rows, { from: '2026-11-01', to: '2026-11-02' });
  assert.ok(!report.some(a => a.approver === DEPOSIT_ROBOT));
  assert.ok(report.some(a => a.approver === 'Ayu Pratama'));
});

test('Remark maps to guide categories; unmatched stays Other with raw text', () => {
  const ktp = mapRemarkToCategories('Mohon unggah foto KTP asli yang jelas');
  assert.equal(ktp[0].categoryId, 'ktp');
  const other = mapRemarkToCategories('Custom staff note not in guide');
  assert.equal(other[0].categoryId, 'other');
  assert.match(other[0].raw, /Custom staff note/);
  const dup = mapRemarkToCategories('Ekyc Status: HasSameIdentity:1 occupation:False');
  assert.ok(dup.some(m => m.categoryId === 'duplicate_account'));
});

test('rejection report splits Robot vs Staff and prefers Remark over Rejected Reason', () => {
  const report = buildRejectionReasonsReport(rows, { from: '2026-11-01', to: '2026-11-02' });
  assert.ok(report.totalRejected >= 4);
  assert.ok(report.robotRejected >= 2);
  assert.ok(report.staffRejected >= 2);
  assert.equal(report.rejectedReasonColumnFilled, 0);
  const byId = Object.fromEntries(report.reasons.map(r => [r.categoryId, r]));
  assert.ok((byId.ktp?.staff ?? 0) >= 1);
  assert.ok((byId.selfie?.staff ?? 0) >= 1);
  assert.ok((byId.duplicate_account?.robot ?? 0) >= 1);
  assert.ok((byId.video_verifikasi?.robot ?? 0) >= 1);
  const other = report.reasons.filter(r => r.categoryId === 'other');
  assert.ok(other.some(r => r.samples.some(s => /Custom staff note/.test(s))));
  assert.match(report.robotRule, /robot\|system/i);
});

test('isRobotRejection covers Deposit Robot, Auto method, auto_ steps, machine remarks', () => {
  assert.equal(isRobotRejection({ approver: 'Deposit Robot', approvalMethod: 'Auto', step: 'auto_video_verify', remark: '' }), true);
  assert.equal(isRobotRejection({ approver: 'Ayu', approvalMethod: 'Manual', step: 'manual_kyc', remark: '' }), false);
  assert.equal(isRobotRejection({ approver: 'Ayu', approvalMethod: 'Manual', step: 'manual_kyc', remark: 'Ekyc Status: foo' }), true);
  assert.equal(isRejectionRow({ approvedStatus: 'Failed', successStatus: null }), true);
  assert.equal(isRejectionRow({ approvedStatus: 'Approved', successStatus: 'Approved' }), false);
});
