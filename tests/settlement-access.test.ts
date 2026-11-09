import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ACCOUNT_FEATURES, SETTLEMENT_REPORT_FEATURE, accountFeatureFromPath, shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';
import { departmentFeaturesWithGrants } from '../src/lib/monthly-report/access';
import {
  canUploadSettlementReport, settlementReportApiAccess, settlementReportPageAccess,
} from '../src/lib/settlement/access';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Settlement Report is its own account feature and route tree', () => {
  assert.equal(SETTLEMENT_REPORT_FEATURE, 'settlement-report');
  assert.ok(ACCOUNT_FEATURES.includes('settlement-report'));
  assert.equal(accountFeatureFromPath('/dashboard/settlement-report'), 'settlement-report');
  assert.equal(accountFeatureFromPath('/dashboard/settlement-report/access'), 'settlement-report');
  assert.equal(accountFeatureFromPath('/dashboard/settlement-reports'), undefined);
  assert.equal(accountFeatureFromPath('/dashboard/monthly-report'), 'monthly-report');
  assert.equal(accountFeatureFromPath('/dashboard/monthly-report/settlement'), 'monthly-report');
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: ['monthly-report'] }, '/dashboard/settlement-report'), true);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: ['settlement-report'] }, '/dashboard/settlement-report/access'), false);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: ['settlement-report'] }, '/dashboard/monthly-report'), true);
});

test('a personal Settlement grant adds settlement-report without changing Onboarding grants', () => {
  assert.deepEqual(departmentFeaturesWithGrants(['seo'], null, null), ['seo']);
  assert.deepEqual(departmentFeaturesWithGrants(['seo'], false, null), ['seo', 'monthly-report']);
  assert.deepEqual(departmentFeaturesWithGrants(['seo'], null, false), ['seo', 'settlement-report']);
  assert.deepEqual(departmentFeaturesWithGrants(['monthly-report'], true, true), ['monthly-report', 'settlement-report']);
  assert.deepEqual(departmentFeaturesWithGrants(['seo'], null), ['seo']);
});

test('view and upload are the same predicate; Onboarding access is not enough', () => {
  const admin = { role: 'admin', features: [...ACCOUNT_FEATURES] };
  const viaDepartment = { role: 'member', features: ['settlement-report'] };
  const onboardingOnly = { role: 'member', features: ['monthly-report'] };
  assert.equal(settlementReportPageAccess(null), 'login');
  assert.equal(settlementReportPageAccess(viaDepartment), 'allowed');
  assert.equal(settlementReportPageAccess(onboardingOnly), 'forbidden');
  assert.equal(settlementReportPageAccess(viaDepartment, { upload: true }), 'allowed');
  assert.equal(settlementReportPageAccess(admin, { adminOnly: true }), 'allowed');
  assert.equal(settlementReportPageAccess(viaDepartment, { adminOnly: true }), 'forbidden');
  assert.equal(canUploadSettlementReport(viaDepartment), true);
  assert.equal(canUploadSettlementReport(onboardingOnly), false);
  assert.equal(canUploadSettlementReport(admin), true);
  assert.equal(settlementReportApiAccess(onboardingOnly)?.status, 403);
  assert.equal(settlementReportApiAccess(viaDepartment), null);
  assert.equal(settlementReportApiAccess(viaDepartment, { upload: true }), null);
});

test('session queries load the personal Settlement grant and migration 046 seeds the department', () => {
  const auth = read('src/lib/auth.ts');
  const route = read('src/app/api/auth/route.ts');
  assert.match(auth, /SETTLEMENT_REPORT_GRANT_SQL/);
  assert.match(route, /SETTLEMENT_REPORT_GRANT_SQL/);
  assert.match(read('src/lib/settlement/access.ts'), /FROM settlement_report_access/);
  const accessRoute = read('src/app/api/settlement-report/access/route.ts');
  assert.match(accessRoute, /typeof body\.view !== 'boolean'/);
  assert.match(accessRoute, /upload:\s*true/);
  assert.match(read('src/lib/settlement/store.ts'), /\[userId, true, grantedBy\]/);
  const page = read('src/app/dashboard/settlement-report/access/page.tsx');
  assert.match(page, /Personal access/);
  assert.match(page, /JSON\.stringify\(\{ userId: user\.id, view \}\)/);
  const sql = read('db/migrations/046_settlement_phase1.sql');
  assert.match(sql, /'settlement-report'/);
  assert.match(sql, /'Settlement'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS settlement_report_access/);
  assert.match(sql, /DROP TABLE IF EXISTS settlement_report_access/);
  assert.match(sql, /array_remove\(permitted_features, 'settlement-report'\)/);
});
