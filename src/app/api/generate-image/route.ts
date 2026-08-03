import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser, getSession } from '@/lib/auth';
import { queryOne, execute } from '@/lib/database';
import { rateLimit } from '@/lib/rate-limit';
import { createImageJobStore, type ImageJob, type ImageJobResult } from '@/lib/image-job-status';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const imageJobs = createImageJobStore();
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const rl = rateLimit(request);
  if (rl) return rl;

  const auth = await getAuthorizedUser(request);
  if ('error' in auth) return jsonError(auth.error, auth.status);
  // Any user with at least one generation feature may render images for it.
  if (auth.features.length === 0) return jsonError('Forbidden: no generation feature enabled for your department', 403);
  const userId = auth.id;
  if (!userId) return jsonError('Unauthorized', 401);

  let body: { prompt?: unknown; type?: unknown; brief?: unknown; model?: unknown; taskId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return jsonError('Prompt is required', 400);
  }

  const prompt = body.prompt.trim();
  const type = typeof body.type === 'string' ? body.type : 'social-post';
  const brief = typeof body.brief === 'string' ? body.brief : prompt;
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-5.6-terra';
  const taskId = typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim() : null;
  const job = imageJobs.create(userId);

  // Deliberately detached from the HTTP request: tunnel/browser disconnects must not stop the job.
  void runImageJob(job, prompt, brief, type, model, taskId);

  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return jsonError(auth.error, auth.status);
  const userId = auth.userId;
  if (!userId) return jsonError('Unauthorized', 401);

  const jobId = request.nextUrl.searchParams.get('jobId');
  if (!jobId || !JOB_ID_PATTERN.test(jobId)) return jsonError('A valid jobId is required', 400);

  const job = imageJobs.get(jobId, userId);
  if (!job) return jsonError('Image job not found', 404);

  return NextResponse.json(toPublicJob(job), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function runImageJob(job: ImageJob, prompt: string, brief: string, type: string, model: string, taskId: string | null) {
  const cwd = process.cwd() || '/Users/bayudarmawan/marketingos';
  const sopName = generateSOPFileName(brief || prompt, type);
  const tmpFile = path.join(os.tmpdir(), `codex-prompt-${job.id}.txt`);

  try {
    fs.writeFileSync(tmpFile, prompt, 'utf8');
    imageJobs.update(job.id, job.ownerId, {
      status: 'generating', progress: 30, message: `🤖 Codex generating image with ${model} (30-90s)...`,
    });
    try { fs.unlinkSync(path.join(cwd, 'output.png')); } catch {}

    const script = path.join(cwd, 'scripts', 'codex-image-gen.sh');
    const command = `bash "${script}" "${tmpFile}" "${cwd}" "${model}"`;
    exec(command, {
      cwd,
      timeout: 300_000,
      env: { ...process.env, TERM: 'xterm' } as NodeJS.ProcessEnv,
      maxBuffer: 10 * 1024 * 1024,
    }, (executionError, stdout, stderr) => {
      finishImageJob(job, cwd, sopName, executionError, String(stdout || ''), String(stderr || ''), { model, prompt, taskId });
      try { fs.unlinkSync(tmpFile); } catch {}
    });
  } catch (error) {
    console.error('[generate-image] Failed to start image job:', error);
    imageJobs.update(job.id, job.ownerId, {
      status: 'error', progress: 0, message: '❌ Unable to start image generation.', error: 'Unable to start image generation.',
    });
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function finishImageJob(
  job: ImageJob,
  cwd: string,
  sopName: string,
  executionError: Error | null,
  stdout: string,
  stderr: string,
  meta: { model: string; prompt: string; taskId: string | null },
) {
  imageJobs.update(job.id, job.ownerId, {
    status: 'processing', progress: 80, message: '📦 Processing image...',
  });

  if (stdout.includes('IMAGE_SUCCESS:')) {
    const match = stdout.match(/IMAGE_SUCCESS:(\S+)/);
    const source = match ? path.join(cwd, match[1]) : path.join(cwd, 'output.png');
    if (fs.existsSync(source)) {
      const directory = path.join(cwd, 'public', 'outputs', 'images');
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
      const fileName = `${sopName}.png`;
      fs.copyFileSync(source, path.join(directory, fileName));
      try { fs.unlinkSync(source); } catch {}
      const imageUrl = `/api/generated-images/${encodeURIComponent(fileName)}`;
      const result: ImageJobResult = {
        success: true,
        imageUrl,
        fileName,
        sopName,
        model: `${meta.model} (Codex)`,
      };
      imageJobs.update(job.id, job.ownerId, {
        status: 'done', progress: 100, message: '✅ Image generated!', result,
      });
      void recordImageOnTask(meta.taskId, job.ownerId, {
        imageUrl, fileName, sopName, model: meta.model, prompt: meta.prompt,
      });
      return;
    }
    imageJobs.update(job.id, job.ownerId, {
      status: 'error', progress: 0, message: '❌ Image file not found.', error: 'Image file not found.',
    });
    return;
  }

  const reason = stdout.match(/IMAGE_FAILED:(.+)/)?.[1]?.trim() || executionError?.message || 'unknown error';
  console.error(`[generate-image] Image job failed: ${reason} | stderr: ${stderr.slice(0, 500)}`);
  imageJobs.update(job.id, job.ownerId, {
    status: 'error', progress: 0, message: '❌ Image generation failed. Please try again.', error: 'Image generation failed. Please try again.',
  });
}

/**
 * Append the generated image to its task's output_data so Recent posts / History
 * can replay it later. Best-effort: a failure here must not fail the image job.
 */
async function recordImageOnTask(
  taskId: string | null,
  userId: string,
  entry: { imageUrl: string; fileName: string; sopName: string; model: string; prompt: string },
) {
  if (!taskId) return;
  try {
    const row = await queryOne<{ output_data: string | null }>(
      'SELECT output_data FROM tasks WHERE id = ? AND user_id = ?',
      [taskId, userId],
    );
    if (!row) return;

    let data: Record<string, unknown> = {};
    if (row.output_data) {
      const parsed = typeof row.output_data === 'string' ? JSON.parse(row.output_data) : row.output_data;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    }

    const existing = Array.isArray(data.images) ? data.images : [];
    const record = { ...entry, generatedAt: new Date().toISOString() };

    await execute('UPDATE tasks SET output_data = ? WHERE id = ? AND user_id = ?', [
      JSON.stringify({ ...data, images: [...existing, record], imageUrl: entry.imageUrl }),
      taskId,
      userId,
    ]);
  } catch (error) {
    console.error('[generate-image] Failed to record image on task:', error);
  }
}

function toPublicJob(job: ImageJob) {
  const { ownerId: _ownerId, ...publicJob } = job;
  return publicJob;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function generateSOPFileName(brief: string, type: string): string {
  const cleaned = brief.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  const contentName = cleaned || 'Content';
  const typeMap: Record<string, string> = { 'social-post': 'SocialPost', 'video-script': 'VideoScript', 'event-plan': 'EventPlan', generated: 'Image' };
  const fileType = typeMap[type] || 'Image';
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const directory = path.join(process.cwd(), 'public', 'outputs', 'images');
  const baseName = `DUPOIN_${contentName}_${fileType}`;
  const version = fs.existsSync(directory) ? fs.readdirSync(directory).filter(file => file.startsWith(baseName)).length + 1 : 1;
  return `DUPOIN_${contentName}_${fileType}_V${version}_${date}`;
}
