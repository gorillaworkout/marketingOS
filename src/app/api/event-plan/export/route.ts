import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import type { EventPlanDeckInput } from '@/lib/event-plan-deck';
import { exportEventPlanPptx, PPTX_MIME } from '@/lib/event-plan-pptx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1_000_000;

/**
 * POST the plan as the user last left it (selected option, quotation table,
 * contingency) and get a 16:9 PPTX back. Nothing is stored.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'event-plan');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'The event plan is too large to export.' }, { status: 413 });
  let body: Partial<EventPlanDeckInput>;
  try {
    body = JSON.parse(raw) as Partial<EventPlanDeckInput>;
  } catch {
    return NextResponse.json({ error: 'Send the event plan as JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || typeof body.eventName !== 'string' || !body.eventName.trim()) {
    return NextResponse.json({ error: 'The event name is required.' }, { status: 400 });
  }
  if (!body.option || typeof body.option !== 'object' || Array.isArray(body.option)) {
    return NextResponse.json({ error: 'Choose a plan option to export.' }, { status: 400 });
  }
  try {
    const file = await exportEventPlanPptx({
      eventName: body.eventName,
      location: typeof body.location === 'string' ? body.location : '',
      theme: typeof body.theme === 'string' ? body.theme : '',
      targetDate: typeof body.targetDate === 'string' ? body.targetDate : '',
      venueName: typeof body.venueName === 'string' ? body.venueName : '',
      participants: typeof body.participants === 'number' ? body.participants : null,
      speakers: Array.isArray(body.speakers) ? body.speakers : [],
      quotations: Array.isArray(body.quotations) ? body.quotations : [],
      contingencyPercent: typeof body.contingencyPercent === 'number' ? body.contingencyPercent : undefined,
      option: body.option as Record<string, unknown>,
    });
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        'content-type': PPTX_MIME,
        'content-disposition': `attachment; filename="${file.fileName}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (cause) {
    console.error('[event-plan/export] PPTX export failed', cause instanceof Error ? cause.message : cause);
    return NextResponse.json({ error: 'Could not build the presentation. Try again.' }, { status: 500 });
  }
}
