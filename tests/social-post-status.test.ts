import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  mergeConfirmedSocialPostStatus,
  socialPostStatusFromResponse,
  viewingPostWithConfirmedStatus,
} from '../src/lib/social-post-status';

const page = readFileSync(path.join(process.cwd(), 'src/app/dashboard/social-post/page.tsx'), 'utf8');

test('status response uses the saved status, including non-approved values', () => {
  assert.equal(socialPostStatusFromResponse({ success: true, newStatus: 'approved' }, 'approved'), 'approved');
  assert.equal(socialPostStatusFromResponse({ success: true, newStatus: 'published' }, 'published'), 'published');
  assert.equal(socialPostStatusFromResponse({ success: true }, 'review'), 'review');
  assert.equal(socialPostStatusFromResponse({ error: 'Task not found' }, 'approved'), null);
  assert.equal(socialPostStatusFromResponse({ success: false, newStatus: 'approved' }, 'approved'), null);
  assert.equal(socialPostStatusFromResponse(null, 'approved'), null);
});

test('confirmed status replaces a stale history row without touching other posts', () => {
  const draft = { id: 'post-1', title: 'Gold outlook', status: 'draft' };
  const review = { id: 'post-2', title: 'Indices', status: 'review' };
  const merged = mergeConfirmedSocialPostStatus([draft, review], { 'post-1': 'approved' });

  assert.equal(merged[0].status, 'approved');
  assert.equal(merged[0].title, 'Gold outlook');
  assert.equal(merged[1], review);
  assert.equal(draft.status, 'draft');
});

test('a later history payload cannot roll an approved post back to draft', () => {
  const confirmed = { 'post-1': 'approved' };
  const staleReload = [
    { id: 'post-1', status: 'draft', title: 'Gold outlook' },
    { id: 'post-3', status: 'published' },
  ];

  const merged = mergeConfirmedSocialPostStatus(staleReload, confirmed);
  assert.equal(merged[0].status, 'approved');
  assert.equal(merged[1].status, 'published');
  assert.equal(
    viewingPostWithConfirmedStatus({ id: 'post-1', status: 'draft' }, confirmed)?.status,
    'approved',
  );
  assert.equal(
    viewingPostWithConfirmedStatus({ id: 'post-3', status: 'published' }, confirmed)?.status,
    'published',
  );
});

test('Social Post applies the saved status to the list and the open post', () => {
  assert.match(page, /socialPostStatusFromResponse/);
  assert.match(page, /mergeConfirmedSocialPostStatus/);
  assert.match(page, /viewingPostWithConfirmedStatus/);
  assert.match(page, /fetch\('\/api\/dashboard\/history\?type=social-post',\s*\{\s*cache:\s*'no-store'\s*\}\)/);
  assert.match(page, /data-testid="social-post-list-status"/);
  assert.match(page, /setPostStatus\(appliedStatus\)/);
});
