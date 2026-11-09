'use client';

import { useEffect, useState } from 'react';
import { Button, EmptyState, FilterGroup, LoadingState, MetricCard, Panel, SectionHeader, Select, TextInput, Toolbar } from '@/components/ui/dashboard';
import { formatInteger } from '@/components/monthly-report/brand';
import { TrendChart } from '@/components/monthly-report/charts';
import { formatDuration } from '@/lib/settlement/metrics';
import type { ReconciliationResponse, SettlementReport } from '@/lib/settlement/report';
import { MarginTable, MismatchTable, ProcessingTable, ReconciliationBlockTable, SwapTable, WithdrawalPctTable } from './SettlementTables';

const todayWib = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
/** Default report date: today once 12:00 WIB has passed, else yesterday. */
const defaultReconDate = () => {
  const now = new Date(Date.now() + 7 * 3_600_000);
  if (now.getUTCHours() >= 12) return now.toISOString().slice(0, 10);
  return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
};
const shift = (date: string, preset: string, direction: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  if (preset === 'month') d.setUTCMonth(d.getUTCMonth() + direction, 1); else d.setUTCDate(d.getUTCDate() + direction * (preset === 'week' ? 7 : 1));
  return d.toISOString().slice(0, 10);
};
const download = (url: string) => { window.location.href = url; };
const REASONS = [['crm_only', 'CRM only'], ['mt5_only', 'MT5 only'], ['amount_diff', 'Amount differs'], ['account_diff', 'Account differs']] as const;

export function SettlementDashboard({ reloadToken = 0 }: { reloadToken?: number }) {
  const [preset, setPreset] = useState('month');
  const [anchor, setAnchor] = useState(todayWib());
  const [report, setReport] = useState<SettlementReport | null>(null);
  const [error, setError] = useState('');
  const [reconDate, setReconDate] = useState(defaultReconDate());
  const [recon, setRecon] = useState<ReconciliationResponse | null>(null);
  const [list, setList] = useState<string>('crm_only');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settlement-report/report?preset=${preset}&anchor=${anchor}`)
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Could not load the report'); return body.report as SettlementReport; })
      .then(value => { if (!cancelled) { setReport(value); setError(''); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the report'); });
    return () => { cancelled = true; };
  }, [preset, anchor, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settlement-report/reconciliation?date=${reconDate}&list=${list}&page=${page}`)
      .then(response => response.json())
      .then(value => { if (!cancelled) setRecon(value as ReconciliationResponse); })
      .catch(() => { if (!cancelled) setRecon(null); });
    return () => { cancelled = true; };
  }, [reconDate, list, page, reloadToken]);

  const p = report?.processing;
  return (
    <>
      <Toolbar>
        <FilterGroup>
          <Select aria-label="Period" value={preset} onChange={event => setPreset(event.target.value)}>
            <option value="day">Day</option><option value="week">Week (Mon–Sun)</option><option value="month">Month</option>
          </Select>
          <Button size="sm" onClick={() => setAnchor(shift(anchor, preset, -1))}>‹</Button>
          <TextInput aria-label="Anchor date" type="date" value={anchor} onChange={event => setAnchor(event.target.value)} />
          <Button size="sm" onClick={() => setAnchor(shift(anchor, preset, 1))}>›</Button>
        </FilterGroup>
        <Button size="sm" onClick={() => download(`/api/settlement-report/export?preset=${preset}&anchor=${anchor}`)}>Export .xlsx</Button>
      </Toolbar>

      <Panel>
        <SectionHeader title="Daily Reconciliation CRM vs MT5" description={recon ? `${recon.reconciliation.window.label}` : 'Window: previous day 12:00:01 – report day 12:00:00 WIB'}
          action={<FilterGroup><TextInput aria-label="Report date" type="date" value={reconDate} onChange={event => { setReconDate(event.target.value); setPage(1); }} /><Button size="sm" onClick={() => download(`/api/settlement-report/export?type=daily&date=${reconDate}`)}>Export daily</Button></FilterGroup>} />
        {recon?.reconciliation ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <ReconciliationBlockTable title="CRM" block={recon.reconciliation.crm} />
              <ReconciliationBlockTable title="MT5" block={recon.reconciliation.mt5} />
            </div>
            <FilterGroup className="mt-4">
              {REASONS.map(([key, label]) => <Button key={key} size="sm" variant={list === key ? 'primary' : 'secondary'} onClick={() => { setList(key); setPage(1); }}>{label} ({formatInteger(recon.mismatchCounts[key])})</Button>)}
            </FilterGroup>
            {recon.list && recon.list.items.length > 0 ? (
              <>
                <MismatchTable items={recon.list.items} />
                <FilterGroup><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button><span className="text-xs">Page {recon.list.page} / {recon.list.pageCount}</span><Button size="sm" disabled={page >= recon.list.pageCount} onClick={() => setPage(page + 1)}>Next</Button></FilterGroup>
              </>
            ) : <EmptyState title="No mismatches" description="Every successful CRM row in this window has a matching MT5 deal." />}
          </>
        ) : <LoadingState label="Loading reconciliation" />}
      </Panel>

      {error && <EmptyState title="Could not load the report" description={error} />}
      {!report && !error && <LoadingState label="Loading settlement report" />}
      {report && p && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Deposit applications" value={formatInteger(report.applications.deposit)} note={`${formatInteger(report.applications.depositRejected)} rejected`} />
            <MetricCard label="Withdrawal applications" value={formatInteger(report.applications.withdrawal)} note={`${formatInteger(report.applications.withdrawalRejected)} rejected`} />
            <MetricCard label="Deposit processing (office hour)" value={formatDuration(p.summary.deposit)} note={`API ${formatDuration(p.summary.depositApi)} · Manual ${formatDuration(p.summary.depositManual)}`} />
            <MetricCard label="Withdrawal processing (office hour)" value={formatDuration(p.summary.withdrawal)} />
          </div>
          <Panel>
            <TrendChart ariaLabel="Deposit applications per day" points={p.deposits.map(d => ({ key: d.date, label: d.date.slice(5), value: d.officeApi.hits + d.officeManual.hits + d.afterApi.hits + d.afterManual.hits }))} />
          </Panel>
          <ProcessingTable processing={p} />
          <WithdrawalPctTable weeks={report.withdrawalWeeks} />
          <MarginTable months={report.margin} />
          <SwapTable swap={report.swap} label={report.swapLabel} />
        </>
      )}
    </>
  );
}
