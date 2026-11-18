import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { listAccounts, recentRuns } from '@/lib/google-ads/report';
import { googleAdsConfigStatus } from '@/lib/google-ads/service';

export const dynamic = 'force-dynamic';

/** Accounts, configuration status (key names only), and recent sync runs. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'google-ads');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const [accounts, runs] = await Promise.all([listAccounts(), recentRuns(5)]);
  return NextResponse.json({
    config: googleAdsConfigStatus(),
    accounts,
    runs,
    running: runs.find(run => run.status === 'running') ?? null,
    isAdmin: auth.role === 'admin',
  });
}
