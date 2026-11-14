import { imageModelLabel, isAllowedImageModel } from './image-models';

/**
 * Image model retried once when an Antigravity (`ag/…`) image model is
 * capacity-limited, or `null` for no fallback.
 *
 * It is `null` on purpose (2026-11-02): the previous fallback,
 * `cx/gpt-5.5-image`, now answers 400 on our ChatGPT-account Codex connection,
 * and `ag/gemini-3.1-flash-image` is the only verified-working image model, so
 * there is nothing different to fall back to. Retrying the same Antigravity
 * quota would just fail twice. A capacity failure therefore surfaces the clear
 * "Antigravity image quota/rate limit is full" error from
 * `explainImageFailure`. Set this to a verified, catalogued, non-`ag/` image
 * id to re-enable the retry.
 */
export const ANTIGRAVITY_IMAGE_FALLBACK_MODEL: string | null = null;

const PAID_IMAGE_PREFIXES = ['google/', 'openai/', 'anthropic/'];

/** The next enabled image model that is not the one that failed and is not a paid id. */
export function nextImageFallback(current: string, enabled: readonly string[]): string | null {
  for (const candidate of enabled) {
    const model = candidate.trim();
    if (!model || model === current) continue;
    if (PAID_IMAGE_PREFIXES.some(prefix => model.startsWith(prefix))) continue;
    return model;
  }
  return null;
}

export function imageQuotaNotice(modelName: string, retryIn?: string | null): string {
  const wait = retryIn?.trim() ? `retry in ${retryIn.trim()}` : 'retry later';
  return `Image quota reached for ${modelName}, ${wait}; no other image model enabled — enable one in AI Models`;
}

/** The configured fallback, only when it is a different catalogued model. */
export function antigravityImageFallbackFor(model: string): string | null {
  const fallback = ANTIGRAVITY_IMAGE_FALLBACK_MODEL;
  if (!fallback || fallback === model) return null;
  if (!isAllowedImageModel(fallback)) return null;
  return fallback;
}

export function parseImageApiErrorStatus(reason: string): number {
  return Number(/Image API error (\d{3})/.exec(reason)?.[1] ?? 0);
}

/**
 * Capacity / rate-limit / quota detection shared by `explainImageFailure` and
 * the Antigravity auto-fallback. Gateway-wrapped 502s still match when the
 * body contains capacity markers ("exhausted your capacity", quota, rate limit).
 */
export function isCapacityOrRateLimitFailure(reason: string): boolean {
  if (reason.includes('image generation needs OpenRouter credits') || reason.includes('OpenRouter free-model rate limit')) return false;
  const status = parseImageApiErrorStatus(reason);
  const lower = reason.toLowerCase();
  if (status === 429) return true;
  if (lower.includes('usage limit') || lower.includes('rate limit') || lower.includes('quota')) return true;
  if (lower.includes('exhausted your capacity') || lower.includes('capacity exhausted')) return true;
  return lower.includes('exhausted') && lower.includes('capacity');
}

export function isAntigravityImageModel(model: string): boolean {
  return model.startsWith('ag/');
}

/**
 * Auto-fallback is only for Antigravity T2I (`ag/…`) capacity / quota /
 * rate-limit failures (including 502s that wrap those markers).
 *
 * We do **not** fallback on auth, 403/404, billing, timeouts, empty images,
 * or a true 5xx outage without capacity text — those need a different fix,
 * and sending the same prompt to another model would hide the real cause.
 * Returns false while no fallback model is configured.
 */
export function shouldFallbackAntigravityImage(model: string, reason: string): boolean {
  if (!isAntigravityImageModel(model)) return false;
  if (!antigravityImageFallbackFor(model)) return false;
  return isCapacityOrRateLimitFailure(reason);
}

export function antigravityCapacityFallbackMessage(
  _fromModel: string,
  toModel: string,
): string {
  return `Antigravity quota full — used ${imageModelLabel(toModel)} instead`;
}

export interface ImageGenerationFallbackResult<T> {
  payload: T;
  requestedModel: string;
  usedModel: string;
  fallbackFrom?: string;
  fallbackMessage?: string;
}

/**
 * Try `requestedModel` once. If it is an Antigravity image id, the failure is
 * capacity/quota/rate-limit, and a fallback is configured
 * (`ANTIGRAVITY_IMAGE_FALLBACK_MODEL`, currently `null`), retry exactly once
 * with it. With no fallback the first error propagates unchanged.
 *
 * When the retry also fails, rethrow the original Antigravity error so
 * `explainImageFailure` keeps the quota copy. Non-capacity first failures
 * propagate unchanged (no second attempt).
 */
export async function generateWithAntigravityCapacityFallback<T>(
  requestedModel: string,
  generate: (model: string) => Promise<T>,
  options?: {
    onRetry?: (fallbackModel: string, fromModel: string) => void | Promise<void>;
    /** Override the configured fallback (tests). `null` disables the retry. */
    fallbackModel?: string | null;
  },
): Promise<ImageGenerationFallbackResult<T>> {
  try {
    const payload = await generate(requestedModel);
    return { payload, requestedModel, usedModel: requestedModel };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    const fallbackModel = options && 'fallbackModel' in options
      ? options.fallbackModel ?? null
      : antigravityImageFallbackFor(requestedModel);
    if (
      !fallbackModel
      || fallbackModel === requestedModel
      || !isAntigravityImageModel(requestedModel)
      || !isCapacityOrRateLimitFailure(reason)
    ) {
      throw error;
    }

    await options?.onRetry?.(fallbackModel, requestedModel);

    try {
      const payload = await generate(fallbackModel);
      return {
        payload,
        requestedModel,
        usedModel: fallbackModel,
        fallbackFrom: requestedModel,
        fallbackMessage: antigravityCapacityFallbackMessage(requestedModel, fallbackModel),
      };
    } catch {
      throw error;
    }
  }
}
