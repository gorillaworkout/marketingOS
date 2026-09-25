import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_FEATURES, canAccessFeature, enabledFeaturesForUser, hasGenerationFeature } from '../src/lib/authorization';

test('admins retain every account feature regardless of department membership', () => {
  assert.equal(canAccessFeature({ role: 'admin', features: [] }, 'social-post'), true);
  assert.equal(canAccessFeature({ role: 'admin', features: [] }, 'internal-docs'), true);
  assert.deepEqual(enabledFeaturesForUser({ role: 'admin', features: [] }), [...ACCOUNT_FEATURES]);
});

test('members can only use features granted by their department', () => {
  const member = { role: 'member' as const, features: ['video-script', 'internal-docs'] };
  assert.equal(canAccessFeature(member, 'video-script'), true);
  assert.equal(canAccessFeature(member, 'internal-docs'), true);
  assert.equal(canAccessFeature(member, 'social-post'), false);
  assert.equal(canAccessFeature({ role: 'member', features: ['video-script'] }, 'internal-docs'), false);
  assert.equal(canAccessFeature(member, 'event-plan'), false);
});

test('a member without a department has no feature access', () => {
  assert.deepEqual(enabledFeaturesForUser({ role: 'member', features: [] }), []);
});

test('Internal Docs alone does not count as a generation feature', () => {
  assert.equal(hasGenerationFeature({ role: 'member', features: ['internal-docs'] }), false);
  assert.equal(hasGenerationFeature({ role: 'member', features: ['social-post', 'internal-docs'] }), true);
  assert.equal(hasGenerationFeature({ role: 'admin', features: [] }), true);
});
