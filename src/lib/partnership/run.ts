import { queryOne } from '@/lib/database';
import { aiProviderErrorBody } from '@/lib/ai-http-status';
import { resolveSearchApiKeys, searchSerper } from '@/lib/ai-research-grounding';
import { generateContent, getUserPreferredModel } from '@/lib/openai';
import { crawlSite } from '@/lib/seo/audit-crawl';
import { tregConfig } from '@/lib/seo/treg-client';
import { settleTregRun, type TregRunCost } from '@/lib/seo/treg-cost-guard';
import { buildCompetitorReport, type CollectDeps } from './collect';
import { isRefreshDue, parseNewsRssWithDates, type NewsHit } from './intel';
import { fetchPublic } from './public-fetch';
import {
  ReportInProgressError, createReport, expireStaleReports, failReport, finishReport, getCompetitor, getReport, latestReports,
  listCompetitors, listEvidence, saveEvidenceExtraction, updateReportProgress,
} from './store';
import { fetchTregSocialFeeds, type SocialFeedOutcome, type TregPlatform } from './treg-social';

/** A confirmed, reserved treg spend for one refresh (from guardTregSpend). */
export interface TregRunPlan {
  spendId: string; estimateMicro: number; balanceBeforeMicro: number | null;
  /** Platforms the user confirmed; missing = Instagram only (older clients). */
  platforms?: TregPlatform[];
}

export const CRAWL_PAGE_CAP = 25;
export const CRAWL_BUDGET_MS = 90_000;
const NEWS_TIMEOUT_MS = 10_000;
const USER_AGENT = 'MarketingOS-Partnership/1.0 (competitor public pages; same-host only)';

/** Google News RSS: Indonesian edition for local brokers, English for international ones. */
export function newsRssUrl(query: string, region: string): string {
  const locale = region === 'international' ? 'hl=en-US&gl=US&ceid=US:en' : 'hl=id&gl=ID&ceid=ID:id';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${locale}`;
}

async function fetchNews(query: string, region: string): Promise<NewsHit[]> {
  const response = await fetch(newsRssUrl(query, region), {
    signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
    headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': USER_AGENT },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Google News returned ${response.status}`);
  return parseNewsRssWithDates((await response.text()).slice(0, 2_000_000));
}

function realDeps(userId: string, region: string, onProgress: CollectDeps['onProgress']): CollectDeps {
  return {
    now: () => new Date(),
    onProgress,
    fetchPublic: (url, accept) => fetchPublic(url, accept),
    saveEvidenceText: (evidenceId, text) => saveEvidenceExtraction(evidenceId, text),
    crawlPages: async startUrl => {
      const pages: Array<{ url: string; html: string }> = [];
      // crawlSite checks every hop: public host, every DNS answer public (DNS-rebinding guard), same host, robots.txt.
      const crawl = await crawlSite({
        startUrl,
        maxPages: CRAWL_PAGE_CAP,
        delayMs: 250,
        deadlineAt: Date.now() + CRAWL_BUDGET_MS,
        onHtml: page => { pages.push({ url: page.url, html: page.html }); },
      });
      return { pages, timedOut: crawl.timedOut };
    },
    fetchNews: query => fetchNews(query, region),
    searchWeb: async query => {
      const key = resolveSearchApiKeys().serper;
      if (!key) return null;
      const attempt = await searchSerper(query, key, fetch, 200_000, 8_000);
      return attempt.sources.map(source => ({ title: source.title, url: source.url, snippet: source.snippet }));
    },
    complete: async (system, user) => {
      const model = await getUserPreferredModel(userId, 'market-research');
      // generateContent routes through the gateway with model failover, including the auth-expired cooldown (src/lib/llm-auth.ts).
      const generated = await generateContent(system, user, userId, undefined, {
        model,
        responseFormat: { type: 'json_object' },
        temperature: 0.2,
        maxTokens: 4_000,
        taskType: 'partnership-competitor-intel',
      });
      return { content: generated.content, model: generated.usage.model };
    },
  };
}

