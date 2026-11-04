'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, FormField, Panel, SectionHeader, StatusBadge, TextInput } from '@/components/ui/dashboard';
import { formatAmount, formatDateTimeWib, formatInteger } from '@/components/monthly-report/brand';
import { formatCoverageDate } from '@/lib/monthly-report/coverage';
import { addDays } from '@/lib/monthly-report/periods';
import type { ManualFtdEntry } from '@/lib/monthly-report/ftd-daily';

type Listing = { entries: ManualFtdEntry[]; total: number; today: string };

/**
 * Daily FTD, entered by hand (no file): pick a WIB date, type the FTD count and
 * optionally the amount. Saving a date that already has a value updates it
 * (upsert per day). The value replaces the FTD-file value of that day.
 */
export function DailyFtdPanel({ onSaved }: { onSaved?: () => void }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState('');
  const [date, setDate] = useState('');
  const [count, setCount] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/monthly-report/ftd-daily?limit=31');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setLoadError(data.error || 'Could not load the daily FTD entries'); return; }
      setListing(data);
      setLoadError('');
      setDate(current => current || addDays(data.today, -1)); // default: yesterday (WIB)
    } catch {
      setLoadError('Could not load the daily FTD entries');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const existing = listing?.entries.find(entry => entry.date === date) ?? null;

  const edit = (entry: ManualFtdEntry) => {
    setDate(entry.date);
    setCount(String(entry.count));
    setAmount(entry.amount === null ? '' : String(entry.amount));
    setMessage(null);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/monthly-report/ftd-daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, count, amount: amount.trim() === '' ? null : amount }),
      });
      const data = await response.json().catch(() => ({ error: 'Unexpected response' }));
      if (!response.ok || !data.ok) { setMessage({ tone: 'error', text: data.error || 'Could not save' }); return; }
      const entry = data.entry as ManualFtdEntry;
      setMessage({ tone: 'ok', text: `${data.created ? 'Saved' : 'Updated'} ${formatCoverageDate(entry.date)}: ${formatInteger(entry.count)} FTD${entry.amount === null ? '' : ` · ${formatAmount(entry.amount)}`}.` });
      setCount('');
      setAmount('');
      await load();
      onSaved?.();
    } catch {
      setMessage({ tone: 'error', text: 'Could not save. Check the connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const clear = async (entry: ManualFtdEntry) => {
    if (!window.confirm(`Clear the manual FTD of ${formatCoverageDate(entry.date)}? The day falls back to the FTD file, or "No data".`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/monthly-report/ftd-daily?date=${entry.date}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      setMessage(response.ok ? { tone: 'ok', text: `Cleared ${formatCoverageDate(entry.date)}.` } : { tone: 'error', text: data.error || 'Could not clear' });
      await load();
      onSaved?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="border-[rgba(46,181,196,0.35)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader title="Daily FTD" description="No file needed: pick the date (WIB) and enter the number of FTDs, plus the amount if you have it. Saving a date again updates it." />
        {listing && <span className="text-xs text-[var(--mos-text-muted)]">{formatInteger(listing.total)} days entered</span>}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <FormField label="Date (WIB)">
          <TextInput type="date" className="w-44" value={date} max={listing?.today} onChange={e => { setDate(e.target.value); setMessage(null); }} />
        </FormField>
        <FormField label="FTD count">
          <TextInput type="number" inputMode="numeric" min={0} step={1} className="w-32" placeholder="0" value={count} onChange={e => setCount(e.target.value)} />
        </FormField>
        <FormField label="FTD amount (USD)" hint="Optional">
          <TextInput type="number" inputMode="decimal" min={0} step="0.01" className="w-40" placeholder="—" value={amount} onChange={e => setAmount(e.target.value)} />
        </FormField>
        <Button variant="primary" disabled={busy || !date || count.trim() === ''} onClick={() => void save()}>{busy ? 'Saving…' : existing ? 'Update' : 'Save'}</Button>
        {existing && <StatusBadge tone="info" dot>{formatCoverageDate(existing.date)} already has {formatInteger(existing.count)} FTD; saving replaces it</StatusBadge>}
      </div>
      {message && <p className={`mt-3 text-xs ${message.tone === 'ok' ? 'text-emerald-200' : 'text-red-300'}`}>{message.text}</p>}
      {loadError && <p className="mt-3 text-xs text-red-300">{loadError}</p>}
      <p className="mt-3 text-xs text-[var(--mos-text-faint)]">A manual value replaces the FTD-file value of that day (count and amount). &ldquo;Activated → FTD (same accounts)&rdquo; needs account numbers, so it is only shown for periods fully covered by an FTD file.</p>
      {listing && listing.entries.length > 0 && (
        <table className="mt-4 w-full text-left text-xs">
          <thead className="text-[var(--mos-text-faint)]"><tr>{['Date (WIB)', 'FTD', 'Amount', 'Last edited by', 'When (WIB)', ''].map(h => <th key={h || 'actions'} className="py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {listing.entries.map(entry => (
              <tr key={entry.date} className="border-t border-[var(--mos-border-subtle)] text-[var(--mos-text-secondary)]">
                <td className="whitespace-nowrap py-2 pr-4">{formatCoverageDate(entry.date)}</td>
                <td className="py-2 pr-4">{formatInteger(entry.count)}</td>
                <td className="py-2 pr-4">{entry.amount === null ? <span className="text-[var(--mos-text-faint)]">Not entered</span> : formatAmount(entry.amount)}</td>
                <td className="py-2 pr-4">{entry.updatedByName ?? '—'}</td>
                <td className="whitespace-nowrap py-2 pr-4">{formatDateTimeWib(entry.updatedAt)}</td>
                <td className="whitespace-nowrap py-2 text-right">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => edit(entry)}>Edit</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear(entry)}>Clear</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {listing && listing.entries.length === 0 && <p className="mt-4 text-xs text-[var(--mos-text-muted)]">No daily FTD entered yet.</p>}
    </Panel>
  );
}
