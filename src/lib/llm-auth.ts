export const AUTH_COOLDOWN_MS = 15 * 60 * 1000;

const expiredUntil = new Map<string, number>();

export function isAuthFailure(status: number, body: string): boolean {
  const text = body.slice(0, 800);
  if (status === 401) return true;
  if (/authentication_error|invalid_api_key|oauth token|token is expired|token expired/i.test(text)) return true;
  return status === 503 && (/\b401\b|authentication_error|token expired/i.test(text));
}

export function isAuthFailureMessage(message: string): boolean {
  return /API error 401\b|HTTP 401\b|authentication_error|invalid_api_key|oauth token|token is expired|token expired/i.test(message)
    || (/API error 503\b/.test(message) && /\b401\b|authentication_error|token expired/i.test(message));
}

export function noteAuthExpired(model: string, now = Date.now()): void {
  expiredUntil.set(model, now + AUTH_COOLDOWN_MS);
}

export function clearAuthExpired(model: string): void {
  expiredUntil.delete(model);
}

export function resetAuthCooldownForTests(): void {
  expiredUntil.clear();
}

export function authCooldownModels(now = Date.now()): string[] {
  const cooled: string[] = [];
  for (const [model, until] of expiredUntil) {
    if (until > now) cooled.push(model);
    else expiredUntil.delete(model);
  }
  return cooled;
}

export function storedAuthExpired(input: { status?: string; message?: string; lastError?: string }): boolean {
  if (input.status === 'active') return false;
  const blob = `${input.message || ''}\n${input.lastError || ''}`;
  return isAuthFailureMessage(blob) || /authentication_error|oauth expired|oauth token/i.test(blob);
}

/**
 * True when a successful Dupoin test of `model` supersedes the stored provider
 * error: the error names that model (e.g. "[claude/claude-sonnet-5-5]" for
 * cc/claude-sonnet-5-5) or names no model at all.
 */
export function providerErrorClearedBy(lastError: string | null | undefined, model: string): boolean {
  const error = (lastError || '').trim();
  if (!error) return false;
  const named = [...error.matchAll(/\[([A-Za-z0-9_.~-]+\/[A-Za-z0-9_.:~-]+)\]/g)].map(match => match[1].toLowerCase());
  if (!named.length) return true;
  const base = model.toLowerCase().split('/').pop() || '';
  return named.some(name => name === model.toLowerCase() || name.split('/').pop() === base);
}

/** A stored provider error only marks a model when it is newer than that model's last test. */
export function providerErrorAppliesTo(row: { provider: string; testedAt?: string | null }, lastFailoverAt?: string | null): boolean {
  if (row.provider !== 'dupoin') return false;
  if (!row.testedAt || !lastFailoverAt) return true;
  return Date.parse(lastFailoverAt) > Date.parse(row.testedAt);
}

export function authFailoverNotice(failedName: string, nextName: string): string {
  return `Model ${failedName} token expired — switched to ${nextName}. Please re-authenticate ${failedName} in AI Models.`;
}
