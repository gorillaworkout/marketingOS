// tests/dpm-invitation-public-guard.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

test('public DPM invitation files never import auth and say so at the top', () => {
  const all = ['src/app/i', 'src/app/api/public/dpm-invitations'].flatMap(files).filter(f => /\.(ts|tsx)$/.test(f));
  assert.ok(all.length >= 2, 'public files exist');
  for (const file of all) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@\/lib\/auth['"]/, file);
    assert.match(source, /Never import @\/lib\/auth/, file);
  }
});

test('public submit route uses the shared flow and the Cloudflare-aware IP', () => {
  const route = readFileSync('src/app/api/public/dpm-invitations/[slug]/responses/route.ts', 'utf8');
  assert.match(route, /submitInvitationResponse\(/);
  assert.match(route, /clientIpFromHeaders\(request\.headers\)/);
  assert.match(route, /SUBMIT_BODY_MAX/);
});
