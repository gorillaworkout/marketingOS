import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { pagesToCsv, pagesToXlsx } from '@/lib/seo/audit-export';
import { getAudit } from '@/lib/seo/audit-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'seo');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const audit = await getAudit(id);
  if (!audit?.result) return NextResponse.json({ error: 'This audit has no page table yet.' }, { status: 404 });
  const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  if (format === 'xlsx') {
    const body = pagesToXlsx(audit.result.pages);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="seo-audit-pages.xlsx"',
      },
    });
  }
  return new NextResponse(pagesToCsv(audit.result.pages), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="seo-audit-pages.csv"',
    },
  });
}
