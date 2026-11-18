export type ImageModelProvider = 'gateway' | 'openrouter';
export type ImageModelFamily = 'gemini' | 'nano-banana' | 'gpt-image';

export interface ImageModelInfo {
  id: string;
  name: string;
  description: string;
  /** Where the request goes. Gateway = GorillaWorkout/9router (included); openrouter = paid credits. */
  provider?: ImageModelProvider;
  family?: ImageModelFamily;
  /** True when every image is billed to OpenRouter credits. */
  paid?: boolean;
  /** Most input images (visual references + assets) the model accepts in one call. */
  maxInputImages?: number;
  /** Rough USD per generated image at the settings MarketingOS sends (1K / medium). Estimate only. */
  estimatedCostUsd?: number;
  /** OpenRouter's listed expiration date (YYYY-MM-DD) after which the id is hidden. */
  expiresOn?: string;
}

/**
 * Default Social Post / generate-image model. Production switched to this id on
 * 2026-11-02 after `cx/gpt-5.5-image` started answering 400 ("The 'gpt-5.5'
 * model is not supported when using Codex with a ChatGPT account").
 */
export const DEFAULT_IMAGE_MODEL = 'ag/gemini-3.1-flash-image';

/**
 * Social Post image-generation catalog served by the GorillaWorkout gateway
 * (`POST /images/generations`). Approved list: `ag/gemini-3.1-flash-image`
 * plus the `cx/gpt-image-*` ids below (verified 2026-11-18).
 *
 * Intentionally omitted:
 * - `cx/gpt-5.5-image` — 400 on a ChatGPT-account Codex connection
 *   (2026-11-02); migration 042 drops it from stored assignments
 * - `ag/nano-banana`, `ag/nano-banana-pro` — not exposed by 9router
 *   (2026-11-02); migration 039 repoints stored assignments to
 *   `ag/gemini-3.1-flash-image`
 * - `cx/gpt-5.4-image` — production probe: rejected on a ChatGPT account
 * - `ag/nanobanana` — do not alias Nano Banana
 * - other Gemini image ids besides `ag/gemini-3.1-flash-image`
 * - `ag/gemini-3-pro-image` (Nano Banana Pro on Antigravity) — not probed on
 *   the gateway yet (2026-11-17); add it only after a live /v1/models check.
 *   The paid OpenRouter twin `google/gemini-3-pro-image` is listed below.
 */
export const AVAILABLE_IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: 'ag/gemini-3.1-flash-image',
    // Gemini 3.1 Flash Image is Google's "Nano Banana 2"; Bayu asked for the Nano Banana name (2026-11-18).
    name: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    description: 'Free · gateway (Antigravity)',
    provider: 'gateway',
    family: 'gemini',
    paid: false,
    // 9router's Antigravity adapter forwards one input image (body.image), so
    // several uploads are merged into one labelled reference sheet first.
    maxInputImages: 8,
    estimatedCostUsd: 0,
  },
  // GPT Image on the connected Codex (ChatGPT) account through the same
  // gateway: free, no OpenRouter. Listed by GET /v1/models/image and probed on
  // production 2026-11-18 (POST /images/generations, with and without a
  // reference image in `image`): every id returned an image and followed the
  // reference. They pick the frame from the prompt's aspect-ratio line rather
  // than `size`. One input image, like Antigravity, so uploads are merged into
  // one labelled reference sheet.
  { id: 'cx/gpt-image-2', name: 'GPT Image 2 (ChatGPT)', description: 'Free · gateway · ChatGPT account', provider: 'gateway', family: 'gpt-image', paid: false, maxInputImages: 8, estimatedCostUsd: 0 },
  { id: 'cx/gpt-image-2.5', name: 'GPT Image 2.5 (ChatGPT)', description: 'Free · gateway · ChatGPT account', provider: 'gateway', family: 'gpt-image', paid: false, maxInputImages: 8, estimatedCostUsd: 0 },
  { id: 'cx/gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare (ChatGPT)', description: 'Free · gateway · ChatGPT account', provider: 'gateway', family: 'gpt-image', paid: false, maxInputImages: 8, estimatedCostUsd: 0 },
  { id: 'cx/gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst (ChatGPT)', description: 'Free · gateway · ChatGPT account', provider: 'gateway', family: 'gpt-image', paid: false, maxInputImages: 8, estimatedCostUsd: 0 },
  { id: 'cx/gpt-image-1.5', name: 'GPT Image 1.5 (ChatGPT)', description: 'Free · gateway · ChatGPT account', provider: 'gateway', family: 'gpt-image', paid: false, maxInputImages: 8, estimatedCostUsd: 0 },
  { id: 'cx/gpt-6-sol-image', name: 'GPT-6 Sol Image (ChatGPT)', description: 'Free · gateway · ChatGPT account', provider: 'gateway', family: 'gpt-image', paid: false, maxInputImages: 8, estimatedCostUsd: 0 },
];

