import { NextResponse } from 'next/server';
import { AVAILABLE_MODELS } from '@/lib/openai';

export async function GET() {
  const providers: Record<string, { label: string; icon: string; credits: string | null; status: string }> = {
    openrouter: { label: 'OpenRouter', icon: '📡', credits: null, status: 'unknown' },
    codex: { label: 'Codex (ChatGPT Plus)', icon: '🤖', credits: null, status: 'available' },
    'claude-code': { label: 'Claude Code (Claude subscription)', icon: '🟠', credits: null, status: 'available' },
  };

  // Try to get OpenRouter credits balance
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${openrouterKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
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

  const models = AVAILABLE_MODELS.map(m => ({
    ...m,
    inputPricePerM: Math.round(m.input * 1_000_000 * 100) / 100,
    outputPricePerM: Math.round(m.output * 1_000_000 * 100) / 100,
  }));

  return NextResponse.json({ models, providers, generatedAt: new Date().toISOString() });
}
