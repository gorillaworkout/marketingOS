/**
 * Google Ads -> PostgreSQL sync (read-only on the Google side).
 *
 * 1. Discover accounts: every client under the MCC (customer_client, any
 *    level), every id from customers:listAccessibleCustomers, and every id in
 *    GOOGLE_ADS_CUSTOMER_IDS. Manager accounts are skipped. Accounts that
 *    cannot be read (e.g. permission denied) are stored with a sanitized
 *    error and skipped; the run carries on with the rest.
 * 2. Per account, walk the date range in CHUNK_DAYS chunks and replace each
 *    chunk atomically (upsert, then drop rows of that chunk that Google no
 *    longer returns). Re-running is idempotent.
 *
 * Incremental runs re-pull the last INCREMENTAL_DAYS days (conversions are
 * attributed late). An account that has never synced gets BACKFILL_DAYS.
 * Dates follow the account time zone, as Google Ads reports them.
 */
import { maskCustomerId, sanitizeGoogleAdsError } from './config';
import { GoogleAdsApiError, type GoogleAdsClient, type SleepFn } from './client';
import {
  buildQueries, buildSnapshot, CUSTOMER_CLIENT_QUERY, CUSTOMER_QUERY, mapCustomerClientRow, mapCustomerRow,
  type ClientAccount, type RangeSnapshot,
} from './gaql';

export const INCREMENTAL_DAYS = 14;
export const BACKFILL_DAYS = 90;
export const CHUNK_DAYS = 7;
export const MAX_DAYS = 400;
/** A run still "running" after this long is treated as crashed and released. */
export const STALE_RUN_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_TIME_ZONE = 'Asia/Jakarta';

export type SyncMode = 'incremental' | 'backfill';
export type SyncTrigger = 'manual' | 'scheduled' | 'cli';
export type AccountSource = 'mcc' | 'env' | 'mcc+env';

export interface RowCounts { campaigns: number; adGroups: number; keywords: number; searchTerms: number }

export interface DiscoveredAccount extends ClientAccount {
  source: AccountSource;
  /** Sanitized reason this account cannot be read (e.g. permission error). Counts as failed. */
  error: string | null;
  /** Set for accounts that are readable but not active (CANCELED, CLOSED, SUSPENDED). Skipped, not failed. */
  skipReason?: string | null;
  /** login-customer-id to use: the MCC for accounts under it, the account itself for direct access. */
  loginCustomerId: string | null;
}

export interface StoredAccountState { customerId: string; firstSyncedDate: string | null; active: boolean }

export interface AccountRunDetail {
  customerId: string;
  name: string;
  status: 'succeeded' | 'failed' | 'skipped';
  rangeStart: string | null;
  rangeEnd: string | null;
  rows: RowCounts;
  error: string | null;
}

export interface GoogleAdsSyncStore {
  /** Inserts a running row; resolves false when another run holds the lock. */
  startRun(run: { id: string; mode: SyncMode; trigger: SyncTrigger; rangeStart: string | null; rangeEnd: string | null; triggeredBy: string | null }): Promise<boolean>;
  releaseStaleRuns(olderThan: Date): Promise<void>;
  upsertAccounts(accounts: DiscoveredAccount[], checkedAt: Date): Promise<void>;
  accountStates(): Promise<StoredAccountState[]>;
  replaceRange(customerId: string, start: string, end: string, snapshot: RangeSnapshot, syncedAt: Date): Promise<RowCounts>;
  markAccountSynced(customerId: string, result: { at: Date; error: string | null; firstSyncedDate: string | null }): Promise<void>;
  finishRun(runId: string, result: { status: 'succeeded' | 'partial' | 'failed'; accountsSynced: number; accountsFailed: number; rowsUpserted: number; details: AccountRunDetail[]; error: string | null }): Promise<void>;
}

export interface RunGoogleAdsSyncOptions {
  mode: SyncMode;
  trigger?: SyncTrigger;
  triggeredBy?: string | null;
  /** Override the number of days (incremental default 14, backfill default 90). */
  days?: number;
  /** Limit to these customer ids (10 digits). */
  customerIds?: string[];
  now?: Date;
  /** Pause between API requests (rate limits). */
  pauseMs?: number;
  onProgress?: (message: string) => void;
}

export interface GoogleAdsSyncDeps {
  store: GoogleAdsSyncStore;
  createClient: () => Promise<{ client: GoogleAdsClient; loginCustomerId: string; extraCustomerIds: string[]; secrets: string[] }>;
  newId: () => string;
  sleep?: SleepFn;
}

export type GoogleAdsSyncResult =
  | { status: 'busy'; error: string }
  | { status: 'succeeded' | 'partial' | 'failed'; runId: string; rangeStart: string; rangeEnd: string; accountsSynced: number; accountsFailed: number; rowsUpserted: number; details: AccountRunDetail[]; error: string | null; configError?: boolean };

