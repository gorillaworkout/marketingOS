import { NextRequest, NextResponse } from 'next/server';
import { listUploads } from '@/lib/monthly-report/store';
import { requireMonthlyReport } from '@/lib/monthly-report/service';

export const dynamic = 'force-dynamic';

/** Upload history (uploaders and admins). */
export async function GET(request: NextRequest) {
  const user = await requireMonthlyReport(request, { upload: true });
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ uploads: await listUploads(100) }, { headers: { 'Cache-Control': 'no-store' } });
}
