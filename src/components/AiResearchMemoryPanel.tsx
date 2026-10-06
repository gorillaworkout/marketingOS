'use client';

import { useEffect, useState } from 'react';
import { AiResearchImportModal } from '@/components/AiResearchImportModal';
import { AiResearchMarkdown } from '@/components/AiResearchMarkdown';
import { IMPORT_SOURCE_LABEL, IMPORT_STATUS_LABEL, importDateLabel, importListActions } from '@/lib/chat-import-ui';

export type AiResearchMemoryKind = 'role' | 'interest' | 'preference' | 'style' | 'context';

export type AiResearchMemoryItem = {
  id: string;
  kind: AiResearchMemoryKind;
  content: string;
  mentionCount: number;
  confidence: number;
  updatedAt: string;
};

export type AiResearchPriorQuestion = {
  conversationId: string | null;
  question: string;
  date: string;
  score: number;
};

type ImportedChatStatus = 'review' | 'extract_failed' | 'approved' | 'chat_only';
type ImportedChatSource = 'codex' | 'claude' | 'text';
type ImportedChatListItem = {
  id: string;
  title: string;
  status: ImportedChatStatus;
  source: ImportedChatSource;
  parserFallback: boolean;
  createdAt: string;
  knowledgeEntryId: string | null;
};

const KIND_ORDER: AiResearchMemoryKind[] = ['role', 'interest', 'preference', 'style', 'context'];
const KIND_LABEL: Record<AiResearchMemoryKind, string> = {
  role: 'Role',
  interest: 'Interests',
  preference: 'Preferences',
  style: 'Style',
  context: 'Context',
};

export function priorQuestionChipText(date: string): string {
  return `You asked something similar on ${date} — View answer`;
}

export function AiResearchPriorQuestionChip({
  match,
  onView,
}: {
  match: AiResearchPriorQuestion;
  onView: (conversationId: string) => void;
}) {
  if (!match.conversationId) {
    return (
      <p className="mb-1.5 text-[11px] text-[var(--mos-text-muted)]" data-testid="ai-research-memory-chip">
        {`You asked something similar on ${match.date}`}
      </p>
    );
  }
  return (
    <button
      type="button"
      data-testid="ai-research-memory-chip"
      onClick={() => onView(match.conversationId as string)}
      className="mb-1.5 inline-flex max-w-full items-center rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-1 text-left text-[11px] text-indigo-100 hover:bg-indigo-500/20"
    >
      {priorQuestionChipText(match.date)}
    </button>
  );
}

