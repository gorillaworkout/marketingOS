import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getUsagePeriod } from '@/lib/admin-usage';
import { microToUsd } from '@/lib/seo/treg-client';
import { listSpend } from '@/lib/seo/treg-spend';

/** Paid data-provider spend (treg.to), kept apart from LLM token cost. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const range = getUsagePeriod(new URL(request.url).searchParams.get('period'));
  const rows = await listSpend(range).catch(() => []);
  const charged = (row: (typeof rows)[number]) => row.actual_micro ?? (row.status === 'reserved' ? row.estimated_micro : 0);
  return NextResponse.json({
    totalUsd: microToUsd(rows.reduce((sum, row) => sum + charged(row), 0)),
    runs: rows.length,
    rows: rows.map(row => ({
      id: row.id,
      createdAt: row.created_at,
      provider: row.provider,
      feature: row.feature,
      username: row.username || 'Unknown user',
      status: row.status,
      calls: row.calls,
      estimatedUsd: microToUsd(row.estimated_micro),
      actualUsd: row.actual_micro === null ? null : microToUsd(row.actual_micro),
      costSource: row.cost_source,
      note: row.note,
    })),
  });
}
