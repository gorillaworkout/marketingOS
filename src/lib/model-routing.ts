import { queryOne } from '@/lib/database';
import { resolveDupoinModel, shortlistForFeature, TIER_PRIMARY, tierForFeature } from '@/lib/model-tiers';
import { AVAILABLE_MODELS, CLAUDE_OPUS_5_5_MODEL, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_5_MODEL, CLAUDE_SONNET_5_MODEL, PREFERRED_CODEX_MODEL, WORKING_TEXT_MODELS, type ModelInfo } from '@/lib/openai';

export const GENERATION_FEATURES = [
  'social-post',
  'video-script',
  'event-plan',
  'article-market-news',
  'market-research',
  'ai-research',
  'seo-content',
] as const;

export type GenerationFeature = typeof GENERATION_FEATURES[number];

export interface FeatureMetadata {
  key: GenerationFeature;
  label: string;
  description: string;
  adminOnly: boolean;
}

export const FEATURE_METADATA: Record<GenerationFeature, FeatureMetadata> = {
  'social-post': {
    key: 'social-post',
    label: 'Social Post',
    description: 'Caption and image-prompt generation share this preference.',
    adminOnly: false,
  },
  'video-script': {
    key: 'video-script',
    label: 'Video Script',
    description: 'Scripts, hooks, and supporting generation steps.',
    adminOnly: false,
  },
  'event-plan': {
    key: 'event-plan',
    label: 'Event Plan',
    description: 'Event concepts, plans, and review steps.',
    adminOnly: false,
  },
  'article-market-news': {
    key: 'article-market-news',
    label: 'Article Market News',
    description: 'Publication-ready market news articles.',
    adminOnly: true,
  },
  'market-research': {
    key: 'market-research',
    label: 'Market Research',
    description: 'Market-news selection and research reports.',
    adminOnly: true,
  },
  'ai-research': {
    key: 'ai-research',
    label: 'AI Research Assistant',
    description: 'Ask anything — research, analysis, and Q&A powered by GorillaWorkout LLM.',
    adminOnly: false,
  },
  'seo-content': {
    key: 'seo-content',
    label: 'SEO Content Studio',
    description: 'SEO article drafts and AI rewrites in SEO OS Content Studio.',
    adminOnly: false,
  },
};

/**
 * Account feature that unlocks a generation feature's model preference.
 * Most map to themselves; SEO Content Studio lives inside SEO OS.
 */
export function accountFeatureForGeneration(feature: GenerationFeature): string {
  return feature === 'seo-content' ? 'seo' : feature;
}

/**
 * The feature's historical lead models first (kept so the stored order does
 * not churn), then every other model in WORKING_TEXT_MODELS, without
 * duplicates. Migration 039 appends the same ids to stored allowlists.
 */
function withAllWorkingModels(lead: string[]): string[] {
  return [...new Set([...lead, ...WORKING_TEXT_MODELS])];
}

// Every id here must exist in AVAILABLE_MODELS and pass scripts/probe-gateway-models.ts.
// Every text feature allows every working text model (9router probe, 2026-11-02).
export const DEFAULT_FEATURE_ASSIGNMENTS: Record<GenerationFeature, {
  allowedModels: string[];
  defaultModel: string;
}> = {
  'social-post': {
    allowedModels: withAllWorkingModels(['ag/gemini-3-flash', PREFERRED_CODEX_MODEL, CLAUDE_SONNET_5_MODEL, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_5_MODEL, CLAUDE_OPUS_5_5_MODEL]),
    defaultModel: 'ag/gemini-3-flash',
  },
  'video-script': {
    allowedModels: withAllWorkingModels(['ag/gemini-3-flash', PREFERRED_CODEX_MODEL, CLAUDE_SONNET_5_MODEL, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_5_MODEL, CLAUDE_OPUS_5_5_MODEL]),
    defaultModel: 'ag/gemini-3-flash',
  },
  'event-plan': {
    allowedModels: withAllWorkingModels(['ag/gemini-3-flash', PREFERRED_CODEX_MODEL, CLAUDE_SONNET_5_MODEL, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_5_MODEL, CLAUDE_OPUS_5_5_MODEL]),
    defaultModel: CLAUDE_SONNET_5_5_MODEL,
  },
  'article-market-news': {
    allowedModels: withAllWorkingModels([CLAUDE_SONNET_5_MODEL, 'ag/gemini-3-flash', PREFERRED_CODEX_MODEL, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_5_MODEL, CLAUDE_OPUS_5_5_MODEL]),
    defaultModel: CLAUDE_SONNET_5_5_MODEL,
  },
  'market-research': {
    allowedModels: withAllWorkingModels([CLAUDE_SONNET_5_MODEL, 'ag/gemini-3-flash', PREFERRED_CODEX_MODEL, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_5_MODEL, CLAUDE_OPUS_5_5_MODEL]),
    defaultModel: CLAUDE_SONNET_5_5_MODEL,
  },
  'ai-research': {
    allowedModels: withAllWorkingModels([
      PREFERRED_CODEX_MODEL,
      'cx/gpt-5.6-terra',
      'cx/gpt-5.6-luna',
      'ag/gemini-3-flash',
      CLAUDE_SONNET_5_MODEL,
      CLAUDE_OPUS_5_MODEL,
      CLAUDE_SONNET_5_5_MODEL,
      CLAUDE_OPUS_5_5_MODEL,
    ]),
    defaultModel: PREFERRED_CODEX_MODEL,
  },
  'seo-content': {
    allowedModels: withAllWorkingModels(['ag/gemini-3-flash', PREFERRED_CODEX_MODEL, CLAUDE_SONNET_5_MODEL, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_5_MODEL, CLAUDE_OPUS_5_5_MODEL]),
    defaultModel: CLAUDE_SONNET_5_5_MODEL,
  },
};

