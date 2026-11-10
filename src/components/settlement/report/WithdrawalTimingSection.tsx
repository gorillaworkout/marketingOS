import { formatInteger } from '@/components/monthly-report/brand';
import type { WithdrawalWeek } from '@/lib/settlement/metrics';
import { NumTd, Td, Th, tableClass } from './ReportTable';

function pct(count: number, total: number): string {
  if (!total) return '—';
  return `${((count / total) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function Mix({ office, after, second, total }: { office: number; after: number; second: number; total: number }) {
  if (!total) return null;
  return (
    <span className="inline-flex h-2 w-28 overflow-hidden rounded bg-white/5" aria-hidden="true">
      <span style={{ width: `${(office / total) * 100}%` }} className="bg-[#2EB5C4]" />
      <span style={{ width: `${(after / total) * 100}%` }} className="bg-[#7FD6DF]" />
      <span style={{ width: `${(second / total) * 100}%` }} className="bg-[#f2c46b]" />
    </span>
  );
}

export function WithdrawalTimingSection({ weeks }: { weeks: WithdrawalWeek[] }) {
  const total = weeks.reduce((sum, week) => ({
    office: sum.office + week.office, after: sum.after + week.afterOffice, second: sum.second + week.secondWithdrawal, total: sum.total + week.total,
  }), { office: 0, after: 0, second: 0, total: 0 });
  return (
    <section id="withdrawal-timing" className="scroll-mt-16 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5">
      <h2 className="text-[15px] font-[560]">Withdrawal timing split</h2>
      <p className="mt-1 mb-4 text-xs text-[var(--mos-text-muted)]">Share of withdrawal requests per week, Mon–Sun.</p>
      <table className={tableClass}>
        <caption className="sr-only">Withdrawal timing split</caption>
        <thead><tr><Th>Week</Th><Th align="right">Office hour</Th><Th align="right">After office</Th><Th align="right">2nd withdrawal</Th><Th align="right">Total</Th><Th>Mix</Th></tr></thead>
        <tbody>
          {weeks.map(week => (
            <tr key={week.weekStart}>
              <Td scope="row">{week.label}</Td>
              <NumTd>{formatInteger(week.office)}<span className="block text-[10.5px] text-[var(--mos-text-faint)]">{pct(week.office, week.total)}</span></NumTd>
              <NumTd>{formatInteger(week.afterOffice)}<span className="block text-[10.5px] text-[var(--mos-text-faint)]">{pct(week.afterOffice, week.total)}</span></NumTd>
              <NumTd>{formatInteger(week.secondWithdrawal)}<span className="block text-[10.5px] text-[var(--mos-text-faint)]">{pct(week.secondWithdrawal, week.total)}</span></NumTd>
              <NumTd>{formatInteger(week.total)}</NumTd>
              <Td><Mix office={week.office} after={week.afterOffice} second={week.secondWithdrawal} total={week.total} /></Td>
            </tr>
          ))}
          <tr className="bg-[var(--mos-raised)] font-semibold text-[var(--mos-text)]">
            <Td>Period</Td>
            <NumTd>{formatInteger(total.office)}<span className="block text-[10.5px] font-normal text-[var(--mos-text-faint)]">{pct(total.office, total.total)}</span></NumTd>
            <NumTd>{formatInteger(total.after)}</NumTd>
            <NumTd>{formatInteger(total.second)}</NumTd>
            <NumTd>{formatInteger(total.total)}</NumTd>
            <Td><Mix office={total.office} after={total.after} second={total.second} total={total.total} /></Td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
