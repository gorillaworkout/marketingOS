'use client';

import { useEffect, useState } from 'react';

const LINKS = [
  ['overview', 'Overview'],
  ['reconciliation', 'Reconciliation'],
  ['processing', 'Processing time'],
  ['withdrawal-timing', 'Withdrawal timing'],
  ['margin', 'Margin in–out'],
  ['commission-swap', 'Commission & swap'],
  ['jisdor', 'JISDOR'],
] as const;

export function SectionNav({ mismatches, pendingDays }: { mismatches: number; pendingDays: number }) {
  const [current, setCurrent] = useState('overview');
  useEffect(() => {
    const nodes = LINKS.map(([id]) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id) setCurrent(visible.target.id);
    }, { rootMargin: '-20% 0px -60% 0px' });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return (
    <nav aria-label="Report sections" className="sticky top-0 z-10 flex flex-wrap gap-0.5 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-bg)]/85 p-1 backdrop-blur">
      {LINKS.map(([id, label]) => (
        <a key={id} href={`#${id}`} aria-current={current === id ? 'true' : undefined} className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium ${current === id ? 'bg-[var(--mos-raised)] text-[var(--mos-text)]' : 'text-[var(--mos-text-muted)]'}`}>
          {label}
          {id === 'reconciliation' && mismatches > 0 && <span className="rounded bg-red-400/15 px-1.5 text-[10.5px] text-red-300">{mismatches}</span>}
          {id === 'commission-swap' && pendingDays > 0 && <span className="rounded bg-amber-400/15 px-1.5 text-[10.5px] text-amber-200">{pendingDays} Pending</span>}
        </a>
      ))}
      <a href="#methodology" className="ml-auto px-3 py-1.5 text-[12.5px] font-medium text-[var(--mos-text-muted)]">Methodology</a>
    </nav>
  );
}
