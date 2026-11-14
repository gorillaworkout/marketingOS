import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { gapsToCsv, gapsToXlsx } from '@/lib/seo/keyword-gap-export';
import { getGap } from '@/lib/seo/keyword-gap-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const gap = await getGap(id);
  if (!gap?.result) return NextResponse.json({ error: 'This keyword gap has no table yet.' }, { status: 404 });
  const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  if (format === 'xlsx') {
    return new NextResponse(new Uint8Array(gapsToXlsx(gap.result.keywords)), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="keyword-gap.xlsx"',
      },
    });
  }
  return new NextResponse(gapsToCsv(gap.result.keywords), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="keyword-gap.csv"' },
  });
}
