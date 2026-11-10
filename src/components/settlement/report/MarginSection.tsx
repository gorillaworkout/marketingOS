'use client';

import { useState } from 'react';
import type { MarginMonth } from '@/lib/settlement/metrics';
import { Money, NumTd, Td, Th, tableClass } from './ReportTable';
import { PendingChip } from './PendingChip';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MarginSection({ months }: { months: MarginMonth[] }) {
  const [currency, setCurrency] = useState<'IDR' | 'USD'>('IDR');
  const idr = currency === 'IDR';
  const amount = (month: MarginMonth, field: 'deposit' | 'withdrawal' | 'im' | 'ex' | 'net') => {
    if (field === 'deposit') return idr ? month.idrDeposit : month.usdDeposit;
    if (field === 'withdrawal') return idr ? month.idrWithdrawal : month.usdWithdrawal;
    if (field === 'im') return idr ? month.idrInitialMargin : month.usdInitialMargin;
    if (field === 'ex') return idr ? month.idrDepositExIm : month.usdDepositExIm;
    return (idr ? month.idrDeposit : month.usdDeposit) - (idr ? month.idrWithdrawal : month.usdWithdrawal);
  };
  const sum = (field: 'deposit' | 'withdrawal' | 'net') => months.reduce((total, month) => total + (amount(month, field) ?? 0), 0);
  const imMissing = months.some(month => amount(month, 'im') === null);
  return (
    <section id="margin" className="scroll-mt-16 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-[560]">Margin in–out</h2>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Successful only. IDR = USD × account rate.</p>
        </div>
        <div role="group" aria-label="Currency" className="flex overflow-hidden rounded-[6px] border border-[var(--mos-border)]">
          {(['IDR', 'USD'] as const).map(item => (
            <button key={item} type="button" aria-pressed={currency === item} onClick={() => setCurrency(item)} className={`px-2.5 py-1 text-[11px] font-medium ${currency === item ? 'bg-[#2EB5C4] text-white' : 'text-[var(--mos-text-muted)]'}`}>{item}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className={tableClass}>
          <caption className="sr-only">Margin in–out</caption>
          <thead><tr><Th>Month</Th><Th align="right">Initial margin</Th><Th align="right">Deposit</Th><Th align="right">Withdrawal</Th><Th align="right">Net in–out</Th></tr></thead>
          <tbody>
            {months.map(month => {
              const im = amount(month, 'im');
              const ex = amount(month, 'ex');
              return (
                <tr key={month.month}>
                  <Td scope="row">{MONTHS[Number(month.month.slice(5)) - 1]} {month.month.slice(0, 4)}</Td>
                  <NumTd>{im === null ? <PendingChip reason="Dealing FTD list" /> : <Money value={im} currency={currency} />}</NumTd>
                  <NumTd>{ex === null ? <PendingChip reason="Dealing FTD list" /> : <Money value={ex} currency={currency} />}</NumTd>
                  <NumTd><Money value={amount(month, 'withdrawal')} currency={currency} sign="auto" /></NumTd>
                  <NumTd><Money value={amount(month, 'net')} currency={currency} sign="pos" /></NumTd>
                </tr>
              );
            })}
            <tr className="bg-[var(--mos-raised)] font-semibold text-[var(--mos-text)]">
              <Td>Year to date</Td>
              <NumTd>{imMissing ? <PendingChip reason="Dealing FTD list" /> : <Money value={months.reduce((total, month) => total + (amount(month, 'im') ?? 0), 0)} currency={currency} />}</NumTd>
              <NumTd><Money value={sum('deposit')} currency={currency} /></NumTd>
              <NumTd><Money value={sum('withdrawal')} currency={currency} sign="auto" /></NumTd>
              <NumTd><Money value={sum('net')} currency={currency} sign="pos" /></NumTd>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
