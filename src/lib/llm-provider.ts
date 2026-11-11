import { resolveGorillaWorkoutApiBase, resolveGorillaWorkoutApiKey } from '@/lib/gateway-config';
import {
  DEFAULT_OPENROUTER_CHAT_MODEL,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_IMAGE_MODEL,
  EMBEDDINGS_FAILOVER_NOTE,
  FREE_MODEL_LIMIT_NOTE,
  IMAGES_FAILOVER_NOTE,
  OPENROUTER_API_BASE,
  VERIFIED_OPENROUTER_IMAGE_MODELS,
  type LlmKind,
  type LlmMode,
  type LlmModelMapping,
  type UsageProvider,
} from '@/lib/llm-provider-defaults';
import { scrubSecrets } from '@/lib/llm-crypto';
import {
  getLlmSettings,
  markProviderRecovered,
  recordProviderFailover,
  type LlmSettings,
} from '@/lib/llm-provider-store';

export {
  EMBEDDINGS_FAILOVER_NOTE,
  FREE_MODEL_LIMIT_NOTE,
  IMAGES_FAILOVER_NOTE,
  OPENROUTER_API_BASE,
  DEFAULT_OPENROUTER_CHAT_MODEL,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_IMAGE_MODEL,
};

/** One Dupoin attempt plus one OpenRouter attempt. Never a third try. */
export const MAX_PROVIDER_FAILOVERS = 1;

export const OPENROUTER_RATE_LIMIT_MESSAGE =
  'OpenRouter free-model rate limit (HTTP 429). Free models have a request limit. Wait and try again, or edit the mapping to a paid model. This request is not retried.';

export const IMAGE_CREDITS_MESSAGE = 'image generation needs OpenRouter credits';
export type { LlmKind, LlmMode, LlmModelMapping, UsageProvider };

export const PROVIDER_FAILURES_TO_OPEN = 3;
export const PROVIDER_CIRCUIT_OPEN_MS = 5 * 60 * 1000;

export type CircuitState = { consecutiveFailures: number; openUntil: number };
export type ProviderChoice = 'dupoin' | 'openrouter';
export type AttemptOutcome = 'ok' | 'transport' | 'client' | 'abort' | 'config';

const circuit: CircuitState = { consecutiveFailures: 0, openUntil: 0 };
let notedProvider: ProviderChoice | null = null;
let settingsReader: (() => Promise<LlmSettings>) | null = null;
let fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);

export function canManageLlmProvider(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === 'admin';
}

export function isProviderFailoverStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function isLlmTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' && /timeout/i.test(error.message));
}

export function chooseProvider(mode: LlmMode, state: CircuitState, now: number): ProviderChoice {
  if (mode === 'openrouter') return 'openrouter';
  if (mode === 'dupoin') return 'dupoin';
  return state.openUntil > now ? 'openrouter' : 'dupoin';
}

/**
 * Automatic mode failovers only for transport failures, and only before any
 * response body has been streamed to the user. A bad prompt (other 4xx) stays
 * on Dupoin. Three transport failures open the circuit for five minutes.
 */
export function applyProviderResult(input: {
  mode: LlmMode;
  attempted: ProviderChoice;
  outcome: AttemptOutcome;
  streamedToUser: boolean;
  circuit: CircuitState;
  now: number;
}): { circuit: CircuitState; failover: boolean } {
  if (input.mode !== 'auto' || input.attempted !== 'dupoin') {
    return { circuit: input.circuit, failover: false };
  }
  if (input.outcome === 'ok') {
    return { circuit: { consecutiveFailures: 0, openUntil: 0 }, failover: false };
  }
  if (input.outcome !== 'transport') return { circuit: input.circuit, failover: false };
  const consecutiveFailures = input.circuit.consecutiveFailures + 1;
  const openUntil = consecutiveFailures >= PROVIDER_FAILURES_TO_OPEN
    ? input.now + PROVIDER_CIRCUIT_OPEN_MS
    : (input.circuit.openUntil > input.now ? input.circuit.openUntil : 0);
  return {
    circuit: { consecutiveFailures, openUntil },
    failover: !input.streamedToUser,
  };
}

export function mapModel(model: string, mappings: readonly LlmModelMapping[], fallback: string, kind: LlmKind): { model: string; mapped: boolean } {
  const match = mappings.find(row => row.dupoinModel === model && row.kind === kind)
    || mappings.find(row => row.dupoinModel === model);
  if (match?.openrouterModel) return { model: match.openrouterModel, mapped: true };
  return { model: fallback, mapped: false };
}

