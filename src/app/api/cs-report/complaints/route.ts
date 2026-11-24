import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { todayWib } from '@/lib/cs-report/dates';
import { parseComplaintInput } from '@/lib/cs-report/validate';
import * as store from '@/lib/cs-report/store';

export const dynamic = 'force-dynamic';

/** POST body = one complaint case (+ agentId for admins). Recorded under the agent of the logged-in user. */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = parseComplaintInput(body, todayWib());
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const targetId = auth.role === 'admin' && typeof body?.agentId === 'string' && body.agentId ? body.agentId : null;
    const agent = targetId ? await store.getAgent(targetId) : await store.ensureAgentForUser(auth.id);
    if (!agent) return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    const complaint = await store.insertComplaint(agent.id, parsed.value, auth.id);
    return NextResponse.json({ complaint }, { status: 201 });
  } catch (error) {
    if (error instanceof store.DuplicateComplaintError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('CS Report complaint save failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not save the complaint.' }, { status: 500 });
  }
}
