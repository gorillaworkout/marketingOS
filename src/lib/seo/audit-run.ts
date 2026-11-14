import { generateContent, getUserPreferredModel } from '@/lib/openai';
import { aiProviderErrorBody } from '@/lib/ai-http-status';
import { applyIssueCounts, buildAuditIssues, healthScore, indexingRows, notConnectedCards } from './audit-page';
import { crawlSite } from './audit-crawl';
import { parsePsiResponse, PSI_CALL_DELAY_MS, psiErrorMessage, PSI_QUOTA_MESSAGE, psiRequestUrl, PSI_TOP_PAGES, resolvePsiKey, scrubPsiKey, topPsiPages } from './audit-psi';
import { failAudit, finishAudit, getAudit, readPagespeedKey, updateAuditProgress } from './audit-store';
import type { AuditResult, PsiReading } from './audit-types';
import { AUDIT_CRAWL_BUDGET_MS, AUDIT_TOTAL_BUDGET_MS, SEO_LLM_TIMEOUT_MS, StepTimeoutError, withTimeout } from './time-budget';

export const PSI_TIME_LIMIT_MESSAGE = 'Skipped: the audit reached its time limit.';

const SUMMARY_SYSTEM = `You are an SEO lead. Write a short prioritized fix list in English for the people who will edit the site.
Use only the crawl issues you are given. Do not invent rankings, traffic, bounce rate, or Search Console indexing numbers.
Lead with the highest-severity fixes. Mention the affected URLs that were provided. Keep it under 250 words.`;

async function collectPsi(urls: string[], key: string | null, deadlineAt: number, onProgress: (message: string) => Promise<void>): Promise<PsiReading[]> {
  const readings: PsiReading[] = [];
  let quotaExceeded = false;
  const total = urls.length * 2;
  for (const url of urls) {
    for (const strategy of ['mobile', 'desktop'] as const) {
      if (quotaExceeded) {
        readings.push({ url, strategy, performanceScore: null, lab: null, field: null, error: PSI_QUOTA_MESSAGE });
        continue;
      }
      if (Date.now() >= deadlineAt) {
        readings.push({ url, strategy, performanceScore: null, lab: null, field: null, error: PSI_TIME_LIMIT_MESSAGE });
        continue;
      }
      await onProgress(`Checking Core Web Vitals (${readings.length + 1} of ${total}).`);
      await new Promise(resolve => setTimeout(resolve, PSI_CALL_DELAY_MS));
      try {
        const response = await fetch(psiRequestUrl(url, strategy, key), { signal: AbortSignal.timeout(30_000) });
        const text = await response.text();
        if (response.status === 429) {
          quotaExceeded = true;
          await onProgress(`${PSI_QUOTA_MESSAGE}. Continuing without Core Web Vitals.`);
          readings.push({ url, strategy, performanceScore: null, lab: null, field: null, error: PSI_QUOTA_MESSAGE });
          continue;
        }
        if (!response.ok) {
          readings.push({ url, strategy, performanceScore: null, lab: null, field: null, error: scrubPsiKey(psiErrorMessage(response.status), key) });
          continue;
        }
        readings.push(parsePsiResponse(JSON.parse(text) as unknown, url, strategy));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'PageSpeed request failed';
        readings.push({ url, strategy, performanceScore: null, lab: null, field: null, error: scrubPsiKey(message, key) });
      }
    }
  }
  return readings;
}

async function summarize(userId: string, score: number, result: AuditResult): Promise<{ summary: string | null; error: string | null; model: string | null }> {
  const lines = result.issues.slice(0, 12).map(issue => `${issue.severity}: ${issue.title} (${issue.urls.length}) ${issue.urls.slice(0, 5).join(', ')}`);
  const user = [`Site health score: ${score}/100`, '', ...lines].join('\n');
  try {
    const model = await getUserPreferredModel(userId, 'seo-content');
    const generated = await withTimeout(generateContent(SUMMARY_SYSTEM, user, userId, undefined, {
      model, temperature: 0.2, maxTokens: 900, taskType: 'seo-audit',
    }), SEO_LLM_TIMEOUT_MS, 'The summary');
    return { summary: generated.content.slice(0, 8000), error: null, model: generated.usage.model };
  } catch (error) {
    return { summary: null, error: error instanceof StepTimeoutError ? error.message : aiProviderErrorBody(error).error, model: null };
  }
}

export async function runSeoAudit(id: string): Promise<void> {
  const audit = await getAudit(id);
  if (!audit || audit.status === 'succeeded' || audit.status === 'failed') return;
  const startedAt = Date.now();
  try {
    await updateAuditProgress(id, 8, 'Reading robots.txt and the sitemap.');
    const crawl = await crawlSite({
      startUrl: audit.start_url,
      maxPages: audit.max_pages,
      deadlineAt: startedAt + AUDIT_CRAWL_BUDGET_MS,
      onProgress: (crawled, maxPages) => {
        if (crawled % 5 !== 0 && crawled !== maxPages) return;
        const progress = 15 + Math.round((crawled / Math.max(maxPages, 1)) * 55);
        void updateAuditProgress(id, progress, `Crawled ${crawled} of up to ${maxPages} pages.`);
      },
    });
    await updateAuditProgress(id, 74, 'Scoring pages.');
    const draftPages = crawl.pages.map(page => ({ ...page }));
    const issues = buildAuditIssues(draftPages, {
      robotsPresent: crawl.robotsPresent,
      sitemapPresent: crawl.sitemapPresent,
      origin: crawl.origin,
      brokenLinks: crawl.brokenLinks,
      robotsBlocked: crawl.robotsBlocked,
    });
    const pages = applyIssueCounts(draftPages, issues);
    const connections = notConnectedCards();
    const score = healthScore(issues);
    const storedKey = await readPagespeedKey().catch(() => null);
    const psiKey = resolvePsiKey(process.env.PAGESPEED_API_KEY, storedKey);
    await updateAuditProgress(id, 82, 'Checking Core Web Vitals.');
    const psi = await collectPsi(topPsiPages(audit.start_url, pages, PSI_TOP_PAGES), psiKey, startedAt + AUDIT_TOTAL_BUDGET_MS, message => updateAuditProgress(id, 84, message));
    const result: AuditResult = {
      healthScore: score,
      issues,
      pages,
      indexing: { rows: indexingRows(pages, crawl.robotsBlocked, crawl.sitemapPresent), ...connections },
      psi,
      psiKeyUsed: Boolean(psiKey),
      limits: { maxPages: audit.max_pages, crawled: pages.length, timedOut: crawl.timedOut },
    };
    await updateAuditProgress(id, 94, 'Writing the summary.');
    const owner = await ownerId(id);
    const written = owner
      ? await summarize(owner, score, result)
      : { summary: null, error: 'The audit has no owner, so no summary was written.', model: null };
    await finishAudit(id, { score, summary: written.summary, summaryError: written.error, model: written.model, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The audit failed.';
    await failAudit(id, message);
  }
}

async function ownerId(id: string): Promise<string | null> {
  const { queryOne } = await import('@/lib/database');
  const row = await queryOne<{ created_by: string | null }>('SELECT created_by FROM seo_audits WHERE id = ?', [id]);
  return row?.created_by ?? null;
}
