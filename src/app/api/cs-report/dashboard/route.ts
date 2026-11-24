import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { readAgentId, readRange } from '@/lib/cs-report/http';
import { getDashboard } from '@/lib/cs-report/service';
import { listAgents } from '@/lib/cs-report/store';

export const dynamic = 'force-dynamic';

/** GET ?from&to[&agentId] -> KPIs, daily trend, per-agent table, weekly recap, questions, complaints. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const range = readRange(request.nextUrl.searchParams);
  if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 });
  try {
    const [dashboard, agents] = await Promise.all([getDashboard(range.from, range.to, readAgentId(request.nextUrl.searchParams)), listAgents()]);
    return NextResponse.json({ ...dashboard, agentOptions: agents.map(a => ({ id: a.id, name: a.displayName })) });
  } catch (error) {
    console.error('CS Report dashboard failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not load the CS Report dashboard.' }, { status: 500 });
  }
}
