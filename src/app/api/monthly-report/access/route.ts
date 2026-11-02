import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listAccessUsers, setUserAccess } from '@/lib/monthly-report/store';

export const dynamic = 'force-dynamic';

/** Admin only: who can view / upload Monthly Report. */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json({ users: await listAccessUsers() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => null) as { userId?: unknown; view?: unknown; upload?: unknown } | null;
  if (!body || typeof body.userId !== 'string' || typeof body.view !== 'boolean' || typeof body.upload !== 'boolean') {
    return NextResponse.json({ error: 'userId, view and upload are required' }, { status: 400 });
  }
  if (body.upload && !body.view) return NextResponse.json({ error: 'Upload rights need view access' }, { status: 400 });
  const ok = await setUserAccess(body.userId, { view: body.view, upload: body.upload }, admin.id);
  if (!ok) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const user = (await listAccessUsers()).find(u => u.id === body.userId);
  return NextResponse.json({ user });
}
