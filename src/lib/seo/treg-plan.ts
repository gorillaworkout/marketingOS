import type { TregConfig } from './treg-client';
import { estimateKeywordGapMicro, TREG_DEFAULT_KEYWORD_LIMIT, TREG_KEYWORD_LIMITS } from './treg-endpoints';
import { guardTregSpend, type TregGuardDeps, type TregPlan } from './treg-cost-guard';

export { canRunTreg, tregStatus, type TregStatus } from './treg-cost-guard';

/** Keyword Gap's use of the shared treg cost guard. */

export function parseKeywordLimit(value: unknown): number {
  const parsed = Number(value);
  return (TREG_KEYWORD_LIMITS as readonly number[]).includes(parsed) ? parsed : TREG_DEFAULT_KEYWORD_LIMIT;
}

export type KeywordGapTregPlan = Exclude<TregPlan, { kind: 'paid' }> | (Extract<TregPlan, { kind: 'paid' }> & { keywordLimit: number });

export async function planTregRun(input: {
  config: TregConfig;
  role: string;
  userId: string;
  competitors: number;
  keywordLimit: number;
  confirmedEstimateMicro: number | null;
}, deps?: TregGuardDeps): Promise<KeywordGapTregPlan> {
  const plan = await guardTregSpend({
    config: input.config, role: input.role, userId: input.userId, feature: 'keyword-gap',
    estimate: estimateKeywordGapMicro(input.competitors, input.keywordLimit),
    confirmedEstimateMicro: input.confirmedEstimateMicro,
  }, deps);
  return plan.kind === 'paid' ? { ...plan, keywordLimit: input.keywordLimit } : plan;
}
