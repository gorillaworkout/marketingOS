import { DEFAULT_IMAGE_MODEL, imageModelLabel } from './image-models';

/** Codex T2I used when an Antigravity (`ag/…`) image model is capacity-limited. */
export const ANTIGRAVITY_IMAGE_FALLBACK_MODEL = DEFAULT_IMAGE_MODEL;

export function parseImageApiErrorStatus(reason: string): number {
  return Number(/Image API error (\d{3})/.exec(reason)?.[1] ?? 0);
}

/**
 * Capacity / rate-limit / quota detection shared by `explainImageFailure` and
 * the Antigravity auto-fallback. Gateway-wrapped 502s still match when the
 * body contains capacity markers ("exhausted your capacity", quota, rate limit).
 */
export function isCapacityOrRateLimitFailure(reason: string): boolean {
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
 * and sending the same prompt to GPT-5.5 Image would hide the real cause.
 */
export function shouldFallbackAntigravityImage(model: string, reason: string): boolean {
  if (!isAntigravityImageModel(model)) return false;
  if (model === ANTIGRAVITY_IMAGE_FALLBACK_MODEL) return false;
  return isCapacityOrRateLimitFailure(reason);
}

export function antigravityCapacityFallbackMessage(
  _fromModel: string,
  toModel: string = ANTIGRAVITY_IMAGE_FALLBACK_MODEL,
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
 * Try `requestedModel` once. If it is an Antigravity image id and the failure
 * is capacity/quota/rate-limit, retry exactly once with
 * `ANTIGRAVITY_IMAGE_FALLBACK_MODEL` (`cx/gpt-5.5-image`).
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
  },
): Promise<ImageGenerationFallbackResult<T>> {
  try {
    const payload = await generate(requestedModel);
    return { payload, requestedModel, usedModel: requestedModel };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    if (!shouldFallbackAntigravityImage(requestedModel, reason)) {
      throw error;
    }

    const fallbackModel = ANTIGRAVITY_IMAGE_FALLBACK_MODEL;
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
