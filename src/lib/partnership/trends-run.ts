import { aiProviderErrorBody } from '@/lib/ai-http-status';
import { resolveSearchApiKeys } from '@/lib/ai-research-grounding';
import { generateContent, getUserPreferredModel } from '@/lib/openai';
import { crawlSite } from '@/lib/seo/audit-crawl';
import { parseNewsRssWithDates, type NewsHit } from './intel';
import { systemUserId } from './run';
import { expireStaleReports, failReport, updateReportProgress } from './store';
import { DEFAULT_TREND_WINDOW, isTrendsDigestDue, parseSerperNews, parseWindowDays } from './trends';
import { buildTrendsDigest, type TrendsDeps } from './trends-collect';
import {
  TrendsInProgressError, createTrendsReport, finishTrendsReport, getTrendsReport, latestSucceededTrendsReport, listTrendBrands,
} from './trends-store';

export const NEWSROOM_PAGE_CAP = 6;
export const NEWSROOM_BUDGET_MS = 25_000;
export const TOTAL_CRAWL_BUDGET_MS = 150_000;
const NEWS_TIMEOUT_MS = 10_000;
const SERPER_TIMEOUT_MS = 8_000;
const USER_AGENT = 'MarketingOS-Partnership/1.0 (public news and newsroom pages; same-host only)';

/** Google News RSS, English edition: the digest is about brokers worldwide. */
export function trendsNewsRssUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

async function fetchNews(query: string): Promise<NewsHit[]> {
  const response = await fetch(trendsNewsRssUrl(query), {
    signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
    headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': USER_AGENT },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Google News returned ${response.status}`);
  return parseNewsRssWithDates((await response.text()).slice(0, 2_000_000), 25);
}

/** Serper news search (optional, free tier). Null when no key is configured. The key is only sent in the request header. */
async function serperNews(query: string, days: number, now: () => Date): Promise<NewsHit[] | null> {
  const key = resolveSearchApiKeys().serper;
  if (!key) return null;
  const response = await fetch('https://google.serper.dev/news', {
    method: 'POST',
    signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
    headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
    body: JSON.stringify({ q: query, num: 10, tbs: days > 31 ? 'qdr:y' : 'qdr:m' }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Serper returned ${response.status}`);
  return parseSerperNews(await response.json().catch(() => null), now());
}

export function realTrendsDeps(userId: string, days: number, onProgress: TrendsDeps['onProgress']): TrendsDeps {
  const crawlDeadline = Date.now() + TOTAL_CRAWL_BUDGET_MS;
  const now = () => new Date();
  return {
    now,
    onProgress,
    fetchNews,
    crawlPages: async startUrl => {
      if (Date.now() >= crawlDeadline) throw new Error('Crawl budget used up.');
      const pages: Array<{ url: string; html: string }> = [];
      // crawlSite checks every hop: public host, every DNS answer public (DNS-rebinding guard), same host, robots.txt.
      const crawl = await crawlSite({
        startUrl,
        maxPages: NEWSROOM_PAGE_CAP,
        delayMs: 250,
        deadlineAt: Math.min(crawlDeadline, Date.now() + NEWSROOM_BUDGET_MS),
        onHtml: page => { pages.push({ url: page.url, html: page.html }); },
      });
      return { pages, timedOut: crawl.timedOut };
    },
    searchNews: query => serperNews(query, days, now),
    complete: async (system, user) => {
      const model = await getUserPreferredModel(userId, 'market-research');
      // generateContent routes through the gateway with model failover, including the auth-expired cooldown (src/lib/llm-auth.ts).
      const generated = await generateContent(system, user, userId, undefined, {
        model,
        responseFormat: { type: 'json_object' },
        temperature: 0.2,
        maxTokens: 6_000,
        taskType: 'partnership-global-trends',
      });
      return { content: generated.content, model: generated.usage.model };
    },
  };
}

export async function runTrendsDigest(reportId: string, depsOverride?: (userId: string, days: number, onProgress: TrendsDeps['onProgress']) => TrendsDeps): Promise<void> {
  const report = await getTrendsReport(reportId);
  if (!report || report.status === 'succeeded' || report.status === 'failed') return;
  const days = parseWindowDays(report.windowDays) ?? DEFAULT_TREND_WINDOW;
  const userId = report.createdBy || await systemUserId();
  if (!userId) {
    await failReport(reportId, 'No user is available to run the digest.');
    return;
  }
  try {
    await updateReportProgress(reportId, 2, 'Starting.');
    const brands = await listTrendBrands({ activeOnly: true });
    if (!brands.length) {
      await failReport(reportId, 'The watchlist is empty. Add at least one brand.');
      return;
    }
    const onProgress = (progress: number, message: string) => updateReportProgress(reportId, progress, message);
    const deps = (depsOverride ?? realTrendsDeps)(userId, days, onProgress);
    const { result, model } = await buildTrendsDigest(
      brands.map(brand => ({ name: brand.name, website: brand.website, newsroomUrl: brand.newsroomUrl, searchTerms: brand.searchTerms })),
      days,
      deps,
    );
    await finishTrendsReport(reportId, result, model);
  } catch (error) {
    await failReport(reportId, aiProviderErrorBody(error).error || (error instanceof Error ? error.message : 'The digest failed.'));
  }
}

export type TrendsDueSummary = { status: 'refreshed' | 'failed' | 'skipped'; reason?: string };

/** Weekly cron: one 30-day digest when the last successful one is 7+ days old. */
export async function runDueTrendsDigest(now: Date = new Date()): Promise<TrendsDueSummary> {
  await expireStaleReports();
  const last = await latestSucceededTrendsReport();
  if (!isTrendsDigestDue(last?.finishedAt ?? null, now)) return { status: 'skipped', reason: 'A digest already ran in the last 7 days.' };
  let reportId: string;
  try {
    reportId = await createTrendsReport(DEFAULT_TREND_WINDOW, 'scheduled', await systemUserId());
  } catch (error) {
    if (error instanceof TrendsInProgressError) return { status: 'skipped', reason: error.message };
    throw error;
  }
  await runTrendsDigest(reportId);
  const finished = await getTrendsReport(reportId);
  return finished?.status === 'succeeded' ? { status: 'refreshed' } : { status: 'failed', reason: finished?.error || undefined };
}
