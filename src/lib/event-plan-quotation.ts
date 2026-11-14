/**
 * Confirmed vendor quotations for Event Plan.
 * Safe to import from the browser. No file parsing and no model calls.
 */

export const QUOTATION_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const QUOTATION_FILE_MAX_COUNT = 5;
export const QUOTATION_CATEGORIES = ['Venue', 'Speakers', 'Production', 'Catering', 'Promotion', 'Other'] as const;

export type QuotationLine = {
  vendor: string;
  item: string;
  category: string;
  qty: number;
  unitPrice: number;
  total: number;
  currency: string;
  notes: string;
};

export function formatIdr(value: number): string {
  return `Rp ${Math.round(value).toLocaleString('id-ID')}`;
}

export function parseSpeakerNames(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\n+/)
      : [];
  const names: string[] = [];
  for (const item of source) {
    if (typeof item !== 'string') continue;
    const name = item.trim().slice(0, 80);
    if (!name || names.some(existing => existing.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
    if (names.length >= 12) break;
  }
  return names;
}

export function parseParticipantCount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const count = typeof value === 'number' ? value : Number(String(value).replace(/\D/g, ''));
  if (!Number.isInteger(count) || count < 1 || count > 100_000) return null;
  return count;
}

export function parseContingencyPercent(value: unknown): number {
  if (value === undefined || value === null || value === '') return 10;
  const percent = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return 10;
  return Math.round(percent * 10) / 10;
}

function money(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseQuotationLines(value: unknown): QuotationLine[] {
  if (!Array.isArray(value)) return [];
  const lines: QuotationLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const description = typeof raw.item === 'string' ? raw.item.trim().slice(0, 160) : '';
    if (!description) continue;
    const qty = money(raw.qty) ?? 1;
    const unitPrice = money(raw.unitPrice) ?? 0;
    const explicit = money(raw.total);
    const total = explicit ?? qty * unitPrice;
    const category = typeof raw.category === 'string' && (QUOTATION_CATEGORIES as readonly string[]).includes(raw.category)
      ? raw.category
      : 'Other';
    lines.push({
      vendor: typeof raw.vendor === 'string' ? raw.vendor.trim().slice(0, 120) : '',
      item: description,
      category,
      qty: Math.max(1, qty),
      unitPrice,
      total,
      currency: typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency.trim().slice(0, 8).toUpperCase() : 'IDR',
      notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 240) : '',
    });
    if (lines.length >= 40) break;
  }
  return lines;
}

export function quotationCategoryTotals(lines: QuotationLine[]): Array<{ category: string; total: number }> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.currency !== 'IDR') continue;
    totals.set(line.category, (totals.get(line.category) || 0) + line.total);
  }
  return [...totals.entries()].map(([category, total]) => ({ category, total }));
}

export function quotationGrandTotal(lines: QuotationLine[], contingencyPercent: number): { subtotal: number; contingency: number; total: number } {
  const subtotal = lines.filter(line => line.currency === 'IDR').reduce((sum, line) => sum + line.total, 0);
  const contingency = Math.round(subtotal * (parseContingencyPercent(contingencyPercent) / 100));
  return { subtotal, contingency, total: subtotal + contingency };
}

export function eventPlanInputBlock(input: {
  venueName?: string;
  participants?: number | null;
  speakers?: string[];
  quotations?: QuotationLine[];
  contingencyPercent?: number;
}): string {
  const lines = [];
  if (input.venueName) lines.push(`Named venue: ${input.venueName}. Use this venue in the agenda, logistics, run of show, and venue line.`);
  if (input.participants) lines.push(`Target participants: ${input.participants}. Scale seating, catering, and materials to this count. Do not invent a per-person price.`);
  if (input.speakers?.length) lines.push(`Speaker slots, use these names and no others: ${input.speakers.join('; ')}.`);
  if (input.quotations?.length) {
    const totals = quotationGrandTotal(input.quotations, input.contingencyPercent ?? 10);
    lines.push('CONFIRMED_QUOTATIONS (use these rows exactly in the budget; do not replace them with an estimate):');
    for (const line of input.quotations) {
      lines.push(`- ${line.category}: ${line.vendor || 'Vendor'} / ${line.item} / qty ${line.qty} / unit ${line.unitPrice} ${line.currency} / total ${line.total} ${line.currency}${line.notes ? ` / ${line.notes}` : ''}`);
    }
    lines.push(`Confirmed IDR subtotal ${totals.subtotal}. Contingency ${parseContingencyPercent(input.contingencyPercent)}% = ${totals.contingency}. Confirmed grand total ${totals.total}.`);
    lines.push('Any other budget line is an AI estimate and must keep estimatedCost null unless a RESEARCH_EXCERPTS price supports it. Never present an estimate as a quotation.');
  }
  return lines.join('\n');
}

