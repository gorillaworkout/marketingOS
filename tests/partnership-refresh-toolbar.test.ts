import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planRefreshBatch, reportMode, reportModeLabel, tregUnavailableReason, type ToolbarTregStatus,
} from '../src/lib/partnership/refresh-plan';

const ready: ToolbarTregStatus = {
  configured: true, adminOnly: true, canRun: true, balanceUsd: 0.87, balanceError: null,
  spentTodayUsd: 0, dailyLimitUsd: 2, instagram: { perCompetitorMicro: 900, maxPerCompetitorUsd: 0.005, enabled: true },
};
const competitors = [
  { id: 'a', name: 'MIFX', instagramHandle: 'mifx.indonesia' },
  { id: 'b', name: 'Elve', instagramHandle: null },
  { id: 'c', name: 'XTB', instagramHandle: 'xtb_id' },
];

test('treg availability: each reason the treg mode is disabled', () => {
  assert.equal(tregUnavailableReason(ready), null);
  assert.equal(tregUnavailableReason(null), 'Checking treg…');
  assert.match(tregUnavailableReason({ ...ready, configured: false, canRun: false, instagram: { ...ready.instagram!, enabled: false } })!, /PARTNERSHIP_TREG_INSTAGRAM=false/);
  assert.match(tregUnavailableReason({ ...ready, configured: false, canRun: false })!, /not configured/);
  assert.match(tregUnavailableReason({ ...ready, canRun: false })!, /admin-only/);
  assert.match(tregUnavailableReason({ ...ready, balanceUsd: 0.0005 })!, /Balance \$0\.00 is below/);
  assert.match(tregUnavailableReason({ ...ready, spentTodayUsd: 2 })!, /limit/);
  // Unknown balance (treg unreachable) still lets the user try; the server guard decides.
  assert.equal(tregUnavailableReason({ ...ready, balanceUsd: null, balanceError: 'treg balance unavailable' }), null);
});

test('batch plan: treg only for competitors with an Instagram handle; total estimate', () => {
  const plan = planRefreshBatch(competitors, ['c', 'a', 'b'], 'treg', ready);
  assert.deepEqual(plan.items.map(item => [item.id, item.useTreg, item.freeReason]), [['a', true, null], ['b', false, 'No Instagram handle'], ['c', true, null]]);
  assert.equal(plan.tregCount, 2);
  assert.equal(plan.estimateMicro, 1800);
  assert.equal(plan.coveredByBalance, 2);
});

test('batch plan: free mode never uses treg and costs nothing', () => {
  const plan = planRefreshBatch(competitors, ['a', 'b', 'c'], 'free', ready);
  assert.equal(plan.tregCount, 0);
  assert.equal(plan.estimateMicro, 0);
  assert.ok(plan.items.every(item => !item.useTreg && item.freeReason === null));
});

test('batch plan: treg mode falls back to free when treg is unavailable, and counts what the balance covers', () => {
  const off = planRefreshBatch(competitors, ['a'], 'treg', { ...ready, canRun: false });
  assert.equal(off.tregCount, 0);
  assert.equal(off.items[0].freeReason, 'treg unavailable');
  const low = planRefreshBatch(competitors, ['a', 'c'], 'treg', { ...ready, balanceUsd: 0.001 });
  assert.equal(low.tregCount, 2);
  assert.equal(low.coveredByBalance, 1);
});

test('report mode label: Free vs treg with the actual cost', () => {
  assert.equal(reportModeLabel(reportMode(null)), 'Free');
  assert.equal(reportModeLabel(reportMode(undefined)), 'Free');
  const cost = { provider: 'treg' as const, estimatedMicro: 900, actualMicro: 900, source: 'reported' as const, calls: 1, balanceBeforeMicro: 870000, balanceAfterMicro: 869100 };
  assert.equal(reportModeLabel(reportMode(cost)), 'treg $0.0009');
  assert.equal(reportModeLabel(reportMode({ ...cost, source: 'estimate' })), 'treg $0.0009 (est.)');
});

test('page: refresh controls live in the top toolbar; rows no longer carry their own Refresh', () => {
  const page = readFileSync('src/app/dashboard/partnership/competitor-intelligence/page.tsx', 'utf8');
  assert.ok(page.indexOf('<RefreshToolbar') > 0 && page.indexOf('<RefreshToolbar') < page.indexOf('title="Comparison"'));
  assert.doesNotMatch(page, /Refresh \+ Instagram via treg/);
  assert.match(page, /ModeBadge mode=\{competitor\.lastRefreshMode\}/);
  const toolbar = readFileSync('src/components/partnership/RefreshToolbar.tsx', 'utf8');
  // One competitor at a time through the existing per-competitor route (its treg guard applies to each).
  assert.match(toolbar, /for \(const job of queue\)/);
  assert.match(toolbar, /await waitFor\(job, data\.id\)/);
  assert.match(toolbar, /\/api\/partnership\/competitors\/\$\{encodeURIComponent\(job\.id\)\}\/refresh/);
  assert.match(toolbar, /confirmedEstimateMicro: perMicro/);
  assert.match(toolbar, /<TregCostNotice/);
  const list = readFileSync('src/app/api/partnership/competitors/route.ts', 'utf8');
  assert.match(list, /lastRefreshMode: report\?\.result \? reportMode\(report\.result\.tregCost\) : null/);
  // Actual treg cost per run from the spend ledger (also for failed runs).
  assert.match(list, /spendForRefs\(/);
  assert.match(list, /tregCostMicro: spend\.get\(latest\.id\)\?\.actual_micro \?\? null/);
});

test('scheduled refreshes never use treg: free sources only', () => {
  const run = readFileSync('src/lib/partnership/run.ts', 'utf8');
  assert.doesNotMatch(run, /planScheduledTreg/);
  assert.doesNotMatch(run, /guardTregSpend\(/);
  const due = run.slice(run.indexOf('export async function runDueCompetitorRefreshes'));
  assert.match(due, /runCompetitorRefresh\(reportId, \{ treg: null \}\)/);
  assert.doesNotMatch(due, /tregNote|instagramFeed/);
  for (const path of ['src/app/api/partnership/cron/refresh/route.ts', 'scripts/run-partnership-refresh.ts']) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /treg/i, path);
  }
  // treg runs only from the signed-in manual route, after the confirmed estimate.
  const route = readFileSync('src/app/api/partnership/competitors/[id]/refresh/route.ts', 'utf8');
  assert.match(route, /createReport\(id, 'manual', auth\.id\)/);
  assert.match(route, /confirmedEstimateMicro/);
});

test('cron and CLI scripts load .env.local before .env', () => {
  for (const name of ['run-partnership-refresh', 'run-ai-research-watches', 'seo-sync', 'monthly-report-import', 'reembed-knowledge', 'seo-visibility', 'seo-gsc-retention']) {
    const source = readFileSync(`scripts/${name}.ts`, 'utf8');
    assert.match(source, /^import '\.\/load-env';$/m, name);
    assert.doesNotMatch(source, /dotenv\/config/, name);
  }
  const env = readFileSync('scripts/load-env.ts', 'utf8');
  assert.ok(env.indexOf("'.env.local'") < env.indexOf("'.env'"));
});
