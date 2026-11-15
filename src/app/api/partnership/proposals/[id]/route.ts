import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { computeTotals, parsePartnerLogo, parseProposalContent, parseProposalInput } from '@/lib/partnership/proposal';
import { deleteProposal, getProposal, getProposalSettings, listVersions, updateProposal } from '@/lib/partnership/proposal-store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const proposal = await getProposal(id);
  if (!proposal) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
  return NextResponse.json({
    proposal,
    totals: computeTotals(proposal.input),
    versions: await listVersions(id),
    canDelete: auth.role === 'admin' || proposal.createdBy === auth.id,
  });
}

/** Saves edits as a new version. */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const existing = await getProposal(id);
  if (!existing) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { settings } = await getProposalSettings();
  const parsed = parseProposalInput(body?.input ?? existing.input, settings);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const logo = parsePartnerLogo(body && 'partnerLogo' in body ? body.partnerLogo : existing.partnerLogo);
  if ('error' in logo) return NextResponse.json({ error: logo.error }, { status: 400 });
  const content = parseProposalContent(body?.content ?? existing.content, parsed.value);
  const status = body?.status === 'final' ? 'final' : body?.status === 'draft' ? 'draft' : existing.status;
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : 'Edited';
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 120) : null;
  const version = await updateProposal(id, { input: parsed.value, content, partnerLogo: logo.value, status, note, model }, auth.id);
  if (version === null) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
  return NextResponse.json({ success: true, version, totals: computeTotals(parsed.value) });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const existing = await getProposal(id);
  if (!existing) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
  if (auth.role !== 'admin' && existing.createdBy !== auth.id) return NextResponse.json({ error: 'Only the author or an admin can delete this proposal.' }, { status: 403 });
  await deleteProposal(id);
  return NextResponse.json({ success: true });
}
