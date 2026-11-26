import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { XLSX_MIME } from '@/lib/cs-report/export';
import { DOCX_MIME } from '@/lib/cs-report/docx-export';
import { readAgentId, readPeriodKind, readRange } from '@/lib/cs-report/http';
import { exportDocx, exportWorkbook } from '@/lib/cs-report/service';

export const dynamic = 'force-dynamic';

/**
 * GET ?from&to[&agentId] -> .xlsx in the current CS workbook layout (one sheet per month).
 * GET ?from&to[&agentId]&format=docx[&kind=day|week|month|custom] -> Word report (same figures as the dashboard).
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const range = readRange(request.nextUrl.searchParams);
  if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 });
  const params = request.nextUrl.searchParams;
  try {
    if (params.get('format') === 'docx') {
      const result = await exportDocx(range.from, range.to, readAgentId(params), readPeriodKind(params));
      return new NextResponse(new Uint8Array(result.buffer), {
        headers: { 'Content-Type': DOCX_MIME, 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'no-store' },
      });
    }
    const result = await exportWorkbook(range.from, range.to, readAgentId(request.nextUrl.searchParams));
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('CS Report export failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not export the CS Report.' }, { status: 500 });
  }
}
