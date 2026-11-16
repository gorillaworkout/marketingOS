import {
  cachedTregBalance, fetchTregBalance, forgetTregBalance, microToUsd, rememberTregBalance, TregError,
  type TregBalance, type TregConfig, type TregFailureKind,
} from './treg-client';
import { TREG_DEFAULT_KEYWORD_LIMIT, TREG_KEYWORD_LIMITS, TREG_RANKED_PRICE } from './treg-endpoints';
import { DailyLimitError, reserveTregSpend, settleTregSpend, tregSpentTodayMicro, type CostSource } from './treg-spend';

/**
 * Shared cost guard for every treg-backed feature. A feature computes its own
 * estimate for ONE generate, then:
 *   1. guardTregSpend()  before the run: permission, confirmed estimate, balance, daily limit, reservation;
 *   2. settleTregRun()   after the run: records the actual cost and reads the remaining balance.
 * The UI side is <TregCostNotice> (src/components/seo/TregCostNotice.tsx).
 */

export interface TregEstimate {
  calls: number;
  totalMicro: number;
}

/** Paid runs follow the AI Visibility "Run now" rule: admins only, unless TREG_ADMIN_ONLY=false. */
export function canRunTreg(config: TregConfig, role: string): boolean {
  return !config.adminOnly || role === 'admin';
}

export interface TregGuardDeps {
  balance: () => Promise<TregBalance>;
  reserve: typeof reserveTregSpend;
}

export type TregPlan =
  | { kind: 'refuse'; status: number; body: Record<string, unknown> }
  | { kind: 'paid'; spendId: string; estimateMicro: number; balanceBeforeMicro: number | null }
  | { kind: 'skip'; reason: TregFailureKind };

export async function guardTregSpend(input: {
  config: TregConfig;
  role: string;
  userId: string;
  feature: string;
  estimate: TregEstimate;
  confirmedEstimateMicro: number | null;
}, deps: TregGuardDeps = { balance: () => cachedTregBalance(input.config), reserve: reserveTregSpend }): Promise<TregPlan> {
  const { config, estimate } = input;
  if (!config.apiKey) return { kind: 'skip', reason: 'not-configured' };
  if (!canRunTreg(config, input.role)) {
    return { kind: 'refuse', status: 403, body: { error: 'Paid treg runs are admin-only. Use Free mode, or ask an admin to run it.' } };
  }
  if (input.confirmedEstimateMicro === null || input.confirmedEstimateMicro < estimate.totalMicro) {
    return { kind: 'refuse', status: 409, body: { error: 'Confirm the estimated treg cost before running.', estimateMicro: estimate.totalMicro, estimateUsd: microToUsd(estimate.totalMicro) } };
  }
  let balanceBeforeMicro: number | null = null;
  try {
    balanceBeforeMicro = (await deps.balance()).balanceMicro;
    if (balanceBeforeMicro < estimate.totalMicro) return { kind: 'skip', reason: 'insufficient-balance' };
  } catch (error) {
    // A rejected token goes straight to Free mode; a slow balance read does not block the run.
    if (error instanceof TregError && (error.kind === 'unauthorized' || error.kind === 'not-configured')) return { kind: 'skip', reason: error.kind };
  }
  try {
    const spendId = await deps.reserve({ feature: input.feature, refId: null, userId: input.userId, estimateMicro: estimate.totalMicro, calls: estimate.calls, limitMicro: config.dailyLimitMicro, balanceBeforeMicro });
    return { kind: 'paid', spendId, estimateMicro: estimate.totalMicro, balanceBeforeMicro };
  } catch (error) {
    if (error instanceof DailyLimitError) {
      return { kind: 'refuse', status: 429, body: { error: error.message, spentTodayUsd: microToUsd(error.spentMicro), dailyLimitUsd: microToUsd(error.limitMicro) } };
    }
    throw error;
  }
}

