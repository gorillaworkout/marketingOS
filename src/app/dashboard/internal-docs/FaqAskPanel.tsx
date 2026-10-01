'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Button, Panel, StatusBadge, TextArea, TextInput } from '@/components/ui/dashboard';
import { guideHighlightNeedle, internalDocFilePath } from '@/lib/internal-docs-reader';
import { FaqWorking } from './FaqFeedback';
import { askHistorySnippet, earlierAskTurns, faqAskHistoryEntries, visibleAskMessages } from './faq-ask-history';
import { revealOpenGuide } from './reveal-guide';

export const ASK_EXAMPLES = [
  'Where is the visitor wifi password?',
  'How do I reset the badge printer?',
  'What is the leave request process?',
];

export interface FaqCitation {
  documentId: string;
  title: string;
  url: string;
  excerpt: string;
  extension?: string;
  images?: string[];
}

export interface FaqAskMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: FaqCitation[];
  confidence?: 'high' | 'low' | 'none';
}

const sourceLinkClass = 'inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-xs font-medium text-[var(--mos-text)] hover:border-[var(--mos-border-strong)]';

export function citationDocumentHref(citation: Pick<FaqCitation, 'documentId' | 'excerpt'>): string {
  const highlight = guideHighlightNeedle(citation.excerpt);
  if (!highlight) return `/dashboard/internal-docs/${citation.documentId}`;
  return `/dashboard/internal-docs/${citation.documentId}?highlight=${encodeURIComponent(highlight)}`;
}

export function citationFileLink(citation: Pick<FaqCitation, 'documentId' | 'extension'>): { href: string; label: string; testId: 'faq-open-pdf' | 'faq-open-file' } | null {
  const extension = (citation.extension || '').trim().toLowerCase();
  if (!citation.documentId || !extension) return null;
  if (extension === '.pdf') {
    return { href: internalDocFilePath(citation.documentId, true), label: 'Open PDF', testId: 'faq-open-pdf' };
  }
  return { href: internalDocFilePath(citation.documentId, false), label: 'Open file', testId: 'faq-open-file' };
}

