const tails = new Map<string, Promise<void>>();

/** Serializes chunk writes for one session. Different sessions do not wait on each other. */
export function withSessionLock<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(sessionId) ?? Promise.resolve();
  const run = previous.then(work, work);
  tails.set(sessionId, run.then(() => undefined, () => undefined));
  return run;
}
