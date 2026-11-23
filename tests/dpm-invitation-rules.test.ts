// tests/dpm-invitation-rules.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWib, isRegistrationOpen, isValidEmail, parseClosesAtWib, parseEventName, parseResponseInput, slugIssue, suggestSlug, toWibInputValue,
} from '../src/lib/dpm-invitation/rules';
import { clientIpFromHeaders, consumeRateLimit, resetRateLimitBuckets } from '../src/lib/rate-limit';

const now = new Date('2026-11-23T05:00:00.000Z'); // 12:00 WIB

test('isRegistrationOpen: status open and closes_at null or in the future', () => {
  assert.equal(isRegistrationOpen({ status: 'open', closesAt: null }, now), true);
  assert.equal(isRegistrationOpen({ status: 'open', closesAt: new Date('2026-11-23T05:01:00Z') }, now), true);
  assert.equal(isRegistrationOpen({ status: 'open', closesAt: new Date('2026-11-23T05:00:00Z') }, now), false);
  assert.equal(isRegistrationOpen({ status: 'open', closesAt: new Date('2026-11-22T00:00:00Z') }, now), false);
  assert.equal(isRegistrationOpen({ status: 'closed', closesAt: null }, now), false);
  assert.equal(isRegistrationOpen({ status: 'closed', closesAt: new Date('2027-01-01T00:00:00Z') }, now), false);
});

test('closing time is read as WIB and shown as WIB', () => {
  assert.deepEqual(parseClosesAtWib('2026-12-20T18:00', now), { ok: true, value: new Date('2026-12-20T11:00:00.000Z') });
  assert.deepEqual(parseClosesAtWib('', now), { ok: true, value: null });
  assert.deepEqual(parseClosesAtWib(null, now), { ok: true, value: null });
  assert.deepEqual(parseClosesAtWib('2026-02-30T10:00', now), { ok: false, error: 'Enter a valid closing date and time.' });
  assert.deepEqual(parseClosesAtWib('tomorrow', now), { ok: false, error: 'Enter a valid closing date and time.' });
  assert.deepEqual(parseClosesAtWib('2026-11-23T11:59', now), { ok: false, error: 'Closing time must be in the future.' });
  assert.equal(toWibInputValue(new Date('2026-12-20T11:00:00.000Z')), '2026-12-20T18:00');
  assert.equal(toWibInputValue(null), '');
  assert.equal(formatWib(new Date('2026-12-20T11:05:00.000Z')), '20 Dec 2026, 18:05 WIB');
});

test('slug rules', () => {
  const shape = 'Use 3–60 lowercase letters, numbers and hyphens.';
  assert.equal(slugIssue('gala-dinner-2027'), null);
  for (const bad of ['ab', '-gala', 'gala-', 'Gala', 'gala--2027', 'a'.repeat(61)]) assert.equal(slugIssue(bad), shape, bad);
  assert.equal(slugIssue('thanks'), 'That word is reserved. Choose another link.');
  assert.equal(suggestSlug('Gala Dinner 2027 — Hà Nội!'), 'gala-dinner-2027-ha-noi');
  assert.equal(suggestSlug('  '), '');
});

test('event name', () => {
  assert.deepEqual(parseEventName('  DPM   Gala Dinner 2027 '), { ok: true, value: 'DPM Gala Dinner 2027' });
  assert.deepEqual(parseEventName('x'), { ok: false, error: 'Enter a name of 2–120 characters.' });
});

test('email check is practical, any domain', () => {
  for (const ok of ['a@b.co', 'nguyen.van.a@dpm.vn', 'x+y@gmail.com']) assert.equal(isValidEmail(ok), true, ok);
  for (const bad of ['', 'a@b', 'a b@c.d', '@c.d', 'a@@c.d', `${'a'.repeat(250)}@c.de`]) assert.equal(isValidEmail(bad), false, bad);
});

