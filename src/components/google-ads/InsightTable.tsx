'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { DataTableFrame, TextInput } from '@/components/ui/dashboard';

export type InsightColumn<T> = {
  key: string;
  label: string;
  /** Sort + filter value. Numbers sort numerically; null sorts last. */
  value: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right';
  wide?: boolean;
  title?: string;
};

export const linkButtonClass = 'inline-flex h-8 items-center whitespace-nowrap rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-xs text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]';

export function InsightTable<T>({ title, description, rows, total, columns, rowKey, defaultSort, exportHref, emptyText = 'No rows for this range.', toolbar }: {
  title: string; description?: string; rows: T[]; total?: number; columns: Array<InsightColumn<T>>; rowKey: (row: T) => string;
  defaultSort: string; exportHref?: string; emptyText?: string; toolbar?: ReactNode;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: defaultSort, desc: true });
  const [filter, setFilter] = useState('');
  const sorted = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle ? rows.filter(row => columns.some(column => typeof column.value(row) === 'string' && String(column.value(row)).toLowerCase().includes(needle))) : rows;
    const column = columns.find(item => item.key === sort.key);
    if (!column) return filtered;
    return [...filtered].sort((left, right) => {
      const a = column.value(left); const b = column.value(right);
      if (a == null || b == null) return a == null && b == null ? 0 : a == null ? 1 : -1;
      const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
      return sort.desc ? -order : order;
    });
  }, [rows, columns, sort, filter]);
  const count = total != null && total > rows.length ? `${rows.length} of ${total}` : String(rows.length);
  return <DataTableFrame title={`${title} (${count})`} description={description} action={<div className="flex flex-wrap items-center gap-2">
    {toolbar}
    <TextInput placeholder="Filter…" aria-label={`Filter ${title}`} value={filter} onChange={event => setFilter(event.target.value)} className="h-8 w-44" />
    {exportHref && <a href={exportHref} className={linkButtonClass}>Export CSV</a>}
  </div>}>
    <div className="max-h-[560px] overflow-y-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="sticky top-0 border-b border-[var(--mos-border)] bg-[var(--mos-panel)] text-left text-xs text-[var(--mos-text-faint)]">
          <tr>{columns.map(column => <th key={column.key} className={`p-3 ${column.align === 'right' ? 'text-right' : ''}`} title={column.title}>
            <button type="button" className="uppercase tracking-wide hover:text-[var(--mos-text)]" onClick={() => setSort(value => ({ key: column.key, desc: value.key === column.key ? !value.desc : true }))}>
              {column.label}{sort.key === column.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
            </button>
          </th>)}</tr>
        </thead>
        <tbody>
          {sorted.map(row => <tr key={rowKey(row)} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
            {columns.map(column => {
              const value = column.value(row);
              return <td key={column.key} className={`p-3 ${column.wide ? 'max-w-[320px] truncate text-white' : 'whitespace-nowrap'} ${column.align === 'right' ? 'text-right tabular-nums' : ''}`} title={typeof value === 'string' ? value : undefined}>
                {column.render ? column.render(row) : value == null || value === '' ? '—' : value}
              </td>;
            })}
          </tr>)}
          {!sorted.length && <tr><td colSpan={columns.length} className="p-8 text-center text-[var(--mos-text-faint)]">{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  </DataTableFrame>;
}

export function Explainer({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--mos-text-muted)]">{children}</ul>;
}

export function SummaryCards({ cards }: { cards: Array<{ label: string; value: string; note?: string; title?: string; tone?: 'good' | 'bad' }> }) {
  return <div className="grid overflow-hidden rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] sm:grid-cols-2 lg:grid-cols-4">
    {cards.map(card => <div key={card.label} title={card.title} className="min-w-0 border-l border-[var(--mos-border-subtle)] px-5 py-4 first:border-l-0">
      <p className="text-[11px] font-medium text-[var(--mos-text-muted)]">{card.label}</p>
      <p className={`mt-2 truncate text-2xl font-[560] tracking-[-0.035em] ${card.tone === 'bad' ? 'text-amber-200' : card.tone === 'good' ? 'text-emerald-300' : 'text-[var(--mos-text)]'}`}>{card.value}</p>
      {card.note && <p className="mt-1 text-[11px] text-[var(--mos-text-faint)]">{card.note}</p>}
    </div>)}
  </div>;
}
