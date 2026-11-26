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
 *
 * Since 2026-11-18 the generate-image route passes its own fallback from
 * `nextImageFallback` over the enabled catalog, which now holds the free
 * gateway GPT Image ids (`cx/gpt-image-2` first), so an Antigravity quota hit
 * retries once on GPT Image through LLM Dupoin.
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

export function imageQuotaNotice(modelName: string, retryIn?: string | null, backupName?: string | null): string {
  const wait = retryIn?.trim() ? `retry in ${retryIn.trim()}` : 'retry later';
  if (backupName?.trim()) return `Image quota reached for ${modelName}, ${wait}; backup image model ${backupName.trim()} was also unavailable`;
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
 * Google disabled the Antigravity account behind 9router (403 PERMISSION_DENIED
 * / TOS_VIOLATION, seen on production 2026-11-26). Nothing a MarketingOS user
 * or admin setting can change; the account owner must appeal or reconnect.
 */
export function isUpstreamAccountDisabledFailure(reason: string): boolean {
  const lower = reason.toLowerCase();
  return lower.includes('tos_violation')
    || lower.includes('violation of terms of service')
    || lower.includes('disabled in this account')
    || (parseImageApiErrorStatus(reason) === 403 && lower.includes('permission_denied'));
}

/**
 * Upstream refused the request for access reasons (401/403, expired token,
 * permission denied, disabled account). For an `ag/…` image model the same
 * prompt can still succeed on another free gateway model, so it is retried
 * once like a quota hit.
 */
export function isAccessOrAuthFailure(reason: string): boolean {
  const status = parseImageApiErrorStatus(reason);
  if (status === 401 || status === 403) return true;
  if (isUpstreamAccountDisabledFailure(reason)) return true;
  const lower = reason.toLowerCase();
  return lower.includes('permission_denied')
    || lower.includes('token expired')
    || lower.includes('token is expired')
    || lower.includes('re-authenticate');
}

/** Failures on an `ag/…` image model that a single retry on another model can cover. */
export function isAntigravityRetryableFailure(reason: string): boolean {
  return isCapacityOrRateLimitFailure(reason) || isAccessOrAuthFailure(reason);
}

/**
 * Auto-fallback is only for Antigravity T2I (`ag/…`) capacity / quota /
 * rate-limit failures (including 502s that wrap those markers) and access
 * failures (401/403, expired token, account disabled by Google).
 *
 * We do **not** fallback on 404, billing, timeouts, empty images, or a true
 * 5xx outage without capacity text — those need a different fix.
 * Returns false while no fallback model is configured.
 */
export function shouldFallbackAntigravityImage(model: string, reason: string): boolean {
  if (!isAntigravityImageModel(model)) return false;
  if (!antigravityImageFallbackFor(model)) return false;
  return isAntigravityRetryableFailure(reason);
}

export function antigravityCapacityFallbackMessage(
  _fromModel: string,
  toModel: string,
): string {
  return `Antigravity quota full — used ${imageModelLabel(toModel)} instead`;
}

/** Toast copy when an `ag/…` image model was refused (401/403) and the backup made the image. */
export function antigravityAccessFallbackMessage(
  fromModel: string,
  toModel: string,
  reason: string,
): string {
  const cause = isUpstreamAccountDisabledFailure(reason)
    ? 'its Google (Antigravity) account was disabled by Google'
    : 'it was refused by the image service';
  return `${imageModelLabel(fromModel)} is unavailable (${cause}) — used ${imageModelLabel(toModel)} instead`;
}

/** Fallback toast copy that matches why the first attempt failed. */
export function antigravityFallbackMessage(fromModel: string, toModel: string, reason: string): string {
  return isCapacityOrRateLimitFailure(reason)
    ? antigravityCapacityFallbackMessage(fromModel, toModel)
    : antigravityAccessFallbackMessage(fromModel, toModel, reason);
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
 * capacity/quota/rate-limit or access (401/403), and a fallback is configured
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
    onRetry?: (fallbackModel: string, fromModel: string, reason: string) => void | Promise<void>;
    /** Called with the backup's own failure before the original error is rethrown. */
    onFallbackError?: (fallbackModel: string, error: unknown) => void;
    /** Override the configured fallback (tests). `null` disables the retry. */
    fallbackModel?: string | null;
    /** Called for every failed attempt (requested model and backup), e.g. to record quota state. */
    onAttemptError?: (model: string, error: unknown) => void;
  },
): Promise<ImageGenerationFallbackResult<T>> {
  try {
    const payload = await generate(requestedModel);
    return { payload, requestedModel, usedModel: requestedModel };
  } catch (error) {
    options?.onAttemptError?.(requestedModel, error);
    const reason = error instanceof Error ? error.message : 'unknown error';
    const fallbackModel = options && 'fallbackModel' in options
      ? options.fallbackModel ?? null
      : antigravityImageFallbackFor(requestedModel);
    if (
      !fallbackModel
      || fallbackModel === requestedModel
      || !isAntigravityImageModel(requestedModel)
      || !isAntigravityRetryableFailure(reason)
    ) {
      throw error;
    }

    // Exactly one retry: the backup's own failure is never retried again.
    await options?.onRetry?.(fallbackModel, requestedModel, reason);

    try {
      const payload = await generate(fallbackModel);
      return {
        payload,
        requestedModel,
        usedModel: fallbackModel,
        fallbackFrom: requestedModel,
        fallbackMessage: antigravityFallbackMessage(requestedModel, fallbackModel, reason),
      };
    } catch (fallbackError) {
      options?.onAttemptError?.(fallbackModel, fallbackError);
      options?.onFallbackError?.(fallbackModel, fallbackError);
      throw error;
    }
  }
}
