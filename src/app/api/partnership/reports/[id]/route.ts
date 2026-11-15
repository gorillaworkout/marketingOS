import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { expireStaleReports, getReport } from '@/lib/partnership/store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  await expireStaleReports();
  const report = await getReport(id);
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  return NextResponse.json({ report });
}
