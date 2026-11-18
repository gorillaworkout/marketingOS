/**
 * Single source of truth for the GorillaWorkout OpenAI-compatible gateway.
 *
 * Production (marketing-aws) talks to llmdupoin. Override with
 * GORILLAWORKOUT_API_BASE / GORILLAWORKOUT_API_KEY. Never hardcode secrets.
 */
export const DEFAULT_GORILLAWORKOUT_API_BASE = 'https://llmdupoin.gorillaworkout.id/v1';

export function resolveGorillaWorkoutApiBase(override?: string): string {
  const raw = (override ?? process.env.GORILLAWORKOUT_API_BASE ?? DEFAULT_GORILLAWORKOUT_API_BASE).trim();
  return raw.replace(/\/+$/, '') || DEFAULT_GORILLAWORKOUT_API_BASE;
}

/**
 * Base for gateway image generation. `GORILLAWORKOUT_IMAGE_API_BASE` lets a server on the
 * same host as 9Router call it directly (e.g. http://127.0.0.1:20128/v1) instead of
 * through the Cloudflare tunnel, which answers 524 after ~100 s; slow image models
 * (cx/gpt-6-sol-image with references) can exceed that. Falls back to the normal base.
 */
export function resolveGorillaWorkoutImageApiBase(override?: string): string {
  const raw = (override ?? process.env.GORILLAWORKOUT_IMAGE_API_BASE ?? '').trim().replace(/\/+$/, '');
  return raw || resolveGorillaWorkoutApiBase();
}

export function resolveGorillaWorkoutApiKey(override?: string): string {
  return override ?? process.env.GORILLAWORKOUT_API_KEY ?? '';
}

export const GORILLAWORKOUT_API_BASE = resolveGorillaWorkoutApiBase();
export const GORILLAWORKOUT_API_KEY = resolveGorillaWorkoutApiKey();
