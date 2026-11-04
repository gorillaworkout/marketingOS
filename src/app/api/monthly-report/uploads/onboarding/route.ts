import { NextRequest, NextResponse } from 'next/server';
import { readUploadBody, requireMonthlyReport } from '@/lib/monthly-report/service';
import { handleOnboardingUpload } from '@/lib/monthly-report/upload-handlers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Onboarding export upload (manual type choice). Body = the raw .xlsx/.csv file.
 * ?mode=preview (default) validates and compares with stored rows; ?mode=commit inserts the
 * events that are not stored yet (key: Document ID + event time + Steps) and skips duplicates.
 * ?fileName= is the original name; ?offset= is the export's UTC offset (default +07:00 WIB).
 */
export async function POST(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  const body = await readUploadBody(request);
  if (body instanceof NextResponse) return body;
  return handleOnboardingUpload(user, body, request.nextUrl.searchParams);
}
