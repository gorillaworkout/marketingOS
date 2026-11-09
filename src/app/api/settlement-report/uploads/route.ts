import { NextRequest, NextResponse } from 'next/server';
import { pageCount, parseUploadHistoryQuery } from '@/lib/monthly-report/upload-history';
import { readUploadBody } from '@/lib/monthly-report/service';
import { requireSettlementReport, settlementPermissions } from '@/lib/settlement/service';
import { SETTLEMENT_KIND_LABELS } from '@/lib/settlement/detect';
import { handleSettlementUpload } from '@/lib/settlement/upload-handlers';
import { listSettlementUploadsPage, loadSettlementCoverage } from '@/lib/settlement/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Settlement upload history. Settlement kinds only.
 * ?page=1&pageSize=25&kind=settlement_crm_deposit|settlement_crm_withdrawal|settlement_mt5_dw|settlement_ftd
 */
export async function GET(request: NextRequest) {
  const user = await requireSettlementReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const filter = parseUploadHistoryQuery(request.nextUrl.searchParams);
  const [history, coverage] = await Promise.all([
    listSettlementUploadsPage(filter),
    loadSettlementCoverage(),
  ]);
  return NextResponse.json({
    ...history,
    pageCount: pageCount(history.total, history.pageSize),
    coverage,
    labels: SETTLEMENT_KIND_LABELS,
    permissions: settlementPermissions(user),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Settlement upload (CRM deposit / CRM withdrawal / MT5 D&W / Dealing FTD), detected by content.
 * mode=preview (default) or mode=commit&expect=<kind shown in the preview>.
 */
export async function POST(request: NextRequest) {
  const user = await requireSettlementReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const body = await readUploadBody(request);
  if (body instanceof NextResponse) return body;
  return handleSettlementUpload(user, body, request.nextUrl.searchParams);
}
