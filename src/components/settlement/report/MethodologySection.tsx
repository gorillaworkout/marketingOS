import { WITHDRAWAL_PCT_KPI, withdrawalPctMethodology } from '@/lib/settlement/kpi-config';

const ITEMS = [
  ['Report day', 'Previous day 12:00:01 – report day 12:00:00 WIB. The label shows both dates, for example 05–06 Nov.'],
  ['Account rate', 'The 2nd account digit: 0 → 10,000, 2 → 12,000, 4 → 14,000, 9 → USD.'],
  ['Office hour', 'Mon–Fri 09:00–18:00 WIB, holidays excluded.'],
  ['MT5 dates', 'Commission and swap use MT5 server time (Europe/Athens).'],
  ['Pending, not zero', 'A missing source shows Pending. It is never counted as 0.'],
  ['Initial margin', 'From the Dealing FTD list. Deposit ex-IM = all deposits − initial margin.'],
  ['Withdrawal %', withdrawalPctMethodology(WITHDRAWAL_PCT_KPI)],
  ['Period rules', 'Daily is 12:00–12:00 WIB. Weekly is Mon–Sun. Monthly is the calendar month.'],
];

export function MethodologySection() {
  return (
    <section id="methodology" className="scroll-mt-24 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5">
      <h2 className="text-[15px] font-[560]">Methodology & sources</h2>
      <p className="mt-1 mb-4 text-xs text-[var(--mos-text-muted)]">Shown once here instead of under every table.</p>
      <dl className="grid gap-4 text-xs text-[var(--mos-text-muted)] sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map(([title, body]) => (
          <div key={title}><dt className="mb-0.5 font-[560] text-[var(--mos-text-secondary)]">{title}</dt><dd>{body}</dd></div>
        ))}
      </dl>
    </section>
  );
}
