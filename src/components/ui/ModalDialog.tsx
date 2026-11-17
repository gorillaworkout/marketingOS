'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Large, focus-trapped dialog. Full-screen sheet on small screens; a max-width
 * panel with a scrollable body on desktop. Close via the X, Escape, or backdrop.
 */
export function ModalDialog({
  open,
  title,
  onClose,
  children,
  testId = 'modal-dialog',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const labelId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        item => !item.hasAttribute('disabled') && item.tabIndex !== -1,
      );
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      <div data-testid={`${testId}-backdrop`} className="absolute inset-0 bg-black/70" onClick={() => onCloseRef.current()} />
      <div className="relative flex h-full items-stretch justify-center md:items-center md:p-4" onClick={() => onCloseRef.current()}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          tabIndex={-1}
          data-testid={testId}
          onClick={event => event.stopPropagation()}
          className="relative flex h-full w-full max-w-full flex-col overflow-hidden bg-[var(--mos-bg)] shadow-[var(--mos-shadow-panel)] outline-none md:h-auto md:max-h-[min(56rem,calc(100vh-2rem))] md:max-w-5xl md:rounded-[var(--mos-radius-panel)] md:border md:border-[var(--mos-border)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--mos-border)] px-4 py-3">
            <h2 id={labelId} className="min-w-0 truncate text-lg font-medium text-[var(--mos-text)]">{title}</h2>
            <button
              type="button"
              aria-label="Close"
              data-testid={`${testId}-close`}
              onClick={() => onCloseRef.current()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--mos-radius-control)] text-xl leading-none text-[var(--mos-text-faint)] hover:bg-white/[0.04] hover:text-[var(--mos-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)]"
            >
              ×
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4" data-testid={`${testId}-body`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
