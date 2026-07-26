import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buildUsers, getUsageRecords } from '@/lib/admin-usage';

function limitFrom(value: string | null, fallback: number): number {
  const limit = Number.parseInt(value || '', 10);
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : fallback;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(request.url);
  const { records } = await getUsageRecords(searchParams.get('period'));
  return NextResponse.json(buildUsers(records, limitFrom(searchParams.get('limit'), 10)));
}
