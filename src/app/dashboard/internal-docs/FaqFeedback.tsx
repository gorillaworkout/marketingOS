export function FaqWorking({
  label,
  testId,
  compact = false,
}: {
  label: string;
  testId?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={compact
        ? 'flex items-center gap-2 text-xs text-[var(--mos-text-muted)]'
        : 'flex items-center gap-2 px-4 py-6 text-xs text-[var(--mos-text-muted)]'}
    >
      <span
        aria-hidden="true"
        className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--mos-border-strong)] border-t-[var(--mos-accent)]"
      />
      <span>{label}</span>
    </div>
  );
}

export function FaqListSkeleton() {
  return (
    <div data-testid="internal-docs-list-loading" role="status" aria-live="polite" aria-busy="true" className="px-4 py-5">
      <FaqWorking label="Loading documents" compact />
      <div className="mt-4 space-y-3" aria-hidden="true">
        {[0, 1, 2, 3].map(row => (
          <div key={row} className="animate-pulse space-y-2 rounded-[var(--mos-radius-control)] border border-[var(--mos-border-subtle)] px-3 py-3">
            <div className="h-3 w-3/5 rounded bg-white/10" />
            <div className="h-2 w-2/5 rounded bg-white/[0.06]" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FaqCardSkeleton() {
  return (
    <div data-testid="faq-guide-cards-loading" role="status" aria-live="polite" aria-busy="true" className="mt-4">
      <FaqWorking label="Loading guides" compact />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map(row => (
          <div key={row} className="animate-pulse space-y-2 rounded-[var(--mos-radius-control)] border border-[var(--mos-border-subtle)] px-4 py-3">
            <div className="h-3 w-3/5 rounded bg-white/10" />
            <div className="h-2 w-full rounded bg-white/[0.06]" />
            <div className="h-2 w-4/5 rounded bg-white/[0.06]" />
          </div>
        ))}
      </div>
    </div>
  );
}
