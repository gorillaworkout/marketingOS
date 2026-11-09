'use client';

import { DataTableFrame } from '@/components/ui/dashboard';
import { formatAmount, formatInteger, formatPct } from '@/components/monthly-report/brand';
import { RATES, type Rate } from '@/lib/settlement/conventions';
import { formatDuration, type MarginMonth, type ProcessingTime, type SwapReport, type WithdrawalWeek } from '@/lib/settlement/metrics';
import type { MismatchItem, ReconciliationBlock } from '@/lib/settlement/reconcile';

const rateLabel = (rate: Rate) => (rate === 1 ? 'USD' : formatInteger(rate));
const th = 'px-3 py-2 text-left font-medium';
const td = 'px-3 py-1.5';
const num = 'px-3 py-1.5 text-right tabular-nums';
const PENDING_IM = 'Pending: Dealing FTD list';

export function ReconciliationBlockTable({ title, block }: { title: string; block: ReconciliationBlock }) {
  return (
    <DataTableFrame title={title}>
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Rate</th><th className={th}>Deposit</th><th className={th}>Withdrawal</th><th className={th}>Total</th></tr></thead>
        <tbody>
          <tr><td className={td}>Clients</td><td className={num}>{formatInteger(block.clients.deposit)}</td><td className={num}>{formatInteger(block.clients.withdrawal)}</td><td className={num}>{formatInteger(block.clients.reject)} reject</td></tr>
          {block.byRate.map(line => <tr key={line.rate}><td className={td}>{rateLabel(line.rate)}</td><td className={num}>{formatAmount(line.deposit)}</td><td className={num}>{formatAmount(line.withdrawal)}</td><td className={num}>{formatAmount(line.total)}</td></tr>)}
          {block.differences.map(d => <tr key={d.label}><td className={td}>{d.label} ({formatInteger(d.count)})</td><td className={num}>{d.side === 'deposit' ? formatAmount(d.amount) : ''}</td><td className={num}>{d.side === 'withdrawal' ? formatAmount(d.amount) : ''}</td><td /></tr>)}
          <tr className="font-medium"><td className={td}>Total</td><td className={num}>{formatAmount(block.total.deposit)}</td><td className={num}>{formatAmount(block.total.withdrawal)}</td><td className={num}>{formatAmount(block.total.net)}</td></tr>
        </tbody>
      </table>
    </DataTableFrame>
  );
}

