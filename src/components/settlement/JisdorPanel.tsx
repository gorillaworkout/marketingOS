'use client';

import { useEffect, useState } from 'react';
import { Button, DataTableFrame, Panel, SectionHeader } from '@/components/ui/dashboard';
import { formatAmount } from '@/components/monthly-report/brand';

type Fixing = { date: string; rate: number };

/** Shows published JISDOR dates. Does not convert the settlement report. */
export function JisdorPanel() {
  const [fixings, setFixings] = useState<Fixing[] | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch('/api/settlement-report/jisdor').then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || 'Could not load JISDOR'); return; }
      setFixings(data.fixings ?? []);
      setNote(data.note ?? '');
      setError('');
    });
  };

  useEffect(() => { load(); }, []);

  async function refresh() {
    setBusy(true);
    setError('');
    const response = await fetch('/api/settlement-report/jisdor', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || 'Fetch failed. Stored fixings were left unchanged.');
    else load();
    setBusy(false);
  }

  return (
    <Panel>
      <SectionHeader
        title="JISDOR"
        description="Official BI daily fixings, fetched only when you ask. They are not applied to commission or swap, and they do not replace the fixed IDR account rates (10000 / 12000 / 14000). A day with no published fixing is left out."
        action={<Button size="sm" variant="primary" disabled={busy} onClick={() => void refresh()}>{busy ? 'Fetching' : 'Fetch latest fixings'}</Button>}
      />
      {error && <p className="px-5 text-xs text-red-300">{error}</p>}
      {note && <p className="px-5 pb-2 text-xs text-[var(--mos-text-muted)]">{note}</p>}
      <DataTableFrame title="Published fixings">
        {!fixings ? <p className="px-5 py-4 text-xs text-[var(--mos-text-muted)]">Loading…</p> : fixings.length === 0 ? <p className="px-5 py-4 text-xs text-[var(--mos-text-muted)]">No fixings stored yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr><th className="px-4 py-2 text-left">Fixing date</th><th className="px-4 py-2 text-right">IDR per USD</th></tr></thead>
            <tbody>
              {fixings.map(row => <tr key={row.date} className="border-t border-[var(--mos-border)]"><td className="px-4 py-1.5">{row.date}</td><td className="px-4 py-1.5 text-right tabular-nums">{formatAmount(row.rate)}</td></tr>)}
            </tbody>
          </table>
        )}
      </DataTableFrame>
    </Panel>
  );
}