export function resolveProviderTarget(input: {
  settings: LlmSettings;
  provider: ProviderChoice;
  kind: LlmKind;
  model: string;
}): { baseUrl: string; apiKey: string; model: string; provider: ProviderChoice; missingKeyMessage: string } {
  if (input.provider === 'dupoin') {
    return {
      baseUrl: resolveGorillaWorkoutApiBase(),
      apiKey: resolveGorillaWorkoutApiKey(),
      model: input.model,
      provider: 'dupoin',
      missingKeyMessage: 'GORILLAWORKOUT_API_KEY is not configured.',
    };
  }
  const fallback = input.kind === 'image'
    ? input.settings.defaultImageModel
    : input.kind === 'embedding'
      ? input.settings.defaultEmbeddingModel
      : input.settings.defaultChatModel;
  const builtin = input.kind === 'image'
    ? DEFAULT_OPENROUTER_IMAGE_MODEL
    : input.kind === 'embedding'
      ? DEFAULT_OPENROUTER_EMBEDDING_MODEL
      : DEFAULT_OPENROUTER_CHAT_MODEL;
  const mapped = mapModel(input.model, input.settings.mappings, fallback || builtin, input.kind);
  return {
    baseUrl: OPENROUTER_API_BASE,
    apiKey: input.settings.openrouterKey,
    model: mapped.model,
    provider: 'openrouter',
    missingKeyMessage: 'OpenRouter API key is not configured. Add it in LLM Provider settings.',
  };
}

export function usageProvider(provider: ProviderChoice): UsageProvider {
  return provider === 'openrouter' ? 'openrouter' : 'gorillaworkout';
}

export function explainLlmHttpError(provider: UsageProvider, status: number, body: string, kind: LlmKind = 'chat'): string {
  const text = body.slice(0, 500);
  const credit = status === 402 || /insufficient|credits|payment required/i.test(text);
  if (provider === 'openrouter' && kind === 'image' && credit) {
    return `${IMAGE_CREDITS_MESSAGE}. OpenRouter has no free image model. Add credits, then try again.`;
  }
  if (provider === 'openrouter' && status === 429) return OPENROUTER_RATE_LIMIT_MESSAGE;
  if (kind === 'image') {
    const label = provider === 'openrouter' ? 'OpenRouter image error' : 'Image API error';
    return `${label} ${status}: ${text}`;
  }
  return `API error ${status}: ${text}`;
}

export function isTerminalProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes(OPENROUTER_RATE_LIMIT_MESSAGE)
    || message.includes(IMAGE_CREDITS_MESSAGE)
    || message.includes('OpenRouter model unavailable');
}

export const MAX_OPENROUTER_CHAT_ATTEMPTS = 8;

/** Mapped model first, then the admin list. Each id is tried at most once. */
export function openRouterChatChain(primary: string, fallbacks: readonly string[]): string[] {
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const candidate of [primary, ...fallbacks]) {
    const model = candidate.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    chain.push(model);
    if (chain.length >= MAX_OPENROUTER_CHAT_ATTEMPTS) break;
  }
  return chain;
}

export function shouldTryNextOpenRouterChat(status: number): boolean {
  return status === 429 || status === 404;
}

export type ModelHealthStatus = 'active' | 'rate_limited' | 'blocked' | 'credits' | 'error';

export function classifyModelProbe(httpStatus: number, body: string): ModelHealthStatus {
  if (httpStatus >= 200 && httpStatus < 300) return 'active';
  if (httpStatus === 429) return 'rate_limited';
  if (httpStatus === 402 || /insufficient credit|payment required|needs credits|requires more credits/i.test(body)) return 'credits';
  if (httpStatus === 404 || /guardrail|data policy|not a valid model|no endpoints found|model not found|unavailable/i.test(body)) return 'blocked';
  return 'error';
}

export function healthStatusLabel(status: ModelHealthStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'rate_limited') return 'Rate-limited';
  if (status === 'blocked') return 'Blocked/Unavailable';
  if (status === 'credits') return 'Needs credits';
  return 'Error';
}

/**
 * OpenRouter embeddings are not stored. liquid/lfm-2.5-embedding-350m:free is
 * 1024-wide, the same count as the local hash, but it is a different space.
 * Writing it into knowledge_entries would make cosine similarity mix the two.
 */
