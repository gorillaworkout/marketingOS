import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listModelFallbackEvents } from '@/lib/model-fallback-log';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const limit = Number(new URL(request.url).searchParams.get('limit') || 100);
  const events = await listModelFallbackEvents(limit);
  return NextResponse.json({
    events: events.map(row => ({
      id: row.id,
      feature: row.feature,
      failedModel: row.failed_model,
      fallbackModel: row.fallback_model,
      error: row.error,
      afterPartial: row.after_partial,
      userId: row.user_id,
      createdAt: row.created_at,
    })),
  });
}
