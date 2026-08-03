import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { queryOne, execute } from '@/lib/database';

// Codex chat models that can drive the built-in image_gen tool. gpt-image-2 is the
// tool's own name, not a selectable model: Codex rejects it on a ChatGPT account
// ("model is not supported when using Codex with a ChatGPT account").
const AVAILABLE_IMAGE_MODELS = [
  { id: 'gpt-5.6-terra', name: 'gpt-5.6-terra', description: 'Codex · image_gen tool · high quality' },
];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const assignment = await queryOne<{ allowed_models: string; default_model: string }>(
      'SELECT allowed_models, default_model FROM image_model_assignments WHERE id = ?',
      ['default']
    );

    if (!assignment) {
      return NextResponse.json({
        availableModels: AVAILABLE_IMAGE_MODELS,
        allowedModels: AVAILABLE_IMAGE_MODELS.map(m => m.id),
        defaultModel: 'gpt-5.6-terra',
      });
    }

    const allowedModels = JSON.parse(assignment.allowed_models) as string[];

    return NextResponse.json({
      availableModels: AVAILABLE_IMAGE_MODELS,
      allowedModels,
      defaultModel: assignment.default_model,
    });
  } catch (error) {
    console.error('Failed to fetch image model assignment:', error);
    return NextResponse.json({ error: 'Failed to load image model settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const body = await request.json() as { allowedModels?: unknown; defaultModel?: unknown };

    if (!Array.isArray(body.allowedModels) || body.allowedModels.length === 0) {
      return NextResponse.json({ error: 'At least one model must be allowed' }, { status: 400 });
    }

    if (typeof body.defaultModel !== 'string' || !body.allowedModels.includes(body.defaultModel)) {
      return NextResponse.json({ error: 'Default model must be one of the allowed models' }, { status: 400 });
    }

    const allowedModels = body.allowedModels.filter(id => 
      typeof id === 'string' && AVAILABLE_IMAGE_MODELS.some(m => m.id === id)
    );

    if (allowedModels.length === 0) {
      return NextResponse.json({ error: 'No valid models selected' }, { status: 400 });
    }

    await execute(
      `INSERT INTO image_model_assignments (id, allowed_models, default_model, updated_by, updated_at)
       VALUES ('default', ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET 
         allowed_models = excluded.allowed_models,
         default_model = excluded.default_model,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(allowedModels), body.defaultModel, 'id' in auth ? auth.id : null]
    );

    return NextResponse.json({
      success: true,
      allowedModels,
      defaultModel: body.defaultModel,
    });
  } catch (error) {
    console.error('Failed to save image model assignment:', error);
    return NextResponse.json({ error: 'Failed to save image model settings' }, { status: 500 });
  }
}
