'use client';

import { useEffect, useState } from 'react';
import { knowledgeGraphFocusUrl } from '@/lib/knowledge-pin';
import {
  IMPORT_CANCEL_NOTE,
  IMPORT_DUPLICATE_NOTE,
  IMPORT_EXTRACT_FAILED_NOTE,
  IMPORT_MEMORY_OFF_NOTE,
  IMPORT_PLAIN_TEXT_NOTE,
  IMPORT_SAVED_NOTE,
  IMPORT_SOURCE_LABEL,
} from '@/lib/chat-import-ui';

type Source = keyof typeof IMPORT_SOURCE_LABEL;
type Kind = 'role' | 'interest' | 'preference' | 'style' | 'context';
type Status = 'review' | 'extract_failed' | 'approved' | 'chat_only';

type FactRow = { id: string; kind: Kind; content: string; included: boolean };
type QaRow = { id: string; question: string; answerSummary: string; included: boolean };

type ImportRecord = {
  id: string;
  parserFallback: boolean;
  status: Status;
  knowledgeEntryId: string | null;
  memoryEnabled: boolean;
  draft: { facts?: FactRow[]; qa?: QaRow[] };
  error: string | null;
  transcript?: string;
};

const KIND_ORDER: Kind[] = ['role', 'interest', 'preference', 'style', 'context'];
const KIND_LABEL: Record<Kind, string> = {
  role: 'Role',
  interest: 'Interests',
  preference: 'Preferences',
  style: 'Style',
  context: 'Context',
};

const fieldClass = 'w-full rounded-lg border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1.5 text-xs text-[var(--mos-text)] outline-none focus:border-indigo-400/60';
const buttonClass = 'rounded-lg border border-[var(--mos-border)] px-2.5 py-1.5 text-[11px] text-[var(--mos-text)] hover:bg-[var(--mos-hover)]';

function isKind(value: string): value is Kind {
  return (KIND_ORDER as string[]).includes(value);
}

