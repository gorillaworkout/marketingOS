import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { approveChatImport, postgresChatImportDeps } from '@/lib/chat-import';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const { id } = await context.params;
  let body: { facts?: unknown; qa?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send the chat as JSON or as a file.' }, 400);
  }
  try {
    const result = await approveChatImport(auth.id, id, { facts: body.facts, qa: body.qa }, postgresChatImportDeps());
    if (!result.ok && result.body.error === 'Extract facts before approving.') {
      return json({ error: 'Extract facts before approving.' }, 409);
    }
    return json(result.body, result.status);
  } catch {
    console.error('[ai-research] chat import', { id, status: 'approve_failed' });
    return json({ error: 'Could not approve that import.' }, 500);
  }
}
