import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/database';
import { AVAILABLE_IMAGE_MODELS, DEFAULT_IMAGE_MODEL, livePaidImageModels, resolveAssignedImageModels } from '@/lib/image-models';
import { getLlmSettings } from '@/lib/llm-provider-store';
import { activeImageQuotaStates } from '@/lib/image-quota';

/** Models still out of quota (server memory), keyed by id, with the reset time as ISO or null. */
function quotaSnapshot(): Record<string, { resetAt: string | null }> {
  const out: Record<string, { resetAt: string | null }> = {};
  for (const state of activeImageQuotaStates()) {
    out[state.model] = { resetAt: state.resetAt ? new Date(state.resetAt).toISOString() : null };
  }
  return out;
}

/**
 * Image model picker. `models` stays the free catalog (filtered by the admin
 * assignment) so existing callers are unchanged. `paidModels` lists the paid
 * OpenRouter models; `paidEnabled` says whether the AI Models paid toggle is
 * on. Paid models are never the default. `quota` lists models that are
 * still out of quota and when they reset; they stay selectable (fallback).
 */
export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  }

  // Paid ids stay disabled unless the toggle is on AND an OpenRouter key is saved.
  const paidEnabled = await getLlmSettings()
    .then(settings => settings.usePaidOpenRouter === true && settings.openrouterKey.trim().length > 0)
    .catch(() => false);
  const paidModels = livePaidImageModels();

  try {
    const assignment = await queryOne<{ allowed_models: string; default_model: string }>(
      'SELECT allowed_models, default_model FROM image_model_assignments WHERE id = ?',
      ['default']
    );

    if (!assignment) {
      return NextResponse.json({
        models: AVAILABLE_IMAGE_MODELS,
        defaultModel: DEFAULT_IMAGE_MODEL,
        paidModels,
        paidEnabled,
        quota: quotaSnapshot(),
      });
    }

    const allowedModelIds = JSON.parse(assignment.allowed_models) as string[];
    const resolved = resolveAssignedImageModels(allowedModelIds, assignment.default_model);

    return NextResponse.json({
      models: resolved.models,
      defaultModel: resolved.defaultModel,
      paidModels,
      paidEnabled,
      quota: quotaSnapshot(),
    });
  } catch (error) {
    console.error('Failed to fetch image models:', error);
    return NextResponse.json({ error: 'Failed to load image models' }, { status: 500 });
  }
}
