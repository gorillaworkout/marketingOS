'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/dashboard';

/**
 * Small confirm dialog for destructive actions. Focus starts on Cancel so
 * Enter never deletes by accident. Escape or the backdrop cancels.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Delete',
  busy = false,
  busyLabel = 'Working…',
  error,
  onConfirm,
  onCancel,
  testId = 'confirm-dialog',
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  const onCancelRef = useRef(onCancel);
  const labelId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancelRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/70" onClick={() => { if (!busy) onCancelRef.current(); }} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelId}
        data-testid={testId}
        className="relative w-full max-w-md rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-bg)] p-5 shadow-[var(--mos-shadow-panel)]"
      >
        <h2 id={labelId} className="text-base font-medium text-[var(--mos-text)]">{title}</h2>
        {children && <div className="mt-2 text-sm text-[var(--mos-text-muted)]">{children}</div>}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button autoFocus data-testid={`${testId}-cancel`} onClick={() => onCancelRef.current()} disabled={busy}>Cancel</Button>
          <Button variant="danger" data-testid={`${testId}-confirm`} onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
