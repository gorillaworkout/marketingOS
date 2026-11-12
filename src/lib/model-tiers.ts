/**
 * One tier per workflow. Dupoin primaries stay on the short list.
 * OpenRouter text uses the free chain, with an optional paid model in front.
 */

export const TEXT_SHORTLIST = [
  'cc/claude-sonnet-5-5',
  'cc/claude-opus-5-5',
  'cx/gpt-5.6-sol',
  'ag/gemini-3-flash',
] as const;

export const IMAGE_SHORTLIST = ['ag/gemini-3.1-flash-image'] as const;

/** Verified on https://openrouter.ai/api/v1/models on 2026-11-12. Gemma is not in this chain. */
export const FREE_TEXT_CHAIN = [
  'thinkingmachines/inkling-2-small:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'openrouter/free',
] as const;

export const MODEL_TIERS = ['smart', 'fast', 'research', 'image'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const TIER_FEATURES: Record<Exclude<ModelTier, 'image'>, readonly string[]> = {
  smart: ['event-plan', 'article-market-news', 'market-research', 'seo-content'],
  fast: ['social-post', 'video-script'],
  research: ['ai-research'],
};

export const TIER_PRIMARY: Record<ModelTier, string> = {
  smart: 'cc/claude-sonnet-5-5',
  fast: 'ag/gemini-3-flash',
  research: 'cx/gpt-5.6-sol',
  image: 'ag/gemini-3.1-flash-image',
};

/** Verified paid ids. Image always needs OpenRouter credits. */
export const TIER_PAID_TARGET: Record<ModelTier, string> = {
  smart: 'anthropic/claude-sonnet-5.5',
  fast: 'anthropic/claude-haiku-5.5',
  research: 'openai/gpt-6.1-sol',
  image: 'google/gemini-3.1-flash-image',
};

export const PAID_TARGET_CHOICES: Record<ModelTier, readonly string[]> = {
  smart: ['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5'],
  fast: ['anthropic/claude-haiku-5.5', 'google/gemini-3-flash-preview'],
  research: ['openai/gpt-6.1-sol', 'openai/gpt-5.6-sol'],
  image: ['google/gemini-3.1-flash-image'],
};

const PAID_VERIFIED = new Set([
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-opus-5.5',
  'anthropic/claude-haiku-5.5',
  'google/gemini-3-flash-preview',
  'openai/gpt-6.1-sol',
  'openai/gpt-5.6-sol',
  'google/gemini-3.1-flash-image',
]);

export function isVerifiedPaidTarget(tier: ModelTier, model: string): boolean {
  return PAID_TARGET_CHOICES[tier].includes(model) && PAID_VERIFIED.has(model);
}

export function tierForFeature(feature: string): ModelTier | null {
  if (feature === 'image') return 'image';
  for (const tier of ['smart', 'fast', 'research'] as const) {
    if ((TIER_FEATURES[tier] as readonly string[]).includes(feature)) return tier;
  }
  return null;
}

export function shortlistForFeature(feature: string): readonly string[] {
  return tierForFeature(feature) === 'image' ? IMAGE_SHORTLIST : TEXT_SHORTLIST;
}

export function resolveDupoinModel(input: {
  preference: string | null | undefined;
  orgDefault: string | null | undefined;
  primary: string;
  shortlist: readonly string[];
}): string {
  if (input.preference && input.shortlist.includes(input.preference)) return input.preference;
  if (input.orgDefault && input.shortlist.includes(input.orgDefault)) return input.orgDefault;
  return input.primary;
}

export function openRouterChainForTier(input: {
  tier: ModelTier;
  usePaid: boolean;
  freeChain: readonly string[];
  paidTarget?: string;
}): string[] {
  const paid = input.tier === 'image'
    ? [input.paidTarget || TIER_PAID_TARGET.image]
    : (input.usePaid ? [input.paidTarget || TIER_PAID_TARGET[input.tier]] : []);
  const rest = input.tier === 'image' ? [] : input.freeChain;
  const chain: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...paid, ...rest]) {
    const model = candidate.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    chain.push(model);
    if (chain.length >= 8) break;
  }
  return chain;
}

export type InUseModel = {
  provider: 'dupoin' | 'openrouter';
  model: string;
  kind: 'chat' | 'image' | 'embedding';
};

/** Unique models the health table should probe. Image stays out unless asked. */
export function modelsInUse(input: {
  primaries: readonly string[];
  freeChain: readonly string[];
  paidTargets: readonly string[];
  usePaid: boolean;
  embeddingModel: string;
  imageModel: string;
  includeImages: boolean;
}): InUseModel[] {
  const rows: InUseModel[] = [];
  const seen = new Set<string>();
  const add = (provider: InUseModel['provider'], model: string, kind: InUseModel['kind']) => {
    const id = model.trim();
    if (!id || (kind === 'image' && !input.includeImages)) return;
    const key = `${provider}:${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ provider, model: id, kind });
  };
  for (const model of input.primaries) add('dupoin', model, model === input.imageModel ? 'image' : 'chat');
  for (const model of input.freeChain) add('openrouter', model, 'chat');
  if (input.usePaid) for (const model of input.paidTargets) add('openrouter', model, model === TIER_PAID_TARGET.image ? 'image' : 'chat');
  add('openrouter', input.embeddingModel, 'embedding');
  if (input.includeImages) add('dupoin', input.imageModel, 'image');
  return rows;
}
