import { GORILLAWORKOUT_API_BASE, GORILLAWORKOUT_API_KEY } from '@/lib/gateway-config';

export const MODEL_HEALTH_TIMEOUT_MS = 18_000;
export const MODEL_HEALTH_MAX_TOKENS = 48;
export const MODEL_HEALTH_PROMPT = 'ping';
export const MODEL_HEALTH_ERROR_MAX_LENGTH = 180;

/** Cloudflare 1010 blocks non-browser User-Agents on the production gateway. */
export const GATEWAY_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type ModelHealthStatus = 'ok' | 'fail' | 'stale';

export interface ModelHealthTarget {
  id: string;
  name: string;
}

export interface ModelHealthResult {
  model: string;
  name: string;
  status: ModelHealthStatus;
  httpStatus: number | null;
  error: string | null;
  snippet: string | null;
  checkedAt: string;
  latencyMs: number;
}

export interface ProbeGatewayOptions {
  name?: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  apiKey?: string;
  timeoutMs?: number;
  now?: () => Date;
}

export function sanitizeHealthError(raw: string, secrets: string[] = []): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      text = text.split(secret).join('[redacted]');
    }
  }
  text = text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  text = text.replace(/\b(?:sk|gw|key)-[A-Za-z0-9._-]{8,}\b/gi, '[redacted]');
  if (text.length > MODEL_HEALTH_ERROR_MAX_LENGTH) {
    text = `${text.slice(0, MODEL_HEALTH_ERROR_MAX_LENGTH - 3)}...`;
  }
  return text;
}

function extractErrorMessage(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
  const record = value as { message?: unknown; type?: unknown; code?: unknown; error?: unknown };
  const message = typeof record.message === 'string' ? record.message : '';
  const type = typeof record.type === 'string' ? record.type : typeof record.code === 'string' ? record.code : '';
  if (message && type && !message.toLowerCase().includes(type.toLowerCase())) {
    return `${type}: ${message}`;
  }
  if (message) return message;
  if (type) return type;
  if (record.error) return extractErrorMessage(record.error);
  try {
    return JSON.stringify(value);
  } catch {
    return 'Gateway error';
  }
}

function extractCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return '';
  const choice = choices[0] as { message?: { content?: unknown }; delta?: { content?: unknown }; text?: unknown };
  const content = choice.message?.content ?? choice.delta?.content ?? choice.text;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map(part => (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function extractGatewaySnippet(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/error code 1010|cf-error-code[^0-9]*1010|cloudflare/i.test(trimmed) && /1010/.test(trimmed)) {
    return 'Cloudflare blocked the probe (error 1010)';
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const fromError = parsed && typeof parsed === 'object' && 'error' in parsed
      ? extractErrorMessage((parsed as { error?: unknown }).error)
      : '';
    if (fromError) return fromError;
    const fromMessage = parsed && typeof parsed === 'object' && 'message' in parsed
      ? extractErrorMessage(parsed)
      : '';
    if (fromMessage) return fromMessage;
    const content = extractCompletionText(parsed);
    if (content) return content;
  } catch {
    // Not JSON — fall through to HTML/text stripping.
  }
  return trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function looksStaleOrDeprecated(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    /no longer available/.test(lower)
    || /deprecated/.test(lower)
    || /has been (retired|removed|replaced|discontinued)/.test(lower)
    || /switch to\s+\S/.test(lower)
    || /please (use|switch|upgrade|migrate)/.test(lower)
    || /gemini 3\.5/.test(lower)
  );
}

export function describeHealthFailure(options: {
  httpStatus: number | null;
  raw: string;
  timedOut?: boolean;
  secrets?: string[];
}): string {
  if (options.timedOut) return 'Timed out waiting for gateway';
  const extracted = extractGatewaySnippet(options.raw);
  const sanitized = sanitizeHealthError(extracted || options.raw, options.secrets);
  if (/cloudflare blocked the probe \(error 1010\)/i.test(sanitized) || /error 1010/.test(sanitized)) {
    return 'Cloudflare blocked the probe (error 1010)';
  }
  switch (options.httpStatus) {
    case 401:
      return sanitized && !/^auth failed/i.test(sanitized)
        ? `Auth failed (expired or invalid API key): ${sanitized}`
        : 'Auth failed (expired or invalid API key)';
    case 403:
      return sanitized && sanitized !== 'Forbidden by gateway' ? sanitized : 'Forbidden by gateway';
    case 404:
      return sanitized && !/not found/i.test(sanitized) ? sanitized : 'Model not found on gateway';
    case 429:
      return 'Gateway rate limited';
    default:
      if (options.httpStatus && options.httpStatus >= 500) {
        return sanitized || `Gateway error ${options.httpStatus}`;
      }
      return sanitized || (options.httpStatus ? `HTTP ${options.httpStatus}` : 'Gateway request failed');
  }
}

export function selectModelsToProbe(
  allowed: ModelHealthTarget[],
  requested?: string | null,
): ModelHealthTarget[] {
  if (!allowed.length) {
    throw new Error('No models are enabled for AI Research');
  }
  if (requested == null || requested === '') return allowed;
  const match = allowed.find(model => model.id === requested);
  if (!match) {
    throw new Error('Model is not enabled for AI Research');
  }
  return [match];
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'name' in error
    && (error.name === 'AbortError' || error.name === 'TimeoutError'),
  );
}

