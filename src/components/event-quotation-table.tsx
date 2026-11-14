'use client';

import { Button, FormField, TextInput } from '@/components/ui/dashboard';
import { formatIdr, quotationCategoryTotals, quotationGrandTotal, QUOTATION_CATEGORIES, type QuotationLine } from '@/lib/event-plan-quotation';

const EMPTY: QuotationLine = { vendor: '', item: '', category: 'Other', qty: 1, unitPrice: 0, total: 0, currency: 'IDR', notes: '' };

export function EventQuotationTable({
  lines,
  contingencyPercent,
  uploading,
  onChange,
  onContingency,
  onUpload,
}: {
  lines: QuotationLine[];
  contingencyPercent: number;
  uploading: boolean;
  onChange: (lines: QuotationLine[]) => void;
  onContingency: (value: number) => void;
  onUpload: (files: File[]) => void;
}) {
  const totals = quotationGrandTotal(lines, contingencyPercent);
  const categories = quotationCategoryTotals(lines);
  const update = (index: number, patch: Partial<QuotationLine>) => {
    onChange(lines.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const next = { ...line, ...patch };
      if (patch.qty !== undefined || patch.unitPrice !== undefined) next.total = next.qty * next.unitPrice;
      return next;
    }));
  };
  return (
    <div className="space-y-3">
      <FormField label="Vendor quotations" hint="PDF, DOCX, XLSX, CSV, JPG, or PNG. 10 MB each, up to 5 files. File contents are read as data, never executed.">
        <input aria-label="Quotation files" type="file" multiple accept=".pdf,.docx,.xlsx,.csv,image/jpeg,image/png,application/pdf" onChange={event => { onUpload(Array.from(event.target.files || [])); event.target.value = ''; }} />
      </FormField>
      {uploading && <p className="text-xs text-[var(--mos-text-muted)]">Reading quotations…</p>}
      <div className="overflow-x-auto rounded-[var(--mos-radius-control)] border border-[var(--mos-border)]">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-[var(--mos-raised)] text-[var(--mos-text-secondary)]">
            <tr>
              <th className="p-2">Vendor</th>
              <th className="p-2">Item</th>
              <th className="p-2">Category</th>
              <th className="p-2">Qty</th>
              <th className="p-2">Unit price</th>
              <th className="p-2">Total</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={`${line.item}-${index}`} className="border-t border-[var(--mos-border)]">
                <td className="p-2"><TextInput value={line.vendor} onChange={event => update(index, { vendor: event.target.value })} /></td>
                <td className="p-2"><TextInput value={line.item} onChange={event => update(index, { item: event.target.value })} /></td>
                <td className="p-2">
                  <select className="h-9 w-full rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-2" value={line.category} onChange={event => update(index, { category: event.target.value })}>
                    {QUOTATION_CATEGORIES.map(category => <option key={category}>{category}</option>)}
                  </select>
                </td>
                <td className="p-2"><TextInput value={String(line.qty)} onChange={event => update(index, { qty: Number(event.target.value.replace(/\D/g, '')) || 1 })} /></td>
                <td className="p-2"><TextInput value={String(line.unitPrice)} onChange={event => update(index, { unitPrice: Number(event.target.value.replace(/\D/g, '')) || 0 })} /></td>
                <td className="p-2 whitespace-nowrap">{line.currency === 'IDR' ? formatIdr(line.total) : `${line.currency} ${line.total}`}</td>
                <td className="p-2"><button type="button" className="text-red-300" onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" onClick={() => onChange([...lines, EMPTY])}>Add line</Button>
      <FormField label="Contingency" hint="Percent added to the confirmed IDR subtotal.">
        <TextInput inputMode="decimal" value={String(contingencyPercent)} onChange={event => onContingency(Number(event.target.value) || 0)} />
      </FormField>
      <div className="space-y-1 text-sm text-[var(--mos-text-secondary)]">
        {categories.map(row => <p key={row.category}>{row.category}: {formatIdr(row.total)}</p>)}
        <p>Subtotal: {formatIdr(totals.subtotal)}</p>
        <p>Contingency: {formatIdr(totals.contingency)}</p>
        <p className="font-medium text-[var(--mos-text)]">Grand total: {formatIdr(totals.total)}</p>
      </div>
    </div>
  );
}
