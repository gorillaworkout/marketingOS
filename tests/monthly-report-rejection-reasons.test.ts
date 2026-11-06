import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticUserApprovedWorkbook } from './fixtures/monthly-report-daily';
import {
  GUIDE_CATEGORIES, OTHER_CATEGORY_LABEL, buildRejectionReasonsReport, isRejectionRow, isRobotRejection, mapRemarkToCategories,
} from '../src/lib/monthly-report/rejection-reasons';
import { aggregateApproverStats, buildApproverReport, DEPOSIT_ROBOT, parseUserApproved, type UserApprovedRow } from '../src/lib/monthly-report/user-approved-parse';

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

test('empty Approver rows never appear in ranking or rejection reasons', () => {
  assert.equal(parsed.summary.skippedBlankApprover, 2);
  const report = buildApproverReport(rows, { from: '2026-11-01', to: '2026-11-02' });
  assert.ok(!report.some(a => !a.approver.trim()), 'no blank approver line in ranking');
  // Even if a blank-approver rejection slipped into storage, the report must ignore it.
  const withBlank = [
    ...rows,
    {
      recordId: 'blank-1', documentId: 'd', createTime: '2026-11-01T12:00:00+07:00', finishedTime: '2026-11-01T12:05:00+07:00',
      applicantUid: null, approverUid: null, approver: '', approvalMethod: 'Manual', step: 'manual_kyc',
      stepStatus: null, approvedStatus: 'Failed', successStatus: 'Failed', account: null, processingTime: null,
      remark: 'Should not count', rejectedReason: null,
    },
  ];
  const rej = buildRejectionReasonsReport(withBlank, { from: '2026-11-01', to: '2026-11-02' });
  assert.ok(!rej.reasons.some(r => r.samples.some(s => /Should not count/.test(s))));
  const ranking = buildApproverReport(withBlank, { from: '2026-11-01', to: '2026-11-02' });
  assert.ok(!ranking.some(a => a.approver === '' || a.approver === '(blank)'));
});

const RANGE = { from: '2026-11-01', to: '2026-11-02' };

function rejection(overrides: Partial<UserApprovedRow> = {}): UserApprovedRow {
  return {
    recordId: 'synthetic-rej',
    documentId: 'doc-synthetic',
    createTime: '2026-11-01T05:00:00.000Z',
    finishedTime: '2026-11-01T05:05:00.000Z',
    applicantUid: null,
    approverUid: null,
    approver: 'Sari Wijaya',
    approvalMethod: 'Manual',
    step: 'manual_kyc',
    stepStatus: null,
    approvedStatus: 'Failed',
    successStatus: 'Failed',
    account: null,
    processingTime: null,
    remark: 'Mohon unggah foto KTP asli yang jelas',
    rejectedReason: null,
    ...overrides,
  };
}

test('Manual + manual_kyc + human remark counts as Staff with an English category label', () => {
  const report = buildRejectionReasonsReport([rejection()], RANGE);
  assert.equal(report.staffRejected, 1);
  assert.equal(report.robotRejected, 0);
  assert.equal(report.totalRejected, 1);
  const ktp = report.reasons.find(r => r.categoryId === 'ktp');
  assert.ok(ktp);
  assert.equal(ktp.staff, 1);
  assert.equal(ktp.robot, 0);
  assert.equal(ktp.categoryLabel, 'KTP');
});

test('Manual + manual_video_verify is not Staff and is omitted from reason totals', () => {
  const report = buildRejectionReasonsReport([
    rejection({ step: 'manual_video_verify', remark: 'Mohon perbaiki video verifikasi' }),
  ], RANGE);
  assert.equal(report.staffRejected, 0);
  assert.equal(report.robotRejected, 0);
  assert.equal(report.totalRejected, 0);
  assert.equal(report.reasons.length, 0);
});

test('Manual + auto_kyc + Ekyc remark counts as Robot, not Staff', () => {
  const report = buildRejectionReasonsReport([
    rejection({ step: 'auto_kyc', remark: 'Ekyc Status: HasSameIdentity:0' }),
  ], RANGE);
  assert.equal(report.robotRejected, 1);
  assert.equal(report.staffRejected, 0);
  assert.equal(report.reasons.some(r => r.staff > 0), false);
});

