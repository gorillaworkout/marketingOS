import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { verifiedFacts } from '@/lib/partnership/proposal-facts';
import { DEFAULT_PROPOSAL_SETTINGS, parseProposalSettings } from '@/lib/partnership/proposal-settings';
import { getProposalSettings, resetProposalSettings, saveProposalSettings } from '@/lib/partnership/proposal-store';

export const dynamic = 'force-dynamic';

/** Rate card and figures. Every Partnership user can read them; only an admin can change them. */
export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const current = await getProposalSettings();
  return NextResponse.json({ ...current, defaults: DEFAULT_PROPOSAL_SETTINGS, facts: verifiedFacts('en'), canEdit: auth.role === 'admin' });
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'admin') return NextResponse.json({ error: 'Only an admin can change proposal settings.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = parseProposalSettings(body?.settings);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await saveProposalSettings(parsed.value, auth.id);
  return NextResponse.json({ success: true, settings: parsed.value });
}

/** Back to the defaults copied from the approved proposals. */
export async function DELETE(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'admin') return NextResponse.json({ error: 'Only an admin can change proposal settings.' }, { status: 403 });
  await resetProposalSettings();
  return NextResponse.json({ success: true, settings: DEFAULT_PROPOSAL_SETTINGS });
}
