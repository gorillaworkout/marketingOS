import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { buildUsers, getUsageRecords } from '@/lib/admin-usage';

function csvCell(value: string | number | null): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(request.url);
  const { records } = await getUsageRecords(searchParams.get('period'));
  const headers = ['Rank', 'Username', 'Department', 'Tokens', 'Cost', 'Tasks', 'Top Model', 'Top Provider'];
  const rows = buildUsers(records).map(user => [user.rank, user.username, user.department, user.totalTokens, user.totalCost, user.taskCount, user.topModel, user.topProvider]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="marketingos-usage-${searchParams.get('period') || 'month'}.csv"`,
    },
  });
}
