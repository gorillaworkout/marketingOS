/**
 * Client-safe settings for "Edit" in the Image Gallery.
 *
 * 9router sends cx/gpt-image-* to the ChatGPT image tool; an input image in
 * the generations body switches that tool to `action: "edit"` (there is no
 * /v1/images/edits route). gpt-6-sol-image and ag/* are not edit tools.
 */
export const EDIT_IMAGE_MODELS = [
  'cx/gpt-image-2',
  'cx/gpt-image-2.5',
  'cx/gpt-image-2.5-flare',
  'cx/gpt-image-2.5-sunburst',
  'cx/gpt-image-1.5',
] as const;
export const DEFAULT_EDIT_IMAGE_MODEL = 'cx/gpt-image-2';
export const MAX_EDIT_INSTRUCTION = 1000;

export function resolveEditImageModel(model: unknown): string {
  return typeof model === 'string' && (EDIT_IMAGE_MODELS as readonly string[]).includes(model.trim()) ? model.trim() : DEFAULT_EDIT_IMAGE_MODEL;
}

/** Shown in the Edit dialog for images made before pre-chrome originals were saved. */
export const LEGACY_EDIT_NOTE =
  'This image was made before edits were supported, so its logo and footer are baked in. The model repaints those areas and the logo and footer are added again, so the result may be less clean.';
