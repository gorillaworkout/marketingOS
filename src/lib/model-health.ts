export const MODEL_HEALTH_TIMEOUT_MS = 18_000;
export const MODEL_HEALTH_MAX_TOKENS = 4;
export const MODEL_HEALTH_PROMPT = 'ping';
export const MODEL_HEALTH_ERROR_MAX_LENGTH = 160;

const GORILLAWORKOUT_API_BASE = process.env.GORILLAWORKOUT_API_BASE || 'https://llm.gorillaworkout.id/v1';
const GORILLAWORKOUT_API_KEY = process.env.GORILLAWORKOUT_API_KEY || '';

export type ModelHealthStatus = 'ok' | 'fail';

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
  if (typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
    return value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return 'Gateway error';
  }
}

export function describeHealthFailure(options: {
  httpStatus: number | null;
  raw: string;
  timedOut?: boolean;
  secrets?: string[];
}): string {
  if (options.timedOut) return 'Timed out waiting for gateway';
  const sanitized = sanitizeHealthError(options.raw, options.secrets);
  switch (options.httpStatus) {
    case 401:
      return 'Auth failed (expired or invalid API key)';
    case 403:
      return 'Forbidden by gateway';
    case 404:
      return 'Model not found on gateway';
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
  startedAt: number,
  now: () => Date,
): ModelHealthResult {
  return {
    model,
    name,
    status,
    httpStatus,
    error,
    checkedAt: now().toISOString(),
    latencyMs: Math.max(0, Date.now() - startedAt),
  };
}

/**
 * Cheap non-streaming chat/completions ping against the GorillaWorkout gateway.
 * Never returns API keys or Authorization material.
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
    return result(modelId, name, 'fail', null, 'Gateway is not configured', startedAt, now);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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
    if (!response.ok) {
      return result(
        modelId,
        name,
        'fail',
        response.status,
        describeHealthFailure({ httpStatus: response.status, raw: rawBody, secrets }),
        startedAt,
        now,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return result(modelId, name, 'fail', response.status, 'Invalid JSON from gateway', startedAt, now);
    }

    if (payload && typeof payload === 'object' && 'error' in payload && payload.error) {
      return result(
        modelId,
        name,
        'fail',
        response.status,
        describeHealthFailure({
          httpStatus: response.status,
          raw: extractErrorMessage(payload.error),
          secrets,
        }),
        startedAt,
        now,
      );
    }

    const choices = payload && typeof payload === 'object' && 'choices' in payload
      ? (payload as { choices?: unknown }).choices
      : null;
    if (!Array.isArray(choices)) {
      return result(modelId, name, 'fail', response.status, 'Gateway response missing choices', startedAt, now);
    }

    return result(modelId, name, 'ok', response.status, null, startedAt, now);
  } catch (error) {
    if (isAbortError(error)) {
      return result(
        modelId,
        name,
        'fail',
        null,
        describeHealthFailure({ httpStatus: null, raw: '', timedOut: true, secrets }),
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
      startedAt,
      now,
    );
  } finally {
    clearTimeout(timer);
  }
}
