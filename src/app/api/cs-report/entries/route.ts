import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { isIsoDate, todayWib } from '@/lib/cs-report/dates';
import { readAgentId } from '@/lib/cs-report/http';
import { parseDailyEntryInput } from '@/lib/cs-report/validate';
import * as store from '@/lib/cs-report/store';

export const dynamic = 'force-dynamic';

/** GET ?date=YYYY-MM-DD[&agentId] -> the agent's entry and complaints for that date (own agent; admins may pick one). */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const today = todayWib();
  const raw = request.nextUrl.searchParams.get('date');
  const date = raw && isIsoDate(raw) ? raw : today;
  const requested = auth.role === 'admin' ? readAgentId(request.nextUrl.searchParams) : null;
  const agent = requested ? await store.getAgent(requested) : await store.agentForUser(auth.id);
  if (requested && !agent) return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
  const self = await store.getUserBrief(auth.id);
  const [entry, complaints, agents] = await Promise.all([
    agent ? store.getEntry(agent.id, date) : null,
    agent ? store.listComplaints(date, date, agent.id) : [],
    auth.role === 'admin' ? store.listAgents() : [],
  ]);
  return NextResponse.json({
    date, today, isAdmin: auth.role === 'admin',
    agent: agent ? { id: agent.id, name: agent.displayName } : { id: null, name: self?.name ?? 'You' },
    entry, complaints,
    agents: agents.map(a => ({ id: a.id, name: a.displayName, linked: Boolean(a.userId) })),
  });
}

/** PUT body = daily entry (+ agentId for admins). Upserts one row per agent per date. */
export async function PUT(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = parseDailyEntryInput(body, todayWib());
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const targetId = auth.role === 'admin' && typeof body?.agentId === 'string' && body.agentId ? body.agentId : null;
    const agent = targetId ? await store.getAgent(targetId) : await store.ensureAgentForUser(auth.id);
    if (!agent) return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    const entry = await store.upsertEntry(agent.id, parsed.value, auth.id);
    return NextResponse.json({ entry });
  } catch (error) {
    console.error('CS Report entry save failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not save the daily entry.' }, { status: 500 });
  }
}