function CitationCard({ citation }: { citation: FaqCitation }) {
  const file = citationFileLink(citation);
  return (
    <li data-testid="faq-citation" className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-3">
      <Link
        data-testid="faq-citation-link"
        href={citationDocumentHref(citation)}
        scroll={false}
        onClick={() => { revealOpenGuide(citation.documentId); }}
        className="text-sm font-medium text-[var(--mos-accent-soft)] underline decoration-[var(--mos-accent-border)] underline-offset-2 hover:text-white"
      >
        {citation.title}
      </Link>
      {citation.excerpt && (
        <p data-testid="faq-answer-excerpt" className="mt-2 text-sm leading-6 text-[var(--mos-text-secondary)]">{citation.excerpt}</p>
      )}
      {file && (
        <a
          data-testid={file.testId}
          href={file.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-3 ${sourceLinkClass}`}
        >
          {file.label}
        </a>
      )}
    </li>
  );
}

export function FaqAskPanel({
  messages,
  input,
  asking,
  error,
  onInputChange,
  onSubmit,
}: {
  messages: FaqAskMessage[];
  input: string;
  asking: boolean;
  error: string;
  onInputChange: (value: string) => void;
  onSubmit: (question: string) => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(input);
  };
  const [historyQuery, setHistoryQuery] = useState('');
  const [opened, setOpened] = useState<{ length: number; index: number } | null>(null);
  const focusedIndex = opened && opened.length === messages.length ? opened.index : null;
  const visible = visibleAskMessages(messages, focusedIndex);
  const earlier = earlierAskTurns(messages);
  const history = faqAskHistoryEntries(messages, historyQuery);

  const openHistory = (index: number) => {
    setOpened({ length: messages.length, index });
    document.getElementById('faq-ask-thread')?.scrollIntoView({ block: 'start' });
  };

  return (
    <Panel id="faq-ask" data-testid="faq-ask">
      <h2 className="text-sm font-[560] text-[var(--mos-text)]">Ask</h2>
      {messages.length === 0 ? (
        <div className="mt-3">
          <p className="text-lg font-[560] tracking-[-0.03em] text-[var(--mos-text)]">Ask anything about company guides</p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--mos-text-muted)]">
            Answers use only the documents you are allowed to read. Open a source link to read the guide or PDF.
          </p>
          <div data-testid="faq-ask-examples" className="mt-3 flex flex-wrap gap-2">
            {ASK_EXAMPLES.map(example => (
              <Button key={example} size="sm" disabled={asking} onClick={() => onSubmit(example)}>
                {example}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">Answers use only the documents you are allowed to read.</p>
      )}
      <div id="faq-ask-thread" data-testid="faq-ask-thread" className="mt-4 space-y-3">
        {focusedIndex != null && (
          <div className="flex justify-end">
            <Button size="sm" data-testid="faq-ask-show-latest" onClick={() => setOpened(null)}>Show latest</Button>
          </div>
        )}
        {visible.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            data-testid="faq-ask-message"
            className={message.role === 'user'
              ? 'text-sm text-[var(--mos-text)]'
              : 'rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] p-3 text-sm leading-6 text-[var(--mos-text-secondary)]'}
          >
            {message.confidence === 'low' && (
              <p className="mb-2">
                <StatusBadge tone="warning">Low confidence</StatusBadge>
              </p>
            )}
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.citations && message.citations.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--mos-text-faint)]">Sources</p>
                <ul className="mt-2 space-y-2">
                  {message.citations.map(citation => (
                    <CitationCard key={`${citation.documentId}-${citation.extension || ''}`} citation={citation} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        {asking && (
          <div data-testid="faq-ask-loading" className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] p-3">
            <FaqWorking compact label="Looking through documents" />
            <div className="mt-3 animate-pulse space-y-2" aria-hidden="true">
              <div className="h-2 w-full rounded bg-white/10" />
              <div className="h-2 w-4/5 rounded bg-white/[0.06]" />
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
      </div>
      {earlier.length > 0 && (
        <div data-testid="faq-ask-history" className="mt-4 border-t border-[var(--mos-border-subtle)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-[560] text-[var(--mos-text)]">History Search</h3>
            <p className="text-[11px] text-[var(--mos-text-faint)]">
              {historyQuery.trim()
                ? `${history.length} ${history.length === 1 ? 'match' : 'matches'}`
                : `${earlier.length} ${earlier.length === 1 ? 'earlier question' : 'earlier questions'}`}
            </p>
          </div>
          <TextInput
            value={historyQuery}
            onChange={event => setHistoryQuery(event.target.value)}
            placeholder="Search past questions"
            aria-label="History Search"
            className="mt-2"
          />
          {history.length === 0 ? (
            <p data-testid="faq-ask-history-empty" className="mt-3 text-xs text-[var(--mos-text-muted)]">No matching questions</p>
          ) : (
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto" aria-label="Earlier questions">
              {history.map(turn => (
                <li key={turn.index}>
                  <button
                    type="button"
                    data-testid="faq-ask-history-item"
                    data-turn-index={turn.index}
                    aria-current={focusedIndex === turn.index ? 'true' : undefined}
                    onClick={() => openHistory(turn.index)}
                    className={`flex w-full flex-col items-start rounded-[var(--mos-radius-control)] px-3 py-2 text-left hover:bg-white/[0.04] ${focusedIndex === turn.index ? 'bg-white/[0.05]' : ''}`}
                  >
                    <span className="line-clamp-2 text-sm text-[var(--mos-text)]">{turn.question || askHistorySnippet(turn.answer)}</span>
                    {turn.question && turn.answer && (
                      <span className="mt-0.5 line-clamp-1 text-xs text-[var(--mos-text-muted)]">{askHistorySnippet(turn.answer)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
        <TextArea
          value={input}
          onChange={event => onInputChange(event.target.value)}
          placeholder="Ask a question about the documents you can read"
          aria-label="Ask FAQ & Guides"
          className="min-h-24"
        />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={asking || !input.trim()}>Ask</Button>
        </div>
      </form>
    </Panel>
  );
}