interface AssignmentRow {
  allowed_models: unknown;
  default_model: string;
}

export interface FeatureModelOptions {
  feature: GenerationFeature;
  metadata: FeatureMetadata;
  allowedModels: ModelInfo[];
  defaultModel: string;
}

export function isGenerationFeature(value: unknown): value is GenerationFeature {
  return typeof value === 'string'
    && (GENERATION_FEATURES as readonly string[]).includes(value);
}

export function isGatewayModel(modelId: unknown): modelId is string {
  return typeof modelId === 'string'
    && AVAILABLE_MODELS.some(model => model.id === modelId);
}

export function validateFeatureAssignment(
  feature: unknown,
  allowedModels: unknown,
  defaultModel: unknown,
): { feature: GenerationFeature; allowedModels: string[]; defaultModel: string } {
  if (!isGenerationFeature(feature)) throw new Error('Invalid feature');
  if (!Array.isArray(allowedModels) || allowedModels.length === 0) {
    throw new Error('Allowed models must be a nonempty array');
  }
  if (!allowedModels.every(isGatewayModel) || !isGatewayModel(defaultModel)) {
    throw new Error('Invalid model');
  }
  if (new Set(allowedModels).size !== allowedModels.length) {
    throw new Error('Allowed models must be unique');
  }
  if (!allowedModels.includes(defaultModel)) {
    throw new Error('Default model must be included in allowed models');
  }
  return { feature, allowedModels: [...allowedModels], defaultModel };
}

export async function getFeatureModelOptions(feature: GenerationFeature): Promise<FeatureModelOptions> {
  const catalogById = new Map(AVAILABLE_MODELS.map(model => [model.id, model]));
  const tier = tierForFeature(feature);
  const shortlist = shortlistForFeature(feature).filter(modelId => catalogById.has(modelId));
  const primary = tier ? TIER_PRIMARY[tier] : DEFAULT_FEATURE_ASSIGNMENTS[feature].defaultModel;
  let orgDefault = primary;
  try {
    const row = await queryOne<AssignmentRow>(
      'SELECT allowed_models, default_model FROM feature_model_assignments WHERE feature_key = ?',
      [feature],
    );
    if (row?.default_model && shortlist.includes(row.default_model)) orgDefault = row.default_model;
  } catch {
    orgDefault = primary;
  }
  if (orgDefault === primary && tier) {
    try {
      const tierRow = await queryOne<{ dupoin_primary: string }>('SELECT dupoin_primary FROM llm_tier_config WHERE tier = ?', [tier]);
      if (tierRow?.dupoin_primary && shortlist.includes(tierRow.dupoin_primary)) orgDefault = tierRow.dupoin_primary;
    } catch {
      orgDefault = primary;
    }
  }

  return {
    feature,
    metadata: FEATURE_METADATA[feature],
    allowedModels: shortlist.map(modelId => catalogById.get(modelId)!),
    defaultModel: resolveDupoinModel({ preference: null, orgDefault, primary, shortlist }),
  };
}

export async function resolveFeatureModel(
  userId: string,
  feature: GenerationFeature,
): Promise<string> {
  const options = await getFeatureModelOptions(feature);
  const preference = await queryOne<{ model: string }>(
    'SELECT model FROM task_model_preferences WHERE user_id = ? AND task_type = ?',
    [userId, feature],
  );
  if (preference && options.allowedModels.some(model => model.id === preference.model)) {
    return preference.model;
  }
  return options.defaultModel;
}

