import { NextRequest, NextResponse } from 'next/server';
import { readUploadBody, requireMonthlyReport } from '@/lib/monthly-report/service';
import { handleFtdUpload } from '@/lib/monthly-report/upload-handlers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Legacy FTD file import (admin only; daily FTD is normally entered by hand on
 * the Uploads page, see /api/monthly-report/ftd-daily). Account-level rows feed
 * the same-account cohort metrics. FTD upload (manual type choice): the monthly FTD report CSV (MONTHLY block) or a clean table with
 * Account, Type, Join Date, FTD Time, Amount. Upserts by Account.
 * Same query parameters as the onboarding upload.
 */
export async function POST(request: NextRequest) {
  const user = await requireMonthlyReport(request, { adminOnly: true });
  if (user instanceof NextResponse) return user;
  const body = await readUploadBody(request);
  if (body instanceof NextResponse) return body;
  return handleFtdUpload(user, body, request.nextUrl.searchParams);
}
