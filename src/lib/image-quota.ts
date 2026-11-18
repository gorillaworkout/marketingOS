/**
 * Image-model quota state: parse when an exhausted model resets, remember it
 * per model in server memory until then, and word it for the UI in WIB.
 *
 * Pure helpers (parse/format/notice) are safe to import in client code. The
 * store lives on globalThis in the Next server process; it is a cache, not a
 * source of truth, so a restart only forgets it (no migration).
 */

export const QUOTA_TIMEZONE = 'Asia/Jakarta';
export const QUOTA_TIMEZONE_LABEL = 'WIB';
/** How long an exhausted model stays flagged when its reset time is unknown. */
export const UNKNOWN_RESET_TTL_MS = 15 * 60 * 1000;
/** Upper bound for a parsed reset, so a bad value cannot pin a model for days. */
const MAX_RESET_MS = 7 * 24 * 60 * 60 * 1000;

const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000, ms: 1 };

/** "1h48m15s", "1h 48m", "48m", "30s", "8m 56s", "1.5s", "6497s" → ms, or null. */
export function parseDurationMs(text: string): number | null {
  const source = String(text || '').trim().toLowerCase();
  if (!source) return null;
  const re = /(\d+(?:\.\d+)?)\s*(ms|d|h|m|s)(?![a-z])/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    matched = true;
    total += Number(match[1]) * UNIT_MS[match[2]];
  }
  return matched && Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

type HeaderBag = Headers | Record<string, string | null | undefined> | null | undefined;

function header(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name);
  const bag = headers as Record<string, string | null | undefined>;
  const key = Object.keys(bag).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? bag[key] ?? null : null;
}

/** Retry-After (seconds or HTTP date) or x-ratelimit-reset (seconds, epoch s/ms, or ISO). */
function resetFromHeaders(headers: HeaderBag, now: number): number | null {
  const retryAfter = header(headers, 'retry-after');
  if (retryAfter) {
    const trimmed = retryAfter.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) return now + Number(trimmed) * 1000;
    const date = Date.parse(trimmed);
    if (Number.isFinite(date)) return date;
  }
  const reset = header(headers, 'x-ratelimit-reset') ?? header(headers, 'x-ratelimit-reset-requests');
  if (reset) {
    const trimmed = reset.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      const value = Number(trimmed);
      if (value > 1e12) return value; // epoch ms
      if (value > 1e9) return value * 1000; // epoch s
      return now + value * 1000; // delta seconds
    }
    const duration = parseDurationMs(trimmed);
    if (duration) return now + duration;
    const date = Date.parse(trimmed);
    if (Number.isFinite(date)) return date;
  }
  return null;
}

/**
 * Structured fields in the (possibly escaped) JSON body. Antigravity sends
 * ErrorInfo.metadata.quotaResetTimeStamp / quotaResetDelay and
 * RetryInfo.retryDelay; the absolute timestamp is the most exact.
 */
function resetFromStructured(text: string, now: number): number | null {
  const unescaped = text.replace(/\\"/g, '"');
  const at = /"(?:quotaResetTimeStamp|resetAt|reset_at|resetTime|reset_time)"\s*:\s*"([^"]+)"/i.exec(unescaped);
  if (at) {
    const date = Date.parse(at[1]);
    if (Number.isFinite(date)) return date;
  }
  const delay = /"(?:quotaResetDelay|retryDelay|retry_after|retryAfter)"\s*:\s*"?([0-9.\sdhms]+)"?/i.exec(unescaped);
  if (delay) {
    const raw = delay[1].trim();
    const ms = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : parseDurationMs(raw);
    if (ms) return now + ms;
  }
  return null;
}

/**
 * Free text: "reset after 1h48m15s", "resets in about 1h48m", "try again in 30s",
 * "reset after ~48m". Several matches can appear (the gateway appends its own
 * short "(reset after 8s)" cooldown), so the latest one wins.
 */
function resetFromText(text: string, now: number): number | null {
  const re = /(?:reset(?:s)?|retry|try again)(?:\s+(?:after|in))\s+(?:about\s+|approximately\s+|approx\.?\s+|around\s+|~\s*)?((?:\d+(?:\.\d+)?\s*(?:ms|d|h|m|s)(?![a-z])\s*)+)/gi;
  let best: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const ms = parseDurationMs(match[1]);
    if (ms && (best === null || ms > best)) best = ms;
  }
  return best === null ? null : now + best;
}

