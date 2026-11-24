import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { canEditComplaint } from '@/lib/cs-report/access';
import { todayWib } from '@/lib/cs-report/dates';
import { parseComplaintInput } from '@/lib/cs-report/validate';
import * as store from '@/lib/cs-report/store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

async function editable(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'cs-report');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const complaint = await store.getComplaint(id);
  if (!complaint) return NextResponse.json({ error: 'Complaint not found.' }, { status: 404 });
  const own = await store.agentForUser(auth.id);
  if (!canEditComplaint(auth, own?.id ?? null, complaint)) return NextResponse.json({ error: 'You can only change your own complaints.' }, { status: 403 });
  return { auth, complaint };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const check = await editable(request, context);
  if (check instanceof NextResponse) return check;
  const parsed = parseComplaintInput(await request.json().catch(() => null), todayWib());
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    return NextResponse.json({ complaint: await store.updateComplaint(check.complaint.id, parsed.value, check.auth.id) });
  } catch (error) {
    if (error instanceof store.DuplicateComplaintError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('CS Report complaint update failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not update the complaint.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const check = await editable(request, context);
  if (check instanceof NextResponse) return check;
  await store.deleteComplaint(check.complaint.id);
  return NextResponse.json({ success: true });
}
