import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { aiProviderErrorBody, aiProviderStatus } from '@/lib/ai-http-status';
import { draftProposalContent, parsePartnerLogo, parseProposalInput, templateContent } from '@/lib/partnership/proposal';
import { competitorInsights, proposalDraftDeps } from '@/lib/partnership/proposal-draft';
import { createProposal, getProposalSettings, listProposals } from '@/lib/partnership/proposal-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const proposals = await listProposals();
  return NextResponse.json({ proposals: proposals.map(item => ({ ...item, canDelete: auth.role === 'admin' || item.createdBy === auth.id })) });
}

/** Creates a proposal. mode "ai" drafts the narrative with the model; mode "template" uses the approved boilerplate. */
export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { settings } = await getProposalSettings();
  const parsed = parseProposalInput(body?.input, settings);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const logo = parsePartnerLogo(body?.partnerLogo);
  if ('error' in logo) return NextResponse.json({ error: logo.error }, { status: 400 });
  const input = parsed.value;

  let content = templateContent(input);
  let model: string | null = null;
  let droppedSentences = 0;
  if (body?.mode !== 'template') {
    try {
      const insights = input.useCompetitorInsights ? await competitorInsights() : [];
      const draft = await draftProposalContent(input, proposalDraftDeps(auth.id), insights);
      ({ content, model, droppedSentences } = draft);
    } catch (error) {
      const status = aiProviderStatus(error);
      return NextResponse.json({ ...aiProviderErrorBody(error), canUseTemplate: true }, { status: status >= 400 ? status : 502 });
    }
  }
  const id = await createProposal({ input, content, partnerLogo: logo.value, status: 'draft', model, note: model ? 'AI draft' : 'Template draft' }, auth.id);
  return NextResponse.json({ id, model, droppedSentences }, { status: 201 });
}
