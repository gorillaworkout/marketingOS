export const GENERATION_FEATURES = [
  'social-post',
  'video-script',
  'event-plan',
  'article-market-news',
  'market-research',
  'ai-research',
] as const;
export type GenerationFeature = typeof GENERATION_FEATURES[number];

export interface FeaturePrincipal {
  role: string;
  features: readonly string[];
}

export function isGenerationFeature(value: string): value is GenerationFeature {
  return (GENERATION_FEATURES as readonly string[]).includes(value);
}

export function canAccessFeature(principal: FeaturePrincipal, feature: GenerationFeature): boolean {
  return principal.role === 'admin' || principal.features.includes(feature);
}

export function enabledFeaturesForUser(principal: FeaturePrincipal): GenerationFeature[] {
  return GENERATION_FEATURES.filter(feature => canAccessFeature(principal, feature));
}