export function dateInTimeZone(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Inclusive [start, end] chunks of at most `size` days. */
export function dateChunks(start: string, end: string, size = CHUNK_DAYS): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, size)) {
    const chunkEnd = addDays(cursor, size - 1);
    chunks.push({ start: cursor, end: chunkEnd < end ? chunkEnd : end });
  }
  return chunks;
}

export function syncRange(mode: SyncMode, today: string, options: { days?: number; neverSynced?: boolean } = {}): { start: string; end: string; days: number } {
  const fallback = mode === 'backfill' || options.neverSynced ? BACKFILL_DAYS : INCREMENTAL_DAYS;
  const requested = options.days && Number.isFinite(options.days) ? Math.floor(options.days) : fallback;
  const days = Math.min(MAX_DAYS, Math.max(1, options.neverSynced && mode === 'incremental' ? Math.max(requested, BACKFILL_DAYS) : requested));
  return { start: addDays(today, -(days - 1)), end: today, days };
}

const errorMessage = (error: unknown, secrets: string[]) => sanitizeGoogleAdsError(error, secrets);

/**
 * Finds every client account. The MCC tree is read with the MCC as login
 * customer; ids outside that tree are probed directly.
 */
export async function discoverAccounts(client: GoogleAdsClient, loginCustomerId: string, extraCustomerIds: string[], secrets: string[] = []): Promise<DiscoveredAccount[]> {
  const found = new Map<string, DiscoveredAccount>();
  const tree = await client.search(loginCustomerId, CUSTOMER_CLIENT_QUERY);
  for (const account of tree.map(mapCustomerClientRow)) {
    if (!/^[0-9]{10}$/.test(account.customerId)) continue;
    found.set(account.customerId, { ...account, source: 'mcc', error: null, loginCustomerId });
  }
  const accessible = await client.listAccessibleCustomers().catch(() => [] as string[]);
  const extras = new Set(extraCustomerIds);
  for (const id of [...new Set([...accessible, ...extraCustomerIds])]) {
    const existing = found.get(id);
    if (existing) {
      if (extras.has(id)) existing.source = 'mcc+env';
      continue;
    }
    try {
      const rows = await client.search(id, CUSTOMER_QUERY, { loginCustomerId: id });
      const account = rows[0] ? mapCustomerRow(rows[0]) : null;
      if (!account) throw new Error('Account returned no customer row.');
      found.set(id, { ...account, customerId: id, source: extras.has(id) ? 'env' : 'mcc', error: null, loginCustomerId: id });
    } catch (error) {
      // Accessible but unreadable (or listed in env but not reachable). Only
      // env-listed ids are kept as failed rows; other accessible ids that fail
      // are usually managers outside the tree and are not shown.
      if (extras.has(id)) {
        found.set(id, { customerId: id, descriptiveName: '', currencyCode: '', timeZone: '', status: '', testAccount: false, manager: false, level: 0, source: 'env', error: errorMessage(error, secrets), loginCustomerId: id });
      }
    }
  }
  return [...found.values()]
    .filter(account => !account.manager)
    .map(account => account.error || account.status === 'ENABLED' || !account.status
      ? account
      : { ...account, skipReason: `Account status is ${account.status}; not synced.` })
    .sort((left, right) => left.descriptiveName.localeCompare(right.descriptiveName) || left.customerId.localeCompare(right.customerId));
}

/** Fetches and maps one date range for one account (no database). */
export async function fetchRangeSnapshot(client: GoogleAdsClient, account: Pick<DiscoveredAccount, 'customerId' | 'loginCustomerId'>, start: string, end: string, pause: () => Promise<void> = async () => {}): Promise<RangeSnapshot> {
  const queries = buildQueries(start, end);
  const options = { loginCustomerId: account.loginCustomerId };
  const campaigns = await client.search(account.customerId, queries.campaigns, options); await pause();
  const adGroups = await client.search(account.customerId, queries.adGroups, options); await pause();
  const keywords = await client.search(account.customerId, queries.keywords, options); await pause();
  const searchTerms = await client.search(account.customerId, queries.searchTerms, options); await pause();
  return buildSnapshot({ campaigns, adGroups, keywords, searchTerms });
}

const zeroCounts = (): RowCounts => ({ campaigns: 0, adGroups: 0, keywords: 0, searchTerms: 0 });
const total = (counts: RowCounts) => counts.campaigns + counts.adGroups + counts.keywords + counts.searchTerms;

