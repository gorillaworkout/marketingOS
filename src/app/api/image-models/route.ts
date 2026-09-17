import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/database';
import { AVAILABLE_IMAGE_MODELS, DEFAULT_IMAGE_MODEL, resolveAssignedImageModels } from '@/lib/image-models';

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
      return NextResponse.json({
        models: AVAILABLE_IMAGE_MODELS,
        defaultModel: DEFAULT_IMAGE_MODEL,
      });
    }

    const allowedModelIds = JSON.parse(assignment.allowed_models) as string[];
    const resolved = resolveAssignedImageModels(allowedModelIds, assignment.default_model);

    return NextResponse.json({
      models: resolved.models,
      defaultModel: resolved.defaultModel,
    });
  } catch (error) {
    console.error('Failed to fetch image models:', error);
    return NextResponse.json({ error: 'Failed to load image models' }, { status: 500 });
  }
}
