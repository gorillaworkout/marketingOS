/**
 * Media Monitoring refresh pipeline. Free sources only, plus an optional extra
 * collector that ONLY the manual treg route passes in. This module never imports
 * treg, so a scheduled refresh (cron, npm run media:refresh, partnership:refresh)
 * physically cannot call it. tests/partnership-media-no-treg-cron.test.ts checks this.
 */
import { aiProviderErrorBody } from '@/lib/ai-http-status';
import { generateContent, getUserPreferredModel } from '@/lib/openai';
import {
  SENTIMENT_BATCH, buildInsightsPrompt, buildMediaDashboard, buildSentimentPrompt, dedupeMentions, parseInsightsResponse, parseSentimentResponse,
  type DateRange, type MediaInsights, type MediaSettings, type RawMention,
} from './media';
import { collectFreeMentions, type FreeSourceDeps } from './media-sources';
import {
  MediaRunInProgressError, createMediaRun, expireStaleMediaRuns, failMediaRun, finishMediaRun, getMediaRun, getMediaSettings, latestSucceededMediaRun,
  listMentionsInRange, mediaSystemUserId as systemUserId, saveMediaInsights, saveSentiments, unscoredMentions, updateMediaRunProgress, upsertMentions,
} from './media-store';

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'MarketingOS-MediaMonitoring/1.0 (Google Alerts RSS, Google News RSS, GDELT)';
/** Sentiment is scored for at most this many new mentions per refresh (the rest on the next one). */
export const SENTIMENT_PER_RUN = 160;
export const MEDIA_WINDOW_DAYS = 30;

export function realFreeSourceDeps(onProgress?: FreeSourceDeps['onProgress']): FreeSourceDeps {
  const get = async (url: string, accept: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept, 'user-agent': USER_AGENT }, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  };
  return {
    now: () => new Date(),
    fetchText: async url => (await (await get(url, 'application/atom+xml, application/rss+xml, application/xml, text/xml')).text()).slice(0, 3_000_000),
    fetchJson: async url => (await get(url, 'application/json')).json(),
    youtubeKey: process.env.YOUTUBE_API_KEY?.trim() || null,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    onProgress,
  };
}

export type LlmComplete = (system: string, user: string, taskType: string) => Promise<{ content: string; model: string | null }>;

/** The existing MarketingOS LLM helper (gateway + failover); provider mode and paid toggle are untouched. */
export function realComplete(userId: string): LlmComplete {
  return async (system, user, taskType) => {
    const model = await getUserPreferredModel(userId, 'market-research');
    const generated = await generateContent(system, user, userId, undefined, { model, responseFormat: { type: 'json_object' }, temperature: 0.2, maxTokens: 6_000, taskType });
    return { content: generated.content, model: generated.usage.model };
  };
}

/** Scores unscored mentions in batches. Never throws: a failed batch stays unscored for next time. */
export async function scoreSentiment(brandName: string, complete: LlmComplete, limit = SENTIMENT_PER_RUN): Promise<{ scored: number; failedBatches: number }> {
  const pending = await unscoredMentions(limit);
  let scored = 0;
  let failedBatches = 0;
  for (let index = 0; index < pending.length; index += SENTIMENT_BATCH) {
    const batch = pending.slice(index, index + SENTIMENT_BATCH);
    try {
      const prompt = buildSentimentPrompt(brandName, batch);
      const reply = await complete(prompt.system, prompt.user, 'partnership-media-sentiment');
      const items = parseSentimentResponse(reply.content, batch.map(item => item.id));
      await saveSentiments(items);
      scored += items.length;
    } catch {
      failedBatches += 1;
    }
  }
  return { scored, failedBatches };
}

/** Extra mentions from a manual, confirmed treg run. Only the manual route provides one. */
export type ExtraCollector = (context: { runId: string; settings: MediaSettings }) => Promise<{ mentions: RawMention[]; notes: string[] }>;

export interface MediaRunOptions {
  extraCollector?: ExtraCollector | null;
  freeDeps?: (onProgress: FreeSourceDeps['onProgress']) => FreeSourceDeps;
  complete?: LlmComplete;
}

