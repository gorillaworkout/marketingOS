import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/database';

// Codex chat models that can drive the built-in image_gen tool. gpt-image-2 is the
// tool's own name, not a selectable model: Codex rejects it on a ChatGPT account
// ("model is not supported when using Codex with a ChatGPT account").
const AVAILABLE_IMAGE_MODELS = [
  { id: 'gpt-5.6-terra', name: 'gpt-5.6-terra', description: 'Codex · image_gen tool · high quality' },
];

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  }

  try {
    const assignment = await queryOne<{ allowed_models: string; default_model: string }>(
      'SELECT allowed_models, default_model FROM image_model_assignments WHERE id = ?',
      ['default']
    );

    if (!assignment) {
      // Fallback: all models allowed
      return NextResponse.json({
        models: AVAILABLE_IMAGE_MODELS,
        defaultModel: 'gpt-5.6-terra',
      });
    }

    const allowedModelIds = JSON.parse(assignment.allowed_models) as string[];
    const allowedModels = AVAILABLE_IMAGE_MODELS.filter(m => allowedModelIds.includes(m.id));

    return NextResponse.json({
      models: allowedModels,
      defaultModel: assignment.default_model,
    });
  } catch (error) {
    console.error('Failed to fetch image models:', error);
    return NextResponse.json({ error: 'Failed to load image models' }, { status: 500 });
  }
}
