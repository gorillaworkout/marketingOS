/** Task types that participate in the shared knowledge graph. */
export const KNOWLEDGE_TASK_TYPES = [
  'social-post',
  'video-script',
  'event-plan',
  'market-research',
  'article-market-news',
  'ai-research',
  'internal-docs',
] as const;

export type KnowledgeTaskType = (typeof KNOWLEDGE_TASK_TYPES)[number];
