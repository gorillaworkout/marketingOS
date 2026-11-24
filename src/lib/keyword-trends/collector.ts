/**
 * Keyword Trends fetch: Keyword Planner ideas -> monthly trend rows -> snapshot.
 * Read-only on Google Ads and free; never uses any paid model gateway.
 * Dependencies (client, store) are injected so this file has no I/O of its own.
 */
import { sanitizeGoogleAdsError } from '@/lib/google-ads/config';
import type { GoogleAdsClient, KeywordPlannerClient } from '@/lib/google-ads/client';
import { CUSTOMER_CLIENT_QUERY, mapCustomerClientRow, type ClientAccount } from '@/lib/google-ads/gaql';
import { buildIdeasRequest, KEYWORD_TRENDS_CONFIG, requestSpecs, type KeywordTrendsConfig } from './config';
import { mergeIdeas, monthlyTrendRows, type TrendRow } from './metrics';

export type FetchTrigger = 'manual' | 'scheduled' | 'cli';

export interface PlannerAccount { customerId: string; name: string; currencyCode: string; timeZone: string }

export interface CollectedTrends {
  account: PlannerAccount;
  ideasCount: number;
  rows: TrendRow[];
  firstMonth: string | null;
  lastMonth: string | null;
}

/** First enabled, non-test, non-manager client under the MCC: IDR first, then name, then id. */
export function pickPlannerAccount(accounts: ClientAccount[]): PlannerAccount | null {
  const eligible = accounts
    .filter(account => /^[0-9]{10}$/.test(account.customerId) && !account.manager && !account.testAccount && account.status === 'ENABLED')
    .sort((a, b) => Number(b.currencyCode === 'IDR') - Number(a.currencyCode === 'IDR')
      || a.descriptiveName.localeCompare(b.descriptiveName) || a.customerId.localeCompare(b.customerId));
  const first = eligible[0];
  return first ? { customerId: first.customerId, name: first.descriptiveName, currencyCode: first.currencyCode, timeZone: first.timeZone } : null;
}

export async function collectKeywordTrends(
  client: GoogleAdsClient & KeywordPlannerClient,
  loginCustomerId: string,
  config: KeywordTrendsConfig = KEYWORD_TRENDS_CONFIG,
  pause: () => Promise<void> = async () => {},
): Promise<CollectedTrends> {
  const tree = await client.search(loginCustomerId, CUSTOMER_CLIENT_QUERY);
  const account = pickPlannerAccount(tree.map(mapCustomerClientRow));
  if (!account) throw new Error('No enabled Google Ads client account under the MCC to run Keyword Planner on.');
  const specs = requestSpecs(config.seedKeywords, config.pageUrl, config.seedLimit);
  const batches = [];
  for (const spec of specs) {
    const results = await client.generateKeywordIdeas(account.customerId, buildIdeasRequest(spec, config), { loginCustomerId, limit: config.maxIdeas });
    batches.push({ spec, results });
    await pause();
  }
  const ideas = mergeIdeas(batches, config.maxIdeas);
  const rows = monthlyTrendRows(ideas, config.seedKeywords);
  const months = [...new Set(rows.map(row => row.searchMonth))].sort();
  return { account, ideasCount: ideas.length, rows, firstMonth: months[0] ?? null, lastMonth: months[months.length - 1] ?? null };
}

export interface KeywordTrendsStore {
  /** Inserts a running snapshot; returns false when another fetch is running. Releases stale runs first. */
  startSnapshot(input: { id: string; trigger: FetchTrigger; triggeredBy: string | null; reportDate: string; config: KeywordTrendsConfig }): Promise<boolean>;
  /** Stores the rows and marks the snapshot succeeded, atomically. */
  completeSnapshot(id: string, collected: CollectedTrends): Promise<void>;
  failSnapshot(id: string, error: string): Promise<void>;
}

export type FetchResult =
  | { status: 'succeeded'; snapshotId: string; ideasCount: number; rowsCount: number; firstMonth: string | null; lastMonth: string | null; accountName: string }
  | { status: 'failed'; snapshotId: string; error: string }
  | { status: 'busy'; error: string };

/** YYYY-MM-DD in Asia/Jakarta. */
export function jakartaDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export async function runKeywordTrendsFetch(
  options: { trigger: FetchTrigger; triggeredBy?: string | null; now?: Date },
  deps: {
    store: KeywordTrendsStore;
    newId: () => string;
    createClient: () => Promise<{ client: GoogleAdsClient & KeywordPlannerClient; loginCustomerId: string; secrets: string[] }>;
    config?: KeywordTrendsConfig;
    pause?: () => Promise<void>;
  },
): Promise<FetchResult> {
  const config = deps.config ?? KEYWORD_TRENDS_CONFIG;
  const id = deps.newId();
  const started = await deps.store.startSnapshot({ id, trigger: options.trigger, triggeredBy: options.triggeredBy ?? null, reportDate: jakartaDate(options.now), config });
  if (!started) return { status: 'busy', error: 'A Keyword Trends fetch is already running.' };
  let secrets: string[] = [];
  try {
    const { client, loginCustomerId, secrets: configSecrets } = await deps.createClient();
    secrets = configSecrets;
    const collected = await collectKeywordTrends(client, loginCustomerId, config, deps.pause);
    if (!collected.rows.length) throw new Error('Keyword Planner returned no keyword ideas with monthly volumes.');
    await deps.store.completeSnapshot(id, collected);
    return { status: 'succeeded', snapshotId: id, ideasCount: collected.ideasCount, rowsCount: collected.rows.length, firstMonth: collected.firstMonth, lastMonth: collected.lastMonth, accountName: collected.account.name };
  } catch (error) {
    const message = sanitizeGoogleAdsError(error, secrets);
    await deps.store.failSnapshot(id, message);
    return { status: 'failed', snapshotId: id, error: message };
  }
}
