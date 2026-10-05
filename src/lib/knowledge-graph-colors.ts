import { ACCOUNT_FEATURE_LABELS } from '@/lib/authorization';
import { KNOWLEDGE_TASK_TYPES, type KnowledgeTaskType } from '@/lib/knowledge-task-types';

/** Dupoin brand teal. Reserved for AI Research nodes. */
export const DUPOIN_TEAL = '#2EB5C4';

export const KNOWLEDGE_FEATURE_OTHER = 'other' as const;

export type KnowledgeFeatureKey = KnowledgeTaskType | typeof KNOWLEDGE_FEATURE_OTHER;

/**
 * Fixed colors for knowledge-graph nodes, keyed by `knowledge_entries.task_type`.
 * Chosen to stay bright and separable on the dark canvas (`#08090c`).
 * Unknown or missing task types share `other`.
 */
export const KNOWLEDGE_FEATURE_COLORS: Record<KnowledgeFeatureKey, string> = {
  'ai-research': DUPOIN_TEAL,
  'social-post': '#C084FC',
  'video-script': '#FACC15',
  'event-plan': '#FB7185',
  'article-market-news': '#60A5FA',
  'market-research': '#F97316',
  'internal-docs': '#4ADE80',
  'user-memory': '#C026D3',
  'ai-research-qa': '#84CC16',
  other: '#94A3B8',
};

const FEATURE_LABELS: Record<KnowledgeFeatureKey, string> = {
  'ai-research': ACCOUNT_FEATURE_LABELS['ai-research'],
  'social-post': ACCOUNT_FEATURE_LABELS['social-post'],
  'video-script': ACCOUNT_FEATURE_LABELS['video-script'],
  'event-plan': ACCOUNT_FEATURE_LABELS['event-plan'],
  'article-market-news': ACCOUNT_FEATURE_LABELS['article-market-news'],
  'market-research': ACCOUNT_FEATURE_LABELS['market-research'],
  'internal-docs': ACCOUNT_FEATURE_LABELS['internal-docs'],
  'user-memory': 'User Memory',
  'ai-research-qa': 'Research Q&A',
  other: 'Other',
};

const KNOWN_TASK_TYPES = new Set<string>(KNOWLEDGE_TASK_TYPES);

const FEATURE_ORDER: KnowledgeFeatureKey[] = [...KNOWLEDGE_TASK_TYPES, KNOWLEDGE_FEATURE_OTHER];

export type KnowledgeFeatureSwatch = {
  key: KnowledgeFeatureKey;
  label: string;
  color: string;
};

export function knowledgeFeatureKey(taskType: string | null | undefined): KnowledgeFeatureKey {
  const value = (taskType || '').trim();
  return KNOWN_TASK_TYPES.has(value) ? value as KnowledgeTaskType : KNOWLEDGE_FEATURE_OTHER;
}

export function knowledgeFeatureLabel(taskType: string | null | undefined): string {
  return FEATURE_LABELS[knowledgeFeatureKey(taskType)];
}

export function knowledgeFeatureColor(taskType: string | null | undefined): string {
  return KNOWLEDGE_FEATURE_COLORS[knowledgeFeatureKey(taskType)];
}

export function knowledgeFeatureColorWithAlpha(taskType: string | null | undefined, alpha: number): string {
  const hex = knowledgeFeatureColor(taskType);
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${red}, ${green}, ${blue}, ${clamped})`;
}

/** Legend entries for features that actually appear, in a stable product order. */
export function knowledgeFeaturesInGraph(taskTypes: Iterable<string | null | undefined>): KnowledgeFeatureSwatch[] {
  const present = new Set<KnowledgeFeatureKey>();
  for (const taskType of taskTypes) present.add(knowledgeFeatureKey(taskType));
  return FEATURE_ORDER.filter(key => present.has(key)).map(key => ({
    key,
    label: FEATURE_LABELS[key],
    color: KNOWLEDGE_FEATURE_COLORS[key],
  }));
}
