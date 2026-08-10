import { queryOne } from '@/lib/database';
import { AVAILABLE_MODELS, type ModelInfo } from '@/lib/openai';

export const GENERATION_FEATURES = [
  'social-post',
  'video-script',
  'event-plan',
  'article-market-news',
  'market-research',
  'ai-research',
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
};

const DEFAULT_FEATURE_ASSIGNMENTS: Record<GenerationFeature, {
  allowedModels: string[];
  defaultModel: string;
}> = {
  'social-post': {
    allowedModels: ['pecut-free', 'ag/gemini-3-flash-agent', 'cc/claude-sonnet-5'],
    defaultModel: 'pecut-free',
  },
  'video-script': {
    allowedModels: ['pecut-free', 'ag/gemini-3-flash-agent', 'cc/claude-sonnet-5'],
    defaultModel: 'ag/gemini-3-flash-agent',
  },
  'event-plan': {
    allowedModels: ['pecut-free', 'ag/gemini-3-flash-agent', 'cc/claude-sonnet-5'],
    defaultModel: 'ag/gemini-3-flash-agent',
  },
  'article-market-news': {
    allowedModels: ['ag/claude-sonnet-4-6', 'cc/claude-sonnet-5', 'cx/gpt-5.6-sol'],
    defaultModel: 'cx/gpt-5.6-sol',
  },
  'market-research': {
    allowedModels: ['ag/claude-sonnet-4-6', 'cc/claude-sonnet-5', 'cx/gpt-5.6-sol'],
    defaultModel: 'cx/gpt-5.6-sol',
  },
  'ai-research': {
    allowedModels: ['pecut-free', 'ag/gemini-3-flash-agent', 'cc/claude-sonnet-5'],
    defaultModel: 'ag/gemini-3-flash-agent',
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

function parseAllowedModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
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
  let assignment = DEFAULT_FEATURE_ASSIGNMENTS[feature];

  const row = await queryOne<AssignmentRow>(
    'SELECT allowed_models, default_model FROM feature_model_assignments WHERE feature_key = ?',
    [feature],
  );
  if (row) {
    const allowedModels = [...new Set(parseAllowedModels(row.allowed_models))]
      .filter(modelId => catalogById.has(modelId));
    if (allowedModels.length === 0 || !allowedModels.includes(row.default_model)) {
      throw new Error(`Invalid model assignment for ${feature}`);
    }
    assignment = { allowedModels, defaultModel: row.default_model };
  }

  return {
    feature,
    metadata: FEATURE_METADATA[feature],
    allowedModels: assignment.allowedModels.map(modelId => catalogById.get(modelId)!),
    defaultModel: assignment.defaultModel,
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

