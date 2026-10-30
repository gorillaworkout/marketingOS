import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGscClient, describeGoogleError, MAX_GOOGLE_ERROR_LENGTH, SeoConfigError } from '../src/lib/seo/gsc-client';
import { startAutoRefresh, SEO_SYNC_FINISHED_EVENT } from '../src/components/seo/autoRefresh';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');
const staticTokens = { getToken: async () => 'ya29.secret-token-value' };
const request = { startDate: 'x', endDate: 'x', dimensions: ['date'] as Array<'date'> };

const PERMISSION_DENIED = JSON.stringify({ error: {
  code: 403, status: 'PERMISSION_DENIED',
  message: "User does not have sufficient permission for site 'sc-domain:a.org'. See also: https://support.google.com/webmasters/answer/2451999.",
  errors: [{ message: 'User does not have sufficient permission', domain: 'global', reason: 'forbidden' }],
} });
const SERVICE_DISABLED = JSON.stringify({ error: {
  code: 403, status: 'PERMISSION_DENIED',
  message: 'Google Search Console API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/searchconsole.googleapis.com/overview?project=123456 then retry.',
  errors: [{ message: 'disabled', domain: 'usageLimits', reason: 'accessNotConfigured', extendedHelp: 'https://console.developers.google.com' }],
  details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com', metadata: { service: 'searchconsole.googleapis.com', consumer: 'projects/123456' } }],
} });

// ---------- GSC 403 reason ----------

test('describeGoogleError reads status, reasons and message from a permission-denied body', () => {
  const text = describeGoogleError(PERMISSION_DENIED);
  assert.match(text, /PERMISSION_DENIED/);
  assert.match(text, /forbidden/);
  assert.match(text, /does not have sufficient permission for site 'sc-domain:a\.org'/);
});

test('describeGoogleError surfaces SERVICE_DISABLED / accessNotConfigured and dedupes reasons', () => {
  const text = describeGoogleError(SERVICE_DISABLED);
  assert.match(text, /PERMISSION_DENIED/);
  assert.match(text, /SERVICE_DISABLED/);
  assert.match(text, /accessNotConfigured/);
  assert.match(text, /has not been used in project 123456/);
  assert.equal(describeGoogleError(JSON.stringify({ error: { status: 'X', errors: [{ reason: 'r' }], details: [{ reason: 'r' }] } })).match(/\br\b/g)?.length, 1);
});

test('describeGoogleError ignores non-JSON or unrelated bodies and never echoes them', () => {
  assert.equal(describeGoogleError('<html><body>403 Forbidden</body></html>'), '');
  assert.equal(describeGoogleError(''), '');
  assert.equal(describeGoogleError('{"rows": []}'), '');
  assert.equal(describeGoogleError('null'), '');
  assert.equal(describeGoogleError('{"error": "plain string"}'), 'plain string');
});

test('describeGoogleError caps length, collapses whitespace and redacts token- and key-like text', () => {
  const long = describeGoogleError(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: `a\n\n b ${'x'.repeat(5000)}` } }));
  assert.ok(long.length <= MAX_GOOGLE_ERROR_LENGTH, `length ${long.length}`);
  assert.match(long, /a b x/);
  assert.match(long, /…$/);
  const leaky = describeGoogleError(JSON.stringify({ error: { message: 'token ya29.a0AfH6SMBabcdefghijklmnop Bearer abc.def.ghi key -----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY----- blob AIzaSyA1234567890abcdefghijklmnopqrstuv' } }));
  assert.doesNotMatch(leaky, /ya29\.|abc\.def\.ghi|MIIEv|BEGIN PRIVATE KEY|AIzaSy/);
  assert.match(leaky, /\[redacted\]/);
});

