import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buildSummary, getUsageRecords } from '@/lib/admin-usage';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(request.url);
  const { records, range } = await getUsageRecords(searchParams.get('period'));
  return NextResponse.json(buildSummary(records, range));
}
