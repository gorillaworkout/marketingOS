import { RATES, type Rate } from '@/lib/settlement/conventions';
import type { DealsDay } from '@/lib/settlement/deals-report';
import type { SwapReport } from '@/lib/settlement/metrics';
import type { DealsHistorySummary } from '@/lib/settlement/summary';
import { Money, NumTd, Td, Th, GroupHeader, tableClass } from './ReportTable';
import { PendingChip } from './PendingChip';
import { ReportSectionHeader } from './ReportSectionHeader';

const rateLabel = (rate: Rate) => (rate === 1 ? 'USD' : rate.toLocaleString('en-US'));

function sumRate(days: DealsDay[], rate: Rate, field: 'commission' | 'swap'): number {
  return days.reduce((total, day) => total + (day.status === 'observed' && day[field] ? day[field]![rate] : 0), 0);
}

export function CommissionSwapSection({ swap, days, summary }: { swap: SwapReport; days: DealsDay[]; summary?: DealsHistorySummary }) {
  const pendingDays = summary?.pendingDays ?? days.filter(day => day.status === 'missing' || day.status === 'partial').length;
  const covered = (summary?.observedDays ?? 0) + (summary?.attestedDays ?? 0);
  const totalDays = summary?.totalDays ?? days.length;
  const pending = pendingDays > 0 || summary?.status === 'pending';
  return (
    <section className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5">
      <ReportSectionHeader
        id="commission-swap"
        number="03"
        title="Commission & swap by account rate"
        description="Commission = Entry in, by MT5 server date. Three swap lines are kept apart and never summed into each other."
        action={totalDays > 0 ? <span className="text-xs text-amber-200">Deals History covers {covered} of {totalDays} days</span> : undefined}
      />
      <div className="overflow-x-auto">
        <table className={tableClass}>
          <caption className="sr-only">Commission and swap</caption>
          <thead>
            <tr>
              <GroupHeader span={1} align="left">Account rate</GroupHeader>
              <GroupHeader span={1}>Commission</GroupHeader>
              <GroupHeader span={3}>Swap (three separate lines)</GroupHeader>
              <GroupHeader span={1}>IDR equivalent</GroupHeader>
            </tr>
            <tr>
              <Th />
              <Th align="right">Deals History</Th>
              <Th align="right">CRM-S</Th>
              <Th align="right">CRM-SR</Th>
              <Th align="right">Deals History swap</Th>
              <Th align="right">CRM-S + SR</Th>
            </tr>
          </thead>
          <tbody>
            {RATES.map(rate => {
              const commission = sumRate(days, rate, 'commission');
              const dhSwap = sumRate(days, rate, 'swap');
              const observed = days.some(day => day.status === 'observed');
              const idr = rate === 1 ? null : (swap.totalSwap[rate] + swap.totalRefund[rate]) * rate;
              return (
                <tr key={rate}>
                  <Td scope="row">{rateLabel(rate)}</Td>
                  <NumTd>
                    {(observed && commission !== 0) || !pending ? <Money value={commission} currency="USD" sign="auto" /> : null}
                    {pending && <span className="ml-2"><PendingChip reason="Deals History">{`${pendingDays} d Pending`}</PendingChip></span>}
                  </NumTd>
                  <NumTd><Money value={swap.totalSwap[rate]} currency="USD" sign="auto" /></NumTd>
                  <NumTd><Money value={swap.totalRefund[rate]} currency="USD" sign="pos" /></NumTd>
                  <NumTd>
                    {pending ? <PendingChip reason="Deals History" /> : <Money value={dhSwap} currency="USD" sign="auto" />}
                  </NumTd>
                  <NumTd>{rate === 1 ? 'n/a (USD)' : <Money value={idr} currency="IDR" sign="auto" />}</NumTd>
                </tr>
              );
            })}
            <tr className="bg-[var(--mos-raised)] font-semibold text-[var(--mos-text)]">
              <Td>Period total</Td>
              <NumTd>{pending ? <PendingChip reason="Deals History" /> : <Money value={summary?.commissionUsd ?? null} currency="USD" sign="auto" />}</NumTd>
              <NumTd><Money value={RATES.reduce((total, rate) => total + swap.totalSwap[rate], 0)} currency="USD" sign="auto" /></NumTd>
              <NumTd><Money value={RATES.reduce((total, rate) => total + swap.totalRefund[rate], 0)} currency="USD" sign="pos" /></NumTd>
              <NumTd>{pending ? <PendingChip reason="Deals History" /> : <Money value={summary?.swapByRate ? RATES.reduce((total, rate) => total + summary.swapByRate[rate], 0) : null} currency="USD" sign="auto" />}</NumTd>
              <NumTd><Money value={swap.idrSwap + swap.idrRefund} currency="IDR" sign="auto" /></NumTd>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--mos-text-faint)]">Commission and Deals History swap totals stay Pending until every day in the period is imported or attested. Imported days are shown per rate above.</p>
      {days.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-[var(--mos-text-muted)]">
            <span>Deals History coverage</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-[#2EB5C4]/80" /> Imported</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-[#2EB5C4]/30" /> Attested, no deals</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded border border-dashed border-amber-300/60 bg-amber-300/20" /> Pending</span>
          </div>
          <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-[3px] sm:grid-cols-[repeat(31,minmax(0,1fr))]">
            {days.map(day => (
              <div key={day.date} title={`${day.date} ${day.status}`} className={`flex h-[22px] items-center justify-center rounded text-[9px] ${day.status === 'observed' ? 'bg-[#2EB5C4]/70 text-white' : day.status === 'attested' ? 'bg-[#2EB5C4]/25 text-[var(--mos-text)]' : 'border border-dashed border-amber-300/50 bg-amber-300/10 text-amber-200'}`}>
                {Number(day.date.slice(8))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
