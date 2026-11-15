import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { buildProposalDocument } from '@/lib/partnership/proposal';
import { exportProposal } from '@/lib/partnership/proposal-export';
import { getProposal, getProposalSettings } from '@/lib/partnership/proposal-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/** GET ?format=pdf|pptx&template=slide|document[&inline=1]. PPTX is for the slide template only. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'partnership');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const proposal = await getProposal(id);
  if (!proposal) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
  const params = request.nextUrl.searchParams;
  const format = params.get('format') === 'pptx' ? 'pptx' : 'pdf';
  const templateParam = params.get('template');
  const template = templateParam === 'document' || templateParam === 'slide' ? templateParam : proposal.input.template;
  if (format === 'pptx' && template !== 'slide') return NextResponse.json({ error: 'PPTX export is available for the Slide 16:9 template only.' }, { status: 400 });
  const { settings } = await getProposalSettings();
  const doc = buildProposalDocument(proposal.input, proposal.content, settings, proposal.partnerLogo);
  const file = await exportProposal(doc, template, format);
  const disposition = params.get('inline') === '1' && format === 'pdf' ? 'inline' : 'attachment';
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'content-type': file.mime,
      'content-disposition': `${disposition}; filename="${file.fileName}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
