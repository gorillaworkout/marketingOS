import type { ReactNode } from 'react';

export function ReportSectionHeader({ id, number, title, description, action }: {
  id?: string;
  number?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div id={id} className="mb-4 flex scroll-mt-24 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2.5 text-[15px] font-[560] tracking-[-0.01em] text-[var(--mos-text)]">
          {number && <span className="text-[11px] font-medium tabular-nums text-[var(--mos-text-faint)]">{number}</span>}
          {title}
        </h2>
        {description && <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}
