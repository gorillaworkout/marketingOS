import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { buildCombinedOpportunities, buildComparison, parseCompetitorInput } from '@/lib/partnership/intel';
import { reportMode } from '@/lib/partnership/refresh-plan';
import { spendForRefs } from '@/lib/seo/treg-spend';
import { DuplicateCompetitorError, createCompetitor, expireStaleReports, latestReports, listCompetitors } from '@/lib/partnership/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  await expireStaleReports();
  const competitors = await listCompetitors();
  const { succeeded, newest } = await latestReports();
  // treg spend ledger per latest run: the actual cost of a paid run, also when it failed.
  const spend = await spendForRefs([...newest.values()].map(report => report.id)).catch(() => new Map());
  const rows = competitors.map(competitor => {
    const report = succeeded.get(competitor.id) ?? null;
    const latest = newest.get(competitor.id) ?? null;
    return {
      ...competitor,
      lastRefreshedAt: report?.finishedAt ?? null,
      lastRefreshMode: report?.result ? reportMode(report.result.tregCost) : null,
      itemCount: report?.result?.items.length ?? 0,
      overview: report?.result?.overview ?? '',
      latestRun: latest ? {
        id: latest.id, status: latest.status, progress: latest.progress, message: latest.message, error: latest.error, trigger: latest.trigger,
        tregCostMicro: spend.get(latest.id)?.actual_micro ?? null,
      } : null,
    };
  });
  const comparison = buildComparison(competitors.map(competitor => {
    const report = succeeded.get(competitor.id);
    return { competitor, report: report?.result ? { finishedAt: report.finishedAt, items: report.result.items, campaigns: report.result.campaigns } : null };
  }));
  const opportunities = buildCombinedOpportunities(competitors.flatMap(competitor => {
    const report = succeeded.get(competitor.id);
    return report?.result ? [{ competitorName: competitor.name, opportunities: report.result.opportunities }] : [];
  }));
  return NextResponse.json({ competitors: rows, comparison, opportunities, canDelete: auth.role === 'admin' });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = parseCompetitorInput(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const id = await createCompetitor(parsed.value, auth.id);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateCompetitorError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
