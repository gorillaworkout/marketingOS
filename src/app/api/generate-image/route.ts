import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedUser, getSession } from '@/lib/auth';
import { hasGenerationFeature } from '@/lib/authorization';
import { queryOne, execute } from '@/lib/database';
import { rateLimit } from '@/lib/rate-limit';
import { createImageJobStore, type ImageJob, type ImageJobResult } from '@/lib/image-job-status';
import { gatewayImageSize, legacyGatewayImageSize, parseImageAspectRatio, type ImageAspectRatio } from '@/lib/image-aspect-ratio';
import { ensureMinLongSide } from '@/lib/image-upscale';
import { applyDupoinImagePromptLocks, resolveDupoinLogoChoice, type DupoinLogoChoice } from '@/lib/dupoin-image-prompt';
import { compositeDupoinInstagramChrome } from '@/lib/dupoin-ig-chrome';
import { compositeDupoinLogo } from '@/lib/dupoin-logo-composite';
import {
  generateWithAntigravityCapacityFallback,
  imageQuotaNotice,
  isCapacityOrRateLimitFailure,
  isSizeRefusal,
  isUpstreamAccountDisabledFailure,
  nextImageFallback,
  parseImageApiErrorStatus,
} from '@/lib/image-generation-fallback';
import { AVAILABLE_IMAGE_MODELS, DEFAULT_IMAGE_MODEL, imageModelLabel, isPaidImageModel, maxInputImagesFor, resolveAssignedImageModels, resolveImageModel } from '@/lib/image-models';
import { postImage, postPaidOpenRouterImage } from '@/lib/llm-provider';
import { getLlmSettings } from '@/lib/llm-provider-store';
import { prepareModelInputImages, readInputImageLists, referencePromptBlock, type ParsedInputImage } from '@/lib/image-reference-inputs';
import { writeGeneratedImageMeta } from '@/lib/generated-image-meta';
import { nextSopVersion } from '@/lib/generated-images';
import {
  allFreeModelsExhaustedText,
  allImageModelsExhausted,
  clearImageModelQuota,
  imageModelQuotaState,
  markImageModelExhausted,
  parseQuotaResetAt,
  quotaExhaustedText,
  quotaFallbackNotice,
  shortModelName,
  type ImageQuotaInfo,
} from '@/lib/image-quota';
import { freeImageBackupModel } from '@/lib/llm-provider-defaults';
import { logTokenUsage } from '@/lib/token-log';
import { parseImageGenerationUsage } from '@/lib/token-usage';
import fs from 'fs';
import path from 'path';

const imageJobs = createImageJobStore();
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Image generation now flows through the single GorillaWorkout LLM gateway
// (llmdupoin.gorillaworkout.id, override with GORILLAWORKOUT_API_BASE) instead
// of spawning the Codex CLI directly, so every generate feature is one-door.
// The gateway maps cx/* image models to the connected Codex (ChatGPT) account.

/** Image types that wear the Dupoin Instagram chrome (header logo + regulatory footer). */
const CHROME_TYPES = new Set(['social-post', 'generate-image']);

export interface ImageJobOptions {
  prompt: string;
  brief: string;
  type: string;
  model: string;
  taskId: string | null;
  aspectRatio: ImageAspectRatio;
  includeSwipeLeft: boolean;
  logo: DupoinLogoChoice;
  footer: boolean;
  brandStyle: boolean;
  references: ParsedInputImage[];
  assets: ParsedInputImage[];
  assetNote: string;
}