export function MismatchTable({ items }: { items: Array<MismatchItem & { state: 'pending' | 'missing' }> }) {
  return (
    <table className="w-full text-sm">
      <thead><tr><th className={th}>Reference</th><th className={th}>Account</th><th className={th}>Side</th><th className={th}>Time (WIB)</th><th className={th}>CRM</th><th className={th}>MT5</th><th className={th}>State</th></tr></thead>
      <tbody>{items.map(item => (
        <tr key={`${item.reason}-${item.reference}-${item.direction}`}>
          <td className={td}>{item.reference}</td><td className={td}>{item.accountNo}</td><td className={td}>{item.direction}</td>
          <td className={td}>{item.at ? new Date(Date.parse(item.at) + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ') : '—'}</td>
          <td className={num}>{formatAmount(item.crmAmount)}</td><td className={num}>{formatAmount(item.mt5Amount)}</td><td className={td}>{item.state}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

export function ProcessingTable({ processing }: { processing: ProcessingTime }) {
  const cell = (c: { avgSeconds: number | null; hits: number }) => `${formatDuration(c.avgSeconds)} · ${formatInteger(c.hits)}`;
  const wd = new Map(processing.withdrawals.map(w => [w.date, w]));
  return (
    <DataTableFrame title="Processing time (avg · hits)" description="Office hour = Mon–Fri 09:00–18:00 WIB excluding holidays. Weekly figures = mean of the daily office-hour averages (Mon–Sun week).">
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Date</th><th className={th}>Dep. office API</th><th className={th}>Dep. office Manual</th><th className={th}>Dep. after API</th><th className={th}>Dep. after Manual</th><th className={th}>WD office</th><th className={th}>2nd WD</th></tr></thead>
        <tbody>{processing.deposits.map(d => {
          const w = wd.get(d.date);
          return <tr key={d.date}><td className={td}>{d.date}</td><td className={num}>{cell(d.officeApi)}</td><td className={num}>{cell(d.officeManual)}</td><td className={num}>{cell(d.afterApi)}</td><td className={num}>{cell(d.afterManual)}</td><td className={num}>{w ? cell(w.office) : '—'}</td><td className={num}>{w ? cell(w.secondWithdrawal) : '—'}</td></tr>;
        })}</tbody>
      </table>
    </DataTableFrame>
  );
}

export function WithdrawalPctTable({ weeks }: { weeks: WithdrawalWeek[] }) {
  const pct = (n: number, total: number) => formatPct(total ? (n / total) * 100 : null);
  return (
    <DataTableFrame title="Withdrawal %" description="Weeks Monday–Sunday (label Mon–Fri). 2nd withdrawal = completed on a later WIB day than requested.">
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Week</th><th className={th}>Office hour</th><th className={th}>After office</th><th className={th}>2nd withdrawal</th><th className={th}>Total</th></tr></thead>
        <tbody>{weeks.map(w => <tr key={w.weekStart}><td className={td}>{w.label}</td><td className={num}>{formatInteger(w.office)} ({pct(w.office, w.total)})</td><td className={num}>{formatInteger(w.afterOffice)} ({pct(w.afterOffice, w.total)})</td><td className={num}>{formatInteger(w.secondWithdrawal)} ({pct(w.secondWithdrawal, w.total)})</td><td className={num}>{formatInteger(w.total)}</td></tr>)}</tbody>
      </table>
    </DataTableFrame>
  );
}

export function MarginTable({ months }: { months: MarginMonth[] }) {
  const im = (value: number | null) => (value === null ? PENDING_IM : formatAmount(value));
  return (
    <DataTableFrame title="Margin In–Out" description="IDR = USD × account rate (default, pending Settlement confirmation). Initial Margin from the Dealing FTD list; Deposit = all successful deposits − Initial Margin. Multi = 0.">
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Month</th><th className={th}>IDR Initial Margin</th><th className={th}>IDR Deposit</th><th className={th}>IDR Withdrawal</th><th className={th}>USD Initial Margin</th><th className={th}>USD Deposit</th><th className={th}>USD Withdrawal</th></tr></thead>
        <tbody>{months.map(m => <tr key={m.month}><td className={td}>{m.month}</td><td className={num}>{im(m.idrInitialMargin)}</td><td className={num}>{formatAmount(m.idrDepositExIm ?? m.idrDeposit)}</td><td className={num}>{formatAmount(m.idrWithdrawal)}</td><td className={num}>{im(m.usdInitialMargin)}</td><td className={num}>{formatAmount(m.usdDepositExIm ?? m.usdDeposit)}</td><td className={num}>{formatAmount(m.usdWithdrawal)}</td></tr>)}</tbody>
      </table>
    </DataTableFrame>
  );
}

export function SwapTable({ swap, label }: { swap: SwapReport; label: string }) {
  return (
    <DataTableFrame title="Swap" description={`${label}. Grouped by MT5 posting (server) date.`}>
      <table className="w-full text-sm">
        <thead><tr><th className={th}>Date</th>{RATES.map(r => <th key={`s${r}`} className={th}>CRM-S {rateLabel(r)}</th>)}{RATES.map(r => <th key={`r${r}`} className={th}>CRM-SR {rateLabel(r)}</th>)}</tr></thead>
        <tbody>
          {swap.days.map(d => <tr key={d.date}><td className={td}>{d.date}</td>{RATES.map(r => <td key={`s${r}`} className={num}>{formatAmount(d.swap[r])}</td>)}{RATES.map(r => <td key={`r${r}`} className={num}>{formatAmount(d.refund[r])}</td>)}</tr>)}
          <tr className="font-medium"><td className={td}>Total</td>{RATES.map(r => <td key={`s${r}`} className={num}>{formatAmount(swap.totalSwap[r])}</td>)}{RATES.map(r => <td key={`r${r}`} className={num}>{formatAmount(swap.totalRefund[r])}</td>)}</tr>
          <tr><td className={td}>IDR (Σ × rate)</td><td className={num} colSpan={4}>CRM-S {formatAmount(swap.idrSwap)}</td><td className={num} colSpan={4}>CRM-SR {formatAmount(swap.idrRefund)} · S + SR {formatAmount(swap.idrSwap + swap.idrRefund)}</td></tr>
        </tbody>
      </table>
    </DataTableFrame>
  );
}
