import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fetchTregMentions, TregNotAllowedError } from '../src/lib/partnership/media-treg';
import { normalizeMediaSettings } from '../src/lib/partnership/media';
import type { TregConfig } from '../src/lib/seo/treg-client';

/**
 * Bayu's rule: cron and scheduled jobs must NEVER use treg. treg runs only when a
 * user generates manually and confirms. These tests enforce it for Media Monitoring.
 */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** Runtime local imports of a TS file (type-only imports are erased), resolved to repo paths (@/ = src/). */
function localImports(file: string): string[] {
  const source = read(file);
  const out: string[] = [];
  for (const match of source.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (/^(import|export)\s+type\s/.test(match[0])) continue;
    const spec = match[1] ?? match[2] ?? match[3];
    let base: string | null = null;
    if (spec.startsWith('@/')) base = path.join('src', spec.slice(2));
    else if (spec.startsWith('.')) base = path.join(path.dirname(file), spec);
    if (!base) continue;
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(path.join(ROOT, candidate))) { out.push(path.normalize(candidate)); break; }
    }
  }
  return out;
}

function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.normalize(entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...localImports(file));
  }
  return seen;
}

const TREG_MODULE = /treg/i;

test('the scheduled Media Monitoring path never imports a treg module (transitively)', () => {
  for (const entry of ['scripts/run-media-refresh.ts', 'src/lib/partnership/media-run.ts', 'src/lib/partnership/media-sources.ts']) {
    const graph = importGraph(entry);
    const tregFiles = [...graph].filter(file => TREG_MODULE.test(path.basename(file)));
    assert.deepEqual(tregFiles, [], `${entry} reaches treg code: ${tregFiles.join(', ')}`);
  }
  // Sanity check that the walker sees treg where it is expected: the manual route.
  const manual = [...importGraph('src/app/api/partnership/media/refresh/route.ts')].map(file => path.basename(file));
  assert.ok(manual.includes('media-treg.ts') && manual.includes('treg-client.ts'));
});

test('scheduled entry points call only runDueMediaRefresh, which takes no collector', () => {
  const runSource = read('src/lib/partnership/media-run.ts');
  assert.match(runSource, /export async function runDueMediaRefresh\(now: Date = new Date\(\), minHours = 12\)/);
  const due = runSource.slice(runSource.indexOf('export async function runDueMediaRefresh'));
  assert.match(due, /trigger: 'scheduled', mode: 'free'/);
  assert.match(due, /await runMediaRefresh\(runId\);/, 'the scheduled run must not pass options (no extra collector)');
  for (const file of ['scripts/run-media-refresh.ts', 'scripts/run-partnership-refresh.ts', 'src/app/api/partnership/cron/refresh/route.ts']) {
    const source = read(file);
    assert.match(source, /runDueMediaRefresh\(\)/, `${file} should run the free-only scheduled refresh`);
    assert.doesNotMatch(source, /fetchTregMentions|media-treg|guardTregSpend/, `${file} must not reach Media Monitoring treg`);
  }
  // runMediaRefresh ignores any extra collector on a scheduled run.
  assert.match(runSource, /if \(run\.trigger !== 'manual'\) \{\s*notes\.push\('Paid sources ignored: scheduled refreshes are free-only\.'\);/);
});

test('only the manual refresh route imports the treg media client', () => {
  const route = read('src/app/api/partnership/media/refresh/route.ts');
  assert.match(route, /from '@\/lib\/partnership\/media-treg'/);
  assert.match(route, /trigger: 'manual'/);
  assert.match(route, /guardTregSpend\(/);
  assert.match(route, /createMediaRun\(\{ trigger: 'manual'/);
});

test('fetchTregMentions refuses a scheduled trigger before any network call', async () => {
  let calls = 0;
  const config: TregConfig = { apiKey: 'test-token', baseUrl: 'https://treg.to', dailyLimitMicro: 5_000_000, lowBalanceMicro: 0, adminOnly: false, org: null };
  const { settings } = normalizeMediaSettings({ keywords: ['Dupoin'] });
  await assert.rejects(
    fetchTregMentions(config, { runId: 'r', trigger: 'scheduled', platforms: ['x', 'tiktok'], settings, range: { from: '2026-11-01', to: '2026-11-18' } }, async () => { calls += 1; return new Response('{}'); }),
    TregNotAllowedError,
  );
  assert.equal(calls, 0);
});