/**
 * Absolute reset time (epoch ms) for a quota error, or null when it cannot be
 * read. Structured upstream fields win; otherwise the latest of the text
 * and Retry-After / x-ratelimit-reset hints.
 */
export function parseQuotaResetAt(reason: string, now: number = Date.now(), headers?: HeaderBag): number | null {
  const text = String(reason || '');
  const valid = (value: number | null): value is number =>
    value !== null && Number.isFinite(value) && value > now - 60_000 && value - now <= MAX_RESET_MS;
  // 0) llm-provider already read the full body and headers (the message is truncated).
  const marked = /\[quota-reset-at: ([^\]]+)\]/.exec(text);
  if (marked) {
    const date = Date.parse(marked[1]);
    if (valid(date)) return date;
  }
  // 1) Upstream structured quota fields are exact.
  const structured = resetFromStructured(text, now);
  if (valid(structured)) return structured;
  // 2) Otherwise the latest of the text and header hints. The gateway's own
  //    Retry-After / "(reset after 8s)" is a short cooldown, not the quota
  //    reset, so it must never win over a longer upstream reset.
  const others = [resetFromText(text, now), resetFromHeaders(headers, now), resetFromHeaders(headersFromReason(text), now)].filter(valid);
  return others.length ? Math.max(...others) : null;
}

/** llm-provider appends "[retry-after: …]" / "[x-ratelimit-reset: …]" to image errors so headers survive the Error. */
function headersFromReason(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\[(retry-after|x-ratelimit-reset): ([^\]]+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) out[match[1].toLowerCase()] = match[2];
  return out;
}

/**
 * Suffix llm-provider adds to an image HTTP error: the quota reset read from
 * the FULL body + headers (the error text itself is truncated to 500 chars,
 * which cuts off quotaResetTimeStamp), plus the raw reset headers.
 */
