import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessFeature, enabledFeaturesForUser } from '../src/lib/authorization';

test('admins retain every generation feature regardless of department membership', () => {
  assert.equal(canAccessFeature({ role: 'admin', features: [] }, 'social-post'), true);
  assert.deepEqual(enabledFeaturesForUser({ role: 'admin', features: [] }), ['social-post', 'video-script', 'event-plan']);
});

test('members can only use generation features granted by their department', () => {
  const member = { role: 'member' as const, features: ['video-script'] };
  assert.equal(canAccessFeature(member, 'video-script'), true);
  assert.equal(canAccessFeature(member, 'social-post'), false);
  assert.equal(canAccessFeature(member, 'event-plan'), false);
});

test('a member without a department has no generation access', () => {
  assert.deepEqual(enabledFeaturesForUser({ role: 'member', features: [] }), []);
});