export function AiResearchPriorPreview({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ai-research/chat?id=${encodeURIComponent(conversationId)}`)
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Could not open that answer');
        return payload as { messages?: Array<{ role?: string; content?: string }> };
      })
      .then(payload => {
        if (cancelled) return;
        const rows = Array.isArray(payload.messages)
          ? payload.messages.flatMap(item => {
            if (item?.role !== 'user' && item?.role !== 'assistant') return [];
            return [{ role: item.role, content: typeof item.content === 'string' ? item.content : '' }];
          })
          : [];
        setMessages(rows);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not open that answer');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [conversationId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="ai-research-prior-preview">
      <button type="button" aria-label="Close earlier answer" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative flex max-h-[min(80vh,40rem)] w-[min(100vw,40rem)] flex-col overflow-hidden rounded-t-2xl border border-[var(--mos-border)] bg-[var(--mos-bg)] shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--mos-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--mos-text)]">Earlier answer</h2>
            <p className="mt-0.5 text-[11px] text-[var(--mos-text-muted)]">Your current chat stays open.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[11px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
          {loading && <p className="text-[11px] text-[var(--mos-text-muted)]">Loading the earlier answer…</p>}
          {error && <p className="text-[11px] text-amber-200">{error}</p>}
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className="rounded-xl border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 py-2">
              <p className="text-[10px] font-semibold text-[var(--mos-text-muted)]">{message.role === 'user' ? 'You' : 'Dupoin AI'}</p>
              <div className="mt-1 text-xs leading-5 text-[var(--mos-text)]">
                {message.role === 'assistant' ? <AiResearchMarkdown text={message.content} /> : <p className="whitespace-pre-wrap">{message.content}</p>}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function AiResearchMemoryPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [memories, setMemories] = useState<AiResearchMemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState('');
  const [deleteArmed, setDeleteArmed] = useState('');
  const [clearArmed, setClearArmed] = useState(false);
  const [imports, setImports] = useState<ImportedChatListItem[]>([]);
  const [importStart, setImportStart] = useState<
    { kind: 'new' } | { kind: 'existing'; id: string; intent: 'view' | 'review' | 'retry' } | null
  >(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ai-research/memory', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not load memory');
      setEnabled(payload.enabled !== false);
      setMemories(Array.isArray(payload.memories) ? payload.memories : []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load memory');
    } finally {
      setLoading(false);
    }
  };

  const loadImports = async () => {
    try {
      const response = await fetch('/api/ai-research/imports', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not load imports');
      setImports(Array.isArray(payload.imports) ? payload.imports : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load imports');
    }
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void load(); void loadImports(); }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const toggle = async () => {
    setBusy('toggle');
    setError('');
    try {
      const response = await fetch('/api/ai-research/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not update memory');
      setEnabled(payload.enabled !== false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update memory');
    } finally {
      setBusy('');
    }
  };

  const saveEdit = async (id: string) => {
    setBusy(`${id}:save`);
    setError('');
    try {
      const response = await fetch('/api/ai-research/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, content: draft }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not update memory');
      if (payload.memory) {
        setMemories(current => current.map(item => item.id === id ? payload.memory as AiResearchMemoryItem : item));
      }
      setEditingId('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update memory');
    } finally {
      setBusy('');
    }
  };

  const remove = async (id: string) => {
    setBusy(`${id}:delete`);
    setError('');
    try {
      const response = await fetch(`/api/ai-research/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not delete memory');
      setMemories(current => current.filter(item => item.id !== id));
      setDeleteArmed('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete memory');
    } finally {
      setBusy('');
    }
  };

  const clearAll = async () => {
    setBusy('clear');
    setError('');
    try {
      const response = await fetch('/api/ai-research/memory?all=1', { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not clear memory');
      setMemories([]);
      setClearArmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear memory');
    } finally {
      setBusy('');
    }
  };

  const grouped = KIND_ORDER.map(kind => ({
    kind,
    label: KIND_LABEL[kind],
    items: memories.filter(item => item.kind === kind),
  })).filter(group => group.items.length > 0);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" data-testid="ai-research-memory-panel">
      <button type="button" aria-label="Close memory" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <aside className="relative flex h-full min-h-0 w-[min(100vw,24rem)] flex-col overflow-hidden border-l border-[var(--mos-border)] bg-[var(--mos-bg)] shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--mos-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--mos-text)]">Memory</h2>
            <p className="mt-0.5 text-[11px] text-[var(--mos-text-muted)]">What Dupoin AI has learned about you</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[11px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]">
            Close
          </button>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--mos-border)] px-4 py-3">
          <div>
            <p className="text-xs font-medium text-[var(--mos-text)]">{enabled ? 'Memory is on' : 'Memory is off'}</p>
            <p className="mt-0.5 text-[10px] leading-4 text-[var(--mos-text-muted)]">
              {enabled
                ? 'New chats can use your role, interests, and earlier answers.'
                : 'Dupoin AI will not read or save what it learns until you turn this back on.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            data-testid="ai-research-memory-toggle"
            disabled={busy === 'toggle'}
            onClick={() => { void toggle(); }}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-[var(--mos-border)]'} disabled:opacity-50`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>
        <div className="flex shrink-0 border-b border-[var(--mos-border)] px-4 py-3">
          <button
            type="button"
            data-testid="ai-research-import-open"
            onClick={() => setImportStart({ kind: 'new' })}
            className="rounded-lg border border-[var(--mos-border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
          >
            Import chat
          </button>
        </div>
        {error && <p className="px-4 pt-2 text-[11px] text-amber-200">{error}</p>}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3">
          <div data-testid="ai-research-import-list" className="space-y-2">
            {imports.map(item => (
              <article key={item.id} className="rounded-xl border border-[var(--mos-border)] bg-[var(--mos-raised)] p-3">
                <p className="text-xs font-medium text-[var(--mos-text)]">{item.title}</p>
                <p className="mt-1 text-[10px] text-[var(--mos-text-muted)]">
                  {IMPORT_SOURCE_LABEL[item.source]} · {IMPORT_STATUS_LABEL[item.status]} · {importDateLabel(item.createdAt)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {importListActions(item.status).map(action => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => setImportStart({ kind: 'existing', id: item.id, intent: action })}
                      className="rounded-lg border border-[var(--mos-border)] px-2 py-1 text-[10px] text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
                    >
                      {action === 'view' ? 'View chat' : action === 'review' ? 'Review facts' : 'Retry extract'}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {loading && memories.length === 0 && <p className="text-[11px] text-[var(--mos-text-muted)]">Loading memory…</p>}
          {!loading && memories.length === 0 && (
            <p className="text-[11px] leading-5 text-[var(--mos-text-muted)]">
              No memories yet. Ask a few questions and Dupoin AI will learn your role, interests, and how you like answers.
            </p>
          )}
          {grouped.map(group => (
            <section key={group.kind}>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--mos-text-muted)]">{group.label}</h3>
              <div className="mt-1.5 space-y-2">
                {group.items.map(item => (
                  <article key={item.id} className="rounded-xl border border-[var(--mos-border)] bg-[var(--mos-raised)] p-3" data-testid="ai-research-memory-card">
                    {editingId === item.id ? (
                      <form onSubmit={event => { event.preventDefault(); void saveEdit(item.id); }} className="space-y-2">
                        <textarea
                          value={draft}
                          onChange={event => setDraft(event.target.value)}
                          aria-label="Edit memory"
                          maxLength={280}
                          rows={3}
                          className="w-full rounded-lg border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1.5 text-xs text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
                        />
                        <div className="flex gap-1.5">
                          <button type="submit" disabled={busy === `${item.id}:save`} className="rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white disabled:opacity-40">
                            Save
                          </button>
                          <button type="button" onClick={() => setEditingId('')} className="rounded-lg border border-[var(--mos-border)] px-2 py-1 text-[10px] text-[var(--mos-text)]">
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="text-xs leading-5 text-[var(--mos-text)]">{item.content}</p>
                        <p className="mt-1 text-[10px] text-[var(--mos-text-faint)]">
                          Mentioned {item.mentionCount} {item.mentionCount === 1 ? 'time' : 'times'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => { setEditingId(item.id); setDraft(item.content); setDeleteArmed(''); }}
                            className="rounded-lg border border-[var(--mos-border)] px-2 py-1 text-[10px] text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
                          >
                            Edit
                          </button>
                          {deleteArmed === item.id ? (
                            <button
                              type="button"
                              disabled={busy === `${item.id}:delete`}
                              onClick={() => { void remove(item.id); }}
                              className="rounded-lg bg-red-600 px-2 py-1 text-[10px] font-medium text-white"
                            >
                              Delete
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleteArmed(item.id)}
                              className="rounded-lg px-2 py-1 text-[10px] text-[var(--mos-text-muted)] hover:text-red-300"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="shrink-0 border-t border-[var(--mos-border)] px-4 py-3">
          {clearArmed ? (
            <div className="space-y-2">
              <p className="text-[11px] leading-4 text-[var(--mos-text-muted)]">Clear every saved memory for your account? This also removes them from your Knowledge Graph.</p>
              <div className="flex gap-1.5">
                <button type="button" data-testid="ai-research-memory-clear-confirm" disabled={busy === 'clear'} onClick={() => { void clearAll(); }} className="rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40">
                  Clear all
                </button>
                <button type="button" onClick={() => setClearArmed(false)} className="rounded-lg border border-[var(--mos-border)] px-2.5 py-1.5 text-[11px] text-[var(--mos-text)]">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-testid="ai-research-memory-clear"
              disabled={memories.length === 0}
              onClick={() => setClearArmed(true)}
              className="text-[11px] text-[var(--mos-text-muted)] hover:text-red-300 disabled:opacity-40"
            >
              Clear all
            </button>
          )}
        </div>
      </aside>
      <AiResearchImportModal
        open={importStart !== null}
        start={importStart ?? { kind: 'new' }}
        onClose={() => setImportStart(null)}
        onChanged={() => { void load(); void loadImports(); }}
      />
    </div>
  );
}
