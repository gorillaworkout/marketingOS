'use client';

import { useEffect, useState } from 'react';
import { Button, StatusBadge } from '@/components/ui/dashboard';
import { formatUsd } from '@/lib/settlement/format';
import { JISDOR_MONTH_UNAVAILABLE, jisdorMonthTable, type JisdorMonthRow } from '@/lib/settlement/jisdor';
import { isFutureMonth, shiftMonth } from './calendar';
import { todayWib } from './labels';
import { PeriodDateField } from './PeriodDateField';
import { NumTd, tableClass, Td, Th } from './ReportTable';

type Fixing = { date: string; rate: number };

const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(yearMonth: string): string {
  return `${LONG[Number(yearMonth.slice(5, 7)) - 1] ?? yearMonth} ${yearMonth.slice(0, 4)}`;
}

function fixingDate(iso: string): string {
  const month = LONG[Number(iso.slice(5, 7)) - 1] ?? '';
  return `${Number(iso.slice(8))} ${month.slice(0, 3)} ${iso.slice(0, 4)}`;
}

export function JisdorSection({ variant, month: initialMonth, fixings: provided, unavailable = false }: {
  variant: 'screen' | 'print';
  month: string;
  fixings?: Fixing[];
  unavailable?: boolean;
}) {
  const [today] = useState(() => todayWib());
  const [month, setMonth] = useState(initialMonth);
  const [fixings, setFixings] = useState<Fixing[] | null>(provided ?? null);
  const [rows, setRows] = useState<JisdorMonthRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [loadedMonth, setLoadedMonth] = useState(provided ? initialMonth : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (provided) return undefined;
    const controller = new AbortController();
    fetch(`/api/settlement-report/jisdor?month=${month}`, { signal: controller.signal }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFailed(true);
        setError(typeof data.error === 'string' ? data.error : JISDOR_MONTH_UNAVAILABLE);
        setRows([]);
        setLoadedMonth(month);
        return;
      }
      setFixings(data.fixings ?? []);
      setRows(data.rows ?? []);
      setFailed(Boolean(data.unavailable));
      setError(data.unavailable ? JISDOR_MONTH_UNAVAILABLE : '');
      setLoadedMonth(month);
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setFailed(true);
      setError(JISDOR_MONTH_UNAVAILABLE);
      setRows([]);
      setLoadedMonth(month);
    });
    return () => controller.abort();
  }, [month, provided]);

  function showMonth(next: string) {
    if (isFutureMonth(next, today)) return;
    setMonth(next);
  }

  async function refresh() {
    setBusy(true);
    const response = await fetch('/api/settlement-report/jisdor', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || 'Fetch failed. Stored fixings were left unchanged.');
    else {
      const again = await fetch(`/api/settlement-report/jisdor?month=${month}`);
      const body = await again.json().catch(() => ({}));
      setFixings(body.fixings ?? []);
      setRows(body.rows ?? []);
      setFailed(Boolean(body.unavailable));
      setError(body.unavailable ? JISDOR_MONTH_UNAVAILABLE : '');
      setLoadedMonth(month);
    }
    setBusy(false);
  }

  const tableRows = provided ? jisdorMonthTable(provided, month) : rows;
  const tableFailed = provided ? unavailable : failed;
  const series = provided ?? fixings ?? [];
  const latest = series.at(-1);
  const min = series.reduce((value, row) => Math.min(value, row.rate), Number.POSITIVE_INFINITY);
  const max = series.reduce((value, row) => Math.max(value, row.rate), 0);
  const span = max - (Number.isFinite(min) ? min : max) || 1;
  const coords = series.map((row, index) => {
    const x = series.length <= 1 ? 0 : (index / (series.length - 1)) * 280;
    const y = 70 - ((row.rate - (Number.isFinite(min) ? min : row.rate)) / span) * 60;
    return `${x},${y}`;
  }).join(' ');
  const loading = !provided && loadedMonth !== month;
  const nextMonth = shiftMonth(month, 1);
  const emptyCopy = tableFailed ? JISDOR_MONTH_UNAVAILABLE : 'No JISDOR fixings for this month.';

  return (
    <section id="jisdor" className="scroll-mt-24 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-[560]">JISDOR reference <StatusBadge tone="info">Display only</StatusBadge></h2>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Official BI daily fixings, fetched only when you ask. They are not applied to commission or swap, and they do not replace the fixed IDR account rates (10,000 / 12,000 / 14,000). A day with no published fixing is left out.</p>
        </div>
        {variant === 'screen' && !provided && <Button size="sm" disabled={busy} onClick={() => void refresh()}>{busy ? 'Fetching' : 'Fetch latest'}</Button>}
      </div>
      {series.length > 1 && (
        <svg viewBox="0 0 280 80" role="img" aria-label={`JISDOR from ${series[0].date} to ${latest?.date}`} className="h-24 w-full">
          <polyline fill="none" stroke="#2EB5C4" strokeWidth="1.6" points={coords} />
          {series.map(row => <title key={row.date}>{`${row.date}: ${row.rate}`}</title>)}
        </svg>
      )}
      <p className="mt-2 text-xs text-[var(--mos-text-muted)]">
        {latest ? <>Latest: {latest.date} · <b className="text-[var(--mos-text)]">{formatUsd(latest.rate)}</b> IDR per USD</> : 'No fixings stored yet.'}
        {series.length > 1 && Number.isFinite(min) && <span className="float-right">Range {formatUsd(min)} – {formatUsd(max)}</span>}
      </p>
      <div className="mt-4 flex items-center justify-between gap-2">
        {variant === 'screen' ? (
          <>
            <button type="button" aria-label="Previous month" onClick={() => showMonth(shiftMonth(month, -1))} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--mos-radius-control)] text-[var(--mos-text-muted)] transition duration-150 hover:bg-white/[0.06] hover:text-[var(--mos-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)]">‹</button>
            <PeriodDateField preset="month" value={`${month}-01`} today={today} onChange={anchor => showMonth(anchor.slice(0, 7))} label="JISDOR month">
              <span className="text-sm font-medium text-[var(--mos-text)]">{monthLabel(month)}</span>
            </PeriodDateField>
            <button type="button" aria-label="Next month" disabled={isFutureMonth(nextMonth, today)} onClick={() => showMonth(nextMonth)} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--mos-radius-control)] text-[var(--mos-text-muted)] transition duration-150 hover:bg-white/[0.06] hover:text-[var(--mos-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] disabled:cursor-not-allowed disabled:opacity-30">›</button>
          </>
        ) : <p className="text-sm font-medium text-[var(--mos-text)]">{monthLabel(month)}</p>}
      </div>
      {loading ? <p className="mt-3 text-xs text-[var(--mos-text-muted)]">Loading JISDOR…</p> : tableRows.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--mos-text-muted)]">{emptyCopy}</p>
      ) : (
        <div className={variant === 'screen' ? 'mt-3 max-h-72 overflow-auto' : 'mt-3'}>
          <table className={tableClass}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th align="right">Rate (IDR)</Th>
                <Th align="right">Change</Th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(row => (
                <tr key={row.date}>
                  <Td>{fixingDate(row.date)}</Td>
                  <Td className="text-right text-[var(--mos-text)]">Rp {formatUsd(row.rate)}</Td>
                  <NumTd tone={row.change == null ? undefined : row.change > 0 ? 'pos' : row.change < 0 ? 'neg' : undefined}>
                    {row.change == null ? '—' : row.change > 0 ? `+${formatUsd(row.change)}` : formatUsd(row.change)}
                  </NumTd>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && !tableFailed && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </section>
  );
}
