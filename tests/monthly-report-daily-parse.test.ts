import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticSummaryWorkbook, syntheticUserApprovedWorkbook } from './fixtures/monthly-report-daily';
import { detectUploadKind } from '../src/lib/monthly-report/detect';
import { parseOnboardingSummary } from '../src/lib/monthly-report/summary-parse';
import { DEPOSIT_ROBOT, parseUserApproved } from '../src/lib/monthly-report/user-approved-parse';

test('detects onboarding_summary and user_approved from headers', () => {
  const summary = detectUploadKind(syntheticSummaryWorkbook());
  assert.equal(summary.ok && summary.kind, 'onboarding_summary');
  const ua = detectUploadKind(syntheticUserApprovedWorkbook());
  assert.equal(ua.ok && ua.kind, 'user_approved');
  const uaCorrect = detectUploadKind(syntheticUserApprovedWorkbook({ correctSpelling: true }));
  assert.equal(uaCorrect.ok && uaCorrect.kind, 'user_approved');
});

test('summary parse skips Total, computes TRA when TOTAL excludes manual', () => {
  const parsed = parseOnboardingSummary(syntheticSummaryWorkbook());
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].date, '2026-11-01');
  assert.equal(parsed.rows[0].registrations, 100);
  assert.equal(parsed.rows[0].totalRealAccount, 40);
  assert.equal(parsed.rows[0].manualKycApproved, 5);
  assert.equal(parsed.rows[0].totalIncludesManual, false);
  const asDaily = parsed.rows[0];
  // TRA for KPIs = TOTAL + Manual when TOTAL is activations-only
  assert.equal(asDaily.totalRealAccount + asDaily.manualKycApproved, 45);
});

test('user_approved accepts Finsihed Time / Step Astatus typos and keeps Deposit Robot', () => {
  const parsed = parseUserApproved(syntheticUserApprovedWorkbook(), { offset: '+07:00' });
  assert.equal(parsed.errors.length, 0);
  assert.ok(parsed.rows.length >= 6);
  assert.ok(parsed.rows.some(r => r.approver === DEPOSIT_ROBOT));
  assert.ok(parsed.rows.every(r => r.createTime.includes('T') || r.createTime.includes('+')));
  const finished = parsed.rows.find(r => r.recordId === '900001');
  assert.ok(finished?.finishedTime);
});

test('user_approved skips empty Approver as unfinished KYC (not invalid, not stored)', () => {
  const parsed = parseUserApproved(syntheticUserApprovedWorkbook(), { offset: '+07:00' });
  assert.equal(parsed.summary.skippedBlankApprover, 2);
  assert.ok(!parsed.rows.some(r => !r.approver || !r.approver.trim()));
  assert.ok(!parsed.issues.some(i => /Approver is missing/i.test(i.message)));
  assert.ok(parsed.summary.skippedRobot >= 1);
});