export function failoverEmbeddingWriteAllowed(): false {
  return false;
}

export function imageRequestPath(provider: ProviderChoice): string {
  return provider === 'openrouter' ? '/images' : '/images/generations';
}

export function openRouterImageSupported(model: string): boolean {
  return (VERIFIED_OPENROUTER_IMAGE_MODELS as readonly string[]).includes(model);
}

export function readCircuit(): CircuitState {
  return { ...circuit };
}

export function resetLlmProviderForTests(): void {
  circuit.consecutiveFailures = 0;
  circuit.openUntil = 0;
  notedProvider = null;
  settingsReader = null;
  fetchImpl = globalThis.fetch.bind(globalThis);
}

export function setLlmSettingsReaderForTests(reader: (() => Promise<LlmSettings>) | null): void {
  settingsReader = reader;
}

export function setLlmFetchForTests(next: typeof fetch | null): void {
  fetchImpl = next ? next.bind(globalThis) : globalThis.fetch.bind(globalThis);
}

function adoptStoredCircuit(settings: LlmSettings, now: number): void {
  if (circuit.consecutiveFailures > 0 || circuit.openUntil > now) return;
  const until = settings.status.circuitOpenUntil ? Date.parse(settings.status.circuitOpenUntil) : 0;
  if (until > now) {
    circuit.openUntil = until;
    circuit.consecutiveFailures = settings.status.consecutiveFailures;
  }
}

async function loadSettings(now: number): Promise<LlmSettings> {
  const settings = settingsReader ? await settingsReader() : await getLlmSettings();
  adoptStoredCircuit(settings, now);
  return settings;
}

function providerHeaders(apiKey: string, referer: string, title: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': referer,
    'X-Title': title,
  };
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { code?: string } }).cause;
  const text = `${error.name} ${error.message} ${cause?.code || ''}`;
  return /fetch failed|network|ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN|ETIMEDOUT|UND_ERR|socket/i.test(text);
}

type Attempt =
  | { kind: 'http'; response: Response; outcome: 'ok' | 'transport' | 'client' }
  | { kind: 'thrown'; outcome: 'transport' | 'abort'; error: Error }
  | { kind: 'config'; outcome: 'config'; error: Error };

async function attemptFetch(input: {
  url: string;
  apiKey: string;
  missingKeyMessage: string;
  body: Record<string, unknown>;
  referer: string;
  title: string;
  timeoutMs: number;
  userSignal?: AbortSignal;
}): Promise<Attempt> {
  if (!input.apiKey) return { kind: 'config', outcome: 'config', error: new Error(input.missingKeyMessage) };
  const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
  const signal = input.userSignal ? AbortSignal.any([input.userSignal, timeoutSignal]) : timeoutSignal;
  try {
    const response = await fetchImpl(input.url, {
      method: 'POST',
      headers: providerHeaders(input.apiKey, input.referer, input.title),
      body: JSON.stringify(input.body),
      signal,
    });
    if (response.ok) return { kind: 'http', response, outcome: 'ok' };
    return { kind: 'http', response, outcome: isProviderFailoverStatus(response.status) ? 'transport' : 'client' };
  } catch (error) {
    const thrown = error instanceof Error ? error : new Error('LLM request failed');
    if (input.userSignal?.aborted) return { kind: 'thrown', outcome: 'abort', error: thrown };
    if (timeoutSignal.aborted || isLlmTimeoutError(thrown) || isNetworkError(thrown)) {
      return { kind: 'thrown', outcome: 'transport', error: thrown };
    }
    return { kind: 'thrown', outcome: 'abort', error: thrown };
  }
}

async function rejectTerminal(provider: ProviderChoice, response: Response, kind: LlmKind): Promise<void> {
  if (provider !== 'openrouter' || response.ok || (response.status !== 429 && response.status !== 402)) return;
  const text = await response.clone().text().catch(() => '');
  const message = explainLlmHttpError('openrouter', response.status, text, kind);
  if (isTerminalProviderError(message)) throw new Error(message);
}

function writeCircuit(next: CircuitState): void {
  circuit.consecutiveFailures = next.consecutiveFailures;
  circuit.openUntil = next.openUntil;
}

