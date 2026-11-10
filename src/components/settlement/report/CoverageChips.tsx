import { coverageTone } from '@/lib/settlement/summary';
import type { DealsHistorySummary } from '@/lib/settlement/summary';

const SOURCES = [
  ['settlement_crm_deposit', 'CRM Deposit'],
  ['settlement_crm_withdrawal', 'CRM Withdrawal'],
  ['settlement_mt5_dw', 'MT5 D&W'],
  ['settlement_ftd', 'Dealing FTD'],
] as const;

export function CoverageChips({ coverage, rangeEnd, commission, asText = false }: {
  coverage: Record<string, string | null>;
  rangeEnd: string;
  commission?: DealsHistorySummary;
  asText?: boolean;
}) {
  const chips: Array<{ key: string; text: string; tone: 'ok' | 'warn' }> = SOURCES.map(([key, label]) => {
    const through = coverage[key] ?? null;
    const tone = coverageTone(through, rangeEnd);
    return { key, text: through ? `${label} · ${through}` : `${label} · no uploads`, tone };
  });
  if (commission) {
    const pending = commission.pendingDays;
    chips.push({
      key: 'deals',
      text: pending > 0 ? `Deals History · ${commission.lastCoveredDate ?? 'none'}, ${pending} days Pending` : `Deals History · ${commission.lastCoveredDate ?? 'covered'}`,
      tone: pending > 0 ? 'warn' : 'ok',
    });
  }
  if (asText) return <p className="text-xs text-[var(--mos-text-muted)]">Data through: {chips.map(chip => chip.text).join(' · ')}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mos-text-muted)]">
      <span>Data through:</span>
      {chips.map(chip => (
        <span key={chip.key} className={`inline-flex h-6 items-center gap-1.5 rounded-[6px] border px-2 text-[11.5px] font-medium ${chip.tone === 'ok' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/25 bg-amber-400/10 text-amber-200'}`}>
          <i className="h-1.5 w-1.5 rounded-full bg-current" />{chip.text}
        </span>
      ))}
    </div>
  );
}
