export const IMAGE_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = '16:9';

const GATEWAY_SIZES: Record<ImageAspectRatio, '1536x1024' | '1024x1024' | '1024x1536'> = {
  '16:9': '1536x1024',
  '4:3': '1536x1024',
  '1:1': '1024x1024',
  '3:4': '1024x1536',
  '9:16': '1024x1536',
};

export function parseImageAspectRatio(value: unknown): ImageAspectRatio {
  if (value === undefined) return DEFAULT_IMAGE_ASPECT_RATIO;
  if (typeof value === 'string' && (IMAGE_ASPECT_RATIOS as readonly string[]).indexOf(value) >= 0) return value as ImageAspectRatio;
  throw new Error('Invalid image aspect ratio');
}

export function getImageOrientation(aspectRatio: ImageAspectRatio): 'landscape' | 'portrait' | 'square' {
  if (aspectRatio === '1:1') return 'square';
  return Number(aspectRatio.split(':')[0]) > Number(aspectRatio.split(':')[1]) ? 'landscape' : 'portrait';
}

const ASPECT_PROMPT_SUFFIX_RE = /\n\nCompose the image in an exact \d+:\d+ (?:landscape|portrait|square) aspect ratio(?: \([^)]+\))?; keep all essential subjects and branding inside that frame\.\s*$/;

export function getImageGenerationSpec(aspectRatio: ImageAspectRatio) {
  const orientation = getImageOrientation(aspectRatio);
  const size = GATEWAY_SIZES[aspectRatio];
  return {
    size,
    orientation,
    promptSuffix: `Compose the image in an exact ${aspectRatio} ${orientation} aspect ratio (${size}); keep all essential subjects and branding inside that frame.`,
  } as const;
}

/** Remove a previously baked aspect suffix so a new ratio can replace it. */
export function stripImageAspectPrompt(prompt: string): string {
  return String(prompt || '').replace(ASPECT_PROMPT_SUFFIX_RE, '').trimEnd();
}

/** Bake the dropdown size/aspect into image-prompt text without stacking duplicates. */
export function withImageAspectPrompt(prompt: string, aspectRatio: ImageAspectRatio): string {
  const { promptSuffix } = getImageGenerationSpec(aspectRatio);
  const trimmed = stripImageAspectPrompt(prompt);
  return trimmed ? `${trimmed}\n\n${promptSuffix}` : promptSuffix;
}
