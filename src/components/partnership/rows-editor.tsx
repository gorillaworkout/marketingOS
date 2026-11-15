'use client';

import { Button, TextInput } from '@/components/ui/dashboard';

export interface RowsColumn<T> {
  key: keyof T & string;
  label: string;
  width?: string;
  type?: 'text' | 'number';
  placeholder?: string;
}

/** Small editable table: one input per cell, add and remove rows. */
export function RowsEditor<T extends object>({ rows, columns, onChange, blank, readOnly, addLabel = 'Add row' }: {
  rows: T[];
  columns: RowsColumn<T>[];
  onChange: (rows: T[]) => void;
  blank: () => T;
  readOnly?: boolean;
  addLabel?: string;
}) {
  const update = (index: number, key: keyof T, value: string, type?: 'text' | 'number') => {
    const next = rows.slice();
    next[index] = { ...next[index], [key]: type === 'number' ? Number(value.replace(/[^\d]/g, '')) || 0 : value };
    onChange(next);
  };
  return <div className="space-y-2">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--mos-text-faint)]">
          {columns.map(column => <th key={column.key} className="px-1 pb-1 font-medium" style={{ width: column.width }}>{column.label}</th>)}
          {!readOnly && <th className="w-10" />}
        </tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={index}>
            {columns.map(column => <td key={column.key} className="px-1 py-1">
              <TextInput
                value={String((row as Record<string, unknown>)[column.key] ?? '')}
                inputMode={column.type === 'number' ? 'numeric' : undefined}
                placeholder={column.placeholder}
                disabled={readOnly}
                aria-label={`${column.label} row ${index + 1}`}
                onChange={event => update(index, column.key, event.target.value, column.type)}
              />
            </td>)}
            {!readOnly && <td className="px-1 py-1 text-right"><Button size="sm" variant="ghost" aria-label={`Remove row ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>✕</Button></td>}
          </tr>)}
        </tbody>
      </table>
    </div>
    {!readOnly && <Button size="sm" onClick={() => onChange([...rows, blank()])}>{addLabel}</Button>}
  </div>;
}
