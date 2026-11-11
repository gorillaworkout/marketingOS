import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { canManageLlmProvider, testLlmProvider } from '@/lib/llm-provider';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;
  if (!canManageLlmProvider(user)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

  const body = await request.json().catch(() => null) as { provider?: unknown; kind?: unknown } | null;
  const provider = body?.provider === 'openrouter' ? 'openrouter' : body?.provider === 'dupoin' ? 'dupoin' : null;
  const kind = body?.kind === 'image' || body?.kind === 'embeddings' ? body.kind : body?.kind === 'chat' ? 'chat' : null;
  if (!provider || !kind) return NextResponse.json({ error: 'Choose a provider and a test kind.' }, { status: 400 });

  const result = await testLlmProvider({ provider, kind });
  return NextResponse.json(result);
}
