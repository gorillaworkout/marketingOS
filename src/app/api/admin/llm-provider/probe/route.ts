import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  canManageLlmProvider,
  probeModelsInOrder,
  type ProbeTarget,
} from '@/lib/llm-provider';
import type { LlmKind } from '@/lib/llm-provider-defaults';
import { clearProviderLastError, getLlmSettings, saveModelHealth } from '@/lib/llm-provider-store';
import { providerErrorClearedBy } from '@/lib/llm-auth';
import { modelsInUse, TIER_PRIMARY } from '@/lib/model-tiers';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function targetOf(value: unknown): ProbeTarget | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { provider?: unknown; model?: unknown; kind?: unknown };
  const provider = row.provider === 'openrouter' ? 'openrouter' : row.provider === 'dupoin' ? 'dupoin' : null;
  const kind: LlmKind | null = row.kind === 'image' || row.kind === 'embedding' || row.kind === 'chat' ? row.kind : null;
  const model = typeof row.model === 'string' ? row.model.trim() : '';
  if (!provider || !kind || !model || model.length > 200) return null;
  if (!/^[A-Za-z0-9_./:[\]~-]+$/.test(model)) return null;
  return { provider, kind, model };
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;
  if (!canManageLlmProvider(user)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

  const body = await request.json().catch(() => null) as { all?: unknown; includeImages?: unknown; targets?: unknown } | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  let targets: ProbeTarget[] = [];
  if (body.all === true) {
    const settings = await getLlmSettings();
    targets = modelsInUse({
      primaries: settings.tiers.map(tier => tier.dupoinPrimary),
      freeChain: settings.chatFallbacks,
      paidTargets: settings.tiers.map(tier => tier.paidTarget),
      usePaid: settings.usePaidOpenRouter,
      embeddingModel: settings.defaultEmbeddingModel,
      imageModel: TIER_PRIMARY.image,
      includeImages: body.includeImages === true,
    });
  } else if (Array.isArray(body.targets)) {
    if (body.targets.length > 8) return NextResponse.json({ error: 'Test at most 8 models at a time, or use Test all.' }, { status: 400 });
    for (const item of body.targets) {
      const target = targetOf(item);
      if (!target) return NextResponse.json({ error: 'Each test needs a provider, model, and kind.' }, { status: 400 });
      targets.push(target);
    }
  } else {
    return NextResponse.json({ error: 'Choose Test all or one model row.' }, { status: 400 });
  }

  const results = (await probeModelsInOrder(targets)).map(result => ({ ...result, testedAt: new Date().toISOString() }));
  for (const result of results) {
    try {
      await saveModelHealth({
        provider: result.provider,
        model: result.model,
        kind: result.kind,
        status: result.status === 'auth_expired' ? 'error' : result.status,
        httpStatus: result.httpStatus,
        latencyMs: result.latencyMs,
        message: result.message,
        testedAt: result.testedAt,
      });
    } catch (error) {
      console.error('[llm-provider] could not store health:', error instanceof Error ? error.message : error);
    }
  }
  // A passing Dupoin chat test supersedes a stale stored failover error for that model (e.g. an old OAuth expiry).
  let clearedProviderError = false;
  const passed = results.filter(result => result.provider === 'dupoin' && result.kind === 'chat' && result.status === 'active');
  if (passed.length) {
    try {
      const { status } = await getLlmSettings();
      if (passed.some(result => providerErrorClearedBy(status.lastError, result.model))) {
        await clearProviderLastError();
        clearedProviderError = true;
      }
    } catch (error) {
      console.error('[llm-provider] could not clear the stored error:', error instanceof Error ? error.message : error);
    }
  }
  return NextResponse.json({ results, clearedProviderError });
}
