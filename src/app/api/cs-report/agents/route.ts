import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { listAgents, listCsUsers } from '@/lib/cs-report/store';

export const dynamic = 'force-dynamic';

/** GET -> CS agents (linked users and name-only historical agents) and the users who have CS Report via their department. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const [agents, users] = await Promise.all([listAgents(), listCsUsers()]);
  return NextResponse.json({ agents: agents.map(a => ({ id: a.id, name: a.displayName, linked: Boolean(a.userId) })), users });
}
