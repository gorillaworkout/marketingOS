'use client';

import Link from 'next/link';
import { FormEvent } from 'react';
import { Button, Panel, TextArea } from '@/components/ui/dashboard';
import { guideHighlightNeedle, internalDocFilePath, isInternalDocImagePath } from '@/lib/internal-docs-reader';

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
}

export function citationDocumentHref(citation: Pick<FaqCitation, 'documentId' | 'excerpt'>): string {
  const highlight = guideHighlightNeedle(citation.excerpt);
  if (!highlight) return `/dashboard/internal-docs/${citation.documentId}`;
  return `/dashboard/internal-docs/${citation.documentId}?highlight=${encodeURIComponent(highlight)}`;
}

function CitationCard({ citation }: { citation: FaqCitation }) {
  const isPdf = (citation.extension || '').toLowerCase() === '.pdf';
  const images = (citation.images || []).filter(isInternalDocImagePath).slice(0, 4);
  return (
    <li className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-3">
      <Link href={citationDocumentHref(citation)} className="text-sm font-medium text-[var(--mos-accent-soft)] hover:underline">
        {citation.title}
      </Link>
      {citation.excerpt && <p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">{citation.excerpt}</p>}
      {isPdf && (
        <div className="mt-3">
          <iframe
            data-testid="faq-answer-pdf"
            title={`${citation.title} PDF`}
            src={internalDocFilePath(citation.documentId, true)}
            className="h-80 w-full rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-white"
          />
          <a
            data-testid="faq-open-pdf"
            href={internalDocFilePath(citation.documentId, true)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-xs font-medium text-[var(--mos-text)] hover:border-[var(--mos-border-strong)]"
          >
            Open PDF
          </a>
        </div>
      )}
      {images.length > 0 && (
        <div className="mt-3 space-y-2">
          {images.map(src => (
            <img
              key={src}
              data-testid="faq-answer-image"
              src={src}
              alt={citation.title}
              className="max-h-80 w-full rounded-[var(--mos-radius-control)] bg-white object-contain"
            />
          ))}
        </div>
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

  return (
    <Panel data-testid="faq-ask">
      <h2 className="text-sm font-[560] text-[var(--mos-text)]">Ask</h2>
      {messages.length === 0 ? (
        <div className="mt-3">
          <p className="text-lg font-[560] tracking-[-0.03em] text-[var(--mos-text)]">Ask anything about company guides</p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--mos-text-muted)]">
            Answers use only the documents you are allowed to read. Open a citation to see the guide.
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
      <div className="mt-4 space-y-3">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={message.role === 'user'
              ? 'text-sm text-[var(--mos-text)]'
              : 'rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] p-3 text-sm leading-6 text-[var(--mos-text-secondary)]'}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.citations && message.citations.length > 0 && (
              <ul className="mt-3 space-y-2">
                {message.citations.map(citation => (
                  <CitationCard key={`${citation.documentId}-${citation.extension || ''}`} citation={citation} />
                ))}
              </ul>
            )}
          </div>
        ))}
        {asking && <p className="text-xs text-[var(--mos-text-muted)]">Looking through documents</p>}
        {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
      </div>
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