export function AiResearchImportModal({
  open,
  start,
  onClose,
  onChanged,
}: {
  open: boolean;
  start: { kind: 'new' } | { kind: 'existing'; id: string; intent: 'view' | 'review' | 'retry' };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [source, setSource] = useState<Source>('codex');
  const [tab, setTab] = useState<'paste' | 'upload'>('paste');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [phase, setPhase] = useState<'form' | 'review' | 'failed' | 'cancelled' | 'duplicate' | 'transcript'>('form');
  const [record, setRecord] = useState<ImportRecord | null>(null);
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [qa, setQa] = useState<QaRow[]>([]);
  const [transcript, setTranscript] = useState('');
  const [duplicate, setDuplicate] = useState<{ id: string; knowledgeEntryId: string | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check' }),
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!cancelled) setIsAdmin(data?.user?.role === 'admin');
    }).catch(() => {
      if (!cancelled) setIsAdmin(false);
    });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    setTranscript('');
    if (start.kind === 'new') {
      setPhase('form');
      setRecord(null);
      setDuplicate(null);
      return () => { cancelled = true; };
    }
    const run = async () => {
      if (start.intent === 'retry') {
        await sendExtract(start.id);
        return;
      }
      await loadDetail(start.id, start.intent === 'view');
    };
    void run();
    return () => { cancelled = true; };

    async function loadDetail(id: string, transcriptOnly: boolean) {
      setBusy(true);
      try {
        const response = await fetch(`/api/ai-research/imports/${encodeURIComponent(id)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error || 'Import was not found.');
        const next = payload.import as ImportRecord;
        remember(next);
        if (transcriptOnly) {
          setTranscript(typeof next.transcript === 'string' ? next.transcript : '');
          setPhase('transcript');
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Import was not found.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    async function sendExtract(id: string) {
      setBusy(true);
      try {
        const response = await fetch(`/api/ai-research/imports/${encodeURIComponent(id)}/extract`, { method: 'POST' });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error || 'Could not extract facts.');
        remember(payload.import as ImportRecord);
        onChanged();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not extract facts.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
  }, [open, start]);

  if (!open) return null;

  function remember(next: ImportRecord) {
    setRecord(next);
    setFacts((next.draft?.facts || []).map(fact => ({ ...fact, included: fact.included !== false })));
    setQa((next.draft?.qa || []).map(row => ({ ...row, included: row.included !== false })));
    if (next.status === 'review') setPhase('review');
    else if (next.status === 'extract_failed') setPhase('failed');
    else if (next.status === 'chat_only') setPhase('cancelled');
    else {
      setTranscript(typeof next.transcript === 'string' ? next.transcript : '');
      setPhase('transcript');
    }
  }

  const showTranscript = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/ai-research/imports/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Import was not found.');
      setTranscript(typeof payload.import?.transcript === 'string' ? payload.import.transcript : '');
      if (payload.import) setRecord(payload.import as ImportRecord);
      setPhase('transcript');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import was not found.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const response = tab === 'paste'
        ? await fetch('/api/ai-research/imports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, text }),
        })
        : await fetch('/api/ai-research/imports', {
          method: 'POST',
          body: (() => {
            const form = new FormData();
            form.set('source', source);
            if (file) form.set('file', file);
            return form;
          })(),
        });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setDuplicate({
          id: typeof payload.existingImportId === 'string' ? payload.existingImportId : '',
          knowledgeEntryId: typeof payload.knowledgeEntryId === 'string' ? payload.knowledgeEntryId : null,
        });
        setPhase('duplicate');
        setError('');
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'Could not import that chat.');
      remember(payload.import as ImportRecord);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import that chat.');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!record) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/ai-research/imports/${encodeURIComponent(record.id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facts: facts.map(fact => ({ id: fact.id, kind: fact.kind, content: fact.content, included: fact.included })),
          qa: qa.map(row => ({ id: row.id, question: row.question, answerSummary: row.answerSummary, included: row.included })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 400) {
        setError(typeof payload.error === 'string' ? payload.error : 'Could not approve that import.');
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'Could not approve that import.');
      onChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not approve that import.');
    } finally {
      setBusy(false);
    }
  };

  const cancelDraft = async () => {
    if (!record) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/ai-research/imports/${encodeURIComponent(record.id)}/cancel`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not cancel that import.');
      setPhase('cancelled');
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not cancel that import.');
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!record) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/ai-research/imports/${encodeURIComponent(record.id)}/extract`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not extract facts.');
      remember(payload.import as ImportRecord);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not extract facts.');
    } finally {
      setBusy(false);
    }
  };

  const graphLink = (entryId: string | null) => isAdmin && entryId ? (
    <a href={knowledgeGraphFocusUrl(entryId)} className="text-[11px] text-indigo-300 underline-offset-2 hover:underline">
      Open in Knowledge Graph
    </a>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="ai-research-import-modal">
      <button type="button" aria-label="Close import" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative flex max-h-[min(80vh,40rem)] w-[min(100vw,40rem)] flex-col overflow-hidden rounded-t-2xl border border-[var(--mos-border)] bg-[var(--mos-bg)] shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--mos-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--mos-text)]">Import chat</h2>
            <p className="mt-0.5 text-[11px] text-[var(--mos-text-muted)]">The saved chat stays in your knowledge graph.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[11px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
          {error && <p className="text-[11px] text-amber-200">{error}</p>}
          {phase === 'form' && (
            <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-3">
              <label className="block text-[11px] text-[var(--mos-text-muted)]">
                Source
                <select value={source} onChange={event => setSource(event.target.value as Source)} className={`${fieldClass} mt-1`}>
                  {(Object.keys(IMPORT_SOURCE_LABEL) as Source[]).map(key => (
                    <option key={key} value={key}>{IMPORT_SOURCE_LABEL[key]}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setTab('paste')} className={buttonClass}>Paste</button>
                <button type="button" onClick={() => setTab('upload')} className={buttonClass}>Upload</button>
              </div>
              {tab === 'paste' ? (
                <textarea value={text} onChange={event => setText(event.target.value)} rows={8} className={fieldClass} aria-label="Chat text" />
              ) : (
                <input type="file" accept=".md,.txt,.json" onChange={event => setFile(event.target.files?.[0] || null)} className="text-xs text-[var(--mos-text)]" />
              )}
              <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40">Import</button>
            </form>
          )}
          {phase === 'duplicate' && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--mos-text)]">{IMPORT_DUPLICATE_NOTE}</p>
              <div className="flex flex-wrap gap-2">
                {duplicate?.id && <button type="button" className={buttonClass} onClick={() => { void showTranscript(duplicate.id); }}>View chat</button>}
                {graphLink(duplicate?.knowledgeEntryId || null)}
              </div>
            </div>
          )}
          {phase === 'transcript' && (
            <pre className="whitespace-pre-wrap text-xs leading-5 text-[var(--mos-text)]">{transcript}</pre>
          )}
          {phase === 'cancelled' && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--mos-text)]">{IMPORT_CANCEL_NOTE}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={busy} onClick={() => { void retry(); }}>Retry extract</button>
                <button type="button" className={buttonClass} onClick={onClose}>Close</button>
              </div>
            </div>
          )}
          {phase === 'failed' && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--mos-text)]">{IMPORT_EXTRACT_FAILED_NOTE}</p>
              <div className="flex flex-wrap gap-2">
                {record && <button type="button" className={buttonClass} onClick={() => { void showTranscript(record.id); }}>View chat</button>}
                <button type="button" className={buttonClass} disabled={busy} onClick={() => { void retry(); }}>Retry extract</button>
              </div>
            </div>
          )}
          {phase === 'review' && record && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--mos-text)]">{IMPORT_SAVED_NOTE}</p>
              {record.parserFallback && <p className="text-[11px] text-amber-200">{IMPORT_PLAIN_TEXT_NOTE}</p>}
              {record.memoryEnabled === false && <p className="text-[11px] text-[var(--mos-text-muted)]">{IMPORT_MEMORY_OFF_NOTE}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} onClick={() => { void showTranscript(record.id); }}>View chat</button>
                {graphLink(record.knowledgeEntryId)}
              </div>
              {KIND_ORDER.map(kind => {
                const rows = facts.filter(fact => fact.kind === kind);
                if (!rows.length) return null;
                return (
                  <section key={kind}>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--mos-text-muted)]">{KIND_LABEL[kind]}</h3>
                    <div className="mt-1.5 space-y-2">
                      {rows.map(fact => (
                        <div key={fact.id} className="flex items-start gap-2">
                          <input type="checkbox" checked={fact.included} aria-label={`Include ${KIND_LABEL[fact.kind]}`} onChange={event => setFacts(current => current.map(item => item.id === fact.id ? { ...item, included: event.target.checked } : item))} />
                          <select value={fact.kind} aria-label="Memory kind" className={fieldClass} onChange={event => {
                            const next = event.target.value;
                            if (!isKind(next)) return;
                            setFacts(current => current.map(item => item.id === fact.id ? { ...item, kind: next } : item));
                          }}>
                            {KIND_ORDER.map(option => <option key={option} value={option}>{KIND_LABEL[option]}</option>)}
                          </select>
                          <input value={fact.content} maxLength={280} aria-label="Memory text" className={fieldClass} onChange={event => setFacts(current => current.map(item => item.id === fact.id ? { ...item, content: event.target.value } : item))} />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
              {qa.map(row => (
                <div key={row.id} className="space-y-1.5 rounded-xl border border-[var(--mos-border)] p-2">
                  <label className="flex items-center gap-2 text-[11px] text-[var(--mos-text-muted)]">
                    <input type="checkbox" checked={row.included} onChange={event => setQa(current => current.map(item => item.id === row.id ? { ...item, included: event.target.checked } : item))} />
                    Include answer
                  </label>
                  <input value={row.question} maxLength={2000} aria-label="Question" className={fieldClass} onChange={event => setQa(current => current.map(item => item.id === row.id ? { ...item, question: event.target.value } : item))} />
                  <input value={row.answerSummary} maxLength={500} aria-label="Answer summary" className={fieldClass} onChange={event => setQa(current => current.map(item => item.id === row.id ? { ...item, answerSummary: event.target.value } : item))} />
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => { void approve(); }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-40">Approve</button>
                <button type="button" disabled={busy} onClick={() => { void cancelDraft(); }} className={buttonClass}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
