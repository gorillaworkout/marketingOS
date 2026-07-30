import { NextRequest, NextResponse } from 'next/server';
import { AVAILABLE_MODELS } from '@/lib/openai';
import { getAuthorizedUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const viewer = await getAuthorizedUser(request);
  if ('error' in viewer) return NextResponse.json({ error: viewer.error }, { status: viewer.status });

  const status = process.env.GORILLAWORKOUT_API_KEY ? 'available' : 'not_configured';
  return NextResponse.json({
    provider: {
      id: 'gorillaworkout',
      label: 'GorillaWorkout LLM',
      endpoint: process.env.GORILLAWORKOUT_API_BASE || 'https://llm.gorillaworkout.id/v1',
      status,
    },
    models: AVAILABLE_MODELS.map(model => ({
      ...model,
      inputPricePerM: model.input * 1_000_000,
      outputPricePerM: model.output * 1_000_000,
      pricingSource: 'gateway',
    })),
    generatedAt: new Date().toISOString(),
  });
}
