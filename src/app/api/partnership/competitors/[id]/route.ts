import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { parseCompetitorInput } from '@/lib/partnership/intel';
import {
  DuplicateCompetitorError, deleteCompetitor, expireStaleReports, getCompetitor, latestReports, listEvidence, recentReports, updateCompetitor,
} from '@/lib/partnership/store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  await expireStaleReports();
  const competitor = await getCompetitor(id);
  if (!competitor) return NextResponse.json({ error: 'Competitor not found.' }, { status: 404 });
  const evidence = await listEvidence(id);
  const { succeeded } = await latestReports();
  const history = await recentReports(id);
  return NextResponse.json({
    competitor,
    evidence: evidence.map(item => ({
      id: item.id,
      kind: item.kind,
      sourceUrl: item.sourceUrl,
      pastedText: item.pastedText,
      extractedText: item.extractedText,
      extractionStatus: item.extractionStatus,
      hasScreenshot: Boolean(item.screenshotKey),
      observedOn: item.observedOn,
      createdByName: item.createdByName,
      createdAt: item.createdAt,
      canDelete: auth.role === 'admin' || item.createdBy === auth.id,
    })),
    report: succeeded.get(id) ?? null,
    history,
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  if (!(await getCompetitor(id))) return NextResponse.json({ error: 'Competitor not found.' }, { status: 404 });
  const parsed = parseCompetitorInput(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    await updateCompetitor(id, parsed.value, auth.id);
  } catch (error) {
    if (error instanceof DuplicateCompetitorError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'admin') return NextResponse.json({ error: 'Only an admin can delete a competitor.' }, { status: 403 });
  const { id } = await context.params;
  if (!(await getCompetitor(id))) return NextResponse.json({ error: 'Competitor not found.' }, { status: 404 });
  await deleteCompetitor(id);
  return NextResponse.json({ success: true });
}
