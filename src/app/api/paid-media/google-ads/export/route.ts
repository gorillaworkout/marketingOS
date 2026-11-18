import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { exportInsightCsv, INSIGHT_EXPORT_KINDS, type InsightExportKind } from '@/lib/google-ads/insights-export';
import { EXPORT_KINDS, exportCsv, ReportInputError, type ExportKind } from '@/lib/google-ads/report';

export const dynamic = 'force-dynamic';

/**
 * GET ?kind=campaigns|keywords|search-terms|daily|paid-organic|negatives|keyword-candidates&start=&end=&account=
 * (+ source for paid-organic, minCost/minConversions for suggestions) -> CSV with all rows, not just the top 500.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const kind = params.get('kind') as ExportKind | InsightExportKind | null;
  const insight = INSIGHT_EXPORT_KINDS.includes(kind as InsightExportKind);
  if (!kind || (!EXPORT_KINDS.includes(kind as ExportKind) && !insight)) return NextResponse.json({ error: `kind must be one of ${[...EXPORT_KINDS, ...INSIGHT_EXPORT_KINDS].join(', ')}` }, { status: 400 });
  try {
    const { filename, csv } = insight
      ? await exportInsightCsv(kind as InsightExportKind, params)
      : await exportCsv(kind as ExportKind, { start: params.get('start'), end: params.get('end'), account: params.get('account') });
    return new NextResponse(`\uFEFF${csv}`, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Google Ads export failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not export Google Ads data.' }, { status: 500 });
  }
}
