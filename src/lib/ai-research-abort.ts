/** Shown after the user cancels an in-flight AI Research run. */
export const AI_RESEARCH_STOPPED_STATUS = 'Stopped';

export function isAbortError(error: unknown): error is { name: 'AbortError' } {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError';
}

export function researchAbortError(reason?: unknown): Error {
  if (isAbortError(reason)) return reason as Error;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

export function throwIfResearchAborted(signal: AbortSignal): void {
  if (signal.aborted) throw researchAbortError(signal.reason);
}

/** Abort `child` when `parent` aborts. A missing parent leaves the child running. */
export function linkAbortSignal(parent: AbortSignal | undefined | null): AbortController {
  const controller = new AbortController();
  if (!parent) return controller;
  if (parent.aborted) {
    controller.abort(parent.reason);
    return controller;
  }
  parent.addEventListener('abort', () => {
    if (!controller.signal.aborted) controller.abort(parent.reason);
  }, { once: true });
  return controller;
}

export function mergeAbortSignals(...signals: Array<AbortSignal | undefined | null>): AbortSignal {
  const present = signals.filter((signal): signal is AbortSignal => signal != null);
  if (present.length === 0) return new AbortController().signal;
  if (present.length === 1) return present[0];
  const anyFn = (AbortSignal as { any?: (inputs: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(present);
  const controller = new AbortController();
  for (const signal of present) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    }, { once: true });
  }
  return controller.signal;
}

/** Fetch wrapper that also aborts when `signal` aborts. */
export function fetchWithAbortSignal(base: typeof fetch, signal: AbortSignal): typeof fetch {
  return (input, init) => base(input, {
    ...init,
    signal: mergeAbortSignals(init?.signal, signal),
  });
}
