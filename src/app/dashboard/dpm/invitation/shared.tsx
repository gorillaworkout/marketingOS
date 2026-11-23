// src/app/dashboard/dpm/invitation/shared.tsx
'use client';
import { StatusBadge } from '@/components/ui/dashboard';
import type { PresentedEvent } from '@/lib/dpm-invitation/present';

export const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp';

export function InvitationStatusBadge({ event }: { event: Pick<PresentedEvent, 'isOpen' | 'closedReason'> }) {
  if (event.isOpen) return <StatusBadge tone="success" dot>{'Open'}</StatusBadge>;
  if (event.closedReason === 'auto') return <StatusBadge tone="warning" dot>{'Closed automatically'}</StatusBadge>;
  return <StatusBadge tone="neutral" dot>{'Closed'}</StatusBadge>;
}

export async function readJson<T>(response: Response): Promise<T & { error?: string; field?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string; field?: string };
}
