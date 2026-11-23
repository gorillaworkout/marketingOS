// tests/dpm-invitation-access.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCOUNT_FEATURES, ACCOUNT_FEATURE_LABELS, DASHBOARD_FEATURE_HREFS, DPM_INVITATION_FEATURE,
  accountFeatureFromPath, canAccessFeature, isDashboardNavItemVisible, shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';

const read = (file: string) => readFileSync(file, 'utf8');

test('dpm-invitation is an Accounts feature, prefix-matched under /dashboard/dpm/invitation', () => {
  assert.equal(DPM_INVITATION_FEATURE, 'dpm-invitation');
  assert.ok(ACCOUNT_FEATURES.includes('dpm-invitation'));
  assert.equal(ACCOUNT_FEATURE_LABELS['dpm-invitation'], 'DPM Invitation');
  assert.equal(DASHBOARD_FEATURE_HREFS['dpm-invitation'], '/dashboard/dpm/invitation');
  assert.equal(accountFeatureFromPath('/dashboard/dpm/invitation'), 'dpm-invitation');
  assert.equal(accountFeatureFromPath('/dashboard/dpm/invitation/abc'), 'dpm-invitation');
});

test('only admins and holders can open DPM Invitation', () => {
  const member = { role: 'member', features: ['social-post'] };
  const holder = { role: 'member', features: ['dpm-invitation'] };
  const admin = { role: 'admin', features: [] };
  assert.equal(canAccessFeature(member, 'dpm-invitation'), false);
  assert.equal(canAccessFeature(holder, 'dpm-invitation'), true);
  assert.equal(canAccessFeature(admin, 'dpm-invitation'), true);
  assert.equal(shouldBlockDashboardGenerationPath(member, '/dashboard/dpm/invitation/x'), true);
  assert.equal(shouldBlockDashboardGenerationPath(holder, '/dashboard/dpm/invitation/x'), false);
  const item = { href: '/dashboard/dpm/invitation', feature: 'dpm-invitation' as const };
  assert.equal(isDashboardNavItemVisible(item, member), false);
  assert.equal(isDashboardNavItemVisible(item, holder), true);
});

test('sidebar has a DPM section with Invitation', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /label: 'DPM',\s*items: \[\s*\{ href: '\/dashboard\/dpm\/invitation', label: 'Invitation', icon: 'event', feature: 'dpm-invitation' \}/);
});

test('new departments do not get dpm-invitation by default (personal data)', () => {
  const accounts = read('src/app/dashboard/accounts/AccountsClient.tsx');
  assert.match(accounts, /NEW_DEPARTMENT_FEATURES[^\n]*feature !== SEO_FEATURE && feature !== DPM_INVITATION_FEATURE/);
});
