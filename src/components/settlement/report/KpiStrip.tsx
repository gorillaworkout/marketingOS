import { formatCompact, formatDurationShort, formatIdr } from '@/lib/settlement/format';
import type { KpiCard } from '@/lib/settlement/kpis';
import type { DailyFlow } from '@/lib/settlement/summary';
import { PendingChip } from './PendingChip';
import { Sparkline } from './Sparkline';

function series(card: KpiCard, daily: DailyFlow[]): Array<number | null> {
  if (card.id === 'deposits') return daily.map(row => row.depositIdr);
  if (card.id === 'withdrawals') return daily.map(row => row.withdrawalIdr);
  if (card.id === 'net') return daily.map(row => row.netIdr);
  if (card.id === 'withdrawal-pct' || card.id === 'withdrawal-ratio') return daily.map(row => row.officeHourPct);
  if (card.id === 'processing') return [];
  return [];
}

function valueText(card: KpiCard): string {
  if (card.pending || card.value === null) return '';
  if (card.kind === 'idr') return formatCompact(card.value);
  if (card.kind === 'duration') return formatDurationShort(card.value);
  return `${card.value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

export function KpiStrip({ cards, daily }: { cards: KpiCard[]; daily: DailyFlow[] }) {
  const columns = cards.length > 6 ? 'xl:grid-cols-7' : 'xl:grid-cols-6';
  return (
    <section id="overview" className={`grid grid-cols-2 overflow-hidden rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] shadow-[var(--mos-shadow-panel)] md:grid-cols-3 ${columns}`}>
      {cards.map(card => (
        <article key={card.id} className="min-w-0 border-l border-[var(--mos-border-subtle)] px-5 py-4 first:border-l-0">
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--mos-text-muted)]">
            {card.label}
            <span title={card.hint} className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--mos-border-strong)] text-[8px]">i</span>
          </p>
          {card.pending ? <div className="mt-2"><PendingChip reason={card.note} /></div> : (
            <p className="mt-2 truncate text-[25px] font-[560] tracking-[-0.035em] tabular-nums text-[var(--mos-text)]">
              {card.kind === 'idr' && <small className="mr-1 text-[13px] font-medium tracking-normal text-[var(--mos-text-muted)]">IDR</small>}
              {valueText(card)}
            </p>
          )}
          {card.delta && (
            <p className={`mt-1.5 flex items-center gap-1.5 text-[11.5px] tabular-nums ${card.delta.tone === 'good' ? 'text-[#6fd3a5]' : card.delta.tone === 'bad' ? 'text-[#f08a8a]' : 'text-[var(--mos-text-muted)]'}`}>
              <span>{card.delta.text}</span>
              {card.versus && <span className="text-[var(--mos-text-faint)]">vs {card.versus}</span>}
              <span className="sr-only">{card.delta.sr}</span>
            </p>
          )}
          <p className="mt-0.5 truncate text-[11px] tabular-nums text-[var(--mos-text-faint)]">{card.pending ? card.note : card.note}</p>
          <Sparkline points={series(card, daily)} label={`${card.label} over the period`} />
          {card.id === 'deposits' && <span className="sr-only">{formatIdr(card.value)}</span>}
        </article>
      ))}
    </section>
  );
}
