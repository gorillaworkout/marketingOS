'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { anchorFromPicker, todayWib } from './labels';
import { isFutureDay, isFutureMonth, monthName, monthWeeks, shiftMonth, weekRange } from './calendar';

const DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Label and calendar button. The popover commits only when a day or month is chosen. */
export function PeriodDateField({ preset, value, onChange, label, children, today = todayWib(), defaultOpen = false }: {
  preset: 'day' | 'week' | 'month';
  value: string;
  onChange: (anchor: string) => void;
  label: string;
  children: ReactNode;
  today?: string;
  defaultOpen?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const uid = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [cursor, setCursor] = useState(value.slice(0, 7));
  const [hover, setHover] = useState<string | null>(null);
  const selectedWeek = preset === 'week' ? weekRange(value) : null;
  const hoverWeek = preset === 'week' && hover ? weekRange(hover) : null;

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    setCursor(value.slice(0, 7));
    setOpen(current => !current);
  }

  function chooseDay(date: string) {
    if (isFutureDay(date, today)) return;
    const next = anchorFromPicker(preset, date);
    if (!next) return;
    onChange(next);
    setOpen(false);
  }

  function chooseMonth(yearMonth: string) {
    if (isFutureMonth(yearMonth, today)) return;
    const next = anchorFromPicker('month', yearMonth);
    if (!next) return;
    onChange(next);
    setOpen(false);
  }

  const [year, month] = cursor.split('-').map(Number);
  const weeks = monthWeeks(year, month);

  return (
    <div ref={root} className="relative">
      <div className="flex items-center">
        <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={toggle} className="cursor-pointer rounded-[var(--mos-radius-control)] px-1 text-center transition duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] active:bg-white/[0.1]">
          {children}
        </button>
        <button type="button" aria-label={`${label} calendar`} aria-expanded={open} onClick={toggle} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--mos-radius-control)] text-[var(--mos-text-muted)] transition duration-150 hover:bg-white/[0.06] hover:text-[var(--mos-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] active:bg-white/[0.1]">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5 2v2.5M11 2v2.5" /></svg>
        </button>
      </div>
      {open && (
        <div role="dialog" aria-label={label} className="absolute left-1/2 top-full z-30 mt-2 w-[17.5rem] -translate-x-1/2 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-3 shadow-[var(--mos-shadow-panel)]">
          {preset === 'month' ? (
            <MonthGrid year={Number(value.slice(0, 4))} selected={value.slice(0, 7)} today={today} onYear={yearNumber => setCursor(`${yearNumber}-01`)} onChoose={chooseMonth} />
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <IconButton label="Previous month" onClick={() => setCursor(shiftMonth(cursor, -1))}>‹</IconButton>
                <p className="text-xs font-medium text-[var(--mos-text)]">{monthName(month - 1)} {year}</p>
                <IconButton label="Next month" onClick={() => setCursor(shiftMonth(cursor, 1))}>›</IconButton>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-[var(--mos-text-faint)]" aria-hidden="true">
                {DAY_NAMES.map(name => <span key={name}>{name}</span>)}
              </div>
              <div role="grid" aria-label={label} className="mt-1">
                {weeks.map(week => {
                  const range = weekRange(week[0]);
                  const highlighted = (hoverWeek && hoverWeek.from === range.from) || (selectedWeek && selectedWeek.from === range.from);
                  return (
                    <div key={week[0]} role="row" data-selected-week={selectedWeek?.from === range.from ? 'true' : undefined} className={`grid grid-cols-7 gap-0.5 rounded ${highlighted ? 'bg-white/[0.06]' : ''}`}>
                      {week.map(date => {
                        const future = isFutureDay(date, today);
                        const outside = date.slice(0, 7) !== cursor;
                        const picked = date === value;
                        return (
                          <button
                            key={date}
                            id={`${uid}-${date}`}
                            type="button"
                            role="gridcell"
                            aria-label={date}
                            aria-selected={date === value || (preset === 'week' && date === selectedWeek?.from)}
                            disabled={future}
                            onMouseEnter={() => setHover(date)}
                            onMouseLeave={() => setHover(null)}
                            onClick={() => chooseDay(date)}
                            className={`h-8 cursor-pointer rounded text-xs tabular-nums transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] disabled:cursor-not-allowed disabled:opacity-30 ${outside ? 'text-[var(--mos-text-faint)]' : 'text-[var(--mos-text-secondary)]'} ${picked ? 'bg-[#2EB5C4] text-white hover:bg-[#3ec4d2]' : 'hover:bg-white/[0.08] hover:text-[var(--mos-text)] active:bg-white/[0.12]'}`}
                          >
                            {Number(date.slice(8))}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MonthGrid({ year, selected, today, onYear, onChoose }: {
  year: number;
  selected: string;
  today: string;
  onYear: (year: number) => void;
  onChoose: (yearMonth: string) => void;
}) {
  const [shown, setShown] = useState(year);
  const currentYear = Number(today.slice(0, 4));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <IconButton label="Previous year" onClick={() => { setShown(shown - 1); onYear(shown - 1); }}>‹</IconButton>
        <p className="text-xs font-medium text-[var(--mos-text)]">{shown}</p>
        <IconButton label="Next year" disabled={shown >= currentYear} onClick={() => { setShown(shown + 1); onYear(shown + 1); }}>›</IconButton>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 12 }, (_, index) => {
          const yearMonth = `${shown}-${String(index + 1).padStart(2, '0')}`;
          const future = isFutureMonth(yearMonth, today);
          const pressed = yearMonth === selected;
          return (
            <button key={yearMonth} type="button" aria-label={yearMonth} aria-pressed={pressed} disabled={future} onClick={() => onChoose(yearMonth)} className={`h-9 cursor-pointer rounded text-xs transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] disabled:cursor-not-allowed disabled:opacity-30 ${pressed ? 'bg-[#2EB5C4] text-white hover:bg-[#3ec4d2]' : 'text-[var(--mos-text-secondary)] hover:bg-white/[0.08] hover:text-[var(--mos-text)] active:bg-white/[0.12]'}`}>
              {monthName(index)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IconButton({ children, label, onClick, disabled = false }: { children: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-[var(--mos-text-muted)] transition duration-150 hover:bg-white/[0.06] hover:text-[var(--mos-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)] disabled:cursor-not-allowed disabled:opacity-30">
      {children}
    </button>
  );
}
