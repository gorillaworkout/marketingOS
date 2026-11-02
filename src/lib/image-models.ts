export interface ImageModelInfo {
  id: string;
  name: string;
  description: string;
}

/**
 * Default Social Post / generate-image model. Production switched to this id on
 * 2026-11-02 after `cx/gpt-5.5-image` started answering 400 ("The 'gpt-5.5'
 * model is not supported when using Codex with a ChatGPT account").
 */
export const DEFAULT_IMAGE_MODEL = 'ag/gemini-3.1-flash-image';

/**
 * Social Post image-generation catalog served by the GorillaWorkout gateway
 * (`POST /images/generations`). Approved list: `ag/gemini-3.1-flash-image`.
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
 */
export const AVAILABLE_IMAGE_MODELS: ImageModelInfo[] = [
  { id: 'ag/gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image (Antigravity)', description: 'Antigravity · Gemini 3.1 Flash T2I' },
];

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

export const IMAGE_MODELS: readonly string[] = AVAILABLE_IMAGE_MODELS.map(model => model.id);

export function isAllowedImageModel(id: string): boolean {
  return IMAGE_MODELS.includes(id);
}

export function resolveImageModel(id: string | undefined | null): string {
  if (typeof id !== 'string') return DEFAULT_IMAGE_MODEL;
  const trimmed = id.trim();
  const live = RETIRED_IMAGE_MODEL_REPLACEMENTS[trimmed] ?? trimmed;
  return isAllowedImageModel(live) ? live : DEFAULT_IMAGE_MODEL;
}

export function imageModelLabel(id: string): string {
  return AVAILABLE_IMAGE_MODELS.find(model => model.id === id)?.name ?? RETIRED_IMAGE_MODEL_LABELS[id] ?? id;
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
