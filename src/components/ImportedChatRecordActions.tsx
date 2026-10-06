'use client';

import { useEffect, useState } from 'react';
import { importListActions, type ImportUiStatus } from '@/lib/chat-import-ui';

const ACTION_LABEL = {
  view: 'View chat',
  review: 'Review facts',
  retry: 'Retry extract',
} as const;

export function ImportedChatRecordActions({
  importId,
  onView,
  onReview,
  onRetry,
}: {
  importId: string;
  onView: () => void;
  onReview: () => void;
  onRetry: () => void;
}) {
  const [status, setStatus] = useState<ImportUiStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai-research/imports', { cache: 'no-store' })
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) return null;
        const rows = Array.isArray(payload.imports) ? payload.imports : [];
        return rows.find((item: { id?: string; status?: ImportUiStatus }) => item.id === importId) || null;
      })
      .then(row => {
        const status = row?.status;
        const known = status === 'review' || status === 'extract_failed' || status === 'approved' || status === 'chat_only';
        if (!cancelled) setStatus(known ? status : null);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => { cancelled = true; };
  }, [importId]);

  if (!status) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {importListActions(status).map(action => (
        <button
          key={action}
          type="button"
          onClick={action === 'view' ? onView : action === 'review' ? onReview : onRetry}
          className="rounded-lg border border-[var(--mos-border)] px-2.5 py-1.5 text-[11px] text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
        >
          {ACTION_LABEL[action]}
        </button>
      ))}
    </div>
  );
}
