/**
 * Commission and Deals History swap from stored facts.
 * Numeric amounts are sums of stored deals. A date with no stored deals is not zero.
 */
import { RATES, type Rate } from './conventions';
import type { DealFact } from './deals-engine';
import type { SwapReport } from './metrics';

export const PENDING_DEALS_HISTORY = 'Pending: Deals History';
export const ATTESTED_EMPTY = 'Attested, no deals stored';

/** Audited 01–05 Oct file. CI does not generate 390,366 rows; the bucket fixture sums to the footer. */
export const OFFICIAL_DH_OCT_1_5 = { uniqueDeals: 390366, commission: -51486.7, swap: 0 } as const;

export interface OfficialBucket { date: string; usd: number; r10000: number; r12000: number; r14000: number }

export const OFFICIAL_COMMISSION_BUCKETS: readonly OfficialBucket[] = [
  { date: '2026-10-01', usd: -24.96, r10000: -4641.65, r12000: -18.48, r14000: -13244.88 },
  { date: '2026-10-02', usd: -43.24, r10000: -4698.92, r12000: -21.68, r14000: -13673.1 },
  { date: '2026-10-03', usd: 0, r10000: 0, r12000: 0, r14000: 0 },
  { date: '2026-10-05', usd: -32.59, r10000: -4693.2, r12000: -26.73, r14000: -10367.27 },
];

const LOGIN: Record<number, string> = { 1: '2900001', 10000: '2000001', 12000: '2200001', 14000: '2400001' };

/** One Entry=in deal per audited bucket. Swap is 0. Enough to prove the footer without the raw file. */
export function officialBucketDeals(): DealFact[] {
  const deals: DealFact[] = [];
  for (const bucket of OFFICIAL_COMMISSION_BUCKETS) {
    const amounts: Array<[Rate, number]> = [[1, bucket.usd], [10000, bucket.r10000], [12000, bucket.r12000], [14000, bucket.r14000]];
    amounts.forEach(([rate, commission], index) => {
      deals.push({
        deal: `${bucket.date.replace(/-/g, '')}${index}`,
        login: LOGIN[rate],
        serverTime: `${bucket.date} 12:00:00`,
        serverDate: bucket.date,
        entry: 'in',
        volume: 1, commission, fee: 0, swap: 0, profit: 0, currency: 'USD', rate,
      });
    });
  }
  return deals;
}

export type DealCoverageStatus = 'attested' | 'partial';
export type DealsDayStatus = 'observed' | 'attested' | 'partial' | 'missing';

export interface DealsDay {
  date: string;
  status: DealsDayStatus;
  commission: Record<Rate, number> | null;
  swap: Record<Rate, number> | null;
  outCommission: number | null;
}

const emptyRates = (): Record<Rate, number> => ({ 1: 0, 10000: 0, 12000: 0, 14000: 0 });
const round2 = (value: number) => Math.round(value * 100) / 100;

function unmarked(date: string, status: DealsDayStatus): DealsDay {
  return { date, status, commission: null, swap: null, outCommission: null };
}

export function dealsHistoryFromDaily(
  rows: Array<{ date: string; rate: Rate; commissionIn: number; swap: number }>,
  coverage: Record<string, { status: DealCoverageStatus } | undefined>,
  dates: string[],
): DealsDay[] {
  return dates.map(date => {
    const matched = rows.filter(row => row.date === date);
    if (matched.length) {
      const commission = emptyRates();
      const swap = emptyRates();
      for (const row of matched) {
        commission[row.rate] = round2(row.commissionIn);
        swap[row.rate] = round2(row.swap);
      }
      return { date, status: 'observed', commission, swap, outCommission: null };
    }
    const mark = coverage[date]?.status;
    return unmarked(date, mark === 'attested' || mark === 'partial' ? mark : 'missing');
  });
}

export function dealsHistoryReport(
  facts: DealFact[],
  coverage: Record<string, { status: DealCoverageStatus } | undefined>,
  dates: string[],
): DealsDay[] {
  return dates.map(date => {
    const matched = facts.filter(deal => deal.serverDate === date && deal.rate !== null);
    if (matched.length) {
      const commission = emptyRates();
      const swap = emptyRates();
      let outCommission = 0;
      for (const deal of matched) {
        if (deal.rate === null) continue;
        if (deal.entry === 'in') commission[deal.rate] += deal.commission;
        else outCommission += deal.commission;
        swap[deal.rate] += deal.swap;
      }
      for (const rate of RATES) { commission[rate] = round2(commission[rate]); swap[rate] = round2(swap[rate]); }
      return { date, status: 'observed', commission, swap, outCommission: round2(outCommission) };
    }
    const mark = coverage[date]?.status;
    return unmarked(date, mark === 'attested' || mark === 'partial' ? mark : 'missing');
  });
}

export interface ComposedSwapDay {
  date: string;
  crmSwap: Record<Rate, number>;
  crmRefund: Record<Rate, number>;
  dealsSwap: Record<Rate, number> | null;
  dealsStatus: DealsDay['status'];
}

/** CRM-S / CRM-SR stay on their phase 1 posting dates. Deals History swap is a separate term. */
export function composeSwap(crm: SwapReport, deals: DealsDay[]): ComposedSwapDay[] {
  const byDate = new Map(deals.map(day => [day.date, day]));
  const dates = [...new Set([...crm.days.map(day => day.date), ...deals.map(day => day.date)])].sort();
  return dates.map(date => {
    const crmDay = crm.days.find(day => day.date === date);
    const dh = byDate.get(date);
    return {
      date,
      crmSwap: crmDay?.swap ?? emptyRates(),
      crmRefund: crmDay?.refund ?? emptyRates(),
      dealsSwap: dh?.status === 'observed' ? dh.swap : null,
      dealsStatus: dh?.status ?? 'missing',
    };
  });
}
