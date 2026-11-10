import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { formatIdr, formatUsd } from '@/lib/settlement/format';

export const tableClass = 'w-full border-collapse text-[12.5px] tabular-nums';
const thBase = 'sticky top-0 border-b border-[var(--mos-border)] bg-[var(--mos-surface)] px-3.5 py-2 text-[11.5px] font-medium whitespace-nowrap text-[var(--mos-text-muted)]';
const tdBase = 'border-b border-[var(--mos-border-subtle)] px-3.5 py-2 whitespace-nowrap text-[var(--mos-text-secondary)]';

export function Th({ align = 'left', className = '', children, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' }) {
  return <th scope="col" className={`${thBase} ${align === 'right' ? 'text-right' : 'text-left'} ${className}`} {...props}>{children}</th>;
}

export function GroupHeader({ children, span, align = 'center' }: { children: ReactNode; span: number; align?: 'left' | 'center' }) {
  return <th scope="colgroup" colSpan={span} className={`border-b border-[var(--mos-border-subtle)] bg-[var(--mos-panel)] px-3.5 py-1.5 text-[10.5px] font-medium tracking-[0.1em] uppercase text-[var(--mos-text-faint)] ${align === 'left' ? 'text-left' : 'text-center'}`}>{children}</th>;
}

export function Td({ className = '', children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`${tdBase} ${className}`} {...props}>{children}</td>;
}

export function NumTd({ children = null, className = '', tone }: { children?: ReactNode; className?: string; tone?: 'neg' | 'pos' | 'auto' }) {
  const text = typeof children === 'string' ? children : '';
  const negative = tone === 'neg' || (tone === 'auto' && text.startsWith('−'));
  const positive = tone === 'pos';
  return <td className={`${tdBase} text-right ${negative ? 'text-[#f08a8a]' : ''} ${positive ? 'text-[#6fd3a5]' : ''} ${className}`}>{children}</td>;
}

export function Money({ value, currency, sign }: { value: number | null | undefined; currency: 'IDR' | 'USD'; sign?: 'neg' | 'pos' | 'auto' }) {
  if (value === null || value === undefined) return <>—</>;
  const text = currency === 'IDR' ? formatIdr(value) : formatUsd(value);
  const negative = value < 0;
  const className = sign === 'pos' && value > 0 ? 'text-[#6fd3a5]' : sign === 'auto' || sign === 'neg' ? (negative ? 'text-[#f08a8a]' : '') : negative ? 'text-[#f08a8a]' : '';
  return <span className={className} data-currency={currency}>{text}</span>;
}
