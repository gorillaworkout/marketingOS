'use client';

import { formatCoverageDate, formatRanges, type CoverageSummary } from '@/lib/monthly-report/coverage';

type CoveragePair = { onboarding: CoverageSummary; ftd: CoverageSummary };

const through = (summary: CoverageSummary) => (summary.through ? formatCoverageDate(summary.through) : 'no uploads yet');

/** "Onboarding data through 31 Oct 2026 · FTD data through 31 Oct 2026" (WIB days). */
export function DataThrough({ coverage, className }: { coverage: CoveragePair; className?: string }) {
  return (
    <p className={className ?? 'text-xs text-[var(--mos-text-muted)]'}>
      Onboarding data through <span className="font-medium text-[var(--mos-text-secondary)]">{through(coverage.onboarding)}</span>
      {' · '}
      FTD data through <span className="font-medium text-[var(--mos-text-secondary)]">{through(coverage.ftd)}</span>
      <span className="text-[var(--mos-text-faint)]"> (WIB)</span>
    </p>
  );
}

/** Amber notice listing the days in the selected range (up to today) that no upload covers. */
export function MissingDataNotice({ coverage, scope }: { coverage: CoveragePair; scope: string }) {
  const rows = ([['Onboarding', coverage.onboarding], ['FTD', coverage.ftd]] as const).filter(([, summary]) => summary.missingDays > 0);
  if (!rows.length) return null;
  return (
    <div role="status" className="rounded-[var(--mos-radius-control)] border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-200">
      <p className="font-medium">Missing data in {scope}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map(([label, summary]) => (
          <li key={label}>
            <span className="font-medium">{label}</span> ({summary.missingDays} {summary.missingDays === 1 ? 'day' : 'days'}): {formatRanges(summary.missing)}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-amber-200/80">These days show “No data” in charts and tables instead of 0. Upload or import the missing files to fill them.</p>
    </div>
  );
}
