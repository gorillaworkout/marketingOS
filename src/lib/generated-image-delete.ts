import fs from 'fs';
import path from 'path';
import { generatedImageMetaDir } from '@/lib/generated-image-meta';
import { imageFileBasename, linkedGeneratedImages } from '@/lib/image-remix';

/**
 * Server-only. Permanent delete of one generated image from the Image Gallery.
 *
 * Removes the PNG in public/outputs/images, its Generate Image meta sidecar,
 * the pre-chrome original (data/generated-image-originals, written by the
 * edit flow), and every reference in tasks.output_data (images[] / imageUrl).
 * There is no trash: Bayu chose permanent delete behind a confirm dialog.
 *
 * Who may delete: the owner (task user_id or meta userId) or an admin. An
 * image with no owner record (legacy files) is admin-only. When several tasks
 * reference the file, a non-admin must own every one of them.
 */

const STRICT_IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$/i;

export function generatedImagesDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'outputs', 'images');
}

/** Pre-chrome originals (outside public/). Only images made after the edit flow shipped have one. */
export function generatedImageOriginalsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'data', 'generated-image-originals');
}

export function isDeletableImageFilename(filename: unknown): filename is string {
  return typeof filename === 'string' && filename.length <= 200 && STRICT_IMAGE_NAME.test(filename) && !filename.includes('..');
}

/** Absolute path of `name` inside `dir`, or null when it would escape the directory. */
export function resolveInside(dir: string, name: string): string | null {
  const root = path.resolve(dir);
  const target = path.resolve(root, name);
  return path.dirname(target) === root ? target : null;
}

export interface ImageActor {
  id: string;
  role: string;
}

export function canDeleteGeneratedImage(actor: ImageActor, ownerIds: readonly string[]): boolean {
  if (actor.role === 'admin') return true;
  if (ownerIds.length === 0) return false;
  return ownerIds.every(owner => owner === actor.id);
}

/**
 * Drop every entry for `fileName` from one task's output_data. `imageUrl`
 * moves to the last remaining image, or is removed when none is left.
 */
export function pruneImageFromTaskOutput(output: unknown, fileName: string): { changed: boolean; output: Record<string, unknown> | null } {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return { changed: false, output: null };
  const data = { ...(output as Record<string, unknown>) };
  let changed = false;
  const entryName = (entry: unknown): string | null => {
    if (typeof entry === 'string') return imageFileBasename(entry);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    return imageFileBasename(row.imageUrl) || imageFileBasename(row.url) || imageFileBasename(row.fileName) || imageFileBasename(row.filename);
  };
  if (Array.isArray(data.images)) {
    const kept = data.images.filter(entry => entryName(entry) !== fileName);
    if (kept.length !== data.images.length) {
      data.images = kept;
      changed = true;
    }
  }
  if (imageFileBasename(data.imageUrl) === fileName) {
    const images = Array.isArray(data.images) ? data.images : [];
    const last = [...images].reverse().map(entry => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      return typeof row.imageUrl === 'string' ? row.imageUrl : typeof row.url === 'string' ? row.url : null;
    }).find((url): url is string => typeof url === 'string' && url.length > 0);
    if (last) data.imageUrl = last;
    else delete data.imageUrl;
    changed = true;
  }
  return { changed, output: data };
}

export interface TaskImageRow {
  id: string;
  user_id: string;
  output_data: unknown;
}

export interface GeneratedImageDeleteStore {
  /** Tasks whose output_data might reference the file (a superset is fine; it is filtered here). */
  tasksReferencing(fileName: string): Promise<TaskImageRow[]>;
  updateTaskOutput(taskId: string, outputJson: string): Promise<void>;
}

export function readMetaOwner(fileName: string, cwd: string = process.cwd()): string | null {
  const file = resolveInside(generatedImageMetaDir(cwd), `${fileName}.json`);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { userId?: unknown };
    return typeof parsed.userId === 'string' && parsed.userId ? parsed.userId : null;
  } catch {
    return null;
  }
}

function parseOutput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export type DeleteOutcome =
  | { ok: true; removedFiles: number; updatedTasks: number }
  | { ok: false; status: 400 | 403 | 404; error: string };

export async function deleteGeneratedImage(input: {
  actor: ImageActor;
  filename: string;
  store: GeneratedImageDeleteStore;
  cwd?: string;
}): Promise<DeleteOutcome> {
  const cwd = input.cwd ?? process.cwd();
  const { filename, actor, store } = input;
  if (!isDeletableImageFilename(filename)) return { ok: false, status: 400, error: 'Invalid image file name.' };
  const imagePath = resolveInside(generatedImagesDir(cwd), filename);
  const metaPath = resolveInside(generatedImageMetaDir(cwd), `${filename}.json`);
  const originalPath = resolveInside(generatedImageOriginalsDir(cwd), filename);
  if (!imagePath || !metaPath || !originalPath) return { ok: false, status: 400, error: 'Invalid image file name.' };

  const candidates = await store.tasksReferencing(filename);
  const linked = candidates
    .map(row => ({ row, output: parseOutput(row.output_data) }))
    .filter(item => linkedGeneratedImages(item.output).some(image => image.filename === filename));
  const metaOwner = readMetaOwner(filename, cwd);
  const imageExists = fs.existsSync(imagePath);
  if (!imageExists && linked.length === 0 && !fs.existsSync(metaPath)) {
    return { ok: false, status: 404, error: 'Image not found.' };
  }

  const owners = [...new Set([...linked.map(item => item.row.user_id), ...(metaOwner ? [metaOwner] : [])].filter(Boolean))];
  if (!canDeleteGeneratedImage(actor, owners)) {
    return { ok: false, status: 403, error: owners.length ? 'You can only delete your own images.' : 'Only an admin can delete an image with no owner record.' };
  }

  let updatedTasks = 0;
  for (const item of linked) {
    const pruned = pruneImageFromTaskOutput(item.output, filename);
    if (!pruned.changed || !pruned.output) continue;
    await store.updateTaskOutput(item.row.id, JSON.stringify(pruned.output));
    updatedTasks += 1;
  }

  let removedFiles = 0;
  for (const file of [imagePath, metaPath, originalPath]) {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      removedFiles += 1;
    }
  }
  return { ok: true, removedFiles, updatedTasks };
}
