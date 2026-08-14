import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/database';

// Codex image models served by the GorillaWorkout gateway (one-door). The
// gateway maps these to the connected Codex (ChatGPT) account. gpt-5.3-image
// is rejected on a ChatGPT account, so only 5.5 and 5.4 are offered.
const AVAILABLE_IMAGE_MODELS = [
  { id: 'cx/gpt-5.5-image', name: 'GPT-5.5 Image', description: 'Codex · image generation · high quality' },
  { id: 'cx/gpt-5.4-image', name: 'GPT-5.4 Image', description: 'Codex · image generation · balanced' },
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
        defaultModel: 'cx/gpt-5.5-image',
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
