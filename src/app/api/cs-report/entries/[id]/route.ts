import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { canDeleteEntry } from '@/lib/cs-report/access';
import * as store from '@/lib/cs-report/store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** DELETE one daily entry. Admin only; the agent's complaint cases are separate and stay. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canDeleteEntry(auth)) return NextResponse.json({ error: 'Only an admin can delete a daily entry. Save the date again to correct it.' }, { status: 403 });
  const { id } = await context.params;
  if (!(await store.getEntryById(id))) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });
  await store.deleteEntry(id);
  return NextResponse.json({ success: true });
}
