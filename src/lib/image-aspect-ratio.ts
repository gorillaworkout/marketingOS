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

export function getImageGenerationSpec(aspectRatio: ImageAspectRatio) {
  const orientation = aspectRatio === '1:1' ? 'square' : Number(aspectRatio.split(':')[0]) > Number(aspectRatio.split(':')[1]) ? 'landscape' : 'portrait';
  return {
    size: GATEWAY_SIZES[aspectRatio],
    promptSuffix: `Compose the image in an exact ${aspectRatio} ${orientation} aspect ratio; keep all essential subjects and branding inside that frame.`,
  } as const;
}
