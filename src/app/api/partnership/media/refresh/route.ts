import { after, NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { runMediaRefresh, type ExtraCollector } from '@/lib/partnership/media-run';
import { MediaRunInProgressError, createMediaRun, getMediaSettings, setMediaRunCost } from '@/lib/partnership/media-store';
import { fetchTregMentions, type TregMediaOutcome } from '@/lib/partnership/media-treg';
import { MEDIA_TREG_FEATURE, estimateMediaTreg, parseMediaTregPlatforms } from '@/lib/partnership/media-treg-platforms';
import { parseDateRange } from '@/lib/partnership/media';
import { tregConfig } from '@/lib/seo/treg-client';
import { guardTregSpend, settleTregRun } from '@/lib/seo/treg-cost-guard';
import { attachSpendRef, settleTregSpend } from '@/lib/seo/treg-spend';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Manual refresh. Body: { mode: "free" } or
 * { mode: "treg", platforms: ["tiktok","x",…], confirmedEstimateMicro: 4500 }.
 * treg runs only here, after the user confirmed the estimate; the shared cost guard
 * checks permission, balance and the $5/day cap. Low balance or a treg error falls
 * back to free sources. Scheduled refreshes use runDueMediaRefresh (free only).
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({})) as { mode?: unknown; platforms?: unknown; confirmedEstimateMicro?: unknown };
  const settings = await getMediaSettings();
  let tregNote: string | null = null;
  let plan: { spendId: string; estimateMicro: number; balanceBeforeMicro: number | null } | null = null;
  const platforms = body.mode === 'treg' ? parseMediaTregPlatforms(body.platforms) : [];
  const estimate = estimateMediaTreg(settings, platforms);
  const config = tregConfig();
  if (body.mode === 'treg') {
    if (!estimate.calls) return NextResponse.json({ error: 'Pick at least one platform, and add keywords or hashtags in Settings.' }, { status: 400 });
    const confirmed = Number(body.confirmedEstimateMicro);
    const guard = await guardTregSpend({ config, role: auth.role, userId: auth.id, feature: MEDIA_TREG_FEATURE, estimate, confirmedEstimateMicro: Number.isFinite(confirmed) ? confirmed : null });
    if (guard.kind === 'refuse') return NextResponse.json(guard.body, { status: guard.status });
    if (guard.kind === 'paid') plan = { spendId: guard.spendId, estimateMicro: guard.estimateMicro, balanceBeforeMicro: guard.balanceBeforeMicro };
    else tregNote = `treg skipped (${guard.reason}); free sources used.`;
  }
  let runId: string;
  try {
    runId = await createMediaRun({ trigger: 'manual', mode: plan ? 'treg' : 'free', platforms: plan ? platforms : [], userId: auth.id });
  } catch (error) {
    if (plan) await settleTregSpend(plan.spendId, { status: 'failed', actualMicro: 0, costSource: 'reported', calls: 0, callIds: [], note: 'Refresh not started' }).catch(() => undefined);
    if (error instanceof MediaRunInProgressError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  if (plan) await attachSpendRef(plan.spendId, runId).catch(() => undefined);
  const range = parseDateRange(null, null);
  let outcome: TregMediaOutcome | null = null;
  const extraCollector: ExtraCollector | null = plan
    ? async ({ runId: id, settings: current }) => {
      outcome = await fetchTregMentions(config, { runId: id, trigger: 'manual', platforms, settings: current, range });
      return { mentions: outcome.mentions, notes: outcome.notes };
    }
    : tregNote ? async () => ({ mentions: [], notes: [tregNote!] }) : null;
  after(async () => {
    await runMediaRefresh(runId, { extraCollector });
    if (!plan) return;
    const finished = outcome as TregMediaOutcome | null;
    const cost = await settleTregRun({
      config, spendId: plan.spendId, estimateMicro: plan.estimateMicro, balanceBeforeMicro: plan.balanceBeforeMicro,
      ok: Boolean(finished?.ok), actualMicro: finished?.costMicro ?? 0, costSource: finished?.costSource ?? 'reported',
      calls: finished?.calls ?? 0, callIds: finished?.callIds ?? [], note: finished && !finished.ok ? finished.notes.join(' ').slice(0, 500) || null : null,
      refusalBalanceMicro: finished?.refusalBalanceMicro ?? null,
    }).catch(() => null);
    if (cost) await setMediaRunCost(runId, { ...cost }).catch(() => undefined);
  });
  return NextResponse.json({ id: runId, treg: plan ? 'reserved' : tregNote ? 'skipped' : 'off', note: tregNote, estimateMicro: plan ? estimate.totalMicro : 0 }, { status: 202 });
}
