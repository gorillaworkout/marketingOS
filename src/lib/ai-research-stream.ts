import { isAbortError } from './ai-research-abort';
import { scanContextUrls } from './ai-research-urls';

/** Conversational skills answer from the thread. They do not need a web search. */
const SKIP_WEB_GATHER_SKILLS = new Set([
  'goal',
  'interview',
  'outline',
  'eli5',
  'continue',
]);

export const AI_RESEARCH_SSE_KEEPALIVE_MS = 10_000;

export const AI_RESEARCH_CONNECTION_DROPPED_MESSAGE =
  'The connection dropped. Send again to retry.';

export const AI_RESEARCH_CONNECTION_RETRYING_MESSAGE =
  'The connection dropped. Retrying…';

const CONNECTION_ERROR = /failed to fetch|networkerror|network error|err_network_changed|err_network|load failed|network changed|connection dropped|fetch failed|terminated/i;

export function shouldSkipWebGatherForTurn(options: {
  skill?: string | null;
  query: string;
  pinnedSourceUrls?: readonly string[];
  compare?: boolean;
}): boolean {
  if (options.compare) return false;
  if (!options.skill || !SKIP_WEB_GATHER_SKILLS.has(options.skill)) return false;
  if ((options.pinnedSourceUrls?.length ?? 0) > 0) return false;
  const scan = scanContextUrls(options.query || '');
  if (scan.accepted.length > 0 || scan.overflow.length > 0) return false;
  return true;
}

/** SSE comment. Clients that only read `data:` frames ignore it; proxies see bytes. */
export function sseKeepaliveComment(): string {
  return ': ping\n\n';
}

export function sseDataFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export interface AiResearchSseSession {
  emit: (data: unknown) => void;
  /** Stop keepalives, write `done`, then close. Close still runs if the done write throws. */
  complete: (done: unknown) => void;
  /** Stop keepalives and close without a done event. */
  close: () => void;
}

/**
 * Keepalive comments run until `complete` or `close`.
 * A failed ping or token write must not swallow the later done event or skip `close`.
 */
export function openAiResearchSseSession(options: {
  write: (frame: string) => void;
  close: () => void;
  isAborted?: () => boolean;
  intervalMs?: number;
  schedule?: (tick: () => void, intervalMs: number) => () => void;
}): AiResearchSseSession {
  let ended = false;
  const stopKeepalive = startSseKeepalive(frame => {
    if (ended || options.isAborted?.()) return;
    try {
      options.write(frame);
    } catch {
      // A failed ping must not mark the session finished.
    }
  }, {
    intervalMs: options.intervalMs,
    schedule: options.schedule,
  });

  const end = (writeDone?: () => void) => {
    if (ended) return;
    stopKeepalive();
    try {
      writeDone?.();
    } catch {
      // The done frame may not have flushed. Close anyway.
    } finally {
      ended = true;
      try {
        options.close();
      } catch {
        // The controller was already closed or cancelled.
      }
    }
  };

  return {
    emit(data) {
      if (ended) return;
      const type = data && typeof data === 'object' && 'type' in data
        ? (data as { type?: unknown }).type
        : undefined;
      if (options.isAborted?.() && type !== 'done') return;
      try {
        options.write(sseDataFrame(data));
      } catch {
        // Leave the session open so complete() can still close the controller.
      }
    },
    complete(done) {
      end(() => {
        options.write(sseDataFrame(done));
      });
    },
    close() {
      end();
    },
  };
}

export type AiResearchAbruptStreamEnd =
  | { action: 'soft-complete' }
  | { action: 'retry' }
  | { action: 'show-error'; message: string };

/**
 * An abrupt SSE end after assistant text is already visible is a soft complete.
 * Do not surface the connection-dropped banner in that case.
 */
export function resolveAiResearchAbruptStreamEnd(options: {
  error?: unknown;
  alreadyRetried: boolean;
  receivedContent: boolean;
}): AiResearchAbruptStreamEnd {
  const error = options.error ?? new TypeError('Failed to fetch');
  if (options.receivedContent && (options.error == null || isAiResearchConnectionError(error))) {
    return { action: 'soft-complete' };
  }
  if (shouldAutoRetryAiResearchStream({
    error,
    alreadyRetried: options.alreadyRetried,
    receivedContent: options.receivedContent,
  })) {
    return { action: 'retry' };
  }
  return {
    action: 'show-error',
    message: aiResearchClientErrorMessage(error),
  };
}

function defaultSseKeepaliveSchedule(tick: () => void, intervalMs: number): () => void {
  const timer = setInterval(tick, intervalMs);
  if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();
  return () => clearInterval(timer);
}

/** Writes `: ping` on an interval until the returned function is called. */
export function startSseKeepalive(
  write: (frame: string) => void,
  options?: {
    intervalMs?: number;
    schedule?: (tick: () => void, intervalMs: number) => () => void;
  },
): () => void {
  const intervalMs = options?.intervalMs ?? AI_RESEARCH_SSE_KEEPALIVE_MS;
  const schedule = options?.schedule ?? defaultSseKeepaliveSchedule;
  let stopped = false;
  const cancel = schedule(() => {
    if (!stopped) write(sseKeepaliveComment());
  }, intervalMs);
  return () => {
    if (stopped) return;
    stopped = true;
    cancel();
  };
}

export function isAiResearchConnectionError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  return CONNECTION_ERROR.test(message);
}

export function aiResearchClientErrorMessage(error: unknown): string {
  if (isAiResearchConnectionError(error)) return AI_RESEARCH_CONNECTION_DROPPED_MESSAGE;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'An error occurred';
}

/** One automatic retry for a dropped connection that has not delivered answer text. */
export function shouldAutoRetryAiResearchStream(options: {
  error: unknown;
  alreadyRetried: boolean;
  receivedContent: boolean;
}): boolean {
  if (options.alreadyRetried || options.receivedContent) return false;
  if (isAbortError(options.error)) return false;
  return isAiResearchConnectionError(options.error);
}

export function appendResearchTurnMessages<T extends { role: string; content: string }>(
  stored: T[],
  incoming: T[],
  retry: boolean,
): T[] {
  if (!retry || incoming.length === 0 || stored.length < incoming.length) {
    return [...stored, ...incoming];
  }
  const tail = stored.slice(stored.length - incoming.length);
  const same = tail.every((message, index) =>
    message.role === incoming[index].role && message.content === incoming[index].content,
  );
  return same ? stored : [...stored, ...incoming];
}
