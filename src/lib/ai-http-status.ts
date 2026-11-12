/**
 * AI provider failures must not use HTTP 502. Cloudflare replaces 502 bodies,
 * so the browser only sees a generic error.
 */
export function aiProviderStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/free-model rate limit|\b429\b|rate limit/i.test(message)) return 429;
  if (/needs OpenRouter credits|\b402\b|insufficient credit/i.test(message)) return 402;
  if (/timed out|timeout|ECONNREFUSED|ENOTFOUND|fetch failed|temporarily unavailable|bad gateway/i.test(message)) return 503;
  return 424;
}

export function aiProviderErrorBody(error: unknown): { error: string } {
  const message = error instanceof Error ? error.message : 'The AI provider could not complete this request.';
  const status = aiProviderStatus(error);
  if (status === 429) return { error: 'The AI model is rate-limited. Try again later.' };
  if (status === 402) return { error: 'image generation needs OpenRouter credits' };
  if (status === 503) return { error: 'The AI provider is temporarily unavailable. Try again later.' };
  return { error: message || 'The AI provider could not complete this request.' };
}

export function statusFallbackText(status: number): string {
  if (status === 429) return 'The AI model is rate-limited. Try again later.';
  if (status === 402) return 'image generation needs OpenRouter credits';
  if (status === 424) return 'The AI provider could not complete this request.';
  if (status === 503) return 'The AI provider is temporarily unavailable. Try again later.';
  if (status >= 500) return 'The server could not complete this request. Try again.';
  return 'The request failed.';
}
