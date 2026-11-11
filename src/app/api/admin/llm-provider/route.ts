import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  EMBEDDINGS_FAILOVER_NOTE,
  FREE_MODEL_LIMIT_NOTE,
  IMAGES_FAILOVER_NOTE,
  canManageLlmProvider,
} from '@/lib/llm-provider';
import type { LlmMode } from '@/lib/llm-provider-defaults';
import {
  assertMapping,
  getLlmSettings,
  listLlmAudit,
  listModelHealth,
  saveLlmProviderSettings,
} from '@/lib/llm-provider-store';

export const dynamic = 'force-dynamic';

function modeOf(value: unknown): LlmMode | null {
  return value === 'dupoin' || value === 'openrouter' || value === 'auto' ? value : null;
}

function modelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (!/^[A-Za-z0-9_./:[\]~-]+$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;
  if (!canManageLlmProvider(user)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

  const settings = await getLlmSettings();
  const audit = await listLlmAudit();
  return NextResponse.json({
    mode: settings.mode,
    keyConfigured: settings.keyConfigured,
    keyReadable: settings.keyReadable,
    keyHint: settings.keyConfigured ? settings.keyHint : null,
    defaultChatModel: settings.defaultChatModel,
    defaultImageModel: settings.defaultImageModel,
    defaultEmbeddingModel: settings.defaultEmbeddingModel,
    chatFallbacks: settings.chatFallbacks,
    mappings: settings.mappings,
    health: await listModelHealth(),
    status: settings.status,
    audit,
    notes: { embeddings: EMBEDDINGS_FAILOVER_NOTE, images: IMAGES_FAILOVER_NOTE, freeModels: FREE_MODEL_LIMIT_NOTE },
  });
}

export async function PUT(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;
  if (!canManageLlmProvider(user)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

  const body = await request.json().catch(() => null) as {
    mode?: unknown;
    defaultChatModel?: unknown;
    defaultImageModel?: unknown;
    defaultEmbeddingModel?: unknown;
    openrouterKey?: unknown;
    mappings?: unknown;
    chatFallbacks?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const mode = modeOf(body.mode);
  const defaultChatModel = modelId(body.defaultChatModel);
  const defaultImageModel = modelId(body.defaultImageModel);
  const defaultEmbeddingModel = modelId(body.defaultEmbeddingModel);
  if (!mode) return NextResponse.json({ error: 'Mode must be Dupoin, OpenRouter, or Automatic.' }, { status: 400 });
  if (!defaultChatModel || !defaultImageModel || !defaultEmbeddingModel) return NextResponse.json({ error: 'Enter a default chat model, image model, and embedding model.' }, { status: 400 });
  if (!Array.isArray(body.mappings) || body.mappings.length > 200) {
    return NextResponse.json({ error: 'Model mappings must be a list of at most 200 rows.' }, { status: 400 });
  }

  let openrouterKey: string | null | undefined;
  if (body.openrouterKey === null) openrouterKey = null;
  else if (body.openrouterKey === undefined || body.openrouterKey === '') openrouterKey = undefined;
  else if (typeof body.openrouterKey === 'string' && body.openrouterKey.trim().length >= 8 && body.openrouterKey.trim().length <= 500) {
    openrouterKey = body.openrouterKey.trim();
  } else {
    return NextResponse.json({ error: 'OpenRouter API key must be between 8 and 500 characters.' }, { status: 400 });
  }

  const current = await getLlmSettings();
  let chatFallbacks = current.chatFallbacks;
  if (Array.isArray(body.chatFallbacks)) {
    if (body.chatFallbacks.length > 8) return NextResponse.json({ error: 'Use at most 8 OpenRouter chat fallbacks.' }, { status: 400 });
    const parsed: string[] = [];
    for (const item of body.chatFallbacks) {
      const id = modelId(item);
      if (!id) return NextResponse.json({ error: 'Each fallback model id must be a valid model id.' }, { status: 400 });
      if (!parsed.includes(id)) parsed.push(id);
    }
    chatFallbacks = parsed;
  }

  try {
    const mappings = body.mappings.map(row => assertMapping({
      dupoinModel: String((row as { dupoinModel?: unknown }).dupoinModel || ''),
      openrouterModel: String((row as { openrouterModel?: unknown }).openrouterModel || ''),
      kind: (row as { kind?: 'chat' | 'image' | 'embedding' }).kind === 'image'
        ? 'image'
        : (row as { kind?: string }).kind === 'embedding' ? 'embedding' : 'chat',
    }));
    const seen = new Set<string>();
    for (const mapping of mappings) {
      if (seen.has(mapping.dupoinModel)) return NextResponse.json({ error: `Duplicate Dupoin model ${mapping.dupoinModel}.` }, { status: 400 });
      seen.add(mapping.dupoinModel);
    }
    await saveLlmProviderSettings({
      mode,
      defaultChatModel,
      defaultImageModel,
      defaultEmbeddingModel,
      chatFallbacks,
      openrouterKey,
      mappings,
      actorId: user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save LLM provider settings.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
