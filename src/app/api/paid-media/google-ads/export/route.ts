import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { EXPORT_KINDS, exportCsv, ReportInputError, type ExportKind } from '@/lib/google-ads/report';

export const dynamic = 'force-dynamic';

/** GET ?kind=campaigns|keywords|search-terms|daily&start=&end=&account= -> CSV (all rows, not just the top 500). */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const kind = params.get('kind') as ExportKind | null;
  if (!kind || !EXPORT_KINDS.includes(kind)) return NextResponse.json({ error: `kind must be one of ${EXPORT_KINDS.join(', ')}` }, { status: 400 });
  try {
    const { filename, csv } = await exportCsv(kind, { start: params.get('start'), end: params.get('end'), account: params.get('account') });
    return new NextResponse(`\uFEFF${csv}`, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Google Ads export failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not export Google Ads data.' }, { status: 500 });
  }
}
