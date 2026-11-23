// tests/dpm-invitation-api.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = 'src/app/api/dpm/invitations';
const routes: Record<string, string[]> = {
  [`${base}/route.ts`]: ['GET', 'POST'],
  [`${base}/[id]/route.ts`]: ['GET', 'PATCH', 'DELETE'],
  [`${base}/[id]/image/route.ts`]: ['GET', 'PUT'],
  [`${base}/[id]/responses/route.ts`]: ['GET'],
  [`${base}/[id]/responses/[responseId]/route.ts`]: ['DELETE'],
  [`${base}/[id]/export/route.ts`]: ['GET'],
};

test('every admin route checks the dpm-invitation feature in every handler and sends no-store', () => {
  for (const [file, methods] of Object.entries(routes)) {
    const source = readFileSync(file, 'utf8');
    for (const method of methods) {
      const handler = source.split(`export async function ${method}(`)[1];
      assert.ok(handler, `${file} exports ${method}`);
      assert.match(handler.split('export async function')[0], /requireFeature\(request, 'dpm-invitation'\)/, `${file} ${method}`);
    }
    assert.match(source, /no-store/, `${file} sends no-store`);
  }
});

test('event delete is admin-only, response delete is open to feature holders', () => {
  assert.match(readFileSync(`${base}/[id]/route.ts`, 'utf8'), /canDeleteInvitation\(auth\)/);
  assert.doesNotMatch(readFileSync(`${base}/[id]/responses/[responseId]/route.ts`, 'utf8'), /canDeleteInvitation|role === 'admin'/);
});
