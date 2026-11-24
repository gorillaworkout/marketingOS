import { v4 as uuidv4 } from 'uuid';
import { createGoogleAdsClient } from '@/lib/google-ads/client';
import { requireGoogleAdsConfig, secretValues } from '@/lib/google-ads/config';
import { runKeywordTrendsFetch, type FetchResult, type FetchTrigger } from './collector';
import { KEYWORD_TRENDS_CONFIG } from './config';
import { buildKeywordTrendsWorkbook } from './export';
import { summarizeKeywords } from './metrics';
import { getSnapshot, latestSucceededSnapshot, postgresKeywordTrendsStore, recentSnapshots, runningSnapshot, snapshotMonths, snapshotRows, type SnapshotInfo } from './store';

/** Production wiring: credentials from the server env (GOOGLE_ADS_*), PostgreSQL store. Free; no paid gateway. */
export async function runKeywordTrendsFetchNow(trigger: FetchTrigger, triggeredBy: string | null = null): Promise<FetchResult> {
  return runKeywordTrendsFetch({ trigger, triggeredBy }, {
    store: postgresKeywordTrendsStore,
    newId: uuidv4,
    pause: () => new Promise(resolve => setTimeout(resolve, 300)),
    createClient: async () => {
      const config = requireGoogleAdsConfig();
      return { client: createGoogleAdsClient(config), loginCustomerId: config.loginCustomerId, secrets: secretValues(config) };
    },
  });
}

export async function getKeywordTrendsData() {
  const [snapshot, runs, running] = await Promise.all([latestSucceededSnapshot(), recentSnapshots(10), runningSnapshot()]);
  const summary = snapshot ? summarizeKeywords(await snapshotRows(snapshot.id)) : { months: [], keywords: [] };
  return { config: KEYWORD_TRENDS_CONFIG, snapshot, runs, running, ...summary };
}

export async function exportKeywordTrends(snapshotId: string | null, months = 3): Promise<{ filename: string; buffer: Buffer } | null> {
  const snapshot: SnapshotInfo | null = snapshotId ? await getSnapshot(snapshotId) : await latestSucceededSnapshot();
  if (!snapshot || snapshot.status !== 'succeeded') return null;
  const recent = (await snapshotMonths(snapshot.id)).slice(-months);
  const rows = await snapshotRows(snapshot.id, recent);
  const { buffer } = await buildKeywordTrendsWorkbook(rows, {
    reportDate: snapshot.reportDate, fetchedAt: snapshot.finishedAt, accountName: snapshot.accountName, currencyCode: snapshot.currencyCode,
    config: { ...KEYWORD_TRENDS_CONFIG, ...snapshot.config },
  }, months);
  return { filename: `keyword-planner-monthly-trend-${snapshot.reportDate.replace(/-/g, '')}.xlsx`, buffer };
}