/**
 * Paid image models served by OpenRouter `POST /api/v1/images` with the exact
 * id below. Checked on 2026-11-17 against the public catalogs
 * https://openrouter.ai/api/v1/images/models (every id lists
 * `input_references`, i.e. real image input) and
 * https://openrouter.ai/api/v1/models?output_modalities=image (pricing).
 *
 * They are never a default and never a fallback. A request is refused unless
 * the AI Models "Use paid OpenRouter models" toggle is on, so nothing here
 * spends credit until an admin opts in. `estimatedCostUsd` is per image:
 * Gemini ids at 1K (~1,120 output image tokens; 2.5 Flash ~1,290), OpenAI ids
 * at quality "medium" portrait (~1,584 output image tokens). Input references
 * add a little on top. The real charge is read from the response afterwards.
 *
 * Preview twins (`google/gemini-3.1-flash-image-preview`,
 * `google/gemini-3-pro-image-preview`) are the same models at the same price
 * and are left out to keep the picker short.
 */
export const PAID_IMAGE_MODELS: ImageModelInfo[] = [
  { id: 'google/gemini-2.5-flash-image', name: 'Nano Banana · Gemini 2.5 Flash Image (OpenRouter, paid)', description: 'Paid · OpenRouter · up to 3 input images', provider: 'openrouter', family: 'nano-banana', paid: true, maxInputImages: 3, estimatedCostUsd: 0.039 },
  { id: 'google/gemini-3.1-flash-image', name: 'Nano Banana 2 · Gemini 3.1 Flash Image (OpenRouter, paid)', description: 'Paid · OpenRouter · up to 14 input images', provider: 'openrouter', family: 'nano-banana', paid: true, maxInputImages: 14, estimatedCostUsd: 0.067 },
  { id: 'google/gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite · Gemini 3.1 Flash Lite Image (OpenRouter, paid)', description: 'Paid · OpenRouter · up to 14 input images', provider: 'openrouter', family: 'nano-banana', paid: true, maxInputImages: 14, estimatedCostUsd: 0.034 },
  { id: 'google/gemini-nano-banana-2.1', name: 'Nano Banana 2.1 (OpenRouter, paid)', description: 'Paid · OpenRouter · image input', provider: 'openrouter', family: 'nano-banana', paid: true, maxInputImages: 14, estimatedCostUsd: 0.034 },
  { id: 'google/gemini-3-pro-image', name: 'Nano Banana Pro · Gemini 3 Pro Image (OpenRouter, paid)', description: 'Paid · OpenRouter · up to 14 input images', provider: 'openrouter', family: 'nano-banana', paid: true, maxInputImages: 14, estimatedCostUsd: 0.134 },
  { id: 'openai/gpt-image-1', name: 'GPT Image 1', description: 'Paid · OpenRouter · up to 16 input images', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.063 },
  { id: 'openai/gpt-image-1-mini', name: 'GPT Image 1 Mini', description: 'Paid · OpenRouter · listed until 1 Dec 2026', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.013, expiresOn: '2026-12-01' },
  { id: 'openai/gpt-image-2', name: 'GPT Image 2', description: 'Paid · OpenRouter · listed until 10 Feb 2027', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.048, expiresOn: '2027-02-10' },
  { id: 'openai/gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', description: 'Paid · OpenRouter · up to 16 input images', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.048 },
  { id: 'openai/gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', description: 'Paid · OpenRouter · up to 16 input images', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.048 },
  { id: 'openai/gpt-image-2.6-flare', name: 'GPT Image 2.6 Flare', description: 'Paid · OpenRouter · up to 16 input images', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.048 },
  { id: 'openai/gpt-image-2.6-sunburst', name: 'GPT Image 2.6 Sunburst', description: 'Paid · OpenRouter · up to 16 input images', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.048 },
  { id: 'openai/gpt-5-image', name: 'GPT-5 Image', description: 'Paid · OpenRouter · listed until 11 Dec 2026', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.063, expiresOn: '2026-12-11' },
  { id: 'openai/gpt-5-image-mini', name: 'GPT-5 Image Mini', description: 'Paid · OpenRouter · listed until 1 Dec 2026', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.013, expiresOn: '2026-12-01' },
  { id: 'openai/gpt-5.4-image-2', name: 'GPT-5.4 Image 2', description: 'Paid · OpenRouter · up to 16 input images', provider: 'openrouter', family: 'gpt-image', paid: true, maxInputImages: 16, estimatedCostUsd: 0.048 },
];

/** Paid ids still listed on OpenRouter (expiry is the end of the listed day, UTC). */
export function livePaidImageModels(now: number = Date.now()): ImageModelInfo[] {
  return PAID_IMAGE_MODELS.filter(model => !model.expiresOn || now < Date.parse(`${model.expiresOn}T23:59:59Z`));
}

