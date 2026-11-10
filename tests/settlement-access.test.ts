import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  assert.equal(accountFeatureFromPath('/dashboard/settlement-report/export'), 'settlement-report');
  assert.equal(accountFeatureFromPath('/dashboard/settlement-reports'), undefined);
  assert.equal(accountFeatureFromPath('/dashboard/monthly-report'), 'monthly-report');
  assert.equal(accountFeatureFromPath('/dashboard/monthly-report/settlement'), 'monthly-report');
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: ['monthly-report'] }, '/dashboard/settlement-report'), true);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: ['settlement-report'] }, '/dashboard/settlement-report/export'), false);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: ['settlement-report'] }, '/dashboard/monthly-report'), true);
});

test('Onboarding personal grants still apply; Settlement grants do not', () => {
  assert.deepEqual(departmentFeaturesWithGrants(['seo'], null), ['seo']);
  assert.deepEqual(departmentFeaturesWithGrants(['seo'], false), ['seo', 'monthly-report']);
  assert.deepEqual(departmentFeaturesWithGrants(['monthly-report'], true), ['monthly-report']);
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

test('Settlement access is department-only; the unused access table is kept', () => {
  const auth = read('src/lib/auth.ts');
  const route = read('src/app/api/auth/route.ts');
  assert.doesNotMatch(auth, /SETTLEMENT_REPORT_GRANT_SQL/);
  assert.doesNotMatch(route, /SETTLEMENT_REPORT_GRANT_SQL/);
  assert.doesNotMatch(auth, /settlement_report_grant/);
  assert.doesNotMatch(route, /settlement_report_grant/);
  assert.doesNotMatch(read('src/lib/settlement/access.ts'), /SETTLEMENT_REPORT_GRANT_SQL/);
  assert.doesNotMatch(read('src/lib/admin-api-access.ts'), /\/api\/settlement-report\/access/);
  assert.doesNotMatch(read('src/components/settlement/SettlementNav.tsx'), /settlement-report\/access/);
  assert.doesNotMatch(read('src/lib/settlement/store.ts'), /listSettlementAccessUsers|setSettlementAccess|settlement_report_access/);
  assert.equal(existsSync(new URL('../src/app/dashboard/settlement-report/access/page.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/app/api/settlement-report/access/route.ts', import.meta.url)), false);
  const sql = read('db/migrations/046_settlement_phase1.sql');
  assert.match(sql, /'settlement-report'/);
  assert.match(sql, /'Settlement'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS settlement_report_access/);
  assert.match(sql, /DROP TABLE IF EXISTS settlement_report_access/);
  assert.match(sql, /array_remove\(permitted_features, 'settlement-report'\)/);
});