export async function runMediaRefresh(runId: string, options: MediaRunOptions = {}): Promise<void> {
  const run = await getMediaRun(runId);
  if (!run || run.status === 'succeeded' || run.status === 'failed') return;
  const notes: string[] = [];
  try {
    const userId = run.createdBy || await systemUserId();
    const settings = await getMediaSettings();
    if (!settings.keywords.length && !settings.hashtags.length && !settings.alertFeeds.length) {
      await failMediaRun(runId, 'Add keywords, hashtags or a Google Alerts RSS feed in Settings first.');
      return;
    }
    const onProgress = (progress: number, message: string) => updateMediaRunProgress(runId, progress, message);
    await onProgress(2, 'Reading free sources.');
    const free = await collectFreeMentions(settings, (options.freeDeps ?? realFreeSourceDeps)(onProgress), MEDIA_WINDOW_DAYS);
    notes.push(...free.notes);
    const collected: RawMention[] = [...free.mentions];
    let paidCount = 0;
    if (options.extraCollector) {
      if (run.trigger !== 'manual') {
        notes.push('Paid sources ignored: scheduled refreshes are free-only.');
      } else {
        await onProgress(60, 'Reading paid sources (treg).');
        const extra = await options.extraCollector({ runId, settings });
        notes.push(...extra.notes);
        collected.push(...extra.mentions);
        paidCount = extra.mentions.length;
      }
    }
    const unique = dedupeMentions(collected);
    await onProgress(75, `Saving ${unique.length} mention(s).`);
    const saved = await upsertMentions(unique, settings, runId);
    let sentiment = { scored: 0, failedBatches: 0 };
    if (userId) {
      await onProgress(85, 'Scoring sentiment.');
      sentiment = await scoreSentiment(settings.brandName, options.complete ?? realComplete(userId));
      if (sentiment.failedBatches) notes.push(`Sentiment: ${sentiment.failedBatches} batch(es) failed; they are retried on the next refresh.`);
    } else {
      notes.push('Sentiment skipped: no user is available to run the model.');
    }
    await finishMediaRun(runId, {
      stats: { collected: collected.length, unique: unique.length, inserted: saved.inserted, updated: saved.updated, scored: sentiment.scored, paid: paidCount, ...free.counts },
      notes,
    });
  } catch (error) {
    await failMediaRun(runId, aiProviderErrorBody(error).error || (error instanceof Error ? error.message : 'The refresh failed.'), notes);
  }
}

export type MediaDueSummary = { status: 'refreshed' | 'failed' | 'skipped'; reason?: string; runId?: string };

/**
 * Scheduled refresh: FREE SOURCES ONLY. No extra collector is passed and none can be:
 * this function takes no options. Skips when a refresh succeeded in the last `minHours`.
 */
export async function runDueMediaRefresh(now: Date = new Date(), minHours = 12): Promise<MediaDueSummary> {
  await expireStaleMediaRuns();
  const last = await latestSucceededMediaRun();
  if (last?.finishedAt && now.getTime() - Date.parse(last.finishedAt) < minHours * 3_600_000) return { status: 'skipped', reason: `A refresh already ran in the last ${minHours} hours.` };
  let runId: string;
  try {
    runId = await createMediaRun({ trigger: 'scheduled', mode: 'free', platforms: [], userId: await systemUserId() });
  } catch (error) {
    if (error instanceof MediaRunInProgressError) return { status: 'skipped', reason: error.message };
    throw error;
  }
  await runMediaRefresh(runId);
  const finished = await getMediaRun(runId);
  return finished?.status === 'succeeded' ? { status: 'refreshed', runId } : { status: 'failed', reason: finished?.error || undefined, runId };
}

/** LLM insights for a date range (Dataxet-style narrative), saved per range. */
export async function generateMediaInsights(range: DateRange, userId: string, complete: LlmComplete = realComplete(userId)): Promise<{ result: MediaInsights; model: string | null; mentions: number }> {
  const settings = await getMediaSettings();
  const mentions = await listMentionsInRange(range);
  if (!mentions.length) throw new Error('No mentions in this date range yet. Refresh first or pick a wider range.');
  const dashboard = buildMediaDashboard(mentions, range, settings.adValue);
  const prompt = buildInsightsPrompt(settings.brandName, dashboard, mentions);
  const reply = await complete(prompt.system, prompt.user, 'partnership-media-insights');
  const result = parseInsightsResponse(reply.content);
  if (!result.executiveSummary && !result.keyInsights.length) throw new Error('The model returned no usable insights. Try again.');
  await saveMediaInsights(range, result, reply.model, userId);
  return { result, model: reply.model, mentions: mentions.length };
}
