import { NextRequest, NextResponse } from 'next/server';
import { hasAnyOnboardingData, listUploads } from '@/lib/monthly-report/store';
import { loadOnboardingReport, parseReportQuery, permissionsFor, requireMonthlyReport } from '@/lib/monthly-report/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await requireMonthlyReport(request);
  if (user instanceof NextResponse) return user;
  let query;
  try {
    query = parseReportQuery(request.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid period' }, { status: 400 });
  }
  const [report, anyData, uploads] = await Promise.all([
    loadOnboardingReport(query.period, query.granularity),
    hasAnyOnboardingData(),
    listUploads(1),
  ]);
  return NextResponse.json({
    period: query.period,
    report,
    hasAnyData: anyData,
    lastUpload: uploads[0] ?? null,
    permissions: permissionsFor(user),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
