import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCOUNT_FEATURES, MONTHLY_REPORT_FEATURE, accountFeatureFromPath, enabledFeaturesForUser, hasGenerationFeature,
  shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';
import {
  canUploadMonthlyReport, departmentFeaturesWithGrants, monthlyReportApiAccess, monthlyReportPageAccess,
} from '../src/lib/monthly-report/access';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Monthly Report is an account feature with a prefix-matched route tree', () => {
  assert.equal(MONTHLY_REPORT_FEATURE, 'monthly-report');
  assert.ok(ACCOUNT_FEATURES.includes('monthly-report'));
  assert.equal(accountFeatureFromPath('/dashboard/monthly-report'), 'monthly-report');
  assert.equal(accountFeatureFromPath('/dashboard/monthly-report/settlement'), 'monthly-report');
  assert.equal(accountFeatureFromPath('/dashboard/monthly-reports'), undefined);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: ['seo'] }, '/dashboard/monthly-report/uploads'), true);
  assert.equal(hasGenerationFeature({ role: 'member', features: ['monthly-report'] }), false);
});

test('a per-user grant adds the feature on top of the department', () => {
  assert.deepEqual(departmentFeaturesWithGrants(['seo'], null), ['seo']);
  assert.deepEqual(departmentFeaturesWithGrants(['seo'], false), ['seo', 'monthly-report']);
  assert.deepEqual(departmentFeaturesWithGrants(null, true), ['monthly-report']);
  assert.deepEqual(departmentFeaturesWithGrants(['monthly-report'], true), ['monthly-report']);
  assert.deepEqual(enabledFeaturesForUser({ role: 'member', features: departmentFeaturesWithGrants(['internal-docs'], false) }), ['internal-docs', 'monthly-report']);
});

test('view and upload: admin, department feature, or personal grant (same predicate)', () => {
  const admin = { role: 'admin', features: [...ACCOUNT_FEATURES], monthlyReportUpload: false };
  const viaDepartment = { role: 'member', features: ['monthly-report'], monthlyReportUpload: false };
  const personalGrant = { role: 'member', features: ['monthly-report'], monthlyReportUpload: true };
  const outsider = { role: 'member', features: ['seo'], monthlyReportUpload: false };
  const staleUploadFlag = { role: 'member', features: [], monthlyReportUpload: true };

  assert.equal(monthlyReportPageAccess(null), 'login');
  assert.equal(monthlyReportPageAccess(viaDepartment), 'allowed');
  assert.equal(monthlyReportPageAccess(outsider), 'forbidden');
  assert.equal(monthlyReportPageAccess(viaDepartment, { upload: true }), 'allowed');
  assert.equal(monthlyReportPageAccess(personalGrant, { upload: true }), 'allowed');
  assert.equal(monthlyReportPageAccess(personalGrant, { adminOnly: true }), 'forbidden');
  assert.equal(monthlyReportPageAccess(admin, { adminOnly: true }), 'allowed');
  assert.equal(monthlyReportPageAccess(admin, { upload: true }), 'allowed');

  assert.equal(canUploadMonthlyReport(admin), true);
  assert.equal(canUploadMonthlyReport(viaDepartment), true);
  assert.equal(canUploadMonthlyReport(personalGrant), true);
  assert.equal(canUploadMonthlyReport(outsider), false);
  // Stale upload flag without view still never allows upload.
  assert.equal(canUploadMonthlyReport(staleUploadFlag), false);

  assert.deepEqual(monthlyReportApiAccess(outsider), { error: 'Forbidden: you do not have access to Onboarding Reports', status: 403 });
  assert.equal(monthlyReportApiAccess(viaDepartment), null);
  assert.equal(monthlyReportApiAccess(viaDepartment, { upload: true }), null);
  assert.equal(monthlyReportApiAccess(outsider, { upload: true })?.status, 403);
});

test('every session query loads the personal Monthly Report grant', () => {
  const auth = read('src/lib/auth.ts');
  const route = read('src/app/api/auth/route.ts');
  assert.equal((auth.match(/MONTHLY_REPORT_GRANT_SQL/g) ?? []).length >= 3, true);
  assert.equal((route.match(/MONTHLY_REPORT_GRANT_SQL/g) ?? []).length >= 2, true);
  assert.match(auth, /monthlyReportUpload/);
  assert.match(read('src/lib/monthly-report/access.ts'), /FROM monthly_report_access/);
});
