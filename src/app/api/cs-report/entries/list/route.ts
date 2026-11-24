import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { addDays, isIsoDate, todayWib } from '@/lib/cs-report/dates';
import { readAgentId } from '@/lib/cs-report/http';
import * as store from '@/lib/cs-report/store';

export const dynamic = 'force-dynamic';

/**
 * GET [?from&to][&agentId] -> "My entries": the agent's saved daily entries, newest first
 * (default: the last 92 days). Members always get their own; admins may pass agentId.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const today = todayWib();
  const to = isIsoDate(params.get('to')) ? params.get('to')! : today;
  const from = isIsoDate(params.get('from')) ? params.get('from')! : addDays(to, -91);
  if (from > to) return NextResponse.json({ error: 'from must be on or before to.' }, { status: 400 });
  const requested = auth.role === 'admin' ? readAgentId(params) : null;
  const agent = requested ? await store.getAgent(requested) : await store.agentForUser(auth.id);
  if (requested && !agent) return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
  const entries = agent ? await store.listEntries(from, to, agent.id) : [];
  return NextResponse.json({ from, to, agent: agent ? { id: agent.id, name: agent.displayName } : null, entries: entries.reverse() });
}
