import { NextRequest, NextResponse } from 'next/server';
import { buildOnboardingDocx, onboardingDocxFileName } from '@/lib/monthly-report/docx-export';
import { buildReportWorkbook, exportFileName } from '@/lib/monthly-report/export';
import { loadOnboardingReport, parseReportQuery, requireMonthlyReport } from '@/lib/monthly-report/service';

export const dynamic = 'force-dynamic';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function GET(request: NextRequest) {
  const user = await requireMonthlyReport(request);
  if (user instanceof NextResponse) return user;
  let query;
  try {
    query = parseReportQuery(request.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid period' }, { status: 400 });
  }
  const report = await loadOnboardingReport(query.period, query.granularity);
  if (request.nextUrl.searchParams.get('format') === 'docx') {
    const docx = await buildOnboardingDocx(report, query.period.preset);
    return new NextResponse(new Uint8Array(docx), {
      headers: { 'Content-Type': DOCX_MIME, 'Content-Disposition': `attachment; filename="${onboardingDocxFileName(report, query.period.preset)}"`, 'Cache-Control': 'no-store' },
    });
  }
  return new NextResponse(new Uint8Array(buildReportWorkbook(report)), {
    headers: { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="${exportFileName(report)}"`, 'Cache-Control': 'no-store' },
  });
}
