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

export function resolveGorillaWorkoutApiKey(override?: string): string {
  return override ?? process.env.GORILLAWORKOUT_API_KEY ?? '';
}

export const GORILLAWORKOUT_API_BASE = resolveGorillaWorkoutApiBase();
export const GORILLAWORKOUT_API_KEY = resolveGorillaWorkoutApiKey();
