import { NextRequest, NextResponse } from 'next/server';
import { requireInternalDocsUser } from '@/lib/internal-docs-access';
import { rateLimit } from '@/lib/rate-limit';
import { resolveFeatureModel } from '@/lib/model-routing';
import {
  citationsFromHits,
  formatInternalDocsPrompt,
  INTERNAL_DOCS_ASK_SYSTEM,
  INTERNAL_DOCS_NO_MATCH_ANSWER,
  retrieveInternalDocHits,
  withCitationMedia,
} from '@/lib/internal-docs';
import { generateContent } from '@/lib/openai';

const ASK_MODEL_FALLBACK = 'ag/gemini-3-flash';

function conversationBlock(history: unknown): string {
  if (!Array.isArray(history)) return '';
  const lines = history.slice(-8).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return [];
    const text = content.replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!text) return [];
    return [`${role === 'user' ? 'Employee' : 'Assistant'}: ${text}`];
  });
  return lines.length ? `Conversation so far:\n${lines.join('\n')}\n\n` : '';
}

export async function POST(request: NextRequest) {
  const actor = await requireInternalDocsUser(request);
  if (actor instanceof NextResponse) return actor;
  const limited = rateLimit(request, `internal-docs-ask:${actor.user.id}`);
  if (limited) return limited;

  let body: { question?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Question is required.' }, { status: 400 });
  }
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : '';
  if (!question) return NextResponse.json({ error: 'Question is required.' }, { status: 400 });

  const hits = await retrieveInternalDocHits(actor.principal, question);
  const citations = await withCitationMedia(citationsFromHits(hits, request.nextUrl.origin), actor.principal);
  if (!hits.length) {
    return NextResponse.json({ answer: INTERNAL_DOCS_NO_MATCH_ANSWER, citations: [] });
  }

  let model = ASK_MODEL_FALLBACK;
  try {
    model = await resolveFeatureModel(actor.user.id, 'ai-research');
  } catch {
    model = ASK_MODEL_FALLBACK;
  }

  const excerpts = hits.map((hit, index) => `${index + 1}. ${hit.title}\n${hit.excerpt}`).join('\n\n');
  try {
    const result = await generateContent(
      `${INTERNAL_DOCS_ASK_SYSTEM}\n\n${formatInternalDocsPrompt(hits, request.nextUrl.origin)}`,
      `${conversationBlock(body.history)}Question: ${question}\n\nExcerpts:\n${excerpts}`,
      actor.user.id,
      undefined,
      { model, temperature: 0.2, maxTokens: 900, taskType: 'internal-docs' },
    );
    return NextResponse.json({ answer: result.content.trim(), citations });
  } catch (error) {
    console.error('Internal docs ask failed:', error);
    return NextResponse.json({ error: 'Could not answer from FAQ & Guides right now.' }, { status: 502 });
  }
}
