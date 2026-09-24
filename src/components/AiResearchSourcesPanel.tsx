'use client';

import type { ReactNode } from 'react';
import { sanitizeHref } from '@/lib/ai-research-markdown';
import {
  RESEARCH_IDLE_COPY,
  RESEARCH_STATUS_COPY,
  inspectorSourceHost,
  type InspectorResearchSource,
  type ResearchGatherStatus,
  type ResearchOriginChip,
  type ResearchTraceKind,
} from '@/lib/ai-research-inspector';

const ORIGIN_CHIP_LABEL: Record<ResearchOriginChip, string> = {
  official: 'Official',
  indonesia: 'Indonesia',
  international: 'International',
};

const ORIGIN_CHIP_CLASS: Record<ResearchOriginChip, string> = {
  official: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  indonesia: 'border-indigo-400/25 bg-indigo-400/10 text-indigo-300',
  international: 'border-white/[0.08] bg-white/[0.04] text-[var(--mos-text-muted)]',
};

const TRACE_LABEL: Record<ResearchTraceKind, string> = {
  person_fact: 'PERSON_FACT',
  other_public_trace: 'OTHER_PUBLIC_TRACE',
};

const TRACE_HINT: Record<ResearchTraceKind, string> = {
  person_fact: 'Official Dupoin/Bappebti roster',
  other_public_trace: 'Other public trace — not necessarily the same person',
};

const TRACE_CLASS: Record<ResearchTraceKind, string> = {
  person_fact: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  other_public_trace: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
};

