import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { accountFeatureFromPath, shouldBlockDashboardGenerationPath } from '../src/lib/authorization.ts';

const root = process.cwd();

function walk(dir: string, fileName: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, fileName));
    else if (name === fileName) out.push(path.relative(root, full));
  }
  return out;
}

/** Routes that are public on purpose: login, health, and a signed share token. */
const PUBLIC_ROUTES = new Set([
  'src/app/api/auth/route.ts',
  'src/app/api/health/route.ts',
  'src/app/api/ai-research/share/route.ts',
]);

const GATE = /requireFeature\(|requireAdmin\(|getSession\(|getAuthorizedUser\(|watchCronAuthorization\(|requireInternalDocsUser\(|requireInternalDocsManager\(|requireMonthlyReport\(|requireSettlementReport\(|authenticateSync\(/;

test('every API route is feature-gated, admin-gated, session-gated, or explicitly public', () => {
  const routes = walk(path.join(root, 'src/app/api'), 'route.ts');
  assert.ok(routes.length >= 100);
  const open: string[] = [];
  for (const route of routes) {
    if (PUBLIC_ROUTES.has(route)) continue;
    const source = readFileSync(path.join(root, route), 'utf8');
    const imported = [...source.matchAll(/from '@\/([^']+)'/g)].map(match => path.join(root, 'src', `${match[1]}.ts`));
    const bodies = [source, ...imported.map(file => { try { return readFileSync(file, 'utf8'); } catch { return ''; } })];
    if (!bodies.some(body => GATE.test(body))) open.push(route);
  }
  assert.deepEqual(open, []);
});

test('a member without the department feature is blocked from that feature path', () => {
  const member = (features: string[]) => ({ role: 'member', features });
  const cases: Array<[string, string]> = [
    ['/dashboard/social-post', 'social-post'],
    ['/dashboard/video-script', 'video-script'],
    ['/dashboard/event-plan', 'event-plan'],
    ['/dashboard/sop', 'article-market-news'],
    ['/dashboard/market-research', 'market-research'],
    ['/dashboard/ai-research', 'ai-research'],
    ['/dashboard/internal-docs/guide', 'internal-docs'],
    ['/dashboard/seo/keyword-gap', 'seo'],
    ['/dashboard/seo/audit', 'seo'],
    ['/dashboard/seo/content/draft-1', 'seo'],
    ['/dashboard/monthly-report/uploads', 'monthly-report'],
    ['/dashboard/settlement-report/data', 'settlement-report'],
  ];
  for (const [pathname, feature] of cases) {
    assert.equal(accountFeatureFromPath(pathname), feature, pathname);
    assert.equal(shouldBlockDashboardGenerationPath(member(['social-post']), pathname), feature !== 'social-post', pathname);
    assert.equal(shouldBlockDashboardGenerationPath(member([feature]), pathname), false, pathname);
  }
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'admin', features: [] }, '/dashboard/seo/keyword-gap'), false);
});