export async function POST(request: NextRequest) {
  const rl = rateLimit(request);
  if (rl) return rl;

  const auth = await getAuthorizedUser(request);
  if ('error' in auth) return jsonError(auth.error, auth.status);
  // Any user with at least one generation workflow may render images for it.
  // Internal Docs alone does not grant image generation.
  if (!hasGenerationFeature(auth)) return jsonError('Forbidden: no generation feature enabled for your department', 403);
  const userId = auth.id;
  if (!userId) return jsonError('Unauthorized', 401);

  let body: {
    prompt?: unknown; type?: unknown; brief?: unknown; model?: unknown; taskId?: unknown; aspectRatio?: unknown;
    includeSwipeLeft?: unknown; dupoinAcademy?: unknown; logo?: unknown; footer?: unknown; brandStyle?: unknown;
    referenceImages?: unknown; assetImages?: unknown; assetNote?: unknown;
  };
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
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_IMAGE_MODEL;
  const taskId = typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim() : null;
  let aspectRatio: ImageAspectRatio;
  try {
    aspectRatio = parseImageAspectRatio(body.aspectRatio);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Invalid image aspect ratio', 400);
  }
  let uploads: { references: ParsedInputImage[]; assets: ParsedInputImage[] };
  try {
    uploads = readInputImageLists(body);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Invalid uploaded image', 400);
  }
  const safeModel = resolveImageModel(model);
  if (isPaidImageModel(safeModel)) {
    // Paid models only run after an admin turned on paid OpenRouter in AI Models.
    const settings = await getLlmSettings().catch(() => null);
    if (settings?.usePaidOpenRouter !== true) {
      return jsonError(`${imageModelLabel(safeModel)} is a paid OpenRouter model. Ask an admin to turn on "Use paid OpenRouter models" in AI Models, or pick a free model.`, 403);
    }
    const max = maxInputImagesFor(safeModel);
    if (uploads.references.length + uploads.assets.length > max) {
      return jsonError(`${imageModelLabel(safeModel)} accepts at most ${max} input image(s). Remove some references or assets, or pick another model.`, 400);
    }
  }
  const logo = resolveDupoinLogoChoice({ logo: body.logo, dupoinAcademy: body.dupoinAcademy });
  const job = imageJobs.create(userId);

  // Deliberately detached from the HTTP request: tunnel/browser disconnects must not stop the job.
  void runImageJob(job, {
    prompt,
    brief,
    type,
    model: safeModel,
    taskId,
    aspectRatio,
    includeSwipeLeft: body.includeSwipeLeft === true,
    logo,
    footer: body.footer !== false,
    brandStyle: body.brandStyle !== false,
    references: uploads.references,
    assets: uploads.assets,
    assetNote: typeof body.assetNote === 'string' ? body.assetNote.slice(0, 500) : '',
  });

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

async function enabledImageIds(): Promise<string[]> {
  const catalog = AVAILABLE_IMAGE_MODELS.map(item => item.id);
  try {
    const assignment = await queryOne<{ allowed_models: string; default_model: string }>(
      'SELECT allowed_models, default_model FROM image_model_assignments WHERE id = ?',
      ['default'],
    );
    if (!assignment) return catalog;
    const allowed = JSON.parse(assignment.allowed_models) as string[];
    const resolved = resolveAssignedImageModels(allowed, assignment.default_model).models.map(item => item.id);
    return [...new Set([...allowed, ...resolved, ...catalog])];
  } catch {
    return catalog;
  }
}

async function runImageJob(job: ImageJob, options: ImageJobOptions) {
  const { prompt, brief, type, model, taskId, aspectRatio } = options;
  const cwd = process.cwd() || '/Users/bayudarmawan/marketingos';
  const sopName = generateSOPFileName(brief || prompt, type);
  // Retired ids (e.g. cx/gpt-5.5-image) map to their replacement and unknown ids
  // fall back to the default image model, before anything is shown or sent.
  const safeModel = resolveImageModel(model);
  const paid = isPaidImageModel(safeModel);
  const hasUploads = options.references.length + options.assets.length > 0;
  const enabled = await enabledImageIds();
  // An enabled catalog model wins; otherwise the free OpenRouter backup covers
  // an Antigravity quota hit while it is still offered. The Recraft backup is
  // text-only, so it is skipped when the user uploaded visual references or
  // assets: a result that ignores them would look like success but is not.
  const fallback = paid ? null : (nextImageFallback(safeModel, enabled) ?? (hasUploads ? null : freeImageBackupModel()));

  try {
    imageJobs.update(job.id, job.ownerId, {
      status: 'generating', progress: 20, message: hasUploads ? '🖼️ Preparing your reference images...' : `🤖 Generating image with ${imageModelLabel(safeModel)} (30-90s)...`,
    });

    const chrome = CHROME_TYPES.has(type);
    const swipeLeft = chrome && options.includeSwipeLeft;
    // Social Post keeps its old behaviour: Dupoin or Academy header plus footer, always.
    const logo: DupoinLogoChoice = chrome ? (type === 'social-post' && options.logo === 'none' ? 'dupoin' : options.logo) : 'dupoin';
    const footer = type === 'social-post' ? true : options.footer;
    const brandStyle = type === 'social-post' ? true : options.brandStyle;
    const academy = chrome && logo === 'academy';
    const lockedPrompt = applyDupoinImagePromptLocks(prompt, aspectRatio, { includeSwipeLeft: swipeLeft, logo, footer, brandStyle });

    const prepared = await prepareModelInputImages({
      references: options.references,
      assets: options.assets,
      maxInputImages: maxInputImagesFor(safeModel),
      // 9router forwards one input image, so several uploads become one labelled sheet.
      singleInputOnly: !paid,
    });
    const referenceBlock = referencePromptBlock({ ...prepared, assetNote: options.assetNote });
    const gatewayPrompt = referenceBlock ? `${referenceBlock}\n\n${lockedPrompt}` : lockedPrompt;

    imageJobs.update(job.id, job.ownerId, {
      status: 'generating',
      progress: 30,
      message: `🤖 Generating image with ${imageModelLabel(safeModel)}${prepared.images.length ? ` using ${prepared.referenceCount + prepared.assetCount} uploaded image(s)` : ''} (30-90s)...`,
    });

    let paidFallbackMessage: string | undefined;
    const runPaid = async () => {
      try {
        const payload = await postPaidOpenRouterImage({
          model: safeModel,
          prompt: gatewayPrompt,
          aspectRatio,
          inputImages: prepared.images,
          timeoutMs: 240_000,
        });
        return { payload: payload as GatewayImagePayload, usedModel: safeModel, fallbackFrom: undefined as string | undefined, fallbackMessage: undefined as string | undefined };
      } catch (error) {
        const reason = error instanceof Error ? error.message : '';
        if (!isOpenRouterCreditFailure(reason)) throw error;
        // Out of credit: fall back to the free model rather than failing outright.
        console.warn(`[generate-image] ${safeModel} has no OpenRouter credit; using ${DEFAULT_IMAGE_MODEL}`);
        paidFallbackMessage = `OpenRouter credit ran out for ${imageModelLabel(safeModel)} — used ${imageModelLabel(DEFAULT_IMAGE_MODEL)} (free) instead`;
        imageJobs.update(job.id, job.ownerId, { status: 'generating', progress: 55, message: `${paidFallbackMessage}...` });
        const freeInputs = await prepareModelInputImages({
          references: options.references,
          assets: options.assets,
          maxInputImages: maxInputImagesFor(DEFAULT_IMAGE_MODEL),
          singleInputOnly: true,
        });
        const freeBlock = referencePromptBlock({ ...freeInputs, assetNote: options.assetNote });
        const payload = await requestGatewayImage(DEFAULT_IMAGE_MODEL, freeBlock ? `${freeBlock}\n\n${lockedPrompt}` : lockedPrompt, aspectRatio, freeInputs.images);
        return { payload, usedModel: DEFAULT_IMAGE_MODEL, fallbackFrom: safeModel, fallbackMessage: paidFallbackMessage };
      }
    };

    const { payload, usedModel, fallbackFrom, fallbackMessage } = paid
      ? await runPaid()
      : await generateWithAntigravityCapacityFallback(
        safeModel,
        (attemptModel) => requestGatewayImage(attemptModel, gatewayPrompt, aspectRatio, prepared.images),
        {
          ...(fallback ? { fallbackModel: fallback } : { fallbackModel: null }),
          onAttemptError: recordQuotaFailure,
          onRetry: (fallbackModel, fromModel, reason) => {
            const capacity = isCapacityOrRateLimitFailure(reason);
            console.warn(`[generate-image] ${fromModel} ${capacity ? 'capacity/quota exhausted' : 'refused (auth/permission)'}; retrying once with ${fallbackModel}`);
            imageJobs.update(job.id, job.ownerId, {
              status: 'generating',
              progress: 55,
              message: capacity
                ? `Antigravity quota full — retrying with ${imageModelLabel(fallbackModel)} instead of ${imageModelLabel(fromModel)}...`
                : `${imageModelLabel(fromModel)} is unavailable — retrying with ${imageModelLabel(fallbackModel)}...`,
            });
          },
          onFallbackError: (fallbackModel, fallbackError) => {
            console.warn(`[generate-image] backup ${fallbackModel} also failed:`, fallbackError instanceof Error ? fallbackError.message.slice(0, 300) : fallbackError);
          },
        },
      );

    const first = payload?.data?.[0];
    if (!first) throw new Error('Image API returned no image.');
    clearImageModelQuota(usedModel);
    // Quota fallback: say which model ran out, when it resets (WIB), and which free model made the image.
    const quotaState = fallbackFrom ? imageModelQuotaState(fallbackFrom) : null;
    const quota: ImageQuotaInfo | undefined = fallbackFrom && quotaState
      ? { model: fallbackFrom, modelLabel: shortModelName(imageModelLabel(fallbackFrom)), resetAt: quotaState.resetAt ? new Date(quotaState.resetAt).toISOString() : null }
      : undefined;
    const quotaNotice = fallbackFrom && quotaState
      ? quotaFallbackNotice({ fromLabel: imageModelLabel(fallbackFrom), resetAt: quotaState.resetAt, usedLabel: imageModelLabel(usedModel), usedFree: !isPaidImageModel(usedModel) })
      : undefined;
    const finalFallbackMessage = quotaNotice ?? fallbackMessage;

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

    // 2K floor: long side >= 2048. Upscale (lanczos3) BEFORE the chrome so the
    // logo / footer / pill are composited once, at the final canvas size.
    const sized = await ensureMinLongSide(imageBytes);
    imageBytes = sized.bytes;

    // Social Post / Generate Image wear Bayu's Instagram chrome: the left
    // header lockup (or the centered Academy logo, or no logo) plus the white
    // regulatory footer when it is on. A lower-right wordmark on the same
    // image would double-brand it. Other image types keep the wordmark stamp.
    imageBytes = chrome
      ? await compositeDupoinInstagramChrome(imageBytes, { includeSwipeLeft: swipeLeft, logo, footer })
      : await compositeDupoinLogo(imageBytes);

    const directory = path.join(cwd, 'public', 'outputs', 'images');
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
    const fileName = `${sopName}.png`;
    if (fs.existsSync(path.join(directory, fileName))) throw new Error('Image file name collision; please try again.');
    fs.writeFileSync(path.join(directory, fileName), imageBytes);

    const usage = parseImageGenerationUsage(payload);
    const costUsd = payload.provider === 'openrouter' && Number.isFinite(usage.cost) ? usage.cost : null;
    const imageUrl = `/api/generated-images/${encodeURIComponent(fileName)}`;
    const result: ImageJobResult = {
      success: true,
      imageUrl,
      fileName,
      sopName,
      model: imageModelLabel(usedModel),
      usedModel,
      aspectRatio,
      includeSwipeLeft: swipeLeft,
      dupoinAcademy: academy,
      logo,
      footer,
      paid: payload.provider === 'openrouter' && isPaidImageModel(usedModel),
      costUsd,
      referenceCount: prepared.referenceCount,
      assetCount: prepared.assetCount,
      width: sized.width,
      height: sized.height,
      ...(sized.upscaledFrom ? { upscaledFrom: sized.upscaledFrom } : {}),
      ...(fallbackFrom ? { fallbackFrom, fallbackMessage: finalFallbackMessage } : {}),
      ...(quota ? { quota } : {}),
    };
    imageJobs.update(job.id, job.ownerId, {
      status: 'done',
      progress: 100,
      message: payload.authNotice || (finalFallbackMessage ? `✅ ${finalFallbackMessage}` : '✅ Image generated!'),
      result,
    });
    try {
      await logImageGenerationUsage(job.ownerId, taskId, usedModel, payload, payload.provider);
    } catch (error) {
      console.error('[generate-image] Failed to log token usage:', error);
    }
    const record = {
      imageUrl, fileName, sopName, model: usedModel, prompt, aspectRatio,
      includeSwipeLeft: swipeLeft,
      dupoinAcademy: academy,
      logo,
      footer,
      brandStyle,
      referenceCount: prepared.referenceCount,
      assetCount: prepared.assetCount,
      width: sized.width,
      height: sized.height,
      ...(sized.upscaledFrom ? { upscaledFrom: sized.upscaledFrom } : {}),
      ...(costUsd !== null ? { costUsd } : {}),
      ...(fallbackFrom ? { fallbackFrom, fallbackMessage: finalFallbackMessage } : {}),
    };
    void recordImageOnTask(taskId, job.ownerId, record);
    if (type === 'generate-image') {
      try {
        writeGeneratedImageMeta({
          fileName,
          imageUrl,
          userId: job.ownerId,
          type: 'generate-image',
          prompt,
          brief: brief.slice(0, 300),
          model: usedModel,
          aspectRatio,
          logo,
          footer,
          includeSwipeLeft: swipeLeft,
          dupoinAcademy: academy,
          brandStyle,
          referenceCount: prepared.referenceCount,
          assetCount: prepared.assetCount,
          paid: result.paid === true,
          costUsd,
          taskId,
          ...(fallbackFrom ? { fallbackFrom, fallbackMessage: finalFallbackMessage } : {}),
          generatedAt: new Date().toISOString(),
        }, cwd);
      } catch (error) {
        console.error('[generate-image] Failed to save image metadata:', error);
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.error('[generate-image] Image job failed:', reason);
    // Report WHY it failed. A blanket "please try again" sent users retrying a
    // quota or an expired upstream token forever, with the real cause only ever
    // visible in the server log.
    if (paid) recordQuotaFailure(safeModel, error);
    const explained = isCapacityOrRateLimitFailure(reason)
      ? explainQuotaFailure(safeModel, fallback && safeModel.startsWith('ag/') ? fallback : null, enabled)
      : explainImageFailure(reason, safeModel, fallback && safeModel.startsWith('ag/') ? imageModelLabel(fallback) : null);
    imageJobs.update(job.id, job.ownerId, {
      status: 'error', progress: 0, message: `❌ ${explained}`, error: explained,
    });
  }
}

/** A failed attempt that was a quota / capacity hit: remember the model as exhausted until its reset. */
function recordQuotaFailure(model: string, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error ?? '');
  if (!isCapacityOrRateLimitFailure(reason)) return;
  const resetAt = parseQuotaResetAt(reason);
  markImageModelExhausted(model, resetAt);
  console.warn(`[generate-image] ${model} quota exhausted; reset ${resetAt ? new Date(resetAt).toISOString() : 'unknown'}`);
}

/**
 * Quota failure copy with the reset time in WIB. When every enabled free
 * model is out, say so and give the earliest reset instead of a generic error.
 */
export function explainQuotaFailure(model: string, backup: string | null, enabled: readonly string[], now: number = Date.now()): string {
  const free = enabled.filter(id => !isPaidImageModel(id));
  const all = allImageModelsExhausted(free.length ? free : [model], now);
  if (all) {
    return allFreeModelsExhaustedText(all.map(state => ({ label: imageModelLabel(state.model), resetAt: state.resetAt })), now);
  }
  const own = imageModelQuotaState(model, now);
  const head = quotaExhaustedText(imageModelLabel(model), own?.resetAt ?? null, now);
  if (!backup) return `${head}. Pick another image model.`;
  const backupState = imageModelQuotaState(backup, now);
  const backupText = backupState
    ? quotaExhaustedText(imageModelLabel(backup), backupState.resetAt, now)
    : `backup ${shortModelName(imageModelLabel(backup))} was also unavailable`;
  return `${head}; ${backupText}. Pick another image model.`;
}

/** OpenRouter answered "no credit" (402 / credits copy) for a paid image call. */
function isOpenRouterCreditFailure(reason: string): boolean {
  const lower = reason.toLowerCase();
  return reason.includes('image generation needs OpenRouter credits')
    || /OpenRouter image error 402/.test(reason)
    || lower.includes('insufficient credit')
    || lower.includes('more credits');
}

type GatewayImagePayload = {
  data?: Array<{ b64_json?: string; url?: string }>;
  usage?: unknown;
  cost?: unknown;
  provider?: 'gorillaworkout' | 'openrouter';
  authNotice?: string | null;
};

async function requestGatewayImage(
  model: string,
  gatewayPrompt: string,
  aspectRatio: ImageAspectRatio,
  inputImages: string[] = [],
): Promise<GatewayImagePayload> {
  // Dupoin keeps POST /images/generations. OpenRouter uses POST /api/v1/images.
  // Uploaded references/assets ride along as real image input.
  const generationSpec = { size: gatewayImageSize(model, aspectRatio) };
  const send = (size: string) => postImage({
    model,
    prompt: gatewayPrompt,
    size,
    aspectRatio,
    ...(inputImages.length ? { inputImages } : {}),
    timeoutMs: 240_000,
  });
  const legacy = legacyGatewayImageSize(aspectRatio);
  try {
    return await send(generationSpec.size);
  } catch (error) {
    // A model that refuses the 2K size gets one retry at the classic size; the
    // result is upscaled to 2K afterwards. Every other failure is unchanged.
    if (generationSpec.size === legacy || !isSizeRefusal(error)) throw error;
    console.warn(`[generate-image] ${model} refused size ${generationSpec.size}; retrying at ${legacy}`);
    return send(legacy);
  }
}

/**
 * Translate an upstream failure into something the user can act on.
 *
 * The gateway wraps provider errors as `Image API error <status>: {...}`, so the
 * HTTP status plus a few marker strings are enough to tell "wait and retry"
 * apart from "tell an admin". Antigravity T2I 429s ("exhausted your capacity")
 * are often wrapped by the gateway/CF as HTTP 502 — capacity markers must win
 * over the generic 5xx outage copy. Capacity detection is shared with
 * `generateWithAntigravityCapacityFallback`.
 */
export function explainImageFailure(reason: string, model: string, backupName?: string | null): string {
  if (reason.includes('image generation needs OpenRouter credits')) return 'image generation needs OpenRouter credits. Add credits in OpenRouter, then try again.';
  if (reason.includes('OpenRouter free-model rate limit')) return reason;
  const status = parseImageApiErrorStatus(reason);
  const lower = reason.toLowerCase();
  const reset = /reset after ([^)"]+)/i.exec(reason)?.[1]?.trim();
  const waitHint = reset ? ` Try again in ${reset}.` : ' Try again in a few minutes.';
  const capacityLimited = isCapacityOrRateLimitFailure(reason);

  if (lower.includes('is not configured')) {
    return 'Image generation is not configured on the server (missing API key). Please contact the administrator.';
  }
  if (capacityLimited) {
    // Wrapped 502s and Antigravity models get the explicit quota message so users
    // do not think the whole image service is down.
    if (model.startsWith('ag/') || status >= 500 || status === 429) {
      return imageQuotaNotice(imageModelLabel(model), reset || null, backupName);
    }
    return `Usage limit reached for ${model}.${waitHint} You can also pick a different image model.`;
  }
  const backupNote = backupName?.trim() ? ` Backup image model ${backupName.trim()} also failed.` : '';
  if (isUpstreamAccountDisabledFailure(reason)) {
    // 403 PERMISSION_DENIED / TOS_VIOLATION from Google: the shared upstream
    // account is blocked, not the MarketingOS user.
    const owner = model.startsWith('ag/') ? 'Google (Antigravity) account' : 'upstream provider account';
    return `The ${owner} behind ${imageModelLabel(model)} was disabled by Google. Pick GPT Image 2 or another model.${backupNote}`;
  }
  if (status === 401 || lower.includes('token is expired') || lower.includes('token expired') || lower.includes('authentication')) {
    return `Model ${imageModelLabel(model)} token expired. Please re-authenticate it in AI Models.${backupNote}`;
  }
  if (status === 403) {
    return `The image service refused ${imageModelLabel(model)} (403 permission denied upstream). This is not a problem with your MarketingOS account. Please choose another image model, such as GPT Image 2, or contact the administrator.${backupNote}`;
  }
  if (status === 404 || lower.includes('model not found') || lower.includes('unknown model')) {
    return `Image model ${model} is unavailable right now. Please choose another model.`;
  }
  if (status === 402 || lower.includes('insufficient credit') || lower.includes('billing')) {
    return `The image service has run out of credit for ${model}. Please contact the administrator.`;
  }
  if (status === 524 || lower.includes('524: a timeout occurred')) {
    // Cloudflare cut the gateway connection at ~100 s; the model itself may still be fine.
    return `${imageModelLabel(model)} took longer than the gateway's 100-second limit (524), so the request was cut off. Try again, use fewer or smaller uploads, or pick a faster free model such as GPT Image 2.`;
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
  // Nothing matched: show the upstream text rather than hiding it.
  return `Image generation failed: ${reason.slice(0, 300)}`;
}

/**
 * Append the generated image to its task's output_data so Recent posts / History
 * can replay it later. Best-effort: a failure here must not fail the image job.
 */
async function recordImageOnTask(
  taskId: string | null,
  userId: string,
  entry: {
    imageUrl: string;
    fileName: string;
    sopName: string;
    model: string;
    prompt: string;
    aspectRatio: ImageAspectRatio;
    includeSwipeLeft?: boolean;
    dupoinAcademy?: boolean;
    logo?: DupoinLogoChoice;
    footer?: boolean;
    brandStyle?: boolean;
    referenceCount?: number;
    assetCount?: number;
    width?: number;
    height?: number;
    upscaledFrom?: string;
    costUsd?: number;
    fallbackFrom?: string;
    fallbackMessage?: string;
  },
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
    const record = {
      ...entry,
      includeSwipeLeft: entry.includeSwipeLeft === true,
      dupoinAcademy: entry.dupoinAcademy === true,
      generatedAt: new Date().toISOString(),
    };

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

async function logImageGenerationUsage(
  userId: string,
  taskId: string | null,
  model: string,
  payload: unknown,
  provider: 'gorillaworkout' | 'openrouter' = 'gorillaworkout',
) {
  const usage = parseImageGenerationUsage(payload);
  await logTokenUsage({
    userId,
    taskId,
    model,
    provider,
    accountSource: 'office',
    taskType: 'image-gen',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: usage.cost,
  });
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function generateSOPFileName(brief: string, type: string): string {
  const cleaned = brief.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  const contentName = cleaned || 'Content';
  const typeMap: Record<string, string> = { 'social-post': 'SocialPost', 'generate-image': 'GenImage', 'video-script': 'VideoScript', 'event-plan': 'EventPlan', generated: 'Image' };
  const fileType = typeMap[type] || 'Image';
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const directory = path.join(process.cwd(), 'public', 'outputs', 'images');
  const baseName = `DUPOIN_${contentName}_${fileType}`;
  const existing = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  return `DUPOIN_${contentName}_${fileType}_V${nextSopVersion(existing, baseName)}_${date}`;
}
