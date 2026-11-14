import type { PsiMetrics, PsiReading } from './audit-types';

export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
export const PSI_TOP_PAGES = 5;
export const PSI_QUOTA_MESSAGE = 'PageSpeed quota exceeded — add PAGESPEED_API_KEY or retry later';
export const PSI_CALL_DELAY_MS = 750;

export function psiErrorMessage(status: number): string {
  return status === 429 ? PSI_QUOTA_MESSAGE : `PageSpeed returned ${status}`;
}

export function resolvePsiKey(envValue: string | undefined, stored: string | null): string | null {
  const envKey = envValue?.trim();
  if (envKey) return envKey;
  const saved = stored?.trim();
  return saved || null;
}

export function psiRequestUrl(pageUrl: string, strategy: 'mobile' | 'desktop', key: string | null): string {
  const endpoint = new URL(PSI_ENDPOINT);
  endpoint.searchParams.set('url', pageUrl);
  endpoint.searchParams.set('strategy', strategy);
  endpoint.searchParams.set('category', 'performance');
  if (key) endpoint.searchParams.set('key', key);
  return endpoint.toString();
}

export function scrubPsiKey(text: string, key: string | null): string {
  if (!key) return text.slice(0, 300);
  return text.split(key).join('[redacted]').slice(0, 300);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function labMetrics(audits: Record<string, { numericValue?: unknown }>): PsiMetrics {
  return {
    lcp: numberOrNull(audits['largest-contentful-paint']?.numericValue),
    inp: numberOrNull(audits['interaction-to-next-paint']?.numericValue ?? audits['experimental-interaction-to-next-paint']?.numericValue),
    cls: numberOrNull(audits['cumulative-layout-shift']?.numericValue),
    fcp: numberOrNull(audits['first-contentful-paint']?.numericValue),
    ttfb: numberOrNull(audits['server-response-time']?.numericValue),
  };
}

function fieldPercentile(metrics: Record<string, { percentile?: unknown }>, key: string): number | null {
  return numberOrNull(metrics[key]?.percentile);
}

export function parsePsiResponse(body: unknown, pageUrl: string, strategy: 'mobile' | 'desktop'): PsiReading {
  const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const lighthouse = payload.lighthouseResult && typeof payload.lighthouseResult === 'object' ? payload.lighthouseResult as Record<string, unknown> : null;
  const categories = lighthouse?.categories && typeof lighthouse.categories === 'object' ? lighthouse.categories as Record<string, { score?: unknown }> : {};
  const audits = lighthouse?.audits && typeof lighthouse.audits === 'object' ? lighthouse.audits as Record<string, { numericValue?: unknown }> : {};
  const score = numberOrNull(categories.performance?.score);
  const experience = payload.loadingExperience && typeof payload.loadingExperience === 'object' ? payload.loadingExperience as Record<string, unknown> : null;
  const metrics = experience?.metrics && typeof experience.metrics === 'object' ? experience.metrics as Record<string, { percentile?: unknown }> : null;
  const field = metrics ? {
    lcp: fieldPercentile(metrics, 'LARGEST_CONTENTFUL_PAINT_MS'),
    inp: fieldPercentile(metrics, 'INTERACTION_TO_NEXT_PAINT'),
    cls: fieldPercentile(metrics, 'CUMULATIVE_LAYOUT_SHIFT_SCORE'),
    fcp: fieldPercentile(metrics, 'FIRST_CONTENTFUL_PAINT_MS'),
    ttfb: fieldPercentile(metrics, 'EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
    category: typeof experience?.overall_category === 'string' ? experience.overall_category : null,
  } : null;
  return {
    url: pageUrl,
    strategy,
    performanceScore: score === null ? null : Math.round(score * 100),
    lab: lighthouse ? labMetrics(audits) : null,
    field: field && Object.values(field).some(value => value !== null) ? field : null,
    error: null,
  };
}

export function topPsiPages(startUrl: string, pages: Array<{ url: string; finalUrl: string; status: number; depth: number; html: boolean }>, limit = PSI_TOP_PAGES): string[] {
  const home = pages.find(page => page.finalUrl === startUrl || page.url === startUrl);
  const rest = pages
    .filter(page => page.html && page.status >= 200 && page.status < 300 && page !== home)
    .sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  const chosen = [home?.finalUrl || startUrl, ...rest.map(page => page.finalUrl)];
  return [...new Set(chosen)].slice(0, limit);
}
