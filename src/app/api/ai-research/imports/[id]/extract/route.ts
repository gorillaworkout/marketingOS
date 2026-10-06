import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { postgresChatImportDeps, retryChatImport } from '@/lib/chat-import';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const { id } = await context.params;
  try {
    const result = await retryChatImport(auth.id, id, postgresChatImportDeps());
    return json(result.body, result.status);
  } catch {
    console.error('[ai-research] chat import', { id, status: 'extract_failed' });
    return json({ error: 'Could not extract facts from that import.' }, 500);
  }
}
