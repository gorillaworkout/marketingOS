'use client';

import type { ReactNode } from 'react';
import { anchorFromPicker, todayWib } from './labels';

/** Clickable period label. The native date or month input fills the label so it opens on click and is keyboard reachable. */
export function PeriodDateField({ preset, value, onChange, label, children }: {
  preset: 'day' | 'week' | 'month';
  value: string;
  onChange: (anchor: string) => void;
  label: string;
  children: ReactNode;
}) {
  const monthly = preset === 'month';
  const today = todayWib();
  return (
    <div className="relative min-w-[11.5rem] rounded-[var(--mos-radius-control)] focus-within:ring-2 focus-within:ring-[var(--mos-accent-ring)]">
      <div className="pointer-events-none px-2 py-0.5 text-center">{children}</div>
      <input
        aria-label={label}
        type={monthly ? 'month' : 'date'}
        value={monthly ? value.slice(0, 7) : value}
        max={monthly ? today.slice(0, 7) : today}
        onChange={event => {
          const next = anchorFromPicker(preset, event.target.value);
          if (next) onChange(next);
        }}
        className="settlement-picker absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none"
      />
    </div>
  );
}
