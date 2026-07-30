import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/database';
import { getAuthorizedUser } from '@/lib/auth';
import {
  GENERATION_FEATURES,
  getFeatureModelOptions,
  isGenerationFeature,
  resolveFeatureModel,
} from '@/lib/model-routing';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  const auth = await getAuthorizedUser(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const visibleFeatures = GENERATION_FEATURES.filter(feature => (
    auth.role === 'admin'
    || (!['article-market-news', 'market-research'].includes(feature)
      && auth.features.some(enabledFeature => enabledFeature === feature))
  ));

  const features = await Promise.all(visibleFeatures.map(async feature => {
    const options = await getFeatureModelOptions(feature);
    const currentModel = await resolveFeatureModel(auth.id, feature);
    return {
      feature,
      label: options.metadata.label,
      description: options.metadata.description,
      allowedModels: options.allowedModels,
      currentModel,
      defaultModel: options.defaultModel,
    };
  }));

  return NextResponse.json({ features });
}

export async function PUT(request: NextRequest) {
  const auth = await getAuthorizedUser(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { feature, model } = await request.json() as { feature?: unknown; model?: unknown };
  if (!isGenerationFeature(feature)) {
    return NextResponse.json({ error: 'Invalid feature' }, { status: 400 });
  }
  if (auth.role !== 'admin' && !auth.features.some(enabledFeature => enabledFeature === feature)) {
    return NextResponse.json({ error: 'Forbidden: feature is not enabled for this user' }, { status: 403 });
  }

  if (model === null) {
    await execute(
      'DELETE FROM task_model_preferences WHERE user_id = ? AND task_type = ?',
      [auth.id, feature],
    );
    const currentModel = await resolveFeatureModel(auth.id, feature);
    return NextResponse.json({ success: true, feature, currentModel, reset: true });
  }

  const options = await getFeatureModelOptions(feature);
  if (typeof model !== 'string' || !options.allowedModels.some(option => option.id === model)) {
    return NextResponse.json({ error: 'Model is not enabled for this feature' }, { status: 400 });
  }

  await execute(
    `INSERT INTO task_model_preferences (id, user_id, task_type, model, provider, updated_at)
     VALUES (?, ?, ?, ?, 'gorillaworkout', CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, task_type) DO UPDATE SET
       model = excluded.model,
       provider = 'gorillaworkout',
       updated_at = CURRENT_TIMESTAMP`,
    [uuidv4(), auth.id, feature, model],
  );

  return NextResponse.json({ success: true, feature, currentModel: model });
}