/** Scheduled runs have no signed-in user; token usage is logged to the first admin. */
export async function systemUserId(): Promise<string | null> {
  const row = await queryOne<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, username LIMIT 1`);
  return row?.id ?? null;
}

export async function runCompetitorRefresh(reportId: string, options: { treg?: TregRunPlan | null; tregNote?: string | null } = {}): Promise<void> {
  const report = await getReport(reportId);
  if (!report || report.status === 'succeeded' || report.status === 'failed' || !report.competitorId) return;
  const competitor = await getCompetitor(report.competitorId);
  if (!competitor) {
    await failReport(reportId, 'The competitor was deleted.');
    return;
  }
  const userId = report.createdBy || await systemUserId();
  const config = tregConfig();
  const plan = options.treg ?? null;
  let outcome = null as SocialFeedOutcome | null;
  let settled = false;
  const settle = async (): Promise<TregRunCost | null> => {
    if (!plan || settled) return null;
    settled = true;
    return settleTregRun({
      config, spendId: plan.spendId, estimateMicro: plan.estimateMicro, balanceBeforeMicro: plan.balanceBeforeMicro,
      ok: Boolean(outcome?.ok), actualMicro: outcome?.costMicro ?? 0, costSource: outcome?.costSource ?? 'reported',
      calls: outcome?.calls ?? 0, callIds: outcome?.callIds ?? [],
      note: outcome && !outcome.ok ? outcome.notes.join(' ').slice(0, 500) || null : null,
      refusalBalanceMicro: outcome?.refusalBalanceMicro ?? null,
    }).catch(() => null);
  };
  if (!userId) {
    await settle();
    await failReport(reportId, 'No user is available to run the refresh.');
    return;
  }
  try {
    await updateReportProgress(reportId, 2, 'Starting.');
    const evidence = await listEvidence(competitor.id);
    const deps = realDeps(userId, competitor.region, (progress, message) => updateReportProgress(reportId, progress, message));
    if (plan) {
      const platforms = plan.platforms?.length ? plan.platforms : ['instagram' as const];
      deps.socialFeeds = async () => {
        outcome = await fetchTregSocialFeeds(config, { reportId, name: competitor.name, website: competitor.website, handles: competitor.socialHandles, platforms });
        return { instagram: outcome.instagram, posts: outcome.posts, notes: outcome.notes };
      };
    }
    const { result, model } = await buildCompetitorReport(
      { name: competitor.name, region: competitor.region, website: competitor.website, instagramHandle: competitor.instagramHandle, socialHandles: competitor.socialHandles },
      evidence.map(item => ({ id: item.id, kind: item.kind, sourceUrl: item.sourceUrl, pastedText: item.pastedText, extractedText: item.extractedText, observedOn: item.observedOn })),
      deps,
    );
    if (options.tregNote) result.notes.push(options.tregNote);
    result.tregCost = await settle();
    if (outcome?.calls) result.tregPlatforms = outcome.perPlatform;
    await finishReport(reportId, result, model);
  } catch (error) {
    await settle();
    await failReport(reportId, aiProviderErrorBody(error).error || (error instanceof Error ? error.message : 'The refresh failed.'));
  }
}

export interface DueRunSummary {
  checked: number;
  refreshed: number;
  failed: number;
  skipped: number;
}

/** Weekly refresh: every active competitor whose last successful refresh is 7+ days old, one at a time, free sources only (never treg). */
export async function runDueCompetitorRefreshes(now: Date = new Date()): Promise<DueRunSummary> {
  await expireStaleReports();
  const competitors = await listCompetitors();
  const { succeeded } = await latestReports();
  const userId = await systemUserId();
  const summary: DueRunSummary = { checked: competitors.length, refreshed: 0, failed: 0, skipped: 0 };
  for (const competitor of competitors) {
    if (!isRefreshDue(succeeded.get(competitor.id)?.finishedAt ?? null, now)) { summary.skipped += 1; continue; }
    let reportId: string;
    try {
      reportId = await createReport(competitor.id, 'scheduled', userId);
    } catch (error) {
      if (error instanceof ReportInProgressError) { summary.skipped += 1; continue; }
      throw error;
    }
    // Scheduled runs never spend treg balance: free sources only. treg runs only
    // after a signed-in user confirms the estimate (POST .../refresh with { treg }).
    await runCompetitorRefresh(reportId, { treg: null });
    const finished = await getReport(reportId);
    if (finished?.status === 'succeeded') summary.refreshed += 1;
    else summary.failed += 1;
  }
  return summary;
}
