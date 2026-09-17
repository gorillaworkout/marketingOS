export interface ImageModelInfo {
  id: string;
  name: string;
  description: string;
}

/** Default Social Post / generate-image model. Must stay on the ChatGPT-compatible Codex T2I id. */
export const DEFAULT_IMAGE_MODEL = 'cx/gpt-5.5-image';

/**
 * Social Post image-generation catalog served by the GorillaWorkout gateway
 * (`POST /images/generations`). Approved list only:
 * `cx/gpt-5.5-image`, `ag/nano-banana`, `ag/nano-banana-pro`.
 *
 * Intentionally omitted:
 * - `cx/gpt-5.4-image` — production probe: rejected on a ChatGPT account
 * - `ag/nanobanana` — do not alias Nano Banana
 * - `ag/gemini-3.1-flash-image` — live probe works, but not approved for this PR
 */
export const AVAILABLE_IMAGE_MODELS: ImageModelInfo[] = [
  { id: 'cx/gpt-5.5-image', name: 'GPT-5.5 Image', description: 'Codex · image generation · high quality' },
  { id: 'ag/nano-banana', name: 'Nano Banana (Gemini / Antigravity)', description: 'Antigravity · Gemini T2I' },
  { id: 'ag/nano-banana-pro', name: 'Nano Banana Pro (Gemini / Antigravity)', description: 'Antigravity · Gemini T2I · higher quality' },
];

export const IMAGE_MODELS: readonly string[] = AVAILABLE_IMAGE_MODELS.map(model => model.id);

export function isAllowedImageModel(id: string): boolean {
  return IMAGE_MODELS.includes(id);
}

export function resolveImageModel(id: string | undefined | null): string {
  if (typeof id !== 'string') return DEFAULT_IMAGE_MODEL;
  const trimmed = id.trim();
  return isAllowedImageModel(trimmed) ? trimmed : DEFAULT_IMAGE_MODEL;
}

export function imageModelLabel(id: string): string {
  return AVAILABLE_IMAGE_MODELS.find(model => model.id === id)?.name ?? id;
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
