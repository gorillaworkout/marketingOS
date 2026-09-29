'use client';

import { EmptyState, Panel } from '@/components/ui/dashboard';
import { guideCardAsk } from '@/lib/internal-docs-cards';
import { FaqCardSkeleton, FaqWorking } from './FaqFeedback';

export interface FaqGuideCardDocument {
  id: string;
  title: string;
  summary: string;
  extension: string;
  status: 'pending' | 'indexed' | 'failed';
}

export function FaqGuideCards({
  documents,
  loading,
  error,
  search,
  asking,
  askingId,
  onAsk,
}: {
  documents: FaqGuideCardDocument[];
  loading: boolean;
  error: string;
  search: string;
  asking: boolean;
  askingId: string;
  onAsk: (request: { question: string; documentId: string }) => void;
}) {
  const cards = documents.filter(document => document.status === 'indexed');
  const searching = search.trim().length > 0;

  return (
    <Panel data-testid="faq-guide-cards" aria-busy={loading || asking ? 'true' : 'false'}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-[560] text-[var(--mos-text)]">Guides</h2>
        {loading && documents.length > 0 && (
          <FaqWorking compact label="Updating guides" testId="faq-guide-cards-refresh" />
        )}
      </div>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--mos-text-muted)]">
        Choose a guide to see what it covers. You do not need to type a question.
      </p>
      {loading && documents.length === 0 && !error && <FaqCardSkeleton />}
      {!loading && error && cards.length === 0 && (
        <p className="mt-4 text-xs text-red-300" role="alert">{error}</p>
      )}
      {!loading && !error && cards.length === 0 && (
        <div data-testid="faq-guide-cards-empty">
          <EmptyState
            title={searching ? 'No matching guides' : 'No guides yet'}
            description={searching ? 'Try another title or phrase.' : 'Guides you can read will appear here.'}
          />
        </div>
      )}
      {cards.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Guides you can ask about">
          {cards.map(document => {
            const active = asking && askingId === document.id;
            const extension = document.extension.replace('.', '').toUpperCase();
            return (
              <li key={document.id}>
                <button
                  type="button"
                  data-testid="faq-guide-card"
                  data-document-id={document.id}
                  data-active={active ? 'true' : 'false'}
                  disabled={asking}
                  onClick={() => onAsk(guideCardAsk(document))}
                  className={`flex h-full w-full flex-col items-start rounded-[var(--mos-radius-control)] border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? 'border-[var(--mos-accent)] bg-[var(--mos-accent)]/10' : 'border-[var(--mos-border)] bg-[var(--mos-raised)] hover:border-[var(--mos-border-strong)]'}`}
                >
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--mos-text)]">{document.title}</span>
                    {extension && <span className="shrink-0 text-[11px] uppercase tracking-wide text-[var(--mos-text-faint)]">{extension}</span>}
                  </span>
                  <span className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--mos-text-muted)]">
                    {document.summary || 'Ask what this guide covers.'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
