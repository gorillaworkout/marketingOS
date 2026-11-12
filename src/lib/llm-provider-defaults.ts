/**
 * Dupoin → OpenRouter ids checked against the public catalog
 * https://openrouter.ai/api/v1/models and the image catalog
 * https://openrouter.ai/api/v1/images/models (no API key).
 * Ids that are not in those catalogs are not invented here; unmapped Dupoin
 * models use the admin-selected default substitute.
 */

export type LlmMode = 'dupoin' | 'openrouter' | 'auto';
export type LlmKind = 'chat' | 'image' | 'embedding';
export type UsageProvider = 'gorillaworkout' | 'openrouter';

export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
/** Verified on https://openrouter.ai/api/v1/models. No paid id is the default. */
export const DEFAULT_OPENROUTER_CHAT_MODEL = 'thinkingmachines/inkling-2-small:free';
/** Tried in order on 429, 404, or no credits. Each id once. Gemma is not included. */
export const DEFAULT_OPENROUTER_CHAT_FALLBACKS = [
  'thinkingmachines/inkling-2-small:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'openrouter/free',
] as const;
/** Free text ids from https://openrouter.ai/api/v1/models on 2026-11-12. Gemma is omitted on purpose. */
export const OPENROUTER_FREE_CHAT_MODELS = [
  'thinkingmachines/inkling-2-small:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'openrouter/free',
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'liquid/lfm-2.5-2.6b:free',
  'cohere/north-mini-code:free',
] as const;
/** Free embedding ids from https://openrouter.ai/api/v1/embeddings/models on 2026-11-11. */
export const OPENROUTER_FREE_EMBEDDING_MODELS = [
  'liquid/lfm-2.5-embedding-350m:free',
  'nvidia/llama-nemotron-embed-vl-1b-v2:free',
  'nvidia/nemotron-3-embed-1b:free',
  'nvidia/nemotron-3.5-embed-1b:free',
  'nvidia/nemotron-3.5-embed-8b:free',
] as const;
/** No free image model is listed on https://openrouter.ai/api/v1/images/models. */
export const DEFAULT_OPENROUTER_IMAGE_MODEL = 'google/gemini-3.1-flash-image';
/**
 * Verified on https://openrouter.ai/api/v1/embeddings/models.
 * The catalog description says this model produces 1,024-dimensional vectors,
 * the same width as MarketingOS EMBEDDING_DIM. Other free embedding models
 * do not publish a vector width there, so they are not the default.
 */
export const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'liquid/lfm-2.5-embedding-350m:free';
export const LOCAL_EMBEDDING_MODEL_ID = 'local/hashed-1024';

export const FREE_MODEL_LIMIT_NOTE =
  'Free OpenRouter models have a request limit. HTTP 429 means try again later; the model is not broken. On 429 or 404 the next chat model in the fallback list is tried once. The list is not repeated.';

export const EMBEDDINGS_FAILOVER_NOTE =
  'The stored knowledge vectors are a local 1024-number hash, saved as JSON text, not an external embedding. liquid/lfm-2.5-embedding-350m:free is the only free OpenRouter embedding model whose catalog text says it produces 1,024 dimensions. That width matches, but the vector space does not. Failover therefore does not write OpenRouter embeddings into the index. Retrieval stays on the local hash either way.';

export const IMAGES_FAILOVER_NOTE =
  'OpenRouter has no free image model. Image failover uses POST /api/v1/images with google/gemini-3.1-flash-image, which needs credits. A key without credits fails with “image generation needs OpenRouter credits” instead of an empty file.';

export type LlmModelMapping = {
  dupoinModel: string;
  openrouterModel: string;
  kind: LlmKind;
};

export const DEFAULT_LLM_MODEL_MAPPINGS: readonly LlmModelMapping[] = [
  { dupoinModel: 'cc/claude-sonnet-5-5', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cc/claude-sonnet-5', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cc/claude-opus-5-5', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cc/claude-opus-5', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/claude-sonnet-5-5', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/claude-sonnet-5-5-low', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/claude-sonnet-5-5-medium', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/claude-opus-5-5', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/claude-opus-5-5-low', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/claude-opus-5-5-medium', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/claude-opus-5-5-high', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/gemini-3-flash', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/gemini-3.8-flash', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/gemini-3.8-flash-high', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/gemini-3.8-flash-medium', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/gemini-3.8-flash-low', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/gemini-4-argon-low', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/gemini-4-argon-medium', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/gemini-4-argon-high', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.6-sol', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.6-sol[1m]', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.6-sol-review', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.6-terra', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.6-terra[1m]', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.6-terra-review', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.6-luna', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.6-luna[1m]', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.6-luna-review', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.4', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'cx/gpt-5.4-mini', openrouterModel: DEFAULT_OPENROUTER_CHAT_MODEL, kind: 'chat' },
  { dupoinModel: 'ag/gemini-3.1-flash-image', openrouterModel: DEFAULT_OPENROUTER_IMAGE_MODEL, kind: 'image' },
  { dupoinModel: LOCAL_EMBEDDING_MODEL_ID, openrouterModel: DEFAULT_OPENROUTER_EMBEDDING_MODEL, kind: 'embedding' },
];

export const VERIFIED_OPENROUTER_IMAGE_MODELS = [
  'google/gemini-2.5-flash-image',
  'google/gemini-3-pro-image',
  'google/gemini-3-pro-image-preview',
  'google/gemini-3.1-flash-image',
  'google/gemini-3.1-flash-image-preview',
  'google/gemini-3.1-flash-lite-image',
  'openai/gpt-5-image',
  'openai/gpt-5-image-mini',
  'openai/gpt-5.4-image-2',
] as const;
