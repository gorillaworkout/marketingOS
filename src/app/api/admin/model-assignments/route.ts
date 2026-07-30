import { NextRequest, NextResponse } from 'next/server';
import { executeTransaction } from '@/lib/database';
import { requireAdmin } from '@/lib/auth';
import { AVAILABLE_MODELS } from '@/lib/openai';
import {
  GENERATION_FEATURES,
  getFeatureModelOptions,
  validateFeatureAssignment,
} from '@/lib/model-routing';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const assignments = await Promise.all(
    GENERATION_FEATURES.map(feature => getFeatureModelOptions(feature)),
  );
  return NextResponse.json({ assignments, models: AVAILABLE_MODELS });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await request.json() as {
      feature?: unknown;
      allowedModels?: unknown;
      defaultModel?: unknown;
    };
    const assignment = validateFeatureAssignment(
      body.feature,
      body.allowedModels,
      body.defaultModel,
    );

    await executeTransaction(async transaction => {
      await transaction.execute(
        `INSERT INTO feature_model_assignments (
           feature_key, allowed_models, default_model, updated_at
         ) VALUES (?, ?::jsonb, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(feature_key) DO UPDATE SET
           allowed_models = excluded.allowed_models,
           default_model = excluded.default_model,
           updated_at = CURRENT_TIMESTAMP`,
        [assignment.feature, JSON.stringify(assignment.allowedModels), assignment.defaultModel],
      );
      await transaction.execute(
        `UPDATE task_model_preferences
         SET model = ?, provider = 'gorillaworkout', updated_at = CURRENT_TIMESTAMP
         WHERE task_type = ? AND NOT (model = ANY(?::text[]))`,
        [assignment.defaultModel, assignment.feature, assignment.allowedModels],
      );
    });

    return NextResponse.json({
      success: true,
      assignment: await getFeatureModelOptions(assignment.feature),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid model assignment';
    const validationError = /Invalid feature|Invalid model|Allowed models|Default model/.test(message);
    return NextResponse.json(
      { error: validationError ? message : 'Unable to save model assignment' },
      { status: validationError ? 400 : 500 },
    );
  }
}