async function remember(input: {
  provider: ProviderChoice;
  reason?: string;
  upstreamModel: string;
  now: number;
}): Promise<void> {
  const changed = notedProvider !== input.provider;
  notedProvider = input.provider;
  if (!input.reason && !changed) return;
  if (!input.reason) return;
  try {
    await recordProviderFailover({
      reason: input.reason,
      upstreamModel: input.upstreamModel,
      circuitOpenUntil: circuit.openUntil,
      consecutiveFailures: circuit.consecutiveFailures,
      activeProvider: input.provider,
    });
  } catch (error) {
    console.error('[llm-provider] could not record failover:', error instanceof Error ? error.message : error);
  }
}

export type ChatExchange = {
  response: Response;
  provider: UsageProvider;
  upstreamModel: string;
  failoverReason?: string;
};

async function completeOpenRouterChat(input: {
  settings: LlmSettings;
  body: Record<string, unknown>;
  referer: string;
  title: string;
  timeoutMs: number;
  userSignal?: AbortSignal;
  requestedModel: string;
  now: number;
  failoverReason?: string;
}): Promise<ChatExchange> {
  const primary = resolveProviderTarget({ settings: input.settings, provider: 'openrouter', kind: 'chat', model: input.requestedModel });
  const chain = openRouterChatChain(primary.model, input.settings.chatFallbacks || []);
  if (!primary.apiKey) throw new Error(primary.missingKeyMessage);
  let last: Attempt | null = null;
  let lastModel = chain[0] || primary.model;
  for (let index = 0; index < chain.length; index += 1) {
    const model = chain[index];
    lastModel = model;
    const attempt = await attemptFetch({
      url: `${primary.baseUrl}/chat/completions`,
      apiKey: primary.apiKey,
      missingKeyMessage: primary.missingKeyMessage,
      body: { ...input.body, model },
      referer: input.referer,
      title: input.title,
      timeoutMs: input.timeoutMs,
      userSignal: input.userSignal,
    });
    last = attempt;
    if (attempt.kind === 'http' && attempt.response.ok) {
      return {
        response: attempt.response,
        provider: 'openrouter',
        upstreamModel: model,
        failoverReason: index > 0 ? `Answered by ${model} after ${chain.slice(0, index).join(', ')}` : input.failoverReason,
      };
    }
    const status = attempt.kind === 'http' ? attempt.response.status : 0;
    if (!(attempt.kind === 'http' && shouldTryNextOpenRouterChat(status) && index < chain.length - 1)) break;
  }
  if (last?.kind === 'http') {
    await rejectTerminal('openrouter', last.response, 'chat');
    if (last.response.status === 404) {
      throw new Error(`OpenRouter model unavailable (HTTP 404). Tried ${chain.join(', ')} once each.`);
    }
    return { response: last.response, provider: 'openrouter', upstreamModel: lastModel, failoverReason: input.failoverReason };
  }
  if (last?.kind === 'thrown' || last?.kind === 'config') throw last.error;
  throw new Error('OpenRouter chat failed');
}

export async function postChat(input: {
  model: string;
  body: Record<string, unknown>;
  referer: string;
  title: string;
  timeoutMs: number;
  userSignal?: AbortSignal;
  /** Set when tokens were already sent to the user. Failover must not retry. */
  streamedToUser?: boolean;
  now?: number;
}): Promise<ChatExchange> {
  const now = input.now ?? Date.now();
  const settings = await loadSettings(now);
  const before = readCircuit();
  const first = chooseProvider(settings.mode, circuit, now);
  const run = (provider: ProviderChoice) => {
    const target = resolveProviderTarget({ settings, provider, kind: 'chat', model: input.model });
    return {
      target,
      attempt: attemptFetch({
        url: `${target.baseUrl}/chat/completions`,
        apiKey: target.apiKey,
        missingKeyMessage: target.missingKeyMessage,
        body: { ...input.body, model: target.model },
        referer: input.referer,
        title: input.title,
        timeoutMs: input.timeoutMs,
        userSignal: input.userSignal,
      }),
    };
  };

  if (first === 'openrouter') {
    return completeOpenRouterChat({ settings, body: input.body, referer: input.referer, title: input.title, timeoutMs: input.timeoutMs, userSignal: input.userSignal, requestedModel: input.model, now });
  }

  const started = run(first);
  const attempt = await started.attempt;
  const decision = applyProviderResult({
    mode: settings.mode,
    attempted: first,
    outcome: attempt.outcome,
    streamedToUser: input.streamedToUser === true,
    circuit,
    now,
  });
  writeCircuit(decision.circuit);

  if (decision.failover) {
    const reason = await describeAttempt(attempt);
    try {
      const exchange = await completeOpenRouterChat({ settings, body: input.body, referer: input.referer, title: input.title, timeoutMs: input.timeoutMs, userSignal: input.userSignal, requestedModel: input.model, now, failoverReason: reason });
      await remember({ provider: 'openrouter', reason, upstreamModel: exchange.upstreamModel, now });
      return exchange;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenRouter chat failed';
      await remember({ provider: 'openrouter', reason: `${reason}; ${scrubSecrets(message)}`, upstreamModel: openRouterChatChain(resolveProviderTarget({ settings, provider: 'openrouter', kind: 'chat', model: input.model }).model, settings.chatFallbacks)[0] || '', now });
      throw new Error(`LLM Dupoin failed (${reason}). ${message}`);
    }
  }

  if (attempt.kind === 'http') {
    if (attempt.outcome === 'ok' && first === 'dupoin' && (before.consecutiveFailures > 0 || before.openUntil > now)) {
      writeCircuit({ consecutiveFailures: 0, openUntil: 0 });
      void markProviderRecovered('dupoin').catch(error => {
        console.error('[llm-provider] could not record recovery:', error instanceof Error ? error.message : error);
      });
    }
    return { response: attempt.response, provider: usageProvider(first), upstreamModel: started.target.model };
  }
  throw attempt.error;
}