test('GSC client keeps the friendly 403 message and appends Google\'s reason', async () => {
  const client = createGscClient(staticTokens, { serviceAccountEmail: 'sa@x.iam.gserviceaccount.com', fetch: async () => new Response(SERVICE_DISABLED, { status: 403, headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(client.query('sc-domain:a.org', request), (error: unknown) => {
    assert.ok(error instanceof SeoConfigError);
    assert.equal(error.code, 'no-access');
    assert.match(error.message, /sa@x\.iam\.gserviceaccount\.com/);
    assert.match(error.message, /Restricted user/);
    assert.match(error.message, /Google said: PERMISSION_DENIED \(SERVICE_DISABLED, accessNotConfigured\): Google Search Console API has not been used/);
    assert.doesNotMatch(error.message, /ya29/);
    return true;
  });
  const html = createGscClient(staticTokens, { fetch: async () => new Response('<html>nope</html>', { status: 403 }) });
  await assert.rejects(html.query('sc-domain:a.org', request), (error: unknown) => error instanceof SeoConfigError && !/Google said|html/.test(error.message) && /Restricted user/.test(error.message));
});

// ---------- Auto refresh ----------

class FakeDocument extends EventTarget { visibilityState: 'visible' | 'hidden' = 'visible'; }
function fakeEnv() {
  const doc = new FakeDocument();
  const win = new EventTarget();
  const timers = new Map<number, () => void>();
  let nextId = 1;
  let clock = 0;
  const env = {
    document: doc, window: win, now: () => clock,
    setInterval: (fn: () => void) => { const id = nextId++; timers.set(id, fn); return id; },
    clearInterval: (id: number) => { timers.delete(id); },
  };
  return { env, doc, win, timers, tick: (ms: number) => { clock += ms; }, fireTimers: () => [...timers.values()].forEach(fn => fn()) };
}

test('auto refresh refetches on focus/visibility, skips when hidden, and throttles bursts', () => {
  const { env, doc, win, tick } = fakeEnv();
  let calls = 0;
  const stop = startAutoRefresh(env, { refresh: () => { calls += 1; }, poll: false, minGapMs: 2000 });
  win.dispatchEvent(new Event('focus'));
  assert.equal(calls, 1);
  doc.dispatchEvent(new Event('visibilitychange')); // same tab switch fires both events
  assert.equal(calls, 1);
  tick(2500);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('focus'));
  assert.equal(calls, 1);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 2);
  tick(2500);
  win.dispatchEvent(new Event(SEO_SYNC_FINISHED_EVENT));
  assert.equal(calls, 3);
  stop();
  tick(2500);
  win.dispatchEvent(new Event('focus'));
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event(SEO_SYNC_FINISHED_EVENT));
  assert.equal(calls, 3);
});

test('auto refresh polls only while poll is on, not while hidden, and clears the interval', () => {
  const { env, doc, timers, fireTimers, tick } = fakeEnv();
  let calls = 0;
  const idle = startAutoRefresh(env, { refresh: () => { calls += 1; }, poll: false });
  assert.equal(timers.size, 0);
  idle();
  const stop = startAutoRefresh(env, { refresh: () => { calls += 1; }, poll: true, intervalMs: 60_000 });
  assert.equal(timers.size, 1);
  tick(60_000); fireTimers();
  assert.equal(calls, 1);
  doc.visibilityState = 'hidden';
  tick(60_000); fireTimers();
  assert.equal(calls, 1);
  stop();
  assert.equal(timers.size, 0);
});

test('auto refresh does not start a new refresh while one is still in flight', async () => {
  const { env, win, tick } = fakeEnv();
  let calls = 0;
  let release: () => void = () => {};
  const stop = startAutoRefresh(env, { refresh: () => { calls += 1; return new Promise<void>(resolve => { release = resolve; }); }, poll: false, minGapMs: 0 });
  win.dispatchEvent(new Event('focus'));
  tick(10_000);
  win.dispatchEvent(new Event('focus'));
  assert.equal(calls, 1);
  release();
  await new Promise(resolve => setTimeout(resolve, 0));
  win.dispatchEvent(new Event('focus'));
  assert.equal(calls, 2);
  stop();
});

test('settings page auto-refreshes sync runs and Sync now announces completion', () => {
  const settings = read('src/app/dashboard/seo/settings/page.tsx');
  assert.match(settings, /useAutoRefresh\(/);
  assert.match(settings, /status === 'running'/);
  const overview = read('src/app/dashboard/seo/page.tsx');
  assert.match(overview, /notifySeoSyncFinished\(\)/);
  assert.match(overview, /useAutoRefresh\(/);
});
