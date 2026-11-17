/**
 * Social Post → Generate Image handoff. Social Post is caption-only; its
 * "Create image from this caption" button stores the selected option here and
 * opens Generate Image, which pre-fills the prompt and links the image back to
 * the Social Post task so Recent posts / History still show it.
 */
export const GENERATE_IMAGE_HANDOFF_QUERY = 'from';
export const GENERATE_IMAGE_HANDOFF_VALUE = 'social-post';
export const GENERATE_IMAGE_HANDOFF_KEY = 'mos.generate-image-handoff';
export const GENERATE_IMAGE_HANDOFF_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface GenerateImageHandoff {
  prompt: string;
  brief?: string;
  hook?: string;
  caption?: string;
  taskId?: string | null;
  platform?: string;
  savedAt: string;
}

export function generateImageHref(fromSocialPost = false): string {
  return fromSocialPost
    ? `/dashboard/generate-image?${GENERATE_IMAGE_HANDOFF_QUERY}=${GENERATE_IMAGE_HANDOFF_VALUE}`
    : '/dashboard/generate-image';
}

export function writeGenerateImageHandoff(record: Omit<GenerateImageHandoff, 'savedAt'>): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(GENERATE_IMAGE_HANDOFF_KEY, JSON.stringify({ ...record, savedAt: new Date().toISOString() }));
}

export function readGenerateImageHandoff(now = Date.now()): GenerateImageHandoff | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(GENERATE_IMAGE_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GenerateImageHandoff>;
    const savedAt = typeof parsed.savedAt === 'string' ? Date.parse(parsed.savedAt) : NaN;
    if (!Number.isFinite(savedAt) || now - savedAt > GENERATE_IMAGE_HANDOFF_MAX_AGE_MS || savedAt > now + 60_000) return null;
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
    const caption = typeof parsed.caption === 'string' ? parsed.caption : undefined;
    if (!prompt && !caption) return null;
    return {
      prompt,
      brief: typeof parsed.brief === 'string' ? parsed.brief : undefined,
      hook: typeof parsed.hook === 'string' ? parsed.hook : undefined,
      caption,
      taskId: typeof parsed.taskId === 'string' && parsed.taskId ? parsed.taskId : null,
      platform: typeof parsed.platform === 'string' ? parsed.platform : undefined,
      savedAt: parsed.savedAt as string,
    };
  } catch {
    return null;
  }
}