function result(
  model: string,
  name: string,
  status: ModelHealthStatus,
  httpStatus: number | null,
  error: string | null,
  snippet: string | null,
  startedAt: number,
  now: () => Date,
): ModelHealthResult {
  return {
    model,
    name,
    status,
    httpStatus,
    error,
    snippet,
    checkedAt: now().toISOString(),
    latencyMs: Math.max(0, Date.now() - startedAt),
  };
}

/**
 * Cheap non-streaming chat/completions ping against the GorillaWorkout gateway.
 * Uses GORILLAWORKOUT_API_BASE / GORILLAWORKOUT_API_KEY. Never returns API keys.
 */
export async function probeGatewayModel(
  modelId: string,
  options: ProbeGatewayOptions = {},
): Promise<ModelHealthResult> {
  const name = options.name || modelId;
  const now = options.now || (() => new Date());
  const apiBase = (options.apiBase || GORILLAWORKOUT_API_BASE).replace(/\/+$/, '');
  const apiKey = options.apiKey ?? GORILLAWORKOUT_API_KEY;
  const timeoutMs = options.timeoutMs ?? MODEL_HEALTH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl || fetch;
  const secrets = [apiKey].filter(secret => secret.length >= 4);
  const startedAt = Date.now();

  if (!apiKey) {
    return result(modelId, name, 'fail', null, 'Gateway is not configured', null, startedAt, now);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': GATEWAY_BROWSER_USER_AGENT,
        'HTTP-Referer': 'https://marketing-aws.gorillaworkout.id',
        'X-Title': 'MarketingOS AI Research',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: MODEL_HEALTH_PROMPT }],
        stream: false,
        temperature: 0,
        max_tokens: MODEL_HEALTH_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    const rawBody = (await response.text()).slice(0, 2_000);
    const snippet = sanitizeHealthError(extractGatewaySnippet(rawBody), secrets) || null;

    if (!response.ok) {
      return result(
        modelId,
        name,
        'fail',
        response.status,
        describeHealthFailure({ httpStatus: response.status, raw: rawBody, secrets }),
        snippet,
        startedAt,
        now,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return result(modelId, name, 'fail', response.status, 'Invalid JSON from gateway', snippet, startedAt, now);
    }

    if (payload && typeof payload === 'object' && 'error' in payload && payload.error) {
      const message = extractErrorMessage(payload.error);
      return result(
        modelId,
        name,
        'fail',
        response.status,
        describeHealthFailure({ httpStatus: response.status, raw: message || rawBody, secrets }),
        snippet,
        startedAt,
        now,
      );
    }

    const choices = payload && typeof payload === 'object' && 'choices' in payload
      ? (payload as { choices?: unknown }).choices
      : null;
    if (!Array.isArray(choices)) {
      return result(modelId, name, 'fail', response.status, 'Gateway response missing choices', snippet, startedAt, now);
    }

    const content = extractCompletionText(payload);
    const contentSnippet = content ? sanitizeHealthError(content, secrets) : snippet;
    if (content && looksStaleOrDeprecated(content)) {
      return result(
        modelId,
        name,
        'stale',
        response.status,
        'Reachable, but the reply looks like a deprecation or switch notice',
        contentSnippet,
        startedAt,
        now,
      );
    }

    return result(modelId, name, 'ok', response.status, null, contentSnippet, startedAt, now);
  } catch (error) {
    if (isAbortError(error)) {
      return result(
        modelId,
        name,
        'fail',
        null,
        describeHealthFailure({ httpStatus: null, raw: '', timedOut: true, secrets }),
        null,
        startedAt,
        now,
      );
    }
    const raw = error instanceof Error ? error.message : 'Gateway request failed';
    return result(
      modelId,
      name,
      'fail',
      null,
      describeHealthFailure({ httpStatus: null, raw, secrets }),
      sanitizeHealthError(raw, secrets) || null,
      startedAt,
      now,
    );
  } finally {
    clearTimeout(timer);
  }
}