async function describeAttempt(attempt: Attempt): Promise<string> {
  if (attempt.kind === 'http') {
    const text = await attempt.response.clone().text().catch(() => '');
    return scrubSecrets(`HTTP ${attempt.response.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
  }
  return scrubSecrets(attempt.error.message || attempt.outcome);
}

export type ImageExchange = {
  data?: Array<{ b64_json?: string; url?: string; media_type?: string }>;
  usage?: unknown;
  cost?: unknown;
  provider: UsageProvider;
  upstreamModel: string;
};

export async function postImage(input: {
  model: string;
  prompt: string;
  size: string;
  aspectRatio?: string;
  timeoutMs: number;
  referer?: string;
  title?: string;
  now?: number;
}): Promise<ImageExchange> {
  const now = input.now ?? Date.now();
  const settings = await loadSettings(now);
  const before = readCircuit();
  const referer = input.referer || 'https://marketingos.local';
  const title = input.title || 'MarketingOS';
  const first = chooseProvider(settings.mode, circuit, now);

  const send = async (provider: ProviderChoice) => {
    const target = resolveProviderTarget({ settings, provider, kind: 'image', model: input.model });
    if (provider === 'openrouter' && !openRouterImageSupported(target.model)) {
      throw new Error(
        `OpenRouter cannot serve image model ${input.model} (mapped to ${target.model}). `
        + 'Image generation uses POST /api/v1/images. Map it to a model listed on https://openrouter.ai/api/v1/images/models, such as google/gemini-3.1-flash-image.',
      );
    }
    const body = provider === 'openrouter'
      ? { model: target.model, prompt: input.prompt, n: 1, aspect_ratio: input.aspectRatio }
      : { model: target.model, prompt: input.prompt, n: 1, size: input.size };
    const attempt = await attemptFetch({
      url: `${target.baseUrl}${imageRequestPath(provider)}`,
      apiKey: target.apiKey,
      missingKeyMessage: target.missingKeyMessage,
      body,
      referer,
      title,
      timeoutMs: input.timeoutMs,
    });
    return { target, attempt };
  };

  const started = await send(first);
  const decision = applyProviderResult({
    mode: settings.mode,
    attempted: first,
    outcome: started.attempt.outcome,
    streamedToUser: false,
    circuit,
    now,
  });
  writeCircuit(decision.circuit);

  const finish = async (provider: ProviderChoice, targetModel: string, attempt: Attempt): Promise<ImageExchange> => {
    if (attempt.kind !== 'http') throw attempt.error;
    if (!attempt.response.ok) {
      const errText = await attempt.response.text();
      throw new Error(explainLlmHttpError(usageProvider(provider), attempt.response.status, errText, 'image'));
    }
    const payload = await attempt.response.json() as ImageExchange;
    if (!payload?.data?.[0]?.b64_json && !payload?.data?.[0]?.url) {
      throw new Error(
        provider === 'openrouter'
          ? `OpenRouter returned no image for ${targetModel}. POST /api/v1/images did not include data[].b64_json or data[].url.`
          : 'Image API returned no image.',
      );
    }
    return { ...payload, provider: usageProvider(provider), upstreamModel: targetModel };
  };

  if (decision.failover) {
    const reason = await describeAttempt(started.attempt);
    try {
      const fallback = await send('openrouter');
      await remember({ provider: 'openrouter', reason, upstreamModel: fallback.target.model, now });
      return await finish('openrouter', fallback.target.model, fallback.attempt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenRouter image request failed';
      throw new Error(`LLM Dupoin image failed (${reason}). ${message}`);
    }
  }

  if (started.attempt.outcome === 'ok' && first === 'dupoin' && (before.consecutiveFailures > 0 || before.openUntil > now)) {
    writeCircuit({ consecutiveFailures: 0, openUntil: 0 });
    void markProviderRecovered('dupoin').catch(error => {
      console.error('[llm-provider] could not record recovery:', error instanceof Error ? error.message : error);
    });
  }
  return finish(first, started.target.model, started.attempt);
}

export async function testLlmProvider(input: {
  provider: ProviderChoice;
  kind: 'chat' | 'image' | 'embeddings';
}): Promise<{ ok: boolean; provider: ProviderChoice; kind: string; message: string }> {
  if (input.kind === 'embeddings') {
    return { ok: true, provider: input.provider, kind: 'embeddings', message: EMBEDDINGS_FAILOVER_NOTE };
  }
  const settings = await loadSettings(Date.now());
  const forced: LlmSettings = { ...settings, mode: input.provider === 'openrouter' ? 'openrouter' : 'dupoin' };
  const previous = settingsReader;
  settingsReader = async () => forced;
  try {
    if (input.kind === 'image') {
      const model = input.provider === 'openrouter' ? forced.defaultImageModel : 'ag/gemini-3.1-flash-image';
      if (input.provider === 'openrouter' && !openRouterImageSupported(model)) {
        return { ok: false, provider: input.provider, kind: 'image', message: `OpenRouter image model ${model} is not in the verified image catalog.` };
      }
      await postImage({
        model: input.provider === 'dupoin' ? 'ag/gemini-3.1-flash-image' : model,
        prompt: 'A flat blue square on a white background',
        size: '1024x1024',
        aspectRatio: '1:1',
        timeoutMs: 60_000,
        title: 'MarketingOS LLM Provider test',
      });
      return { ok: true, provider: input.provider, kind: 'image', message: 'Image endpoint returned an image.' };
    }
    const model = input.provider === 'dupoin' ? 'ag/gemini-3-flash' : (forced.defaultChatModel || DEFAULT_OPENROUTER_CHAT_MODEL);
    const exchange = await postChat({
      model,
      body: {
        messages: [{ role: 'user', content: 'Reply with the single word ok.' }],
        temperature: 0,
        max_tokens: 100,
      },
      referer: 'https://marketing-aws.gorillaworkout.id',
      title: 'MarketingOS LLM Provider test',
      timeoutMs: 30_000,
    });
    if (!exchange.response.ok) {
      const text = await exchange.response.text();
      return { ok: false, provider: input.provider, kind: 'chat', message: scrubSecrets(`HTTP ${exchange.response.status}: ${text.slice(0, 180)}`) };
    }
    return { ok: true, provider: input.provider, kind: 'chat', message: 'Chat endpoint accepted a short completion.' };
  } catch (error) {
    return { ok: false, provider: input.provider, kind: input.kind, message: scrubSecrets(error instanceof Error ? error.message : 'Test failed') };
  } finally {
    settingsReader = previous;
  }
}

export const MODEL_PROBE_GAP_MS = 400;
export const MODEL_PROBE_MAX_TOKENS = 100;

export type ProbeTarget = { provider: ProviderChoice; model: string; kind: LlmKind };

export type ModelProbeResult = ProbeTarget & {
  status: ModelHealthStatus;
  httpStatus: number | null;
  latencyMs: number;
  message: string;
  dimension: number | null;
};

export function healthProbePlan(input: {
  mappings: readonly LlmModelMapping[];
  chatFallbacks: readonly string[];
  defaultChatModel: string;
  defaultImageModel: string;
  defaultEmbeddingModel: string;
  includeImages: boolean;
}): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  const seen = new Set<string>();
  const add = (provider: ProviderChoice, model: string, kind: LlmKind) => {
    const id = model.trim();
    if (!id) return;
    if (!input.includeImages && kind === 'image') return;
    const key = `${provider}:${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ provider, model: id, kind });
  };
  for (const row of input.mappings) {
    add('dupoin', row.dupoinModel, row.kind);
    add('openrouter', row.openrouterModel, row.kind);
  }
  add('openrouter', input.defaultChatModel, 'chat');
  add('openrouter', input.defaultEmbeddingModel, 'embedding');
  for (const model of input.chatFallbacks) add('openrouter', model, 'chat');
  if (input.includeImages) add('openrouter', input.defaultImageModel, 'image');
  return targets;
}