export async function runGoogleAdsSync(options: RunGoogleAdsSyncOptions, deps: GoogleAdsSyncDeps): Promise<GoogleAdsSyncResult> {
  const now = options.now ?? new Date();
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const pause = async () => { if (options.pauseMs) await sleep(options.pauseMs); };
  const log = options.onProgress ?? (() => {});
  const today = dateInTimeZone(now, DEFAULT_TIME_ZONE);
  const planned = syncRange(options.mode, today, { days: options.days });

  await deps.store.releaseStaleRuns(new Date(now.getTime() - STALE_RUN_MS));
  const runId = deps.newId();
  const started = await deps.store.startRun({ id: runId, mode: options.mode, trigger: options.trigger ?? 'manual', rangeStart: planned.start, rangeEnd: planned.end, triggeredBy: options.triggeredBy ?? null });
  if (!started) return { status: 'busy', error: 'A Google Ads sync is already running. Try again when it finishes.' };

  let secrets: string[] = [];
  const details: AccountRunDetail[] = [];
  let rowsUpserted = 0;
  let rangeStart = planned.start;
  const finish = async (status: 'succeeded' | 'partial' | 'failed', error: string | null, configError = false): Promise<GoogleAdsSyncResult> => {
    const accountsSynced = details.filter(detail => detail.status === 'succeeded').length;
    const accountsFailed = details.filter(detail => detail.status === 'failed').length;
    await deps.store.finishRun(runId, { status, accountsSynced, accountsFailed, rowsUpserted, details, error });
    return { status, runId, rangeStart, rangeEnd: planned.end, accountsSynced, accountsFailed, rowsUpserted, details, error, configError };
  };

  try {
    let wiring: Awaited<ReturnType<GoogleAdsSyncDeps['createClient']>>;
    try {
      wiring = await deps.createClient();
    } catch (error) {
      return await finish('failed', errorMessage(error, []), true);
    }
    secrets = wiring.secrets;
    const { client } = wiring;
    let accounts: DiscoveredAccount[];
    try {
      accounts = await discoverAccounts(client, wiring.loginCustomerId, wiring.extraCustomerIds, secrets);
    } catch (error) {
      return await finish('failed', `Could not list accounts under the MCC: ${errorMessage(error, secrets)}`);
    }
    await deps.store.upsertAccounts(accounts, now);
    log(`Found ${accounts.length} client account(s): ${accounts.map(account => `${account.descriptiveName || '(unknown)'} ${maskCustomerId(account.customerId)}${account.error ? ' [error]' : account.skipReason ? ' [skipped]' : ''}`).join(', ')}`);

    const states = new Map((await deps.store.accountStates()).map(state => [state.customerId, state]));
    const only = options.customerIds?.length ? new Set(options.customerIds) : null;
    for (const account of accounts) {
      if (only && !only.has(account.customerId)) continue;
      const name = account.descriptiveName || maskCustomerId(account.customerId);
      if (account.error || account.skipReason || states.get(account.customerId)?.active === false) {
        details.push({ customerId: account.customerId, name, status: account.error ? 'failed' : 'skipped', rangeStart: null, rangeEnd: null, rows: zeroCounts(), error: account.error ?? account.skipReason ?? 'Account is turned off in MarketingOS.' });
        continue;
      }
      const accountToday = dateInTimeZone(now, account.timeZone || DEFAULT_TIME_ZONE);
      const neverSynced = !states.get(account.customerId)?.firstSyncedDate;
      const range = syncRange(options.mode, accountToday, { days: options.days, neverSynced });
      if (range.start < rangeStart) rangeStart = range.start;
      const rows = zeroCounts();
      try {
        for (const chunk of dateChunks(range.start, range.end)) {
          const snapshot = await fetchRangeSnapshot(client, account, chunk.start, chunk.end, pause);
          const written = await deps.store.replaceRange(account.customerId, chunk.start, chunk.end, snapshot, new Date());
          rows.campaigns += written.campaigns; rows.adGroups += written.adGroups; rows.keywords += written.keywords; rows.searchTerms += written.searchTerms;
          rowsUpserted += total(written);
          log(`  ${name} ${chunk.start}..${chunk.end}: ${total(written)} rows`);
        }
        const existingFirst = states.get(account.customerId)?.firstSyncedDate ?? null;
        await deps.store.markAccountSynced(account.customerId, { at: new Date(), error: null, firstSyncedDate: existingFirst && existingFirst < range.start ? existingFirst : range.start });
        details.push({ customerId: account.customerId, name, status: 'succeeded', rangeStart: range.start, rangeEnd: range.end, rows, error: null });
      } catch (error) {
        const message = errorMessage(error, secrets);
        await deps.store.markAccountSynced(account.customerId, { at: new Date(), error: message, firstSyncedDate: null });
        details.push({ customerId: account.customerId, name, status: 'failed', rangeStart: range.start, rangeEnd: range.end, rows, error: message });
        if (error instanceof GoogleAdsApiError && error.status === 401) break;
      }
    }
    const ok = details.filter(detail => detail.status === 'succeeded').length;
    const failed = details.filter(detail => detail.status === 'failed').length;
    if (!ok && !details.length) return await finish('failed', 'No Google Ads client accounts were found under the MCC.');
    if (!ok && failed) return await finish('failed', 'No account could be synced. See the per-account errors.');
    return await finish(failed ? 'partial' : 'succeeded', failed ? `${failed} account(s) failed.` : null);
  } catch (error) {
    return await finish('failed', errorMessage(error, secrets));
  }
}
