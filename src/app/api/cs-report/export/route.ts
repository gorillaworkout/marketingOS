import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { XLSX_MIME } from '@/lib/cs-report/export';
import { readAgentId, readRange } from '@/lib/cs-report/http';
import { exportWorkbook } from '@/lib/cs-report/service';

export const dynamic = 'force-dynamic';

/** GET ?from&to[&agentId] -> .xlsx in the current CS workbook layout (one sheet per month). */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const range = readRange(request.nextUrl.searchParams);
  if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 });
  try {
    const result = await exportWorkbook(range.from, range.to, readAgentId(request.nextUrl.searchParams));
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('CS Report export failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not export the CS Report.' }, { status: 500 });
  }
}
