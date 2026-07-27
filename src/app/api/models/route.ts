import { NextResponse } from 'next/server';
import { AVAILABLE_MODELS } from '@/lib/openai';

type ProviderStatus = {
  label: string;
  icon: string;
  credits: string | null;
  status: string;
};

type OpenRouterEndpoint = {
  status?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};

type LivePrice = {
  inputPerToken: number;
  outputPerToken: number;
};

export async function getOpenRouterLivePrice(modelId: string): Promise<LivePrice | null> {
  try {
    const response = await fetch(`https://openrouter.ai/api/v1/models/${modelId}/endpoints`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const payload = await response.json() as { data?: { endpoints?: OpenRouterEndpoint[] } };
    const endpoints = (payload.data?.endpoints || []).filter(endpoint => (endpoint.status ?? 0) >= 0);
    const inputPrices = endpoints
      .map(endpoint => Number(endpoint.pricing?.prompt))
      .filter(price => Number.isFinite(price) && price >= 0);
    const outputPrices = endpoints
      .map(endpoint => Number(endpoint.pricing?.completion))
      .filter(price => Number.isFinite(price) && price >= 0);

    if (!inputPrices.length || !outputPrices.length) return null;
    return {
      inputPerToken: Math.min(...inputPrices),
      outputPerToken: Math.min(...outputPrices),
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const providers: Record<string, ProviderStatus> = {
    openrouter: { label: 'OpenRouter', icon: '📡', credits: null, status: 'unknown' },
    codex: { label: 'Codex (ChatGPT Plus)', icon: '🤖', credits: null, status: 'available' },
    'claude-code': { label: 'Claude Code (Claude subscription)', icon: '🟠', credits: null, status: 'available' },
  };

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${openrouterKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        providers.openrouter.credits = data.credits !== undefined ? Number(data.credits).toFixed(4) : null;
        providers.openrouter.status = (data.credits || 0) > 0 ? 'has_credits' : 'low';
      } else {
        providers.openrouter.status = 'error';
      }
    } catch {
      providers.openrouter.status = 'unreachable';
    }
  } else {
    providers.openrouter.status = 'not_configured';
  }

  const livePriceEntries = await Promise.all(
    AVAILABLE_MODELS
      .filter(model => model.provider === 'openrouter')
      .map(async model => [model.id, await getOpenRouterLivePrice(model.id)] as const),
  );
  const livePrices = new Map(livePriceEntries);

  const models = AVAILABLE_MODELS.map(model => {
    const livePrice = livePrices.get(model.id);
    const input = livePrice?.inputPerToken ?? model.input;
    const output = livePrice?.outputPerToken ?? model.output;
    return {
      ...model,
      input,
      output,
      inputPricePerM: input * 1_000_000,
      outputPricePerM: output * 1_000_000,
      pricingSource: model.provider === 'openrouter'
        ? livePrice ? 'openrouter-live' : 'fallback'
        : 'subscription',
      sourceUrl: model.provider === 'openrouter' ? `https://openrouter.ai/${model.id}` : null,
    };
  });

  return NextResponse.json({
    models,
    providers,
    generatedAt: new Date().toISOString(),
    pricingNote: 'OpenRouter prices are the lowest active provider prices and may vary by routing/provider.',
  });
}
