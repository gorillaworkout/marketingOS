export const IMAGE_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = '16:9';

/** Shortest acceptable long side for a delivered image ("2K"). Smaller results are upscaled. */
export const MIN_OUTPUT_LONG_SIDE = 2048;

/**
 * 2K-class sizes requested from the gateway. Every edge is a multiple of 16,
 * at most 3840 px, ratio at most 3:1 and 0.65–8.3 MP: the GPT Image 2 size
 * rules. 9router forwards `size` to the cx image tool and turns it into an
 * aspect ratio (gcd) for ag/* Gemini, so these also give exact 16:9 / 4:3.
 */
const GATEWAY_SIZES: Record<ImageAspectRatio, string> = {
  '16:9': '2048x1152',
  '4:3': '2048x1536',
  '1:1': '2048x2048',
  '3:4': '1536x2048',
  '9:16': '1152x2048',
};

/** The three classic GPT Image sizes: used by gpt-image-1.5 and as the retry when a 2K size is refused. */
const LEGACY_GATEWAY_SIZES: Record<ImageAspectRatio, '1536x1024' | '1024x1024' | '1024x1536'> = {
  '16:9': '1536x1024',
  '4:3': '1536x1024',
  '1:1': '1024x1024',
  '3:4': '1024x1536',
  '9:16': '1024x1536',
};

/** Gateway models documented to accept only the classic sizes. */
const LEGACY_SIZE_MODELS = new Set(['cx/gpt-image-1.5']);

export function legacyGatewayImageSize(aspectRatio: ImageAspectRatio): string {
  return LEGACY_GATEWAY_SIZES[aspectRatio];
}

/** Size sent to the gateway for this model: 2K-class unless the model only knows the classic sizes. */
export function gatewayImageSize(model: string, aspectRatio: ImageAspectRatio): string {
  return LEGACY_SIZE_MODELS.has(model.trim()) ? LEGACY_GATEWAY_SIZES[aspectRatio] : GATEWAY_SIZES[aspectRatio];
}

export function parseImageAspectRatio(value: unknown): ImageAspectRatio {
  if (value === undefined) return DEFAULT_IMAGE_ASPECT_RATIO;
  if (typeof value === 'string' && (IMAGE_ASPECT_RATIOS as readonly string[]).indexOf(value) >= 0) return value as ImageAspectRatio;
  throw new Error('Invalid image aspect ratio');
}

export function getImageOrientation(aspectRatio: ImageAspectRatio): 'landscape' | 'portrait' | 'square' {
  if (aspectRatio === '1:1') return 'square';
  return Number(aspectRatio.split(':')[0]) > Number(aspectRatio.split(':')[1]) ? 'landscape' : 'portrait';
}

const ASPECT_PROMPT_SUFFIX_RE = /\n\nCompose the image in an exact \d+:\d+ (?:landscape|portrait|square) aspect ratio(?: \([^)]+\))?; keep all essential subjects (?:and branding|and text) inside that frame\.\s*$/;

export function getImageGenerationSpec(aspectRatio: ImageAspectRatio) {
  const orientation = getImageOrientation(aspectRatio);
  const size = GATEWAY_SIZES[aspectRatio];
  return {
    size,
    orientation,
    promptSuffix: `Compose the image in an exact ${aspectRatio} ${orientation} aspect ratio (${size}); keep all essential subjects and text inside that frame.`,
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
