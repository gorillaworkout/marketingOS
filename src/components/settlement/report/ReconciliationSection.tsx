'use client';

import { Button, StatusBadge } from '@/components/ui/dashboard';
import { formatUsd } from '@/lib/settlement/format';
import type { ReconciliationResponse } from '@/lib/settlement/report';
import type { ReconciliationBlock } from '@/lib/settlement/reconcile';
import { dailyPairLabel } from './labels';
import { PendingChip } from './PendingChip';
import { NumTd, Td, Th, tableClass } from './ReportTable';
import { ReportSectionHeader } from './ReportSectionHeader';

const REASONS = [['crm_only', 'CRM only'], ['mt5_only', 'MT5 only'], ['amount_diff', 'Amount differs'], ['account_diff', 'Account differs']] as const;
const rateLabel = (rate: number) => (rate === 1 ? 'USD' : rate.toLocaleString('en-US'));

function Statement({ title, block }: { title: string; block: ReconciliationBlock }) {
  return (
    <div className="px-5 py-4">
      <h3 className="mb-2 text-xs font-medium text-[var(--mos-text-muted)]">{title}</h3>
      <table className={tableClass}>
        <caption className="sr-only">{title} statement</caption>
        <thead><tr><Th>Rate</Th><Th align="right">Deposit</Th><Th align="right">Withdrawal</Th><Th align="right">Net</Th></tr></thead>
        <tbody>
          <tr><Td>Clients</Td><NumTd>{block.clients.deposit.toLocaleString('en-US')}</NumTd><NumTd>{block.clients.withdrawal.toLocaleString('en-US')}</NumTd><NumTd>{block.clients.reject.toLocaleString('en-US')}</NumTd></tr>
          {block.byRate.map(line => (
            <tr key={line.rate}><Td>{rateLabel(line.rate)}</Td><NumTd>{formatUsd(line.deposit)}</NumTd><NumTd>{formatUsd(line.withdrawal)}</NumTd><NumTd>{formatUsd(line.total)}</NumTd></tr>
          ))}
          <tr className="font-medium text-[var(--mos-text)]"><Td className="text-[var(--mos-text)]">Total</Td><NumTd>{formatUsd(block.total.deposit)}</NumTd><NumTd>{formatUsd(block.total.withdrawal)}</NumTd><NumTd>{formatUsd(block.total.net)}</NumTd></tr>
        </tbody>
      </table>
    </div>
  );
}