test('response parsing follows the form order and drops hidden answers', () => {
  assert.deepEqual(parseResponseInput({ fullName: ' Nguyễn  Văn A ', email: ' A@Dpm.VN ', attending: 'yes', hasAllergy: 'yes', allergyNotes: ' peanuts ' }), {
    ok: true, value: { fullName: 'Nguyễn Văn A', email: 'A@Dpm.VN', emailNormalized: 'a@dpm.vn', attending: true, hasAllergy: true, allergyNotes: 'peanuts' },
  });
  assert.deepEqual(parseResponseInput({ fullName: 'Tran B', email: 'b@x.vn', attending: 'yes', hasAllergy: 'no', allergyNotes: 'ignored' }), {
    ok: true, value: { fullName: 'Tran B', email: 'b@x.vn', emailNormalized: 'b@x.vn', attending: true, hasAllergy: false, allergyNotes: null },
  });
  assert.deepEqual(parseResponseInput({ fullName: 'Le C', email: 'c@x.vn', attending: 'no', hasAllergy: 'yes', allergyNotes: 'shellfish' }), {
    ok: true, value: { fullName: 'Le C', email: 'c@x.vn', emailNormalized: 'c@x.vn', attending: false, hasAllergy: null, allergyNotes: null },
  });
  assert.deepEqual(parseResponseInput({ fullName: 'x', email: 'nope', attending: 'maybe' }), {
    ok: false, fieldErrors: { fullName: 'Please enter your full name.', email: 'Please enter a valid email address.', attending: 'Please choose Yes or No.' },
  });
  assert.deepEqual(parseResponseInput({ fullName: 'Pham D', email: 'd@x.vn', attending: 'yes' }), { ok: false, fieldErrors: { hasAllergy: 'Please choose Yes or No.' } });
  assert.deepEqual(parseResponseInput({ fullName: 'Pham D', email: 'd@x.vn', attending: 'yes', hasAllergy: 'yes', allergyNotes: '  ' }), { ok: false, fieldErrors: { allergyNotes: 'Please tell us what you are allergic to.' } });
  assert.deepEqual(parseResponseInput({ fullName: 'Pham D', email: 'd@x.vn', attending: 'yes', hasAllergy: 'yes', allergyNotes: 'x'.repeat(201) }), { ok: false, fieldErrors: { allergyNotes: 'Please use at most 200 characters.' } });
  assert.deepEqual(parseResponseInput({ fullName: 'y'.repeat(121), email: 'd@x.vn', attending: 'no' }), { ok: false, fieldErrors: { fullName: 'Please use at most 120 characters.' } });
  assert.deepEqual(parseResponseInput({ fullName: 'Bad\u0007Name', email: 'd@x.vn', attending: 'no' }), { ok: false, fieldErrors: { fullName: 'Please enter your full name.' } });
});

test('named rate-limit buckets are independent and windowed', () => {
  resetRateLimitBuckets();
  const t = 1_000_000;
  for (let i = 0; i < 60; i++) assert.equal(consumeRateLimit('dpm-inv-ip', '1.1.1.1', 60, 600_000, t).allowed, true);
  const blocked = consumeRateLimit('dpm-inv-ip', '1.1.1.1', 60, 600_000, t + 1000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 599);
  assert.equal(consumeRateLimit('dpm-inv-email', '1.1.1.1', 5, 3_600_000, t).allowed, true, 'other bucket unaffected');
  assert.equal(consumeRateLimit('dpm-inv-ip', '2.2.2.2', 60, 600_000, t).allowed, true, 'other key unaffected');
  assert.equal(consumeRateLimit('dpm-inv-ip', '1.1.1.1', 60, 600_000, t + 600_000).allowed, true, 'window reset');
});

test('client IP prefers Cloudflare, then nginx headers', () => {
  assert.equal(clientIpFromHeaders(new Headers({ 'cf-connecting-ip': '9.9.9.9', 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '7.7.7.7, 1.1.1.1' })), '9.9.9.9');
  assert.equal(clientIpFromHeaders(new Headers({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '7.7.7.7' })), '8.8.8.8');
  assert.equal(clientIpFromHeaders(new Headers({ 'x-forwarded-for': ' 7.7.7.7 , 1.1.1.1' })), '7.7.7.7');
  assert.equal(clientIpFromHeaders(new Headers()), 'unknown');
});
