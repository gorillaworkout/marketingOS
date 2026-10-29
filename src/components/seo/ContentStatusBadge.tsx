import { StatusBadge } from '@/components/ui/dashboard';
import type { ContentStatus } from '@/lib/seo/content-status';

export const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'Draft', review: 'In review', approved: 'Approved', queued: 'Queued', published: 'Published',
};

const TONES: Record<ContentStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', review: 'warning', approved: 'info', queued: 'info', published: 'success',
};

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return <StatusBadge tone={TONES[status]} dot>{STATUS_LABELS[status]}</StatusBadge>;
}
