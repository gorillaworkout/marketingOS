import fs from 'fs';
import path from 'path';

/**
 * Generation inputs for images made on Generate Image without a Social Post
 * task. Stored as one JSON file per image under data/generated-image-meta/
 * (git-ignored, outside public/), so no DB migration is needed and the Image
 * Gallery can still offer "Remix" with the original prompt and options.
 * Uploaded reference and asset images are not stored, only their counts.
 */
export interface GeneratedImageMeta {
  fileName: string;
  imageUrl: string;
  userId: string;
  type: 'generate-image';
  prompt: string;
  brief?: string;
  model: string;
  aspectRatio: string;
  logo: 'dupoin' | 'academy' | 'none';
  footer: boolean;
  includeSwipeLeft: boolean;
  dupoinAcademy: boolean;
  brandStyle: boolean;
  referenceCount: number;
  assetCount: number;
  paid: boolean;
  costUsd: number | null;
  taskId: string | null;
  fallbackFrom?: string;
  fallbackMessage?: string;
  /** Set on an Edit result: the gallery image it was made from (kept). */
  parentFileName?: string;
  editInstruction?: string;
  generatedAt: string;
}

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function generatedImageMetaDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'data', 'generated-image-meta');
}

export function writeGeneratedImageMeta(meta: GeneratedImageMeta, cwd: string = process.cwd()): void {
  if (!SAFE_NAME.test(meta.fileName)) return;
  const dir = generatedImageMetaDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${meta.fileName}.json`), JSON.stringify(meta));
}

function readOne(file: string): GeneratedImageMeta | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<GeneratedImageMeta>;
    if (!parsed || typeof parsed.fileName !== 'string' || typeof parsed.prompt !== 'string' || typeof parsed.userId !== 'string') return null;
    return parsed as GeneratedImageMeta;
  } catch {
    return null;
  }
}

/** Every stored record, keyed by image file name. */
export function readAllGeneratedImageMeta(cwd: string = process.cwd()): Map<string, GeneratedImageMeta> {
  const dir = generatedImageMetaDir(cwd);
  const found = new Map<string, GeneratedImageMeta>();
  if (!fs.existsSync(dir)) return found;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const meta = readOne(path.join(dir, name));
    if (meta) found.set(meta.fileName, meta);
  }
  return found;
}

/** The user's own Generate Image history, newest first. */
export function readUserGeneratedImageMeta(userId: string, limit = 30, cwd: string = process.cwd()): GeneratedImageMeta[] {
  return [...readAllGeneratedImageMeta(cwd).values()]
    .filter(meta => meta.userId === userId)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}
