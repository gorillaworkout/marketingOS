import type { CompetitorKeyword, OurKeyword } from './keyword-gap-bucket';
import { dataForSeoError, parseDataForSeoRanked } from './keyword-gap-providers';
import { TregError, tregCall, type FetchLike, type TregConfig } from './treg-client';
import { estimateKeywordGapMicro, TREG_RANKED_KEYWORDS_ENDPOINT, tregRankedKeywordsBody } from './treg-endpoints';

export interface TregGapInput {
  gapId: string;
  userId: string;
  ourDomain: string;
  competitors: string[];
  market: string;
  language: 'id' | 'en';
  keywordLimit: number;
  onProgress?: (progress: number, message: string) => Promise<void> | void;
}

export interface TregSpendTally {
  actualMicro: number;
  /** 'estimate' when at least one call's charge is unknown (timeout) and its estimate was counted. */
  costSource: 'reported' | 'estimate';
  calls: number;
  callIds: string[];
}

export type TregGapOutcome =
  | ({ ok: true; ours: OurKeyword[]; competitorKeywords: CompetitorKeyword[] } & TregSpendTally)
  | ({ ok: false; error: TregError } & TregSpendTally);

function host(value: string): string {
  try { return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.replace(/^www\./, ''); } catch { return value; }
}

/**
 * Ranked keywords for our domain and each competitor through treg. Stops at the first
 * failure so the caller can fall back to Free mode; what was already charged is kept.
 */
export async function collectTregKeywords(input: TregGapInput, config: TregConfig, fetchImpl: FetchLike = fetch): Promise<TregGapOutcome> {
  const { perCallMicro } = estimateKeywordGapMicro(input.competitors.length, input.keywordLimit);
  // Ceiling per call: 3x the catalog price leaves room for treg's billing-block rounding.
  const maxCostUsd = Math.max(0.05, (perCallMicro * 3) / 1_000_000);
  const tally: TregSpendTally = { actualMicro: 0, costSource: 'reported', calls: 0, callIds: [] };
  const targets = [host(input.ourDomain), ...input.competitors.map(host)];
  let ours: OurKeyword[] = [];
  const competitorKeywords: CompetitorKeyword[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    await input.onProgress?.(15 + Math.round((index / targets.length) * 60), `Reading treg ranked keywords for ${target} (${index + 1} of ${targets.length}).`);
    tally.calls += 1;
    try {
      const result = await tregCall(config, {
        endpointId: TREG_RANKED_KEYWORDS_ENDPOINT,
        body: tregRankedKeywordsBody(target, input.market, input.language, input.keywordLimit),
        meta: { feature: 'keyword-gap', run: input.gapId, user: input.userId },
        idempotencyKey: `${input.gapId}:${index}`,
        maxCostUsd,
      }, fetchImpl);
      tally.actualMicro += result.costMicro ?? 0;
      if (result.callId) tally.callIds.push(result.callId);
      const failure = dataForSeoError(result.body);
      if (failure) throw new TregError('provider-error', 200);
      const parsed = parseDataForSeoRanked(result.body, target);
      if (index === 0) ours = parsed.ours;
      else competitorKeywords.push(...parsed.competitor);
    } catch (error) {
      const tregError = error instanceof TregError ? error : new TregError('provider-error');
      if (tregError.kind === 'timeout' || tregError.kind === 'network') {
        // The call may still have been charged; count its estimate and say so.
        tally.actualMicro += perCallMicro;
        tally.costSource = 'estimate';
      } else {
        tally.actualMicro += tregError.costMicro;
      }
      return { ok: false, error: tregError, ...tally };
    }
  }
  return { ok: true, ours, competitorKeywords, ...tally };
}
