import { after, NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { runCompetitorRefresh, type TregRunPlan } from '@/lib/partnership/run';
import { ReportInProgressError, createReport, getCompetitor } from '@/lib/partnership/store';
import { TREG_IG_FEATURE, instagramFeedEnabled } from '@/lib/partnership/treg-instagram';
import { estimateCompetitorTreg, parseTregPlatforms } from '@/lib/partnership/treg-social';
import { tregConfig } from '@/lib/seo/treg-client';
import { guardTregSpend } from '@/lib/seo/treg-cost-guard';
import { attachSpendRef, settleTregSpend } from '@/lib/seo/treg-spend';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Body (optional): { "treg": { "platforms": ["instagram","tiktok","meta_ads"], "confirmedEstimateMicro": 3240 } }
 * to also read the competitor's social feeds through treg after the user confirmed
 * the estimate (estimateCompetitorTreg for this competitor's handles). Without it, or
 * when treg is not configured / short on balance, the refresh uses free sources only.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const competitor = await getCompetitor(id);
  if (!competitor) return NextResponse.json({ error: 'Competitor not found.' }, { status: 404 });
  const body = await request.json().catch(() => null) as { treg?: { confirmedEstimateMicro?: unknown; platforms?: unknown } } | null;

  let plan: TregRunPlan | null = null;
  let tregNote: string | null = null;
  // Older clients send no platforms: Instagram only, as before.
  const platforms = body?.treg ? (body.treg.platforms === undefined ? ['instagram' as const] : parseTregPlatforms(body.treg.platforms)) : [];
  const estimate = estimateCompetitorTreg(competitor.socialHandles, platforms);
  if (body?.treg && estimate.calls > 0 && instagramFeedEnabled()) {
    const confirmed = Number(body.treg.confirmedEstimateMicro);
    const guard = await guardTregSpend({
      config: tregConfig(), role: auth.role, userId: auth.id, feature: TREG_IG_FEATURE,
      estimate, confirmedEstimateMicro: Number.isFinite(confirmed) ? confirmed : null,
    });
    if (guard.kind === 'refuse') return NextResponse.json(guard.body, { status: guard.status });
    if (guard.kind === 'paid') plan = { spendId: guard.spendId, estimateMicro: guard.estimateMicro, balanceBeforeMicro: guard.balanceBeforeMicro, platforms: estimate.platforms.map(item => item.platform) };
    else tregNote = `treg skipped (${guard.reason}); free sources used.`;
  } else if (body?.treg && estimate.calls === 0) {
    tregNote = 'treg not used: no selected platform applies to this competitor (add its social accounts); free sources used.';
  }
  try {
    const reportId = await createReport(id, 'manual', auth.id);
    if (plan) await attachSpendRef(plan.spendId, reportId).catch(() => undefined);
    after(() => runCompetitorRefresh(reportId, { treg: plan, tregNote }));
    return NextResponse.json({ id: reportId, treg: plan ? 'reserved' : tregNote ? 'skipped' : 'off' }, { status: 202 });
  } catch (error) {
    // Nothing was called: close the reservation at $0.
    if (plan) await settleTregSpend(plan.spendId, { status: 'failed', actualMicro: 0, costSource: 'reported', calls: 0, callIds: [], note: 'Refresh not started' }).catch(() => undefined);
    if (error instanceof ReportInProgressError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
