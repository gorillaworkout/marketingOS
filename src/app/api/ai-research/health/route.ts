import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/auth';
import { getFeatureModelOptions } from '@/lib/model-routing';
import { probeGatewayModel, selectModelsToProbe } from '@/lib/model-health';
import { rateLimit } from '@/lib/rate-limit';

export const maxDuration = 60;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'ai-research');
  if ('error' in auth) return jsonError(auth.error, auth.status);

  const limited = rateLimit(request, `ai-research-health:${auth.id}`);
  if (limited) return limited;

  let requested: string | undefined;
  try {
    const body = await request.json() as { model?: unknown };
    if (body && typeof body === 'object' && body.model != null && body.model !== '') {
      if (typeof body.model !== 'string') return jsonError('Invalid model', 400);
      requested = body.model.trim();
      if (!requested) return jsonError('Invalid model', 400);
    }
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError('Invalid JSON body', 400);
    // Empty body is treated as "probe all allowed models".
  }

  let options;
  try {
    options = await getFeatureModelOptions('ai-research');
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to resolve AI Research models', 500);
  }

  let targets;
  try {
    targets = selectModelsToProbe(
      options.allowedModels.map(model => ({ id: model.id, name: model.name })),
      requested,
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Invalid model', 400);
  }

  const results = await Promise.all(
    targets.map(model => probeGatewayModel(model.id, { name: model.name })),
  );

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    results,
  });
}
