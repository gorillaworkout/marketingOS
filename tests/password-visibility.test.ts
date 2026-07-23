import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordInputType } from '../src/lib/password-visibility';

test('uses a masked input while password visibility is disabled', () => {
  assert.equal(passwordInputType(false), 'password');
});

test('uses a text input while password visibility is enabled', () => {
  assert.equal(passwordInputType(true), 'text');
});
