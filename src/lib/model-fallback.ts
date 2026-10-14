/**
 * Automatic LLM model fallback for every gateway call.
 *
 * Pure logic only: no database, no fetch. Callers pass an `attempt` function
 * that talks to the 9router/llmdupoin gateway. Safe to import from tests.
 */

/** Global fallback order. The chosen model runs first, then these in order. */
export const GLOBAL_FALLBACK_ORDER = [
  'cc/claude-sonnet-5-5',
  'cx/gpt-5.6-sol',
  'ag/gemini-3-flash',
  'cc/claude-opus-5-5',
] as const;

/** Display names for fallback labels. Unknown ids fall back to the raw id. */
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'cc/claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'cc/claude-opus-5-5': 'Claude Opus 5.5',
  'cc/claude-sonnet-5': 'Claude Sonnet 5',
  'cc/claude-opus-5': 'Claude Opus 5',
  'lr/claude-sonnet-4.5': 'Claude Sonnet 4.5',
  'cx/gpt-5.6-sol': 'GPT-5.6 Sol',
  'cx/gpt-5.6-terra': 'GPT-5.6 Terra',
  'cx/gpt-5.6-luna': 'GPT-5.6 Luna',
  'cx/gpt-5.5': 'GPT-5.5',
  'cx/gpt-5.4': 'GPT-5.4',
  'cx/gpt-5.4-mini': 'GPT-5.4 Mini',
  'ag/gemini-3-flash': 'Gemini 3 Flash',
  'ag/gemini-3.6-flash-low': 'Gemini 3.6 Flash Low',
  'ag/gemini-3.6-flash-medium': 'Gemini 3.6 Flash Medium',
  'ag/gemini-3.6-flash-high': 'Gemini 3.6 Flash High',
  'ag/gemini-3.1-pro-low': 'Gemini 3.1 Pro Low',
  'ag/gemini-pro-agent': 'Gemini Pro Agent',
  'ag/gpt-oss-120b-medium': 'GPT OSS 120B Medium',
};

export function modelDisplayName(modelId: string): string {
  return MODEL_DISPLAY_NAMES[modelId] || modelId;
}

/**
 * The chosen model first, then GLOBAL_FALLBACK_ORDER, without duplicates and
 * without any model that already failed.
 */
export function buildFallbackChain(
  chosenModel: string | null | undefined,
  failedModels: Iterable<string> = [],
): string[] {
  const failed = new Set(failedModels);
  const chain: string[] = [];
  for (const model of [chosenModel, ...GLOBAL_FALLBACK_ORDER]) {
    if (!model || failed.has(model) || chain.includes(model)) continue;
    chain.push(model);
  }
  return chain;
}

export interface FallbackEvent {
  failedModel: string;
  fallbackModel: string;
  error: string;
  /** True when the failed model had already streamed some text. */
  afterPartial: boolean;
  at: string;
}

export interface FallbackSummary {
  finalModel: string;
  events: FallbackEvent[];
  label: string | null;
}

