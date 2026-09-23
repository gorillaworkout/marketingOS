import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import {
  checkResearchWatch,
  createResearchWatch,
  deleteResearchWatch,
  listResearchWatches,
  setResearchWatchStatus,
} from '@/lib/ai-research-watch-run';
import { AI_RESEARCH_MAX_WATCHES } from '@/lib/ai-research-watches';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const watches = await listResearchWatches(auth.id);
  return json({ watches, limit: AI_RESEARCH_MAX_WATCHES });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  try {
    const body = await request.json() as { topic?: unknown; keywords?: unknown };
    const result = await createResearchWatch(auth.id, body);
    return json(result.body, result.status);
  } catch {
    return json({ error: 'Permintaan tidak valid.' }, 400);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  try {
    const body = await request.json() as { id?: unknown; status?: unknown; action?: unknown };
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return json({ error: 'Pantauan tidak valid.' }, 400);
    if (body.action === 'check') {
      const result = await checkResearchWatch(auth.id, id);
      return json(result.body, result.status);
    }
    const result = await setResearchWatchStatus(auth.id, id, body.status);
    return json(result.body, result.status);
  } catch {
    return json({ error: 'Permintaan tidak valid.' }, 400);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const id = request.nextUrl.searchParams.get('id')?.trim() || '';
  if (!id) return json({ error: 'Pantauan tidak valid.' }, 400);
  const result = await deleteResearchWatch(auth.id, id);
  return json(result.body, result.status);
}