function probeMessage(status: ModelHealthStatus, httpStatus: number | null, latencyMs: number, body: string, dimension: number | null): string {
  if (status === 'active' && dimension != null) return `HTTP ${httpStatus} in ${latencyMs}ms. Dimension ${dimension}. Not stored.`;
  if (status === 'active') return `HTTP ${httpStatus} in ${latencyMs}ms.`;
  if (status === 'rate_limited') return 'HTTP 429. Try again later. This is a rate limit, not a broken model.';
  if (status === 'credits') return IMAGE_CREDITS_MESSAGE;
  if (status === 'blocked') return `Blocked or unavailable${httpStatus ? ` (HTTP ${httpStatus})` : ''}. ${scrubSecrets(body).slice(0, 160)}`;
  return scrubSecrets(body || `HTTP ${httpStatus ?? 'error'}`).slice(0, 240);
}

export async function probeModel(target: ProbeTarget, timeoutMs = 30_000): Promise<ModelProbeResult> {
  if (target.model.startsWith('local/')) {
    return { ...target, status: 'active', httpStatus: null, latencyMs: 0, dimension: 1024, message: 'Local 1024-dimension hash. Not sent to a provider and not stored from OpenRouter.' };
  }
  const settings = await loadSettings(Date.now());
  const model = target.model;
  const baseUrl = target.provider === 'dupoin' ? resolveGorillaWorkoutApiBase() : OPENROUTER_API_BASE;
  const apiKey = target.provider === 'dupoin' ? resolveGorillaWorkoutApiKey() : settings.openrouterKey;
  if (!apiKey) {
    const message = target.provider === 'dupoin'
      ? 'GORILLAWORKOUT_API_KEY is not configured.'
      : 'OpenRouter API key is not configured. Add it in LLM Provider settings.';
    return { ...target, model, status: 'error', httpStatus: null, latencyMs: 0, dimension: null, message };
  }
  const started = Date.now();
  const path = target.kind === 'embedding' ? '/embeddings' : target.kind === 'image' ? imageRequestPath(target.provider) : '/chat/completions';
  const body = target.kind === 'embedding'
    ? { model, input: 'ping' }
    : target.kind === 'image'
      ? (target.provider === 'openrouter' ? { model, prompt: 'A flat blue square', n: 1, aspect_ratio: '1:1' } : { model, prompt: 'A flat blue square', n: 1, size: '1024x1024' })
      : { model, messages: [{ role: 'user', content: 'Reply with the single word ok.' }], temperature: 0, max_tokens: MODEL_PROBE_MAX_TOKENS };
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: providerHeaders(apiKey, 'https://marketing-aws.gorillaworkout.id', 'MarketingOS LLM Provider test'),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const latencyMs = Date.now() - started;
    let dimension: number | null = null;
    if (target.kind === 'embedding' && response.ok) {
      try {
        const parsed = JSON.parse(text) as { data?: Array<{ embedding?: unknown }> };
        const vector = parsed.data?.[0]?.embedding;
        dimension = Array.isArray(vector) ? vector.length : null;
      } catch {
        dimension = null;
      }
    }
    const status = classifyModelProbe(response.status, text);
    return { ...target, model, status, httpStatus: response.status, latencyMs, dimension, message: probeMessage(status, response.status, latencyMs, text, dimension) };
  } catch (error) {
    return { ...target, model, status: 'error', httpStatus: null, latencyMs: Date.now() - started, dimension: null, message: scrubSecrets(error instanceof Error ? error.message : 'Probe failed') };
  }
}

export async function probeModelsInOrder(
  targets: readonly ProbeTarget[],
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<ModelProbeResult[]> {
  const results: ModelProbeResult[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    if (index > 0) await sleep(MODEL_PROBE_GAP_MS);
    results.push(await probeModel(targets[index]));
  }
  return results;
}
