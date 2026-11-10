'use client';

import { Button } from '@/components/ui/dashboard';
import type { SettlementPeriod, SettlementPreset } from '@/lib/settlement/report';
import { periodSubtitle, periodTitle, previousTitle } from './labels';
import { PeriodDateField } from './PeriodDateField';

const PRESETS: Array<{ id: SettlementPreset; label: string; hint: string }> = [
  { id: 'day', label: 'Daily', hint: '12:00–12:00 WIB' },
  { id: 'week', label: 'Weekly', hint: 'Mon–Sun' },
  { id: 'month', label: 'Monthly', hint: 'Calendar month' },
];

export function SettlementPeriodBar({ period, previous, onPreset, onShift, onAnchor }: {
  period: SettlementPeriod;
  previous: { from: string; to: string };
  onPreset: (preset: SettlementPreset) => void;
  onShift: (direction: number) => void;
  onAnchor: (anchor: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Period" className="flex overflow-hidden rounded-[var(--mos-radius-control)] border border-[var(--mos-border)]">
          {PRESETS.map(item => {
            const selected = period.preset === item.id;
            return (
              <button key={item.id} type="button" aria-pressed={selected} onClick={() => onPreset(item.id)} className={`cursor-pointer border-l border-[var(--mos-border)] px-3 py-1.5 text-left text-xs font-medium transition duration-150 ease-out first:border-l-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--mos-accent-ring)] ${selected ? 'bg-[#2EB5C4] text-white hover:bg-[#3ec4d2] active:bg-[#1A8A96]' : 'text-[var(--mos-text-muted)] hover:bg-white/[0.06] hover:text-[var(--mos-text)] active:bg-white/[0.1]'}`}>
                {item.label}<small className="block text-[10px] font-normal opacity-80">{item.hint}</small>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" aria-label="Previous period" onClick={() => onShift(-1)}>‹</Button>
          <PeriodDateField preset={period.preset === 'month' ? 'month' : period.preset === 'week' ? 'week' : 'day'} value={period.preset === 'week' ? period.range.from : period.anchor} onChange={onAnchor} label="Choose report period">
            <div className="text-[13.5px] font-[560] text-[var(--mos-text)]">{periodTitle(period)}</div>
            <div className="text-[11px] text-[var(--mos-text-faint)]">{periodSubtitle(period)}</div>
          </PeriodDateField>
          <Button size="sm" aria-label="Next period" onClick={() => onShift(1)}>›</Button>
        </div>
      </div>
      <p className="text-xs text-[var(--mos-text-muted)]">Compared with <span className="text-[var(--mos-text-secondary)]">{previousTitle(period.preset, previous)}</span></p>
    </div>
  );
}
