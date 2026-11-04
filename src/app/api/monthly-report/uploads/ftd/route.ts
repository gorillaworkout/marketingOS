import { NextRequest, NextResponse } from 'next/server';
import { readUploadBody, requireMonthlyReport } from '@/lib/monthly-report/service';
import { handleFtdUpload } from '@/lib/monthly-report/upload-handlers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * FTD upload (manual type choice): the monthly FTD report CSV (MONTHLY block) or a clean table with
 * Account, Type, Join Date, FTD Time, Amount. Upserts by Account.
 * Same query parameters as the onboarding upload.
 */
export async function POST(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const body = await readUploadBody(request);
  if (body instanceof NextResponse) return body;
  return handleFtdUpload(user, body, request.nextUrl.searchParams);
}