function Chip({
  className,
  children,
  title,
}: {
  className: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 items-center whitespace-nowrap rounded-md border px-1.5 text-[9px] font-semibold uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

function SourceCard({
  source,
  pinned,
  onTogglePin,
}: {
  source: InspectorResearchSource;
  pinned: boolean;
  onTogglePin: (url: string) => void;
}) {
  const href = sanitizeHref(source.url);
  const host = inspectorSourceHost(source.url);

  return (
    <article
      className={`rounded-xl border px-3 py-2.5 ${
        pinned
          ? 'border-indigo-400/35 bg-indigo-500/10'
          : source.traceKind === 'person_fact'
            ? 'border-emerald-400/20 bg-emerald-400/[0.04]'
            : source.traceKind === 'other_public_trace'
              ? 'border-amber-400/15 bg-amber-400/[0.04]'
              : 'border-[var(--mos-border)] bg-[var(--mos-raised)]'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[12px] font-medium leading-4 text-[var(--mos-text)] hover:text-indigo-300 break-words"
            >
              {source.title}
            </a>
          ) : (
            <p className="text-[12px] font-medium leading-4 text-[var(--mos-text)] break-words">{source.title}</p>
          )}
          <p className="mt-0.5 truncate text-[10px] text-[var(--mos-text-faint)]">{host}</p>
        </div>
        <button
          type="button"
          onClick={() => onTogglePin(source.url)}
          aria-pressed={pinned}
          title={pinned ? 'Unpin' : 'Pin this source'}
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border transition-colors ${
            pinned
              ? 'border-indigo-400/40 bg-indigo-500/20 text-indigo-200'
              : 'border-[var(--mos-border)] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] hover:bg-[var(--mos-hover)]'
          }`}
        >
          <span className="sr-only">{pinned ? 'Unpin' : 'Pin'}</span>
          <svg className="h-3.5 w-3.5" fill={pinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 3v6.5a4 4 0 01-1.2 2.85L12 15l-2.8-2.65A4 4 0 018 9.5V3h8zM8 3h8M12 15v6" />
          </svg>
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Chip className={ORIGIN_CHIP_CLASS[source.originChip]}>{ORIGIN_CHIP_LABEL[source.originChip]}</Chip>
        {source.traceKind && (
          <Chip className={TRACE_CLASS[source.traceKind]} title={TRACE_HINT[source.traceKind]}>
            {TRACE_LABEL[source.traceKind]}
          </Chip>
        )}
        {pinned && <Chip className="border-indigo-400/30 bg-indigo-400/10 text-indigo-200">Pinned</Chip>}
      </div>
      {source.snippet ? (
        <p className="mt-2 text-[11px] leading-4 text-[var(--mos-text-muted)] break-words">{source.snippet}</p>
      ) : (
        <p className="mt-2 text-[11px] italic leading-4 text-[var(--mos-text-faint)]">No excerpt — open the URL to check the source.</p>
      )}
    </article>
  );
}

export function AiResearchSourcesPanel({
  open,
  onClose,
  sources,
  grounding,
  pinnedUrls,
  onTogglePin,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  sources: InspectorResearchSource[];
  grounding: ResearchGatherStatus | null;
  pinnedUrls: string[];
  onTogglePin: (url: string) => void;
  loading: boolean;
}) {
  const pinned = new Set(pinnedUrls);
  const copy = grounding ? RESEARCH_STATUS_COPY[grounding] : null;
  const title = copy?.title || 'Sources used';
  const pinnedCount = sources.filter(source => pinned.has(source.url)).length;

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close sources panel"
          onClick={onClose}
          className="absolute inset-0 z-20 bg-black/50 md:hidden"
        />
      )}
      <aside
        aria-label="Sources used"
        className={`absolute inset-y-0 right-0 z-30 flex w-[min(100vw,20rem)] flex-col border-l border-[var(--mos-border)] bg-[var(--mos-bg)] shadow-2xl transition-transform duration-200 md:static md:z-0 md:h-full md:shadow-none ${
          open ? 'translate-x-0' : 'translate-x-full md:translate-x-0 pointer-events-none md:pointer-events-auto'
        } ${open ? 'md:w-80 md:pointer-events-auto' : 'md:w-0 md:border-l-0 md:overflow-hidden'}`}
      >
        <div className={`${open ? 'flex' : 'hidden md:flex'} h-full min-h-0 flex-col ${open ? '' : 'md:hidden'}`}>
          <div className="flex items-start justify-between gap-2 border-b border-[var(--mos-border)] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--mos-text)]">{title}</p>
              <p className="mt-0.5 text-[10px] leading-4 text-[var(--mos-text-muted)]">
                {copy?.body || RESEARCH_IDLE_COPY}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[var(--mos-text-muted)] hover:bg-[var(--mos-hover)] hover:text-[var(--mos-text)]"
              title="Close"
            >
              <span className="sr-only">Close sources panel</span>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 border-b border-[var(--mos-border-subtle)] px-3 py-1.5 text-[10px] text-[var(--mos-text-faint)]">
            <span>{sources.length} source{sources.length === 1 ? '' : 's'}{pinnedCount ? ` · ${pinnedCount} pinned` : ''}</span>
            {grounding === 'ok' && (
              <span className="text-[9px] uppercase tracking-wide text-emerald-300/80">Complete</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading && sources.length === 0 && !grounding && (
              <p className="px-1 py-6 text-center text-[11px] text-[var(--mos-text-muted)]">Collecting sources…</p>
            )}
            {!loading && !grounding && sources.length === 0 && (
              <p className="px-1 py-6 text-center text-[11px] text-[var(--mos-text-muted)]">{RESEARCH_IDLE_COPY}</p>
            )}
            {grounding === 'failed' && (
              <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2.5 text-[11px] leading-4 text-red-200">
                {RESEARCH_STATUS_COPY.failed.body}
              </div>
            )}
            {grounding === 'empty' && (
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-[11px] leading-4 text-amber-100">
                {RESEARCH_STATUS_COPY.empty.body}
              </div>
            )}
            {grounding === 'skipped' && (
              <div className="rounded-xl border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 py-2.5 text-[11px] leading-4 text-[var(--mos-text-muted)]">
                {RESEARCH_STATUS_COPY.skipped.body}
              </div>
            )}
            {sources.map((source, index) => (
              <SourceCard
                key={`${source.url}-${index}`}
                source={source}
                pinned={pinned.has(source.url)}
                onTogglePin={onTogglePin}
              />
            ))}
          </div>
          {pinnedCount > 0 && (
            <p className="border-t border-[var(--mos-border-subtle)] px-3 py-2 text-[9px] leading-4 text-[var(--mos-text-faint)]">
              Pinned sources are sent again on the next turn so the model prioritizes them. The panel still shows every trace.
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
