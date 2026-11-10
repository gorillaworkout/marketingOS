import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  ACCOUNT_FEATURES, MONTHLY_REPORT_FEATURE, accountFeatureFromPath, hasGenerationFeature,
  shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';
import {
  canUploadMonthlyReport, monthlyReportApiAccess, monthlyReportPageAccess,
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

test('view and upload are the same predicate; access is admin or department only', () => {
  const admin = { role: 'admin', features: [...ACCOUNT_FEATURES] };
  const viaDepartment = { role: 'member', features: ['monthly-report'] };
  const outsider = { role: 'member', features: ['seo'] };

  assert.equal(monthlyReportPageAccess(null), 'login');
  assert.equal(monthlyReportPageAccess(viaDepartment), 'allowed');
  assert.equal(monthlyReportPageAccess(outsider), 'forbidden');
  assert.equal(monthlyReportPageAccess(viaDepartment, { upload: true }), 'allowed');
  assert.equal(monthlyReportPageAccess(viaDepartment, { adminOnly: true }), 'forbidden');
  assert.equal(monthlyReportPageAccess(admin, { adminOnly: true }), 'allowed');
  assert.equal(monthlyReportPageAccess(admin, { upload: true }), 'allowed');

  assert.equal(canUploadMonthlyReport(admin), true);
  assert.equal(canUploadMonthlyReport(viaDepartment), true);
  assert.equal(canUploadMonthlyReport(outsider), false);

  assert.deepEqual(monthlyReportApiAccess(outsider), { error: 'Forbidden: you do not have access to Onboarding Reports', status: 403 });
  assert.equal(monthlyReportApiAccess(viaDepartment), null);
  assert.equal(monthlyReportApiAccess(viaDepartment, { upload: true }), null);
  assert.equal(monthlyReportApiAccess(outsider, { upload: true })?.status, 403);
});

test('Onboarding access is department-only; the unused access table is kept', () => {
  const auth = read('src/lib/auth.ts');
  const route = read('src/app/api/auth/route.ts');
  assert.doesNotMatch(auth, /MONTHLY_REPORT_GRANT_SQL/);
  assert.doesNotMatch(route, /MONTHLY_REPORT_GRANT_SQL/);
  assert.doesNotMatch(auth, /monthly_report_grant|monthlyReportUpload|departmentFeaturesWithGrants/);
  assert.doesNotMatch(route, /monthly_report_grant|departmentFeaturesWithGrants/);
  assert.doesNotMatch(read('src/lib/monthly-report/access.ts'), /MONTHLY_REPORT_GRANT_SQL|departmentFeaturesWithGrants/);
  assert.doesNotMatch(read('src/lib/monthly-report/access.ts'), /FROM monthly_report_access/);
  assert.doesNotMatch(read('src/lib/admin-api-access.ts'), /\/api\/monthly-report\/access/);
  assert.doesNotMatch(read('src/components/monthly-report/ReportTabs.tsx'), /monthly-report\/access/);
  assert.doesNotMatch(read('src/lib/monthly-report/store.ts'), /listAccessUsers|setUserAccess|monthly_report_access/);
  assert.equal(existsSync(new URL('../src/app/dashboard/monthly-report/access/page.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/app/api/monthly-report/access/route.ts', import.meta.url)), false);
  const sql = read('db/migrations/041_monthly_report.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS monthly_report_access/);
  assert.match(sql, /retained after the Access tab was removed/);
});
