import { computeDelta, formatCompact, formatDurationShort, formatUsd, type Delta, type Favourable } from './format';
import { WITHDRAWAL_PCT_KPI, WITHDRAWAL_PCT_LABEL, type WithdrawalPctMode } from './kpi-config';
import type { PeriodSummary } from './summary';

export interface WithdrawalPctCard { label: string; value: number | null; favourable: 'up' | 'down'; note: string }

export function withdrawalPctCards(summary: PeriodSummary, mode: WithdrawalPctMode): WithdrawalPctCard[] {
  const pct = summary.totals.withdrawalPct;
  const office: WithdrawalPctCard = {
    label: WITHDRAWAL_PCT_LABEL['office-hour'], value: pct.officeHourPct, favourable: 'up', note: `${pct.office} of ${pct.total} same-day`,
  };
  const ratio: WithdrawalPctCard = {
    label: WITHDRAWAL_PCT_LABEL['wd-over-dep'], value: pct.ofDepositsPct, favourable: 'down', note: 'Withdrawals ÷ deposits (IDR)',
  };
  if (mode === 'both') return [office, ratio];
  return mode === 'wd-over-dep' ? [ratio] : [office];
}

export interface KpiCard {
  id: string;
  label: string;
  hint: string;
  kind: 'idr' | 'pct' | 'duration' | 'pending';
  value: number | null;
  delta: Delta | null;
  note: string;
  pending: boolean;
  favourable: Favourable;
  versus: string | null;
}

function moneyNote(usd: number, count: number, delta: Delta | null): string {
  return delta ? `USD ${formatUsd(usd)} · ${count} requests` : 'No previous data';
}

export function buildKpis(input: { current: PeriodSummary; previous: PeriodSummary }, mode: WithdrawalPctMode = WITHDRAWAL_PCT_KPI): KpiCard[] {
  const { current, previous } = input;
  const depositDelta = computeDelta(current.totals.deposit.idr, previous.totals.deposit.idr, { kind: 'relative', favourable: 'up' });
  const withdrawalDelta = computeDelta(current.totals.withdrawal.idr, previous.totals.withdrawal.idr, { kind: 'relative', favourable: 'down' });
  const netDelta = computeDelta(current.totals.netIdr, previous.totals.netIdr, { kind: 'relative', favourable: 'up' });
  const processingDelta = computeDelta(current.processing.deposit, previous.processing.deposit, { kind: 'seconds', favourable: 'down' });
  const commission = current.commission;
  const previousCommission = previous.commission;
  const commissionPending = !commission || commission.status === 'pending';
  const commissionDelta = !commissionPending && previousCommission?.status === 'complete'
    ? computeDelta(commission.commissionIdr, previousCommission.commissionIdr, { kind: 'relative', favourable: 'neutral' })
    : null;
  const pctCards = withdrawalPctCards(current, mode);
  const previousPct = withdrawalPctCards(previous, mode);
  const pctVersus = (value: number | null) => (value === null ? null : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
  return [
    { id: 'deposits', label: 'Deposits', hint: 'Successful deposits, dated by completion. IDR = USD × account rate.', kind: 'idr', value: current.totals.deposit.idr, delta: depositDelta, note: moneyNote(current.totals.deposit.usd, current.totals.deposit.count, depositDelta), pending: false, favourable: 'up', versus: depositDelta ? formatCompact(previous.totals.deposit.idr) : null },
    { id: 'withdrawals', label: 'Withdrawals', hint: 'Successful withdrawals, dated by the request. IDR = USD × account rate.', kind: 'idr', value: current.totals.withdrawal.idr, delta: withdrawalDelta, note: moneyNote(current.totals.withdrawal.usd, current.totals.withdrawal.count, withdrawalDelta), pending: false, favourable: 'down', versus: withdrawalDelta ? formatCompact(previous.totals.withdrawal.idr) : null },
    { id: 'net', label: 'Net margin in–out', hint: 'Deposits minus withdrawals. This does not use the Dealing FTD list.', kind: 'idr', value: current.totals.netIdr, delta: netDelta, note: netDelta ? 'Deposits − withdrawals' : 'No previous data', pending: false, favourable: 'up', versus: netDelta ? formatCompact(previous.totals.netIdr) : null },
    ...pctCards.map((card, index) => {
      const prior = previousPct[index]?.value ?? null;
      const delta = computeDelta(card.value, prior, { kind: 'points', favourable: card.favourable });
      return {
        id: index === 0 ? 'withdrawal-pct' : 'withdrawal-ratio',
        label: card.label,
        hint: card.note,
        kind: 'pct' as const,
        value: card.value,
        delta,
        note: card.value === null || prior === null || prior === 0 ? 'No previous data' : card.note,
        pending: false,
        favourable: card.favourable,
        versus: delta ? pctVersus(prior) : null,
      };
    }),
    { id: 'processing', label: 'Avg processing', hint: 'Mean of daily office-hour deposit averages. Lower is faster.', kind: 'duration', value: current.processing.deposit, delta: processingDelta, note: `WD ${formatDurationShort(current.processing.withdrawal)}`, pending: false, favourable: 'down', versus: processingDelta ? formatDurationShort(previous.processing.deposit) : null },
    {
      id: 'commission', label: 'Commission', hint: 'Deals History commission. IDR rates are summed × rate. A missing day stays Pending.', kind: commissionPending ? 'pending' : 'idr',
      value: commissionPending ? null : commission.commissionIdr, delta: commissionDelta, pending: commissionPending, favourable: 'neutral',
      versus: commissionDelta && previousCommission ? formatCompact(previousCommission.commissionIdr) : null,
      note: commissionPending
        ? `${(commission?.observedDays ?? 0) + (commission?.attestedDays ?? 0)} of ${commission?.totalDays ?? 0} days imported`
        : `USD ${formatUsd(commission.commissionUsd)}`,
    },
  ];
}
