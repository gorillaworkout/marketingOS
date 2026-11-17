import { generateContent } from '@/lib/openai';
import { siteHostFor } from './visibility-run';
import { getVisibilitySettings, listPrompts } from './visibility-store';
import { listLatestChecks, listLifetimeChecks } from './visibility-export-store';
import { GAP_SUMMARY_SYSTEM, buildGapReport, gapSummaryPrompt, sanitizeGapSummary, type GapReport } from './visibility-gaps';
import type { SeoSiteRow } from './sites';

export const GAP_SUMMARY_TASK_TYPE = 'seo-visibility-gaps';

/** Loads stored prompts and answers (read-only) and builds the gap report. */
export async function loadGapReport(site: Pick<SeoSiteRow, 'id' | 'name' | 'site_url' | 'gsc_property'>): Promise<GapReport> {
  const [prompts, settings, lifetime, latest] = await Promise.all([
    listPrompts(site.id), getVisibilitySettings(site.id), listLifetimeChecks(site.id), listLatestChecks(site.id),
  ]);
  return buildGapReport({ siteName: site.name, siteHost: siteHostFor(site), models: settings.models, prompts, lifetime, latest });
}

/**
 * Optional AI-written executive summary: one call through the normal
 * MarketingOS LLM helper with the site's classifier model. Provider routing
 * and the paid toggle are untouched. Falls back to null on any failure.
 */
export async function addAiSummary(report: GapReport, siteId: string, userId: string): Promise<GapReport> {
  try {
    const settings = await getVisibilitySettings(siteId);
    const prompts = await listPrompts(siteId);
    const result = await generateContent(GAP_SUMMARY_SYSTEM, gapSummaryPrompt(report), userId, undefined, {
      model: settings.classifierModel, temperature: 0.2, maxTokens: 700, taskType: GAP_SUMMARY_TASK_TYPE,
    });
    return { ...report, aiSummary: sanitizeGapSummary(result.content, report, prompts) };
  } catch (error) {
    console.error('AI Visibility gap summary failed:', error instanceof Error ? error.message : error);
    return { ...report, aiSummary: null };
  }
}