export const NOT_IN_QUOTATION_NOTE = 'Not in quotation — to confirm with vendor';

/** Drop estimate rows a quotation already covers, and stop saying "no public price" for the rest. */
export function alignBudgetWithQuotation(budget: Record<string, unknown> | null | undefined, lines: QuotationLine[]): Record<string, unknown> {
  const source = budget || {};
  const items = Array.isArray(source.items) ? source.items : [];
  if (!lines.length) return { ...source, items };
  const covered = new Set(lines.map(line => line.category.toLowerCase()));
  const next = items.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const category = typeof row.category === 'string' ? row.category.toLowerCase() : '';
    if (covered.has(category) && row.source !== 'quotation') return [];
    if (row.source === 'quotation') return [row];
    const notes = typeof row.notes === 'string' ? row.notes : '';
    const replaced = notes.replace(/No public price found[^.]*/gi, NOT_IN_QUOTATION_NOTE);
    return [{
      ...row,
      notes: replaced.includes(NOT_IN_QUOTATION_NOTE) ? replaced : `${replaced} ${NOT_IN_QUOTATION_NOTE}`.trim(),
    }];
  });
  return { ...source, items: next };
}

/** Replace the "no public price" line when a confirmed quotation total exists. */
export function applyConfirmedQuotationNarrative(text: string, lines: QuotationLine[], contingencyPercent: number): string {
  if (!lines.length) return text;
  const totals = quotationGrandTotal(lines, contingencyPercent);
  const sentence = `Confirmed quotation subtotal IDR ${totals.subtotal.toLocaleString('en-US')}. Contingency ${parseContingencyPercent(contingencyPercent)}% is IDR ${totals.contingency.toLocaleString('en-US')}. Confirmed grand total IDR ${totals.total.toLocaleString('en-US')}.`;
  const replaced = text.replace(/No public price found[^.]*\./gi, sentence);
  return /Confirmed quotation subtotal/i.test(replaced) ? replaced : `${replaced.trim()}\n\n${sentence}`.trim();
}

export function mergeQuotedBudget(aiBudget: Record<string, unknown> | null | undefined, lines: QuotationLine[], contingencyPercent: number): Record<string, unknown> {
  const confirmed = lines.map(line => ({
    category: line.category,
    estimatedCost: line.currency === 'IDR' ? line.total : null,
    suggestedVendor: line.vendor || 'Quoted vendor',
    venue: '',
    sourceUrl: null,
    source: 'quotation' as const,
    notes: `Confirmed quotation. ${line.item}. Qty ${line.qty} × ${line.currency} ${line.unitPrice} = ${line.currency} ${line.total}.${line.notes ? ` ${line.notes}` : ''}`,
  }));
  const aligned = lines.length ? alignBudgetWithQuotation(aiBudget, lines) : (aiBudget || {});
  const estimates: Array<Record<string, unknown> & { source: 'estimate'; estimatedCost?: unknown }> = (Array.isArray(aligned.items) ? aligned.items : []).map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return { ...row, source: 'estimate' as const };
  });
  const totals = quotationGrandTotal(lines, contingencyPercent);
  const estimateSum = estimates.reduce((sum, item) => sum + (typeof item.estimatedCost === 'number' ? item.estimatedCost : 0), 0);
  return {
    ...(aiBudget || {}),
    currency: 'IDR',
    items: [...confirmed, ...estimates],
    quotationSubtotal: totals.subtotal,
    contingencyPercent: parseContingencyPercent(contingencyPercent),
    contingency: lines.length ? totals.contingency : aiBudget?.contingency ?? null,
    quotationTotal: lines.length ? totals.total : null,
    total: lines.length ? totals.total + estimateSum : aiBudget?.total ?? null,
  };
}
