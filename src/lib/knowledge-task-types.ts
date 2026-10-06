/** Task types that participate in the shared knowledge graph. */
export const KNOWLEDGE_TASK_TYPES = [
  'social-post',
  'video-script',
  'event-plan',
  'market-research',
  'article-market-news',
  'ai-research',
  'internal-docs',
  'user-memory',
  'ai-research-qa',
  'imported-chat',
] as const;

export const USER_MEMORY_TASK_TYPE = 'user-memory' as const;
export const AI_RESEARCH_QA_TASK_TYPE = 'ai-research-qa' as const;
export const IMPORTED_CHAT_TASK_TYPE = 'imported-chat' as const;

export type KnowledgeTaskType = (typeof KNOWLEDGE_TASK_TYPES)[number];

/**
 * Knowledge-graph task types AI Research may retrieve.
 * Social captions, video scripts, and event plans stay out so promo copy
 * cannot outrank a saved research fact. FAQ/guide rows use internal-docs;
 * article-market-news is the other saved knowledge type.
 */
export const AI_RESEARCH_RETRIEVAL_TASK_TYPES = [
  'ai-research',
  'market-research',
  'internal-docs',
  'article-market-news',
] as const;

/** Drop weak knowledge-graph hits before they enter the research prompt. */
export const AI_RESEARCH_KNOWLEDGE_MIN_SCORE = 0.28;
