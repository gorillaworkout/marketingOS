import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { XLSX_MIME } from '@/lib/keyword-trends/export';
import { exportKeywordTrends } from '@/lib/keyword-trends/service';

export const dynamic = 'force-dynamic';

/** GET [snapshot=id] -> XLSX of the last 3 search months (Summary, Detail, Column guide). Default: latest succeeded snapshot. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await exportKeywordTrends(request.nextUrl.searchParams.get('snapshot'));
    if (!result) return NextResponse.json({ error: 'No Keyword Trends snapshot to export yet. Press Fetch now first.' }, { status: 404 });
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Keyword Trends export failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not export Keyword Trends.' }, { status: 500 });
  }
}
