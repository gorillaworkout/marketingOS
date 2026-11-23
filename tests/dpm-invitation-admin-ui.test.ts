// tests/dpm-invitation-admin-ui.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const list = readFileSync('src/app/dashboard/dpm/invitation/page.tsx', 'utf8');
const detail = readFileSync('src/app/dashboard/dpm/invitation/[id]/page.tsx', 'utf8');
const shared = readFileSync('src/app/dashboard/dpm/invitation/shared.tsx', 'utf8');

test('list page creates invitations with a WIB closing time and only accepted image types', () => {
  assert.match(list, /'use client'/);
  for (const text of ['New invitation', 'Closes at (WIB)', 'type="datetime-local"', 'accept={ACCEPT_IMAGES}', 'suggestSlug(']) assert.ok(list.includes(text), text);
  assert.match(shared, /ACCEPT_IMAGES = 'image\/jpeg,image\/png,image\/webp'/);
});

test('status badge covers open, closed by hand and closed automatically', () => {
  for (const text of ["'Open'", "'Closed automatically'", "'Closed'"]) assert.ok(shared.includes(text), text);
});

test('detail page offers the approved actions', () => {
  for (const text of ['Copy link', 'Close registration', 'Open registration', 'Export Excel', 'Export CSV', 'Replace image',
    'The old link /i/', 'will stop working', 'Delete invitation', 'Delete this response?']) assert.ok(detail.includes(text), text);
});

test('only admins see Delete invitation; every holder may delete responses', () => {
  assert.match(detail, /\{isAdmin && \(/);
  assert.match(detail, /action: 'check'/);
  assert.match(detail, /method: 'DELETE'/);
  assert.match(detail, /confirm: confirmSlug/);
});
