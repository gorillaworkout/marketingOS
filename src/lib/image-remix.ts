/**
 * Remix payload for an image the gallery already shows.
 *
 * Prompts are not a separate table. They live on the task row the gallery
 * already reads: `tasks.output_data` JSON, on `images[]` (`prompt`,
 * `aspectRatio`, `model`, `includeSwipeLeft`, `dupoinAcademy`) with a fallback to `imagePrompt`.
 * `tasks.type` picks the editor. Images now live on Generate Image
 * (/dashboard/generate-image); Social Post is caption-only, so images from
 * Social Post tasks also remix there. Standalone Generate Image results keep
 * their inputs in data/generated-image-meta/ (see generated-image-meta.ts).
 */

export const IMAGE_REMIX_QUERY = 'remix';
export const IMAGE_REMIX_STORAGE_KEY = 'mos.image-remix';
export const IMAGE_REMIX_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type ImageRemixTarget = 'generate-image';

/** Stored before Social Post became caption-only. Still read, then sent to Generate Image. */
const LEGACY_REMIX_TARGETS = ['social-post'];

export interface LinkedGeneratedImage {
  filename: string;
  prompt: string | null;
  aspectRatio: string | null;
  model: string | null;
  includeSwipeLeft: boolean | null;
  dupoinAcademy: boolean | null;
  logo?: 'dupoin' | 'academy' | 'none' | null;
  footer?: boolean | null;
}

export interface ImageRemixRecord {
  target: ImageRemixTarget;
  prompt: string;
  brief?: string;
  aspectRatio?: string;
  model?: string;
  includeSwipeLeft?: boolean;
  dupoinAcademy?: boolean;
  logo?: 'dupoin' | 'academy' | 'none';
  footer?: boolean;
  taskId?: string;
  filename?: string;
  imageUrl?: string;
  savedAt: string;
}

export function imageRemixTarget(type: string | null | undefined): ImageRemixTarget | null {
  return type === 'social-post' || type === 'generate-image' ? 'generate-image' : null;
}

export function imageRemixHref(target: ImageRemixTarget = 'generate-image'): string {
  return `/dashboard/${target}?${IMAGE_REMIX_QUERY}=1`;
}

function readLogo(value: unknown): 'dupoin' | 'academy' | 'none' | null {
  return value === 'dupoin' || value === 'academy' || value === 'none' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function basename(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const path = trimmed.split('?')[0].split('#')[0];
  const name = path.split('/').pop() || '';
  if (!name || name === '.' || name === '..' || name.includes('..')) return null;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function readPrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

function readModel(entry: Record<string, unknown> | null): string | null {
  if (!entry) return null;
  if (typeof entry.model === 'string' && entry.model.trim()) return entry.model.trim();
  if (typeof entry.usedModel === 'string' && entry.usedModel.trim()) return entry.usedModel.trim();
  return null;
}

/**
 * Every generated file referenced by one task output, with the prompt and
 * generation inputs stored beside that file. The first match wins so a later
 * string URL cannot wipe fields already read from an image object.
 */
export function linkedGeneratedImages(output: unknown): LinkedGeneratedImage[] {
  const data = asRecord(output);
  if (!data) return [];

  const fallbackPrompt = readPrompt(data.imagePrompt);
  const fallbackSwipe = readBool(data.includeSwipeLeft);
  const fallbackAcademy = readBool(data.dupoinAcademy);
  const found = new Map<string, LinkedGeneratedImage>();

  const remember = (filename: string | null, entry: Record<string, unknown> | null) => {
    if (!filename || found.has(filename)) return;
    const swipe = entry ? readBool(entry.includeSwipeLeft) : null;
    const academy = entry ? readBool(entry.dupoinAcademy) : null;
    found.set(filename, {
      filename,
      prompt: readPrompt(entry?.prompt) || fallbackPrompt,
      aspectRatio: typeof entry?.aspectRatio === 'string' && entry.aspectRatio.trim() ? entry.aspectRatio.trim() : null,
      model: readModel(entry),
      includeSwipeLeft: swipe ?? fallbackSwipe,
      dupoinAcademy: academy ?? fallbackAcademy,
      logo: entry ? readLogo(entry.logo) : null,
      footer: entry ? readBool(entry.footer) : null,
    });
  };

  const images = Array.isArray(data.images) ? data.images : [];
  for (const image of images) {
    if (typeof image === 'string') {
      remember(basename(image), null);
      continue;
    }
    const row = asRecord(image);
    if (!row) continue;
    const filename = basename(row.imageUrl) || basename(row.url) || basename(row.fileName) || basename(row.filename);
    remember(filename, row);
  }
  remember(basename(data.imageUrl), null);

  return [...found.values()];
}

export function writeImageRemix(record: Omit<ImageRemixRecord, 'savedAt'>): void {
  if (typeof sessionStorage === 'undefined') return;
  const payload: ImageRemixRecord = { ...record, prompt: record.prompt.trim(), savedAt: new Date().toISOString() };
  if (!payload.prompt) return;
  sessionStorage.setItem(IMAGE_REMIX_STORAGE_KEY, JSON.stringify(payload));
}

export function readImageRemix(target: ImageRemixTarget, now = Date.now()): ImageRemixRecord | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(IMAGE_REMIX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImageRemixRecord>;
    const storedTarget = typeof parsed.target === 'string' ? parsed.target : '';
    if (storedTarget !== target && !LEGACY_REMIX_TARGETS.includes(storedTarget)) return null;
    if (typeof parsed.prompt !== 'string' || !parsed.prompt.trim()) return null;
    const savedAt = typeof parsed.savedAt === 'string' ? Date.parse(parsed.savedAt) : NaN;
    if (!Number.isFinite(savedAt) || now - savedAt > IMAGE_REMIX_MAX_AGE_MS || savedAt > now + 60_000) return null;
    return {
      target,
      prompt: parsed.prompt.trim(),
      brief: typeof parsed.brief === 'string' ? parsed.brief : undefined,
      aspectRatio: typeof parsed.aspectRatio === 'string' ? parsed.aspectRatio : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      includeSwipeLeft: typeof parsed.includeSwipeLeft === 'boolean' ? parsed.includeSwipeLeft : undefined,
      dupoinAcademy: typeof parsed.dupoinAcademy === 'boolean' ? parsed.dupoinAcademy : undefined,
      logo: readLogo(parsed.logo) ?? undefined,
      footer: typeof parsed.footer === 'boolean' ? parsed.footer : undefined,
      taskId: typeof parsed.taskId === 'string' ? parsed.taskId : undefined,
      filename: typeof parsed.filename === 'string' ? parsed.filename : undefined,
      imageUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl : undefined,
      savedAt: parsed.savedAt as string,
    };
  } catch {
    return null;
  }
}
