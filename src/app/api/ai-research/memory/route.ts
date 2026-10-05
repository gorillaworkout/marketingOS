import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import {
  clearMemories,
  deleteMemory,
  listMemorySettings,
  setAiMemoryEnabled,
  updateMemoryContent,
} from '@/lib/ai-research-memory';

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  try {
    const settings = await listMemorySettings(auth.id);
    return json(settings);
  } catch (error) {
    console.error('[ai-research] memory list failed:', error);
    return json({ error: 'Could not load memory.' }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  let body: { id?: unknown; content?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  try {
    if (typeof body.enabled === 'boolean' && body.id == null && body.content == null) {
      const enabled = await setAiMemoryEnabled(auth.id, body.enabled);
      return json({ enabled });
    }
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return json({ error: 'Memory was not found.' }, 400);
    const result = await updateMemoryContent(auth.id, id, typeof body.content === 'string' ? body.content : '');
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ memory: result.memory });
  } catch (error) {
    console.error('[ai-research] memory update failed:', error);
    return json({ error: 'Could not update memory.' }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  const all = request.nextUrl.searchParams.get('all');
  const id = request.nextUrl.searchParams.get('id')?.trim() || '';
  try {
    if (all === '1' || all === 'true') {
      const removed = await clearMemories(auth.id);
      return json({ cleared: true, removed });
    }
    if (!id) return json({ error: 'Memory was not found.' }, 400);
    const removed = await deleteMemory(auth.id, id);
    if (!removed) return json({ error: 'Memory was not found.' }, 404);
    return json({ deleted: true, id });
  } catch (error) {
    console.error('[ai-research] memory delete failed:', error);
    return json({ error: 'Could not delete memory.' }, 500);
  }
}
