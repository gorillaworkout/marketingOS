import { StatusBadge } from '@/components/ui/dashboard';

/** A missing source. Never a zero. */
export function PendingChip({ reason, children = 'Pending' }: { reason?: string; children?: string }) {
  return (
    <span data-pending="true" title={reason}>
      <StatusBadge tone="warning" dot>{children}</StatusBadge>
    </span>
  );
}
