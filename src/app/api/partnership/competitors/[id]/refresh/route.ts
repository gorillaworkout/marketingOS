import { after, NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { runCompetitorRefresh } from '@/lib/partnership/run';
import { ReportInProgressError, createReport, getCompetitor } from '@/lib/partnership/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!(await getCompetitor(id))) return NextResponse.json({ error: 'Competitor not found.' }, { status: 404 });
  try {
    const reportId = await createReport(id, 'manual', auth.id);
    after(() => runCompetitorRefresh(reportId));
    return NextResponse.json({ id: reportId }, { status: 202 });
  } catch (error) {
    if (error instanceof ReportInProgressError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