/** Free catalog plus paid OpenRouter ids. Paid ids still need the paid toggle at request time. */
export function imageModelCatalog(now: number = Date.now()): ImageModelInfo[] {
  return [...AVAILABLE_IMAGE_MODELS, ...livePaidImageModels(now)];
}

export function findImageModel(id: string | null | undefined, now: number = Date.now()): ImageModelInfo | undefined {
  if (typeof id !== 'string') return undefined;
  return imageModelCatalog(now).find(model => model.id === id.trim());
}

export function isPaidImageModel(id: string | null | undefined): boolean {
  if (typeof id !== 'string') return false;
  return PAID_IMAGE_MODELS.some(model => model.id === id.trim());
}

/** Input images (references + assets) one call to this model may carry. */
export function maxInputImagesFor(id: string): number {
  return findImageModel(id)?.maxInputImages ?? 1;
}

/** Image ids that no longer exist upstream, mapped to their live replacement. */
export const RETIRED_IMAGE_MODEL_REPLACEMENTS: Readonly<Record<string, string>> = {
  'ag/nano-banana': 'ag/gemini-3.1-flash-image',
  'ag/nano-banana-pro': 'ag/gemini-3.1-flash-image',
  'cx/gpt-5.5-image': 'ag/gemini-3.1-flash-image',
};

/** Display names for retired image ids, so History / usage rows that ran on them stay readable. */
export const RETIRED_IMAGE_MODEL_LABELS: Readonly<Record<string, string>> = {
  'ag/nano-banana': 'Nano Banana',
  'ag/nano-banana-pro': 'Nano Banana Pro',
  'cx/gpt-5.5-image': 'GPT-5.5 Image',
};

/** Free (included) image ids. Paid ids are checked with isPaidImageModel. */
export const IMAGE_MODELS: readonly string[] = AVAILABLE_IMAGE_MODELS.map(model => model.id);

/** Free catalog id. Used for defaults, assignments and fallbacks, so a paid id can never become one. */
export function isAllowedImageModel(id: string): boolean {
  return IMAGE_MODELS.includes(id);
}

/** Free id, or a paid id still listed. Paid ids still need the paid toggle at request time. */
export function isSelectableImageModel(id: string, now: number = Date.now()): boolean {
  return isAllowedImageModel(id) || livePaidImageModels(now).some(model => model.id === id);
}

export function resolveImageModel(id: string | undefined | null): string {
  if (typeof id !== 'string') return DEFAULT_IMAGE_MODEL;
  const trimmed = id.trim();
  const live = RETIRED_IMAGE_MODEL_REPLACEMENTS[trimmed] ?? trimmed;
  return isSelectableImageModel(live) ? live : DEFAULT_IMAGE_MODEL;
}

/** Display names for backup image ids that are not in the picker catalog. */
export const BACKUP_IMAGE_MODEL_LABELS: Readonly<Record<string, string>> = {
  'recraft/recraft-v4.1-flash-v2:free': 'Recraft V4.1 Flash (OpenRouter free)',
};

export function imageModelLabel(id: string): string {
  return AVAILABLE_IMAGE_MODELS.find(model => model.id === id)?.name ?? PAID_IMAGE_MODELS.find(model => model.id === id)?.name ?? BACKUP_IMAGE_MODEL_LABELS[id] ?? RETIRED_IMAGE_MODEL_LABELS[id] ?? id;
}

/**
 * Picker selection for a stored id (task replay / remix). Retired ids move to
 * their replacement; unknown ids fall back to the default so the select never
 * holds a value that has no option.
 */
export function selectableImageModel(id: string | undefined | null, options: readonly ImageModelInfo[] = AVAILABLE_IMAGE_MODELS): string {
  const live = resolveImageModel(id);
  if (options.some(model => model.id === live)) return live;
  return options.some(model => model.id === DEFAULT_IMAGE_MODEL) ? DEFAULT_IMAGE_MODEL : (options[0]?.id ?? DEFAULT_IMAGE_MODEL);
}

/**
 * Apply a stored assignment against the current catalog. Stale ids (e.g.
 * production `gpt-5.6-terra`) yield the full current catalog so users are not
 * stuck with an empty picker until ops updates `image_model_assignments`.
 */
export function resolveAssignedImageModels(allowedModelIds: string[], defaultModel: string): {
  models: ImageModelInfo[];
  defaultModel: string;
} {
  const models = AVAILABLE_IMAGE_MODELS.filter(model => allowedModelIds.includes(model.id));
  if (models.length === 0) {
    return { models: AVAILABLE_IMAGE_MODELS, defaultModel: DEFAULT_IMAGE_MODEL };
  }
  const resolvedDefault = models.some(model => model.id === defaultModel)
    ? defaultModel
    : (models.some(model => model.id === DEFAULT_IMAGE_MODEL) ? DEFAULT_IMAGE_MODEL : models[0].id);
  return { models, defaultModel: resolvedDefault };
}