test('Auto approval method and a machine remark count as Robot', () => {
  const report = buildRejectionReasonsReport([
    rejection({
      approver: 'System',
      approvalMethod: 'Auto',
      step: 'auto_kyc',
      remark: 'Ekyc Status: livenessAuth:false',
    }),
  ], RANGE);
  assert.equal(report.robotRejected, 1);
  assert.equal(report.staffRejected, 0);
});

test('Manual + manual_kyc machine remarks are excluded from Staff', () => {
  const cases: Array<{ remark: string; robot: boolean }> = [
    { remark: 'Ekyc Status: failed', robot: true },
    { remark: 'E-Kyc mismatch on document', robot: false },
    { remark: 'EKyc result pending', robot: false },
    { remark: 'Speech Script Matching: false', robot: true },
    { remark: 'HasSameIdentity:1', robot: true },
    { remark: 'Face consistency: low', robot: true },
    { remark: 'isFirstAccount:false', robot: true },
    { remark: 'livenessAuth:false', robot: true },
    { remark: 'occupation:True', robot: false },
    { remark: 'openingPurpose:False', robot: false },
    { remark: 'fundSource:True', robot: false },
    { remark: 'isDemoTrade:false', robot: false },
  ];
  for (const { remark, robot } of cases) {
    const report = buildRejectionReasonsReport([
      rejection({ approvalMethod: 'manual', step: 'MANUAL_KYC', remark }),
    ], RANGE);
    assert.equal(report.staffRejected, 0, remark);
    assert.equal(report.robotRejected, robot ? 1 : 0, remark);
    if (!robot) {
      assert.equal(report.totalRejected, 0, remark);
      assert.equal(report.reasons.length, 0, remark);
    }
  }
});

test('category labels use English WNA names and keep Indonesian matchers', () => {
  const labels = GUIDE_CATEGORIES.map(c => c.label);
  assert.deepEqual(labels, [
    'KTP',
    'Passport',
    'Selfie',
    'Proof of Address',
    'Personal Information',
    'Employment Information',
    'Contact Person Information',
    'Financial Information',
    'Bank Account Information',
    'Investment Experience Information',
    'Duplicate Account',
    'Forbidden Occupation',
    'Restricted Country',
    'Demo Account',
    'Video Verification',
    'Video Verification - Under Age',
  ]);
  assert.equal(OTHER_CATEGORY_LABEL, 'Other');
  assert.doesNotMatch(labels.join(' '), /INFORMASI|VERIFIKASI/);
  const pekerjaan = GUIDE_CATEGORIES.find(c => c.id === 'pekerjaan');
  assert.ok(pekerjaan?.templates.some(t => /INFORMASI PEKERJAAN/i.test(t)));
  const video = GUIDE_CATEGORIES.find(c => c.id === 'video_verifikasi');
  assert.ok(video?.keywords?.some(k => /VIDEO VERIFIKASI/i.test(k)));
  const mapped = mapRemarkToCategories('Mohon lengkapi informasi pekerjaan');
  assert.equal(mapped[0].categoryId, 'pekerjaan');
  assert.equal(mapped[0].categoryLabel, 'Employment Information');
});

test('Deposit Robot on manual_kyc stays Robot when the Staff checks also match', () => {
  const report = buildRejectionReasonsReport([
    rejection({ approver: 'Deposit Robot', remark: 'Mohon unggah foto KTP asli yang jelas' }),
  ], RANGE);
  assert.equal(report.robotRejected, 1);
  assert.equal(report.staffRejected, 0);
  const ktp = report.reasons.find(r => r.categoryId === 'ktp');
  assert.equal(ktp?.robot, 1);
  assert.equal(ktp?.staff, 0);
  assert.equal(ktp?.categoryLabel, 'KTP');
});

test('Success Status Rejected with Manual + manual_kyc counts as Staff', () => {
  const report = buildRejectionReasonsReport([
    rejection({
      approvedStatus: 'Approved',
      successStatus: 'Rejected',
      remark: 'Mohon lengkapi informasi pekerjaan',
    }),
  ], RANGE);
  assert.equal(report.staffRejected, 1);
  assert.equal(report.robotRejected, 0);
  const job = report.reasons.find(r => r.categoryId === 'pekerjaan');
  assert.equal(job?.categoryLabel, 'Employment Information');
  assert.equal(job?.staff, 1);
});

