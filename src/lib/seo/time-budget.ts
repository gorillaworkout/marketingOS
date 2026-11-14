/** Time caps for background SEO jobs (Website Audit, Keyword Gap). */

export const AUDIT_CRAWL_BUDGET_MS = 4 * 60_000;
export const AUDIT_TOTAL_BUDGET_MS = 8 * 60_000;
export const GAP_COMPETITOR_PAGE_CAP = 40;
export const GAP_COMPETITOR_CRAWL_MS = 90_000;
export const SEO_LLM_TIMEOUT_MS = 120_000;

export class StepTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)} s.`);
    this.name = 'StepTimeoutError';
  }
}

/** Rejects with StepTimeoutError when `promise` takes longer than `ms`. The work itself is not cancelled. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new StepTimeoutError(label, ms)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function crawlTimeoutNote(domain: string, pages: number, ms: number): string {
  return `Stopped crawling ${domain} after ${Math.round(ms / 1000)} s with ${pages} page${pages === 1 ? '' : 's'} read. Results for it are partial.`;
}
