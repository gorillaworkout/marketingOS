// tests/dpm-invitation-submit.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportFilename, responsesCsv, responsesXlsx } from '../src/lib/dpm-invitation/export';
import { canDeleteInvitation, presentEvent } from '../src/lib/dpm-invitation/present';
import { submitInvitationResponse, type SubmitDeps } from '../src/lib/dpm-invitation/submit';
import { resetRateLimitBuckets } from '../src/lib/rate-limit';
import type { InvitationEvent, InvitationResponse, ParsedResponse } from '../src/lib/dpm-invitation/types';

const now = new Date('2026-11-23T05:00:00Z'); // 12:00 WIB
const event: InvitationEvent = {
  id: 'e1', name: 'Gala', slug: 'gala-2027', status: 'open', closesAt: null, imageKey: '11111111-1111-4111-8111-111111111111.webp',
  imageMime: 'image/webp', imageWidth: 1024, imageHeight: 1536, createdAt: now, updatedAt: now,
};

function deps(overrides: Partial<InvitationEvent> = {}) {
  const saved: ParsedResponse[] = [];
  const d: SubmitDeps = {
    getEventBySlug: async slug => (slug === 'gala-2027' ? { ...event, ...overrides } : null),
    upsertResponse: async (_id, value) => { saved.push(value); },
    now: () => now,
  };
  return { d, saved };
}
const body = (extra: Record<string, unknown> = {}) => JSON.stringify({ fullName: 'Nguyen Van A', email: 'a@dpm.vn', attending: 'no', website: '', ...extra });

test('submit: success, 404, closed by status and by closes_at, 422, honeypot, 413, 400', async () => {
  resetRateLimitBuckets();
  let { d, saved } = deps();
  assert.deepEqual(await submitInvitationResponse('gala-2027', body(), '1.1.1.1', d), { status: 200, body: { ok: true } });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].hasAllergy, null);

  assert.equal((await submitInvitationResponse('nope', body(), '1.1.1.1', d)).status, 404);
  ({ d } = deps({ status: 'closed' }));
  assert.deepEqual(await submitInvitationResponse('gala-2027', body(), '1.1.1.1', d), { status: 403, body: { error: 'Registration has closed.' } });
  ({ d } = deps({ closesAt: new Date('2026-11-23T04:59:00Z') }));
  assert.equal((await submitInvitationResponse('gala-2027', body(), '1.1.1.1', d)).status, 403);

  ({ d, saved } = deps());
  const invalid = await submitInvitationResponse('gala-2027', body({ email: 'x' }), '1.1.1.1', d);
  assert.deepEqual(invalid, { status: 422, body: { fieldErrors: { email: 'Please enter a valid email address.' } } });

  assert.deepEqual(await submitInvitationResponse('gala-2027', body({ website: 'http://spam' }), '1.1.1.1', d), { status: 200, body: { ok: true } });
  assert.equal(saved.length, 0, 'honeypot stores nothing');

  assert.equal((await submitInvitationResponse('gala-2027', 'x'.repeat(16_385), '1.1.1.1', d)).status, 413);
  assert.equal((await submitInvitationResponse('gala-2027', '{not json', '1.1.1.1', d)).status, 400);
});

test('submit: 60 per 10 minutes per IP, 5 per hour per event and email', async () => {
  resetRateLimitBuckets();
  const { d } = deps();
  for (let i = 0; i < 60; i++) assert.equal((await submitInvitationResponse('gala-2027', body({ email: `p${i}@dpm.vn` }), '3.3.3.3', d)).status, 200);
  assert.deepEqual(await submitInvitationResponse('gala-2027', body({ email: 'late@dpm.vn' }), '3.3.3.3', d), {
    status: 429, body: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  });

  resetRateLimitBuckets();
  for (let i = 0; i < 5; i++) assert.equal((await submitInvitationResponse('gala-2027', body({ email: 'Same@dpm.vn' }), `4.4.4.${i}`, d)).status, 200);
  assert.equal((await submitInvitationResponse('gala-2027', body({ email: 'same@DPM.vn' }), '4.4.4.9', d)).status, 429);
});

const rows: InvitationResponse[] = [
  { id: 'r1', eventId: 'e1', fullName: '=HYPERLINK("x")', email: 'a@dpm.vn', attending: true, hasAllergy: true, allergyNotes: 'Đậu phộng, "peanuts"', submissionCount: 2, createdAt: now, updatedAt: now },
  { id: 'r2', eventId: 'e1', fullName: 'Tran B', email: 'b@x.vn', attending: false, hasAllergy: null, allergyNotes: null, submissionCount: 1, createdAt: now, updatedAt: now },
];

test('export: headers, Yes/No/blank, formula guard, BOM, WIB dates, filename', async () => {
  const csv = responsesCsv(rows);
  assert.ok(csv.startsWith('\uFEFFFull name,Email,Attending,Food allergy,Allergy notes,Submissions,First submitted (WIB),Last updated (WIB)\r\n'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")",a@dpm.vn,Yes,Yes,"Đậu phộng, ""peanuts""",2,"23 Nov 2026, 12:00 WIB","23 Nov 2026, 12:00 WIB"\r\n`));
  assert.ok(csv.includes('Tran B,b@x.vn,No,,,1,"23 Nov 2026, 12:00 WIB"'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await responsesXlsx(rows, 'gala-2027')) as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet('gala-2027')!;
  assert.equal(sheet.getCell('A2').value, `'=HYPERLINK("x")`);
  assert.equal(sheet.getCell('C3').value, 'No');
  assert.ok(!sheet.getCell('D3').value, 'blank allergy for not attending');
  assert.equal(exportFilename('gala-2027', 'xlsx', new Date('2026-11-23T18:00:00Z')), 'dpm-invitation-gala-2027-20261124.xlsx');
});

test('present: open state, WIB label, public path; only admins delete events', () => {
  const p = presentEvent({ ...event, closesAt: new Date('2026-12-20T11:00:00Z') }, now);
  assert.equal(p.isOpen, true);
  assert.equal(p.closesAtWib, '20 Dec 2026, 18:00 WIB');
  assert.equal(p.closesAtInput, '2026-12-20T18:00');
  assert.equal(p.publicPath, '/i/gala-2027');
  assert.equal(p.imageUrl, '/api/dpm/invitations/e1/image?v=11111111-1111-4111-8111-111111111111');
  assert.equal(p.closedReason, null);
  assert.equal(presentEvent({ ...event, closesAt: new Date('2026-11-01T00:00:00Z') }, now).closedReason, 'auto');
  assert.equal(presentEvent({ ...event, status: 'closed' }, now).closedReason, 'manual');
  assert.equal(canDeleteInvitation({ role: 'admin' }), true);
  assert.equal(canDeleteInvitation({ role: 'member' }), false);
});
