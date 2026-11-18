/**
 * "Fetch now" for Partnership > Google Alerts. Free: it only reads the Google Alerts
 * RSS feeds (no key, no treg, no model). Items are saved into the Media Monitoring
 * mentions table (deduplicated by URL) and linked to their feed, so both pages show
 * the same articles. Sentiment is scored on the next Media Monitoring refresh.
 */
import { dedupeMentions } from './media';
import { readAlertFeeds, type AlertFeedRef } from './media-sources';
import { realFreeSourceDeps } from './media-run';
import { getMediaSettings, upsertMentions } from './media-store';
import { alertFeedRefs, recordAlertFeedResults } from './google-alerts-store';

export interface AlertFetchSummary {
  feeds: number;
  failed: number;
  items: number;
  inserted: number;
  updated: number;
  results: Array<{ feedId: string | null; label: string; ok: boolean; items: number; error: string | null }>;
}

export async function fetchGoogleAlertsNow(input: { feedId?: string | null; fetchText?: (url: string) => Promise<string> } = {}): Promise<AlertFetchSummary> {
  const all = await alertFeedRefs();
  const feeds: AlertFeedRef[] = input.feedId ? all.filter(feed => feed.id === input.feedId) : all;
  if (!feeds.length) return { feeds: 0, failed: 0, items: 0, inserted: 0, updated: 0, results: [] };
  const results = await readAlertFeeds(feeds, input.fetchText ?? realFreeSourceDeps().fetchText);
  await recordAlertFeedResults(results);
  const unique = dedupeMentions(results.flatMap(result => result.items));
  const saved = unique.length ? await upsertMentions(unique, await getMediaSettings(), null) : { inserted: 0, updated: 0 };
  return {
    feeds: feeds.length,
    failed: results.filter(result => !result.ok).length,
    items: unique.length,
    inserted: saved.inserted,
    updated: saved.updated,
    results: results.map(result => ({ feedId: result.feed.id, label: result.feed.label || result.feedTitle, ok: result.ok, items: result.items.length, error: result.error })),
  };
}