export function ReconciliationSection({ date, recon, list, variant, onDate, onList, onPage }: {
  date: string;
  recon: ReconciliationResponse | null;
  list: string;
  variant: 'screen' | 'print';
  onDate?: (date: string) => void;
  onList?: (reason: string) => void;
  onPage?: (page: number) => void;
}) {
  const counts = recon?.mismatchCounts;
  const mismatches = counts ? counts.crm_only + counts.mt5_only + counts.amount_diff + counts.account_diff : 0;
  const crm = recon?.reconciliation.crm;
  const crmSide = counts ? counts.crm_only + counts.amount_diff + counts.account_diff : 0;
  const rows = crm ? crm.clients.deposit + crm.clients.withdrawal : 0;
  const matched = Math.max(0, rows - crmSide);
  const universe = matched + mismatches;
  const pct = universe ? Math.round((matched / universe) * 1000) / 10 : 100;
  const shift = (direction: number) => {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + direction);
    onDate?.(next.toISOString().slice(0, 10));
  };
  return (
    <section className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)]">
      <div className="border-b border-[var(--mos-border-subtle)] px-5 py-4">
        <ReportSectionHeader
          id="reconciliation"
          number="01"
          title="CRM vs MT5"
          description={`${dailyPairLabel(date)} · ${recon?.reconciliation.window.label ?? '12:00–12:00 WIB'}`}
          action={variant === 'screen' ? (
            <div className="flex items-center gap-2">
              {mismatches > 0 ? <StatusBadge tone="danger" dot>{mismatches.toLocaleString('en-US')} mismatches</StatusBadge> : <StatusBadge tone="success" dot>Matched</StatusBadge>}
              <Button size="sm" aria-label="Previous report day" onClick={() => shift(-1)}>‹</Button>
              <span className="text-xs tabular-nums">{date}</span>
              <Button size="sm" aria-label="Next report day" onClick={() => shift(1)}>›</Button>
            </div>
          ) : mismatches > 0 ? <StatusBadge tone="danger" dot>{mismatches.toLocaleString('en-US')} mismatches</StatusBadge> : <StatusBadge tone="success" dot>Matched</StatusBadge>}
        />
      </div>
      {recon && crm && (
        <>
          <div className="grid lg:grid-cols-[1fr_1fr_280px]">
            <Statement title="CRM" block={crm} />
            <div className="border-l border-[var(--mos-border-subtle)]"><Statement title="MT5" block={recon.reconciliation.mt5} /></div>
            <div className="border-l border-[var(--mos-border-subtle)] px-5 py-4">
              <div className="mb-3 flex items-center gap-3">
                <svg viewBox="0 0 42 42" className="h-14 w-14" role="img" aria-label={`${pct}% of rows matched`}>
                  <circle cx="21" cy="21" r="16" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="4" />
                  <circle cx="21" cy="21" r="16" fill="none" stroke="#2EB5C4" strokeWidth="4" strokeDasharray={`${(pct / 100) * 100.5} 100.5`} strokeLinecap="round" transform="rotate(-90 21 21)" />
                </svg>
                <div><div className="text-lg font-[560] tabular-nums">{pct}%</div><div className="text-[11px] text-[var(--mos-text-faint)]">{matched.toLocaleString('en-US')} of {universe.toLocaleString('en-US')} rows matched</div></div>
              </div>
              <div className="flex flex-col gap-1.5">
                {REASONS.map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={list === key} onClick={() => onList?.(key)} className={`flex justify-between rounded-[6px] border px-2.5 py-2 text-left text-[12.5px] ${list === key ? 'border-[#2EB5C4]/50 bg-[#2EB5C4]/10 text-[var(--mos-text)]' : 'border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]'}`}>
                    <span>{label}</span><b className="tabular-nums">{counts?.[key] ?? 0}</b>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto border-t border-[var(--mos-border-subtle)]">
            <table className={tableClass}>
              <caption className="sr-only">Mismatches</caption>
              <thead><tr><Th>Reference</Th><Th>Account</Th><Th>Side</Th><Th>Time (WIB)</Th><Th align="right">CRM (USD)</Th><Th align="right">MT5 (USD)</Th><Th align="right">Difference</Th><Th>State</Th></tr></thead>
              <tbody>
                {(recon.list?.items ?? []).map(item => {
                  const difference = (item.mt5Amount ?? 0) - (item.crmAmount ?? 0);
                  const time = item.at ? new Date(Date.parse(item.at) + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ') : '—';
                  return (
                    <tr key={`${item.reason}-${item.reference}-${item.direction}`}>
                      <Td className="font-mono text-xs">{item.reference}</Td>
                      <Td>{item.accountNo}</Td>
                      <Td className="capitalize">{item.direction}</Td>
                      <Td>{time}</Td>
                      <NumTd>{item.crmAmount === null ? '—' : formatUsd(item.crmAmount)}</NumTd>
                      <NumTd>{item.mt5Amount === null ? '—' : formatUsd(item.mt5Amount)}</NumTd>
                      <NumTd tone="auto">{formatUsd(difference)}</NumTd>
                      <Td>{item.state === 'pending' ? <PendingChip reason="Unmatched for less than 24 hours">Pending in CRM</PendingChip> : <StatusBadge tone="danger" dot>MT5 missing</StatusBadge>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {recon.list && recon.list.pageCount > 1 && variant === 'screen' && (
              <div className="flex items-center gap-2 px-4 py-3 text-xs">
                <Button size="sm" disabled={recon.list.page <= 1} onClick={() => onPage?.(recon.list!.page - 1)}>Prev</Button>
                <span>Page {recon.list.page} / {recon.list.pageCount}</span>
                <Button size="sm" disabled={recon.list.page >= recon.list.pageCount} onClick={() => onPage?.(recon.list!.page + 1)}>Next</Button>
              </div>
            )}
            {variant === 'print' && recon.list && recon.list.pageCount > 1 && <p className="px-4 py-2 text-xs text-[var(--mos-text-faint)]">Showing the first 50 mismatches.</p>}
          </div>
        </>
      )}
    </section>
  );
}