test('classification copy documents the Staff rule in English', () => {
  const report = buildRejectionReasonsReport([rejection()], RANGE);
  assert.match(report.robotRule, /manual_kyc/i);
  assert.match(report.robotRule, /Staff/i);
  assert.doesNotMatch(report.robotRule, /INFORMASI|VERIFIKASI/);
});

test('Final Rejected counts a manual_kyc failure when Success Status is blank', () => {
  // Live Metabase: Success Status is Approved or blank; the failure is Approved Status = Failed.
  const onlyRejection = rejection({
    recordId: 'blank-success',
    approver: 'Citra Lestari',
    successStatus: null,
    approvedStatus: 'Failed',
    approvalMethod: 'Manual',
    step: 'manual_kyc',
    remark: 'Mohon unggah foto KTP asli yang jelas',
  });
  const report = buildApproverReport([onlyRejection], RANGE);
  const citra = report.find(a => a.approver === 'Citra Lestari');
  assert.ok(citra, 'an approver with only rejections still appears in the ranking');
  assert.equal(citra.finalApproved, 0);
  assert.equal(citra.finalRejected, 1);
  assert.equal(citra.finalRejected, buildRejectionReasonsReport([onlyRejection], RANGE).staffRejected);
  const aggregated = aggregateApproverStats([onlyRejection]);
  assert.equal(aggregated.find(a => a.approver === 'Citra Lestari')?.finalRejected, 1);
});

test('Final Rejected skips manual_video_verify, Manual auto_kyc, and Deposit Robot', () => {
  const video = rejection({
    recordId: 'video',
    approver: 'Citra Lestari',
    successStatus: 'Failed',
    approvedStatus: 'Failed',
    step: 'manual_video_verify',
    remark: 'Mohon perbaiki video verifikasi',
  });
  const autoKyc = rejection({
    recordId: 'auto-kyc',
    approver: 'Eka Nugroho',
    successStatus: null,
    approvedStatus: 'Failed',
    approvalMethod: 'Manual',
    step: 'auto_kyc',
    remark: 'Ekyc Status: HasSameIdentity:0',
  });
  const robot = rejection({
    recordId: 'robot',
    approver: DEPOSIT_ROBOT,
    successStatus: null,
    approvedStatus: 'Failed',
    approvalMethod: 'Manual',
    step: 'manual_kyc',
    remark: 'Mohon unggah foto KTP asli yang jelas',
  });
  const machineRemark = rejection({
    recordId: 'machine-remark',
    approver: 'Fajar Hidayat',
    successStatus: 'Failed',
    approvedStatus: 'Failed',
    approvalMethod: 'Manual',
    step: 'manual_kyc',
    remark: 'Ekyc Status: occupation:True',
  });
  const rowsForCase = [video, autoKyc, robot, machineRemark];
  const report = buildApproverReport(rowsForCase, RANGE);
  assert.equal(report.find(a => a.approver === 'Citra Lestari')?.finalRejected ?? 0, 0);
  assert.equal(report.find(a => a.approver === 'Eka Nugroho')?.finalRejected ?? 0, 0);
  assert.equal(report.find(a => a.approver === 'Fajar Hidayat')?.finalRejected ?? 0, 0);
  assert.equal(report.some(a => a.approver === DEPOSIT_ROBOT), false);
  for (const stat of report) {
    const staff = buildRejectionReasonsReport(
      rowsForCase.filter(row => row.approver === stat.approver),
      RANGE,
    ).staffRejected;
    assert.equal(stat.finalRejected, staff, stat.approver);
  }
});

test('fixture Final Rejected matches each approver Staff rejection count', () => {
  const report = buildApproverReport(rows, RANGE);
  assert.ok(report.some(a => a.approver === 'Ayu Pratama'));
  assert.ok(report.some(a => a.approver === 'Budi Santoso'));
  for (const stat of report) {
    const staff = buildRejectionReasonsReport(
      rows.filter(row => row.approver === stat.approver),
      RANGE,
    ).staffRejected;
    assert.equal(stat.finalRejected, staff, stat.approver);
  }
});
