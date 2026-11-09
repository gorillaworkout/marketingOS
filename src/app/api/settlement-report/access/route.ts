import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listSettlementAccessUsers, setSettlementAccess } from '@/lib/settlement/store';

export const dynamic = 'force-dynamic';

/** Admin only: who can open Settlement Report (view = upload). */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json({ users: await listSettlementAccessUsers() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null) as { userId?: unknown; view?: unknown; upload?: unknown } | null;
  if (!body || typeof body.userId !== 'string' || typeof body.view !== 'boolean') {
    return NextResponse.json({ error: 'userId and view are required' }, { status: 400 });
  }
  const ok = await setSettlementAccess(body.userId, { view: body.view, upload: true }, admin.id);
  if (!ok) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const user = (await listSettlementAccessUsers()).find(u => u.id === body.userId);
  return NextResponse.json({ user });
}