/** What a finished treg run cost, as stored on the feature's result and shown by <TregCostNotice>. */
export interface TregRunCost {
  provider: 'treg';
  estimatedMicro: number;
  actualMicro: number;
  source: CostSource;
  calls: number;
  balanceBeforeMicro: number | null;
  /** Fresh balance read after the run; null when treg could not be reached. */
  balanceAfterMicro: number | null;
}

export async function settleTregRun(input: {
  config: TregConfig;
  spendId: string | null;
  estimateMicro: number;
  balanceBeforeMicro: number | null;
  ok: boolean;
  actualMicro: number;
  costSource: CostSource;
  calls: number;
  callIds: string[];
  note: string | null;
  /** balance_micro from a 402 refusal, if any. */
  refusalBalanceMicro?: number | null;
}, deps: { balance?: () => Promise<TregBalance>; settle?: typeof settleTregSpend } = {}): Promise<TregRunCost> {
  let balanceAfterMicro: number | null = input.refusalBalanceMicro ?? null;
  if (balanceAfterMicro !== null) rememberTregBalance(balanceAfterMicro);
  else if (input.config.apiKey && input.calls > 0) {
    forgetTregBalance();
    try {
      const fresh = await (deps.balance ?? (() => fetchTregBalance(input.config)))();
      balanceAfterMicro = fresh.balanceMicro;
      rememberTregBalance(fresh.balanceMicro);
    } catch {
      balanceAfterMicro = null;
    }
  }
  if (input.spendId) {
    await (deps.settle ?? settleTregSpend)(input.spendId, {
      status: input.ok ? 'succeeded' : 'fallback', actualMicro: input.actualMicro, costSource: input.costSource,
      calls: input.calls, callIds: input.callIds, note: input.note, balanceAfterMicro,
    }).catch(() => undefined);
  }
  return {
    provider: 'treg', estimatedMicro: input.estimateMicro, actualMicro: input.actualMicro, source: input.costSource,
    calls: input.calls, balanceBeforeMicro: input.balanceBeforeMicro, balanceAfterMicro,
  };
}

export interface TregStatus {
  configured: boolean;
  adminOnly: boolean;
  canRun: boolean;
  balanceUsd: number | null;
  balanceFetchedAt: string | null;
  balanceError: string | null;
  lowBalance: boolean;
  lowBalanceUsd: number;
  spentTodayUsd: number;
  dailyLimitUsd: number;
  price: { perRequestUsd: number; perKeywordUsd: number };
  keywordLimits: number[];
  defaultKeywordLimit: number;
}

/** Status for <TregCostNotice>. Never includes the token. Balance is cached 5 minutes. */
export async function tregStatus(config: TregConfig, role: string, deps: { balance?: () => Promise<TregBalance>; spentToday?: () => Promise<number> } = {}): Promise<TregStatus> {
  let balance: TregBalance | null = null;
  let balanceError: string | null = null;
  if (config.apiKey) {
    try {
      balance = await (deps.balance ?? (() => cachedTregBalance(config)))();
    } catch (error) {
      balanceError = error instanceof TregError ? error.message : 'treg unavailable';
    }
  }
  const spent = await (deps.spentToday ?? tregSpentTodayMicro)().catch(() => 0);
  return {
    configured: Boolean(config.apiKey),
    adminOnly: config.adminOnly,
    canRun: Boolean(config.apiKey) && canRunTreg(config, role),
    balanceUsd: balance ? microToUsd(balance.balanceMicro) : null,
    balanceFetchedAt: balance?.fetchedAt ?? null,
    balanceError,
    lowBalance: balance ? balance.balanceMicro < config.lowBalanceMicro : false,
    lowBalanceUsd: microToUsd(config.lowBalanceMicro),
    spentTodayUsd: microToUsd(spent),
    dailyLimitUsd: microToUsd(config.dailyLimitMicro),
    price: { perRequestUsd: microToUsd(TREG_RANKED_PRICE.perRequestMicro), perKeywordUsd: microToUsd(TREG_RANKED_PRICE.perKeywordMicro) },
    keywordLimits: [...TREG_KEYWORD_LIMITS],
    defaultKeywordLimit: TREG_DEFAULT_KEYWORD_LIMIT,
  };
}
