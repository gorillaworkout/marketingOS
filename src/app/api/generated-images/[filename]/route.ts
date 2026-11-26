import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAuthorizedUser, getSession, type AuthError, type AuthResult } from '@/lib/auth';
import { execute, queryAll } from '@/lib/database';
import { deleteGeneratedImage, type GeneratedImageDeleteStore, type TaskImageRow } from '@/lib/generated-image-delete';
import { rateLimit } from '@/lib/rate-limit';
import { generatedImageContentType, isSafeGeneratedImageFilename } from '@/lib/generated-images';

type RouteContext = { params: Promise<{ filename: string }> };

// Authenticated bytes: browsers may cache privately; shared/CDN caches must not.
const PRIVATE_CACHE = 'private, max-age=3600';

// Generated files are written after `next start` has booted. Serve them from a
// route handler rather than Next's startup-scanned /public static file list.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const auth = await getSession(request);
  return respondGeneratedImage(auth, await params);
}

export async function respondGeneratedImage(
  auth: AuthResult | AuthError,
  params: { filename: string },
) {
  if (!('userId' in auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { filename } = params;
  if (!isSafeGeneratedImageFilename(filename)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const filePath = path.join(process.cwd(), 'public', 'outputs', 'images', filename);
  if (!fs.existsSync(filePath)) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    return new NextResponse(fs.readFileSync(filePath), {
      headers: {
        'Content-Type': generatedImageContentType(filename) || 'application/octet-stream',
        'Cache-Control': PRIVATE_CACHE,
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    });
  } catch {
    return new NextResponse('Unable to read image', { status: 500 });
  }
}

/** Tasks whose output_data text contains the file name (filtered exactly in deleteGeneratedImage). */
const deleteStore: GeneratedImageDeleteStore = {
  async tasksReferencing(fileName) {
    const escaped = fileName.replace(/[\\%_]/g, char => `\\${char}`);
    return queryAll<TaskImageRow & Record<string, unknown>>(
      "SELECT id, user_id, output_data FROM tasks WHERE output_data IS NOT NULL AND output_data::text LIKE ? ESCAPE '\\'",
      [`%${escaped}%`],
    );
  },
  async updateTaskOutput(taskId, outputJson) {
    await execute('UPDATE tasks SET output_data = ? WHERE id = ?', [outputJson, taskId]);
  },
};

/** Permanent delete. Owner or admin only; checked here on the server. */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const limited = rateLimit(request);
  if (limited) return limited;
  const actor = await getAuthorizedUser(request);
  if ('error' in actor) return NextResponse.json({ error: actor.error }, { status: actor.status });
  const { filename } = await params;
  const outcome = await deleteGeneratedImage({ actor, filename, store: deleteStore });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  console.info(`[generated-images] ${actor.id} deleted ${filename} (${outcome.removedFiles} file(s), ${outcome.updatedTasks} task(s))`);
  return NextResponse.json({ ok: true, removedFiles: outcome.removedFiles, updatedTasks: outcome.updatedTasks });
}
