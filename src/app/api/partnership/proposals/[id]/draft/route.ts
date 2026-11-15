import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { aiProviderErrorBody, aiProviderStatus } from '@/lib/ai-http-status';
import { draftProposalContent, parseProposalInput } from '@/lib/partnership/proposal';
import { competitorInsights, proposalDraftDeps } from '@/lib/partnership/proposal-draft';
import { getProposal, getProposalSettings } from '@/lib/partnership/proposal-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

/** Re-drafts the narrative with AI from the (possibly edited) form. Returns content for review; nothing is saved. */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const existing = await getProposal(id);
  if (!existing) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { settings } = await getProposalSettings();
  const parsed = parseProposalInput(body?.input ?? existing.input, settings);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const insights = parsed.value.useCompetitorInsights ? await competitorInsights() : [];
    const draft = await draftProposalContent(parsed.value, proposalDraftDeps(auth.id), insights);
    return NextResponse.json({ content: { ...draft.content, include: existing.content.include }, model: draft.model, droppedSentences: draft.droppedSentences, insightsUsed: insights.length });
  } catch (error) {
    const status = aiProviderStatus(error);
    return NextResponse.json(aiProviderErrorBody(error), { status: status >= 400 ? status : 502 });
  }
}