export function quotaHeaderSuffix(headers: HeaderBag, body = '', now: number = Date.now()): string {
  const parts: string[] = [];
  const resetAt = body ? parseQuotaResetAt(body, now, headers) : null;
  if (resetAt !== null) parts.push(`[quota-reset-at: ${new Date(resetAt).toISOString()}]`);
  for (const name of ['retry-after', 'x-ratelimit-reset']) {
    const value = header(headers, name);
    if (value && value.length <= 64) parts.push(`[${name}: ${value.replace(/[\]\n]/g, '')}]`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** "15:50 WIB", or "19 Nov 15:50 WIB" when the reset falls on another Jakarta day. */
export function formatWibTime(at: number, now: number = Date.now()): string {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: QUOTA_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  const day = (value: number) => new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  if (day(at) === day(now)) return `${time} ${QUOTA_TIMEZONE_LABEL}`;
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: QUOTA_TIMEZONE, day: 'numeric', month: 'short' }).format(at);
  return `${date} ${time} ${QUOTA_TIMEZONE_LABEL}`;
}

/**
 * Catalog label without a trailing provider tag: "GPT Image 2 (ChatGPT)" → "GPT Image 2".
 * Only provider tags are dropped, so "Nano Banana 2 (Gemini 3.1 Flash Image)" keeps its full name.
 */
const PROVIDER_TAG_RE = /\s*\((?:Antigravity|ChatGPT|OpenRouter(?:,\s*paid|\s+free)?|free|paid)\)\s*$/i;
export function shortModelName(label: string): string {
  return String(label || '').replace(PROVIDER_TAG_RE, '').trim() || String(label || '');
}

/** "<model> quota exhausted, resets around 15:50 WIB" / "<model> quota exhausted, try again later". */
export function quotaExhaustedText(modelLabel: string, resetAt: number | null | undefined, now: number = Date.now()): string {
  const name = shortModelName(modelLabel);
  return typeof resetAt === 'number' && Number.isFinite(resetAt)
    ? `${name} quota exhausted, resets around ${formatWibTime(resetAt, now)}`
    : `${name} quota exhausted, try again later`;
}

/** Result notice when the requested model was out of quota and a free backup made the image. */
export function quotaFallbackNotice(input: { fromLabel: string; resetAt: number | null | undefined; usedLabel: string; usedFree: boolean; now?: number }): string {
  const used = `${shortModelName(input.usedLabel)}${input.usedFree ? ' (free)' : ''}`;
  return `${quotaExhaustedText(input.fromLabel, input.resetAt, input.now)}. This image was generated with ${used} instead.`;
}

/** Error when every free model is out of quota. */
export function allFreeModelsExhaustedText(states: Array<{ label: string; resetAt: number | null }>, now: number = Date.now()): string {
  const known = states.filter(state => typeof state.resetAt === 'number').sort((a, b) => (a.resetAt as number) - (b.resetAt as number));
  if (known.length === 0) return 'All free image models are out of quota; try again later.';
  const first = known[0];
  return `All free image models are out of quota. The earliest reset is around ${formatWibTime(first.resetAt as number, now)}, for ${shortModelName(first.label)}.`;
}

/** Model picker hint: "Quota resets ~15:50 WIB" / "Quota exhausted, try again later". */
export function quotaPickerHint(resetAt: number | null | undefined, now: number = Date.now()): string {
  return typeof resetAt === 'number' && Number.isFinite(resetAt)
    ? `Quota resets ~${formatWibTime(resetAt, now)}`
    : 'Quota exhausted, try again later';
}

export interface ImageQuotaState {
  model: string;
  /** Epoch ms when the quota resets, or null when unknown. */
  resetAt: number | null;
  /** When the state stops applying (resetAt, or exhaustedAt + UNKNOWN_RESET_TTL_MS). */
  expiresAt: number;
  exhaustedAt: number;
}

/** Wire shape for API responses. */
export interface ImageQuotaInfo {
  model: string;
  modelLabel: string;
  resetAt: string | null;
}

const store = globalThis as typeof globalThis & { __marketingOsImageQuota?: Map<string, ImageQuotaState> };
function quotaMap(): Map<string, ImageQuotaState> {
  if (!store.__marketingOsImageQuota) store.__marketingOsImageQuota = new Map();
  return store.__marketingOsImageQuota;
}

/** Remember that `model` is out of quota until `resetAt` (or a short TTL when unknown). */
export function markImageModelExhausted(model: string, resetAt: number | null, now: number = Date.now()): ImageQuotaState {
  const state: ImageQuotaState = {
    model,
    resetAt,
    exhaustedAt: now,
    expiresAt: resetAt ?? now + UNKNOWN_RESET_TTL_MS,
  };
  quotaMap().set(model, state);
  return state;
}

/** Current quota state for a model, or null once it has reset / expired. */
export function imageModelQuotaState(model: string, now: number = Date.now()): ImageQuotaState | null {
  const state = quotaMap().get(model);
  if (!state) return null;
  if (state.expiresAt <= now) {
    quotaMap().delete(model);
    return null;
  }
  return state;
}

/** A model produced an image: its quota is fine again. */
export function clearImageModelQuota(model: string): void {
  quotaMap().delete(model);
}

/** Every model still flagged as exhausted. */
export function activeImageQuotaStates(now: number = Date.now()): ImageQuotaState[] {
  const out: ImageQuotaState[] = [];
  for (const model of [...quotaMap().keys()]) {
    const state = imageModelQuotaState(model, now);
    if (state) out.push(state);
  }
  return out;
}

/**
 * Models on the same gateway provider prefix (`ag/…`, `cx/…`) share one
 * upstream account, so one exhausted member stands for the group when we
 * decide whether every free model is out.
 */
export function quotaGroup(model: string): string {
  const slash = model.indexOf('/');
  return slash > 0 ? model.slice(0, slash) : model;
}

/**
 * When every given model (or its provider group) is flagged exhausted,
 * the flagged states sorted by earliest reset; otherwise null.
 */
export function allImageModelsExhausted(models: readonly string[], now: number = Date.now()): ImageQuotaState[] | null {
  if (models.length === 0) return null;
  const active = activeImageQuotaStates(now);
  if (active.length === 0) return null;
  const groups = new Set(active.map(state => quotaGroup(state.model)));
  if (!models.every(model => groups.has(quotaGroup(model)))) return null;
  return active
    .filter(state => models.some(model => quotaGroup(model) === quotaGroup(state.model)))
    .sort((a, b) => (a.resetAt ?? Infinity) - (b.resetAt ?? Infinity));
}

/** Test helper. */
export function resetImageQuotaStore(): void {
  quotaMap().clear();
}
