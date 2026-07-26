import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buildTopUsers, getUsageRecords } from '@/lib/admin-usage';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(request.url);
  const requestedLimit = Number.parseInt(searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 5;
  const { records } = await getUsageRecords(searchParams.get('period'));
  // Cost is the canonical top-spender sort. Kept as a query parameter for API compatibility.
  return NextResponse.json(buildTopUsers(records, limit));
}
