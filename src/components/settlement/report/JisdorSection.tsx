'use client';

import { useEffect, useState } from 'react';
import { Button, StatusBadge } from '@/components/ui/dashboard';
import { formatUsd } from '@/lib/settlement/format';

type Fixing = { date: string; rate: number };

export function JisdorSection({ variant, fixings: provided }: { variant: 'screen' | 'print'; fixings?: Fixing[] }) {
  const [fixings, setFixings] = useState<Fixing[] | null>(provided ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (provided) return undefined;
    let cancelled = false;
    fetch('/api/settlement-report/jisdor').then(async response => {
      const data = await response.json().catch(() => ({}));
      if (cancelled) return;
      if (!response.ok) setError(data.error || 'Could not load JISDOR');
      else setFixings(data.fixings ?? []);
    }).catch(() => { if (!cancelled) setError('Could not load JISDOR'); });
    return () => { cancelled = true; };
  }, [provided]);

  async function refresh() {
    setBusy(true);
    const response = await fetch('/api/settlement-report/jisdor', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || 'Fetch failed. Stored fixings were left unchanged.');
    else {
      const again = await fetch('/api/settlement-report/jisdor');
      const body = await again.json().catch(() => ({}));
      setFixings(body.fixings ?? []);
      setError('');
    }
    setBusy(false);
  }

  const rows = fixings ?? [];
  const latest = rows.at(-1);
  const min = rows.reduce((value, row) => Math.min(value, row.rate), Number.POSITIVE_INFINITY);
  const max = rows.reduce((value, row) => Math.max(value, row.rate), 0);
  const span = max - (Number.isFinite(min) ? min : max) || 1;
  const coords = rows.map((row, index) => {
    const x = rows.length <= 1 ? 0 : (index / (rows.length - 1)) * 280;
    const y = 70 - ((row.rate - (Number.isFinite(min) ? min : row.rate)) / span) * 60;
    return `${x},${y}`;
  }).join(' ');

  return (
    <section id="jisdor" className="scroll-mt-24 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-[560]">JISDOR reference <StatusBadge tone="info">Display only</StatusBadge></h2>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Official BI daily fixings, fetched only when you ask. They are not applied to commission or swap, and they do not replace the fixed IDR account rates (10,000 / 12,000 / 14,000). A day with no published fixing is left out.</p>
        </div>
        {variant === 'screen' && !provided && <Button size="sm" disabled={busy} onClick={() => void refresh()}>{busy ? 'Fetching' : 'Fetch latest'}</Button>}
      </div>
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
      {rows.length > 1 && (
        <svg viewBox="0 0 280 80" role="img" aria-label={`JISDOR from ${rows[0].date} to ${latest?.date}`} className="h-24 w-full">
          <polyline fill="none" stroke="#2EB5C4" strokeWidth="1.6" points={coords} />
          {rows.map(row => <title key={row.date}>{`${row.date}: ${row.rate}`}</title>)}
        </svg>
      )}
      <p className="mt-2 text-xs text-[var(--mos-text-muted)]">
        {latest ? <>Latest: {latest.date} · <b className="text-[var(--mos-text)]">{formatUsd(latest.rate)}</b> IDR per USD</> : 'No fixings stored yet.'}
        {rows.length > 1 && Number.isFinite(min) && <span className="float-right">Range {formatUsd(min)} – {formatUsd(max)}</span>}
      </p>
    </section>
  );
}
