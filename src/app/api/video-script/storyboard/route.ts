import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/database';
import { requireFeature } from '@/lib/auth';
import { aiProviderErrorBody, aiProviderStatus } from '@/lib/ai-http-status';
import { generateContent, getUserPreferredModel } from '@/lib/openai';
import {
  normalizeStoryboardScenes,
  parseVideoFormat,
  scenesFromScript,
  videoFormatInstruction,
  withStoryboard,
  type StoryboardScene,
} from '@/lib/video-script-format';
import { buildStoryboardPdf, buildStoryboardZip, storyboardImageFileName } from '@/lib/video-script-storyboard-export';

export const dynamic = 'force-dynamic';

type TaskRow = { id: string; output_data: string | null; brief: string | null; title: string | null };

async function ownScript(userId: string, taskId: string): Promise<TaskRow | undefined> {
  return queryOne<TaskRow>(
    `SELECT id, output_data, brief, title FROM tasks WHERE id = ? AND user_id = ? AND type = 'video-script'`,
    [taskId, userId],
  );
}

function storedOutput(row: TaskRow): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.output_data || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveStoryboard(userId: string, taskId: string, format: ReturnType<typeof parseVideoFormat>, scenes: StoryboardScene[]) {
  if (!format) return;
  const row = await ownScript(userId, taskId);
  if (!row) return;
  const next = withStoryboard(storedOutput(row), { format, scenes });
  await execute('UPDATE tasks SET output_data = ? WHERE id = ? AND user_id = ?', [JSON.stringify(next), taskId, userId]);
}

async function readSceneImage(fileName: string): Promise<Buffer | null> {
  if (!storyboardImageFileName(`/api/generated-images/${fileName}`)) return null;
  try {
    return await readFile(path.join(process.cwd(), 'public', 'outputs', 'images', fileName));
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature(request, 'video-script');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const format = parseVideoFormat(body?.format);
  if (!format) return NextResponse.json({ error: 'A video format is required.' }, { status: 400 });
  const fullScript = typeof body?.fullScript === 'string' ? body.fullScript.trim().slice(0, 12_000) : '';
  if (!fullScript) return NextResponse.json({ error: 'A generated script is required.' }, { status: 400 });
  const taskId = typeof body?.taskId === 'string' ? body.taskId.trim() : '';
  const model = await getUserPreferredModel(auth.id, 'video-script');
  let scenes: StoryboardScene[] = [];
  try {
    const result = await generateContent(
      'You split a Dupoin video script into storyboard scenes. Return JSON only. Do not invent prices or competitor names.',
      `${videoFormatInstruction(format)}\nScript:\n${fullScript}\nReturn 4 to 8 scenes. JSON: { "scenes": [{ "shot": "", "onScreenText": "", "vo": "", "duration": "5s" }] }`,
      auth.id,
      taskId || undefined,
      { model, responseFormat: { type: 'json_object' }, temperature: 0.3, taskType: 'video-script' },
    );
    const parsed = JSON.parse(result.content) as { scenes?: unknown };
    scenes = normalizeStoryboardScenes(parsed.scenes);
  } catch (error) {
    scenes = scenesFromScript(fullScript);
    if (scenes.length === 0) return NextResponse.json(aiProviderErrorBody(error), { status: aiProviderStatus(error) });
  }
  if (scenes.length === 0) scenes = scenesFromScript(fullScript);
  if (scenes.length === 0) return NextResponse.json({ error: 'The script could not be split into scenes.' }, { status: 424 });
  if (taskId) await saveStoryboard(auth.id, taskId, format, scenes);
  return NextResponse.json({ format, scenes });
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeature(request, 'video-script');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null) as { taskId?: unknown; format?: unknown; scenes?: unknown } | null;
  const format = parseVideoFormat(body?.format);
  const taskId = typeof body?.taskId === 'string' ? body.taskId.trim() : '';
  if (!format || !taskId) return NextResponse.json({ error: 'A saved script and format are required.' }, { status: 400 });
  const row = await ownScript(auth.id, taskId);
  if (!row) return NextResponse.json({ error: 'Script not found.' }, { status: 404 });
  const scenes = normalizeStoryboardScenes(body?.scenes);
  await saveStoryboard(auth.id, taskId, format, scenes);
  return NextResponse.json({ success: true, scenes });
}

export async function GET(request: NextRequest) {
  const auth = await requireFeature(request, 'video-script');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const taskId = request.nextUrl.searchParams.get('taskId') || '';
  const kind = request.nextUrl.searchParams.get('kind') === 'zip' ? 'zip' : 'pdf';
  const row = await ownScript(auth.id, taskId);
  if (!row) return NextResponse.json({ error: 'Script not found.' }, { status: 404 });
  const output = storedOutput(row);
  const storyboard = output.storyboard && typeof output.storyboard === 'object' ? output.storyboard as { format?: unknown; scenes?: unknown } : null;
  const format = parseVideoFormat(storyboard?.format || output.format);
  const scenes = normalizeStoryboardScenes(storyboard?.scenes);
  if (!format || scenes.length === 0) return NextResponse.json({ error: 'Generate a storyboard before downloading.' }, { status: 400 });
  const title = row.title || row.brief || 'Video storyboard';
  if (kind === 'zip') {
    const bytes = await buildStoryboardZip({ title, scenes, readImage: readSceneImage });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="video-storyboard.zip"',
      },
    });
  }
  const bytes = await buildStoryboardPdf({ title, format, scenes, readImage: readSceneImage });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="video-storyboard.pdf"',
    },
  });
}
