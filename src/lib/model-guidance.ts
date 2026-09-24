import type { GenerationFeature } from '@/lib/model-routing';

export type GuidanceLevel = 'excellent' | 'good' | 'specialist' | 'limited';

export interface ModelGuidance {
  family: 'Gemini' | 'Claude' | 'GPT / Codex' | 'GorillaWorkout';
  summary: string;
  strengths: string[];
  tradeoffs: string[];
  bestFor: string[];
  speed: 'Fast' | 'Moderate' | 'Deliberate' | 'Variable';
  reasoning: 'Light' | 'Balanced' | 'Deep';
  workflowFit: Record<GenerationFeature, GuidanceLevel>;
  note: string;
}

const BASE_FIT: Record<GenerationFeature, GuidanceLevel> = {
  'social-post': 'good',
  'video-script': 'good',
  'event-plan': 'good',
  'article-market-news': 'good',
  'market-research': 'good',
  'ai-research': 'good',
};

function fit(overrides: Partial<Record<GenerationFeature, GuidanceLevel>>): Record<GenerationFeature, GuidanceLevel> {
  return { ...BASE_FIT, ...overrides };
}

/** Operational guidance for MarketingOS; this is not a vendor benchmark or universal quality ranking. */
export function getModelGuidance(modelId: string): ModelGuidance {
  const lower = modelId.toLowerCase();

  if (lower.includes('gemini')) {
    const pro = lower.includes('pro');
    const low = lower.includes('low');
    return {
      family: 'Gemini',
      summary: pro ? 'General-purpose model for more complex synthesis and long structure.' : 'Fast model for content iteration, hook variations, and multi-step workflows.',
      strengths: pro
        ? ['Complex brief synthesis', 'Long structure stays more intact', 'Fits planning and review']
        : ['Fast responses', 'Efficient at producing several options', 'Good for structured output and visual ideas'],
      tradeoffs: pro
        ? ['Slower than the Flash variants', 'More than a simple caption needs', 'Market claims still need a fact check']
        : ['Copy can feel generic without a brand example', 'Deep reasoning is more limited', low ? 'The low-compute variant needs tighter QC' : 'Complex long-form needs review'],
      bestFor: pro ? ['Event plan', 'Long-form outline', 'Complex brief synthesis'] : ['Social Post', 'Video Script preview', 'Image prompt', 'High-volume iteration'],
      speed: pro ? 'Moderate' : 'Fast', reasoning: pro ? 'Deep' : 'Balanced',
      workflowFit: fit({
        'social-post': pro ? 'good' : 'excellent',
        'video-script': pro ? 'good' : 'excellent',
        'event-plan': pro ? 'excellent' : 'good',
        'article-market-news': pro ? 'good' : 'limited',
        'market-research': pro ? 'good' : 'limited',
      }),
      note: 'Operational guidance based on variant character and MarketingOS use; not a vendor benchmark.',
    };
  }

  if (lower.includes('claude')) {
    const opus = lower.includes('opus');
    const haiku = lower.includes('haiku');
    const thinking = lower.includes('thinking');
    return {
      family: 'Claude',
      summary: opus || thinking ? 'Deliberative model for editorial judgment, reasoning, and ambiguous briefs.' : haiku ? 'Light model for fast drafts and copy transforms.' : 'Writing-first model for nuanced copy, narrative, and editorial structure.',
      strengths: opus || thinking
        ? ['Deep reasoning', 'Handles complex instructions', 'Strong for critique and editorial review']
        : haiku
          ? ['Fast for rewrites', 'Efficient for classification', 'Fits short drafts']
          : ['Natural writing and tone', 'Storytelling and narrative flow', 'Follows style guidance well'],
      tradeoffs: opus || thinking
        ? ['Slower', 'Overkill for routine captions', 'Output can run long without a firm limit']
        : haiku
          ? ['Nuance and reasoning are more limited', 'Less suited to complex reports', 'Needs editorial QC']
          : ['Can be verbose', 'Needs an explicit schema or length', 'Market facts still have to stay tied to sources'],
      bestFor: opus || thinking ? ['Market research synthesis', 'Editorial review', 'Complex event plan'] : haiku ? ['Rewrite', 'Short caption draft', 'Content classification'] : ['Human-sounding Social Post', 'Video Script narration', 'Article structure'],
      speed: haiku ? 'Fast' : opus || thinking ? 'Deliberate' : 'Moderate', reasoning: opus || thinking ? 'Deep' : haiku ? 'Light' : 'Balanced',
      workflowFit: fit({
        'social-post': opus ? 'good' : haiku ? 'good' : 'excellent',
        'video-script': opus ? 'good' : haiku ? 'good' : 'excellent',
        'event-plan': opus || thinking ? 'excellent' : 'good',
        'article-market-news': haiku ? 'limited' : 'excellent',
        'market-research': opus || thinking ? 'excellent' : haiku ? 'limited' : 'good',
      }),
      note: 'Writing strengths are an internal selection guide; actual quality still depends on the prompt, source evidence, and human QC.',
    };
  }

  if (lower.startsWith('cx/') || lower.includes('gpt') || lower.includes('codex')) {
    const review = lower.includes('review');
    const mini = lower.includes('mini') || lower.includes('spark') || lower.includes('luna');
    const sol = lower.includes('sol');
    return {
      family: 'GPT / Codex',
      summary: review ? 'Review variant for checking structure, consistency, and weak spots in a draft.' : mini ? 'Compact variant for fast, structured work.' : 'General reasoning model for analysis, structure, and tightly constrained output.',
      strengths: review
        ? ['Critique and quality review', 'Spots inconsistencies', 'Fits a second pass']
        : mini
          ? ['Fast and economical', 'Good for simple schemas', 'Fits high volume']
          : ['Structured reasoning', 'Follows complex constraints', 'Good for research selection and planning'],
      tradeoffs: review
        ? ['Not the first choice for a creative draft', 'Adds a workflow step', 'Still needs a human reviewer']
        : mini
          ? ['Copy nuance is more limited', 'Complex analysis needs a larger model', 'Long-form needs QC']
          : ['Can sound formal for social copy', sol ? 'Premium tier for routine tasks' : 'Latency depends on the model', 'Does not replace source verification'],
      bestFor: review ? ['Draft review', 'Compliance pass', 'Editorial critique'] : mini ? ['Classification', 'Outline', 'Structured extraction'] : ['Market Research', 'Article Market News', 'Event planning', 'Complex structured output'],
      speed: mini ? 'Fast' : sol ? 'Deliberate' : 'Moderate', reasoning: mini ? 'Balanced' : 'Deep',
      workflowFit: fit({
        'social-post': review ? 'limited' : mini ? 'good' : 'good',
        'video-script': review ? 'specialist' : 'good',
        'event-plan': review ? 'specialist' : 'excellent',
        'article-market-news': review ? 'specialist' : mini ? 'good' : 'excellent',
        'market-research': review ? 'specialist' : mini ? 'good' : 'excellent',
        'ai-research': review ? 'specialist' : sol ? 'excellent' : 'good',
      }),
      note: review ? 'Use it after the main draft, not as the default generator.' : 'Internal guidance; the model must not invent sources, quotations, or market facts.',
    };
  }

  return {
    family: 'GorillaWorkout', summary: 'General-purpose gateway model that does not have a specific usage profile yet.',
    strengths: ['Available through one gateway', 'Can be tested per workflow'], tradeoffs: ['Not enough internal observation yet', 'Needs a pilot and user ratings'],
    bestFor: ['Controlled pilot'], speed: 'Variable', reasoning: 'Balanced', workflowFit: BASE_FIT,
    note: 'Early guidance; not a vendor benchmark. Evaluate it on a real brief before making it the default.',
  };
}

export const FIT_LABELS: Record<GuidanceLevel, string> = {
  excellent: 'Highly recommended', good: 'Recommended', specialist: 'Specialist / second pass', limited: 'Use with caution',
};

export const GUIDANCE_FEATURE_LABELS: Record<GenerationFeature, string> = {
  'social-post': 'Social Post', 'video-script': 'Video Script', 'event-plan': 'Event Plan',
  'article-market-news': 'Article Market News', 'market-research': 'Market Research',
  'ai-research': 'AI Research Assistant',
};

export const MODEL_GUIDANCE_DISCLAIMER = 'Operational guidance for MarketingOS; not a vendor benchmark or universal quality ranking.';
