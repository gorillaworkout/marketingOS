import { NextRequest, NextResponse } from 'next/server';
import { todayWib } from '@/lib/monthly-report/service';
import { requireSettlementReport } from '@/lib/settlement/service';
import { buildReconciliationWorkbook, buildSettlementWorkbook, reconciliationExportFileName, settlementExportFileName } from '@/lib/settlement/export';
import { buildSettlementDocx, settlementDocxFileName } from '@/lib/settlement/docx-export';
import { buildSettlementHtml, settlementHtmlFileName } from '@/lib/settlement/html-export';
import { listJisdorFixings } from '@/lib/settlement/jisdor-store';
import { attachDealsHistory } from '@/lib/settlement/report-data';
import { loadReconciliation, loadSettlementReport, resolveSettlementPeriod } from '@/lib/settlement/report';

export const dynamic = 'force-dynamic';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** GET ?type=report&preset=…&anchor=… (default) or ?type=daily&date=YYYY-MM-DD → .xlsx */
export async function GET(request: NextRequest) {
  const user = await requireSettlementReport(request);
  if (user instanceof NextResponse) return user;
  const params = request.nextUrl.searchParams;
  const send = (buffer: Buffer, fileName: string) => new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': XLSX_MIME, 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' },
  });
  if (params.get('type') === 'daily') {
    const date = params.get('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    return send(buildReconciliationWorkbook(await loadReconciliation(date)), reconciliationExportFileName(date));
  }
  let period;
  try {
    period = resolveSettlementPeriod(params.get('preset') ?? 'month', params.get('anchor') || todayWib(), params.get('from'), params.get('to'));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid period' }, { status: 400 });
  }
  const report = await attachDealsHistory(await loadSettlementReport(period));
  try { report.jisdor = await listJisdorFixings(); } catch { report.jisdor = []; }
  const format = params.get('format');
  if (format === 'html' || format === 'docx') {
    const requested = params.get('recon') ?? '';
    const recon = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : period.anchor;
    const reconciliation = await loadReconciliation(recon);
    if (format === 'html') {
      return new NextResponse(buildSettlementHtml(report, { reconciliation }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${settlementHtmlFileName(report)}"`, 'Cache-Control': 'no-store' },
      });
    }
    const docx = await buildSettlementDocx(report, { reconciliation });
    return new NextResponse(new Uint8Array(docx), {
      headers: { 'Content-Type': DOCX_MIME, 'Content-Disposition': `attachment; filename="${settlementDocxFileName(report)}"`, 'Cache-Control': 'no-store' },
    });
  }
  return send(buildSettlementWorkbook(report), settlementExportFileName(report));
}
