import { NextRequest, NextResponse } from 'next/server';
import { coverageOverview } from '@/lib/monthly-report/coverage';
import { listUploadMonths, listUploadsPage, loadCoverage, loadUploadRanges } from '@/lib/monthly-report/store';
import { requireMonthlyReport, todayWib } from '@/lib/monthly-report/service';
import { monthBounds, pageCount, parseUploadHistoryQuery } from '@/lib/monthly-report/upload-history';

export const dynamic = 'force-dynamic';

/**
 * Upload history (uploaders and admins), newest first and paged:
 * ?page=1&pageSize=25 (max 100), ?kind=onboarding|ftd, ?month=YYYY-MM (data range overlaps the month).
 * Also returns the months that have data (for the filter) and the data coverage
 * ("data through" per type, missing days in the selected month or since the first upload).
 */
export async function GET(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const filter = parseUploadHistoryQuery(request.nextUrl.searchParams);
  const ranges = await loadUploadRanges();
  const [history, months, coverage] = await Promise.all([listUploadsPage(filter), listUploadMonths(ranges), loadCoverage(ranges)]);
  const today = todayWib();
  return NextResponse.json({
    ...history,
    pageCount: pageCount(history.total, history.pageSize),
    filter: { kind: filter.kind, month: filter.month },
    months,
    coverage: coverageOverview(coverage, today, filter.month ? monthBounds(filter.month) : null),
    today,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
