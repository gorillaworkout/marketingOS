import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createImageJobStore,
  isTerminalImageJobStatus,
} from '../src/lib/image-job-status';

test('recognizes completed and failed image jobs as terminal', () => {
  assert.equal(isTerminalImageJobStatus('done'), true);
  assert.equal(isTerminalImageJobStatus('error'), true);
  assert.equal(isTerminalImageJobStatus('generating'), false);
});

test('keeps image jobs available when the route store is recreated during hot reload', () => {
  const firstRouteInstance = createImageJobStore();
  const job = firstRouteInstance.create('hot-reload-user');
  const reloadedRouteInstance = createImageJobStore();

  assert.equal(reloadedRouteInstance.get(job.id, 'hot-reload-user')?.status, 'queued');
});

test('keeps image jobs isolated to their owner and exposes terminal results', () => {
  const jobs = createImageJobStore();
  const job = jobs.create('user-a');

  assert.equal(jobs.get(job.id, 'user-b'), undefined);
  assert.equal(jobs.get(job.id, 'user-a')?.status, 'queued');

  jobs.update(job.id, 'user-a', {
    status: 'done',
    progress: 100,
    message: 'Image generated',
    result: { success: true, imageUrl: '/api/generated-images/image.png' },
  });

  const completed = jobs.get(job.id, 'user-a');
  assert.equal(completed?.status, 'done');
  assert.equal(completed?.progress, 100);
  assert.deepEqual(completed?.result, { success: true, imageUrl: '/api/generated-images/image.png' });
  assert.equal(isTerminalImageJobStatus(completed!.status), true);
  assert.equal(jobs.update(job.id, 'user-a', {
    status: 'generating', progress: 30, message: 'This must not replace a terminal job',
  }), undefined);
  assert.equal(jobs.get(job.id, 'user-a')?.status, 'done');
});

test('uses JSON job handoff and polling instead of a request-bound image stream', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const route = fs.readFileSync(path.join(root, 'src/app/api/generate-image/route.ts'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'src/app/dashboard/social-post/page.tsx'), 'utf8');

  assert.match(route, /export async function POST/);
  assert.match(route, /export async function GET/);
  assert.match(route, /Cache-Control': 'no-store'/);
  assert.doesNotMatch(route, /request\.signal/);
  assert.doesNotMatch(route, /text\/event-stream/);
  assert.match(client, /fetch\('\/api\/generate-image', \{[\s\S]*method: 'POST'/);
  assert.match(client, /fetch\(`\/api\/generate-image\?jobId=\$\{encodeURIComponent\(jobId\)\}`/);
  assert.doesNotMatch(client, /generate-image[\s\S]*getReader\(\)/);
});
