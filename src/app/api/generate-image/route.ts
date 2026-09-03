import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser, getSession } from '@/lib/auth';
import { queryOne, execute } from '@/lib/database';
import { rateLimit } from '@/lib/rate-limit';
import { createImageJobStore, type ImageJob, type ImageJobResult } from '@/lib/image-job-status';
import fs from 'fs';
import path from 'path';

const imageJobs = createImageJobStore();
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Image generation now flows through the single GorillaWorkout LLM gateway
// (llm.gorillaworkout.id) instead of spawning the Codex CLI directly, so every
// generate feature is one-door. The gateway maps cx/* image models to the
// connected Codex (ChatGPT) account on the 9router host.
const GORILLAWORKOUT_API_BASE = process.env.GORILLAWORKOUT_API_BASE || 'https://llm.gorillaworkout.id/v1';
const GORILLAWORKOUT_API_KEY = process.env.GORILLAWORKOUT_API_KEY || '';

// Codex image models served by the gateway. gpt-5.3-image is rejected on a
// ChatGPT account, so only 5.5 and 5.4 are offered.
const IMAGE_MODELS = ['cx/gpt-5.5-image', 'cx/gpt-5.4-image'];

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
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'cx/gpt-5.5-image';
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

  try {
    imageJobs.update(job.id, job.ownerId, {
      status: 'generating', progress: 30, message: `🤖 Codex generating image with ${model} (30-90s)...`,
    });

    if (!GORILLAWORKOUT_API_KEY) {
      throw new Error('GORILLAWORKOUT_API_KEY is not configured.');
    }

    // Fall back to the gateway's default image model when an unknown one is requested.
    const safeModel = IMAGE_MODELS.includes(model) ? model : 'cx/gpt-5.5-image';

    const response = await fetch(`${GORILLAWORKOUT_API_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GORILLAWORKOUT_API_KEY}`,
        'HTTP-Referer': 'https://marketingos.local',
        'X-Title': 'MarketingOS',
      },
      body: JSON.stringify({
        model: safeModel,
        prompt,
        n: 1,
        size: '1024x1024',
      }),
      signal: AbortSignal.timeout(240_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Image API error ${response.status}: ${errText.slice(0, 500)}`);
    }

    const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = payload?.data?.[0];
    if (!first) throw new Error('Image API returned no image.');

    let imageBytes: Buffer;
    if (first.b64_json) {
      imageBytes = Buffer.from(first.b64_json, 'base64');
    } else if (first.url) {
      const imgRes = await fetch(first.url);
      if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`);
      imageBytes = Buffer.from(await imgRes.arrayBuffer());
    } else {
      throw new Error('Image API returned an empty result.');
    }

    if (imageBytes.length < 10_000) throw new Error('Image API returned a suspiciously small image.');

    const directory = path.join(cwd, 'public', 'outputs', 'images');
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
    const fileName = `${sopName}.png`;
    fs.writeFileSync(path.join(directory, fileName), imageBytes);

    const imageUrl = `/api/generated-images/${encodeURIComponent(fileName)}`;
    const result: ImageJobResult = {
      success: true,
      imageUrl,
      fileName,
      sopName,
      model: `${safeModel} (Codex)`,
    };
    imageJobs.update(job.id, job.ownerId, {
      status: 'done', progress: 100, message: '✅ Image generated!', result,
    });
    void recordImageOnTask(taskId, job.ownerId, {
      imageUrl, fileName, sopName, model: safeModel, prompt,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.error('[generate-image] Image job failed:', reason);
    // Report WHY it failed. A blanket "please try again" sent users retrying a
    // quota or an expired upstream token forever, with the real cause only ever
    // visible in the server log.
    const explained = explainImageFailure(reason, model);
    imageJobs.update(job.id, job.ownerId, {
      status: 'error', progress: 0, message: `❌ ${explained}`, error: explained,
    });
  }
}

/**
 * Translate an upstream failure into something the user can act on.
 *
 * The gateway wraps provider errors as `Image API error <status>: {...}`, so the
 * HTTP status plus a few marker strings are enough to tell "wait and retry"
 * apart from "tell an admin".
 */
export function explainImageFailure(reason: string, model: string): string {
  const status = Number(/Image API error (\d{3})/.exec(reason)?.[1] ?? 0);
  const lower = reason.toLowerCase();
  const reset = /reset after ([^)"]+)/i.exec(reason)?.[1]?.trim();
  const waitHint = reset ? ` Try again in ${reset}.` : ' Try again in a few minutes.';

  if (lower.includes('is not configured')) {
    return 'Image generation is not configured on the server (missing API key). Please contact the administrator.';
  }
  if (status === 429 || lower.includes('usage limit') || lower.includes('rate limit') || lower.includes('quota')) {
    return `Usage limit reached for ${model}.${waitHint} You can also pick a different image model.`;
  }
  if (status === 401 || lower.includes('token is expired') || lower.includes('authentication')) {
    return `The image service rejected our credentials for ${model} (expired or invalid token). This needs an administrator to reconnect the account — retrying will not help.`;
  }
  if (status === 403) {
    return `This account is not allowed to use ${model}. Please choose another image model or contact the administrator.`;
  }
  if (status === 404 || lower.includes('model not found') || lower.includes('unknown model')) {
    return `Image model ${model} is unavailable right now. Please choose another model.`;
  }
  if (status === 402 || lower.includes('insufficient credit') || lower.includes('billing')) {
    return `The image service has run out of credit for ${model}. Please contact the administrator.`;
  }
  if (status >= 500 || lower.includes('bad gateway') || lower.includes('service unavailable')) {
    return `The image service is temporarily down (${status || 'upstream error'}).${waitHint}`;
  }
  if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('timed out')) {
    return `${model} took too long to respond and the request timed out. Please try again, or use a simpler prompt.`;
  }
  if (lower.includes('no image') || lower.includes('empty result') || lower.includes('suspiciously small')) {
    return `${model} returned no usable image — the prompt may have been rejected by its safety filter. Try rewording the prompt.`;
  }
  return 'Image generation failed unexpectedly. Please contact the administrator if this continues.';
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
