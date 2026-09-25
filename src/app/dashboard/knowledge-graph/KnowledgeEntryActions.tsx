'use client';

import { useEffect, useState } from 'react';
import { Button, TextArea } from '@/components/ui/dashboard';
import { KNOWLEDGE_ENTRY_TITLE_MAX, normalizeKnowledgeEntryTitle } from '@/lib/knowledge-graph-entry';

export default function KnowledgeEntryActions({ entryId, title, onTitleSaved, onDeleted }: {
  entryId: string;
  title: string;
  onTitleSaved: (id: string, title: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(title);
  const [pending, setPending] = useState<'save' | 'delete' | ''>('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    setEditing(false);
    setConfirmingDelete(false);
    setDraft(title);
    setActionError('');
  }, [entryId, title]);

  const saveTitle = async () => {
    const titleResult = normalizeKnowledgeEntryTitle(draft);
    if ('error' in titleResult) {
      setActionError(titleResult.error);
      return;
    }
    setPending('save');
    setActionError('');
    try {
      const response = await fetch(`/api/admin/knowledge-graph/entries/${encodeURIComponent(entryId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleResult.title }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Title could not be saved.');
      setEditing(false);
      onTitleSaved(entryId, typeof payload.title === 'string' ? payload.title : draft.replace(/\s+/g, ' ').trim());
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Title could not be saved.');
    } finally {
      setPending('');
    }
  };

  const deleteEntry = async () => {
    setPending('delete');
    setActionError('');
    try {
      const response = await fetch(`/api/admin/knowledge-graph/entries/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Knowledge entry could not be deleted.');
      onDeleted(entryId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Knowledge entry could not be deleted.');
      setPending('');
    }
  };

  return <div className="border-t border-[var(--mos-border-subtle)] pt-4">
    {editing ? <form onSubmit={event => { event.preventDefault(); void saveTitle(); }} className="space-y-2">
      <label className="block text-[10px] text-[var(--mos-text-faint)]" htmlFor="knowledge-entry-title">Title</label>
      <TextArea id="knowledge-entry-title" value={draft} maxLength={KNOWLEDGE_ENTRY_TITLE_MAX} rows={4} className="min-h-20" onChange={event => setDraft(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" type="submit" disabled={pending !== ''}>Save title</Button>
        <Button size="sm" disabled={pending !== ''} onClick={() => { setEditing(false); setDraft(title); setActionError(''); }}>Cancel</Button>
      </div>
    </form> : confirmingDelete ? <div className="rounded-md border border-red-400/25 bg-red-400/10 p-3">
      <p className="text-xs leading-5 text-red-100">Delete this knowledge entry? Its stored connections are removed with it. This cannot be undone.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="danger" disabled={pending !== ''} onClick={() => { void deleteEntry(); }}>Delete</Button>
        <Button size="sm" disabled={pending !== ''} onClick={() => { setConfirmingDelete(false); setActionError(''); }}>Cancel</Button>
      </div>
    </div> : <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => { setEditing(true); setDraft(title); setConfirmingDelete(false); setActionError(''); }}>Edit title</Button>
      <Button size="sm" variant="danger" onClick={() => { setConfirmingDelete(true); setEditing(false); setActionError(''); }}>Delete entry</Button>
    </div>}
    {actionError && <p className="mt-2 text-xs leading-5 text-red-300">{actionError}</p>}
  </div>;
}