export class AllModelsFailedError extends Error {
  readonly attempts: Array<{ model: string; error: string }>;
  constructor(attempts: Array<{ model: string; error: string }>) {
    const last = attempts[attempts.length - 1];
    super(last
      ? `All models failed. Last error from ${modelDisplayName(last.model)}: ${last.error}`
      : 'All models failed.');
    this.name = 'AllModelsFailedError';
    this.attempts = attempts;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

/**
 * English label shown under the answer. Null when no fallback happened.
 * - "Continued by GPT-5.6 Sol after Claude Sonnet 5.5 failed" when the switch
 *   happened after text was already streamed.
 * - "Answered by GPT-5.6 Sol (Claude Sonnet 5.5 unavailable)" otherwise.
 */
export function formatFallbackLabel(finalModel: string, events: FallbackEvent[]): string | null {
  if (!events.length) return null;
  const failed = [...new Set(events.map(event => modelDisplayName(event.failedModel)))];
  const failedText = failed.length === 1
    ? failed[0]
    : `${failed.slice(0, -1).join(', ')} and ${failed[failed.length - 1]}`;
  const finalName = modelDisplayName(finalModel);
  if (events.some(event => event.afterPartial)) {
    return `Continued by ${finalName} after ${failedText} failed`;
  }
  return `Answered by ${finalName} (${failedText} unavailable)`;
}

export const CONTINUATION_INSTRUCTION = [
  'Your previous reply (the assistant message above) was cut off mid-stream.',
  'Continue seamlessly from exactly where that text stopped.',
  'Do not repeat any of the text already written, do not restart, and do not add a preamble or acknowledge this instruction.',
  'If the text stopped mid-word or mid-sentence, finish that word or sentence first.',
  'Output only the continuation.',
].join(' ');

/**
 * Original messages plus the partial assistant text and a continuation
 * instruction for the next model.
 */
export function buildContinuationMessages<M extends { role: string }>(
  messages: M[],
  partialText: string,
): Array<M | { role: 'assistant' | 'user'; content: string }> {
  const tail = partialText.slice(-200);
  return [
    ...messages,
    { role: 'assistant', content: partialText },
    {
      role: 'user',
      content: `${CONTINUATION_INSTRUCTION}\n\nThe text ended with:\n"""${tail}"""`,
    },
  ];
}

export type FallbackLogger = (event: FallbackEvent) => void | Promise<void>;

async function safeLog(logger: FallbackLogger | undefined, event: FallbackEvent) {
  if (!logger) return;
  try {
    await logger(event);
  } catch (error) {
    console.error('[model-fallback] failed to log fallback event:', error);
  }
}

/**
 * Non-streaming fallback. Tries the chosen model, then the global order.
 * `shouldAbort` lets callers stop on user cancellation instead of falling back.
 */
export async function runWithModelFallback<T>(options: {
  chosenModel: string;
  attempt: (model: string) => Promise<T>;
  onFallback?: FallbackLogger;
  shouldAbort?: (error: unknown) => boolean;
  now?: () => Date;
}): Promise<{ result: T; model: string } & FallbackSummary> {
  const now = options.now ?? (() => new Date());
  const failures: Array<{ model: string; error: string }> = [];
  const events: FallbackEvent[] = [];
  const chain = buildFallbackChain(options.chosenModel);
  for (let index = 0; index < chain.length; index += 1) {
    const model = chain[index];
    try {
      const result = await options.attempt(model);
      return { result, model, finalModel: model, events, label: formatFallbackLabel(model, events) };
    } catch (error) {
      if (options.shouldAbort?.(error)) throw error;
      const message = errorMessage(error);
      failures.push({ model, error: message });
      const next = chain[index + 1];
      if (next) {
        const event: FallbackEvent = {
          failedModel: model,
          fallbackModel: next,
          error: message,
          afterPartial: false,
          at: now().toISOString(),
        };
        events.push(event);
        await safeLog(options.onFallback, event);
      }
    }
  }
  throw new AllModelsFailedError(failures);
}

export type StreamAttemptResult<U> =
  | { ok: true; content: string; usage?: U | null }
  | { ok: false; aborted: true; content?: string }
  | { ok: false; aborted?: false; error: string; content: string; usage?: U | null };

/**
 * Streaming fallback with mid-stream continuation.
 *
 * `attempt` streams one model and forwards its tokens to the client itself.
 * It returns the text it produced. When it fails after some text, the next
 * model gets the original messages plus the accumulated partial text and a
 * continuation instruction, and its output is appended to the same stream.
 */
export async function streamWithModelFallback<M extends { role: string }, U>(options: {
  chosenModel: string;
  messages: M[];
  attempt: (model: string, messages: Array<M | { role: 'assistant' | 'user'; content: string }>) => Promise<StreamAttemptResult<U>>;
  onFallback?: FallbackLogger;
  /** Called right before the next model starts, so the UI can be told. */
  onSwitch?: (event: FallbackEvent) => void;
  mergeUsage?: (a: U | null, b: U | null) => U | null;
  now?: () => Date;
}): Promise<
  | ({ ok: true; content: string; usage: U | null; usedModels: string[] } & FallbackSummary)
  | { ok: false; aborted: true; content: string }
  | { ok: false; aborted: false; error: AllModelsFailedError; content: string; events: FallbackEvent[] }
> {
  const now = options.now ?? (() => new Date());
  const failures: Array<{ model: string; error: string }> = [];
  const events: FallbackEvent[] = [];
  const usedModels: string[] = [];
  const merge = options.mergeUsage ?? ((a: U | null, b: U | null) => b ?? a);
  let accumulated = '';
  let usage: U | null = null;
  const chain = buildFallbackChain(options.chosenModel);

  for (let index = 0; index < chain.length; index += 1) {
    const model = chain[index];
    usedModels.push(model);
    const messages = accumulated
      ? buildContinuationMessages(options.messages, accumulated)
      : options.messages;
    const outcome = await options.attempt(model, messages);
    if (outcome.ok) {
      accumulated += outcome.content;
      usage = merge(usage, outcome.usage ?? null);
      return {
        ok: true,
        content: accumulated,
        usage,
        usedModels,
        finalModel: model,
        events,
        label: formatFallbackLabel(model, events),
      };
    }
    if (outcome.aborted) {
      return { ok: false, aborted: true, content: accumulated + (outcome.content || '') };
    }
    const hadTextBefore = accumulated.length > 0;
    accumulated += outcome.content;
    usage = merge(usage, outcome.usage ?? null);
    failures.push({ model, error: outcome.error });
    const next = chain[index + 1];
    if (next) {
      const event: FallbackEvent = {
        failedModel: model,
        fallbackModel: next,
        error: outcome.error,
        afterPartial: hadTextBefore || outcome.content.length > 0,
        at: now().toISOString(),
      };
      events.push(event);
      options.onSwitch?.(event);
      await safeLog(options.onFallback, event);
    }
  }
  return { ok: false, aborted: false, error: new AllModelsFailedError(failures), content: accumulated, events };
}
