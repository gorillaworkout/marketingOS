'use client';

import { useState } from 'react';
import { Button, FormField, Select, TextArea, TextInput } from '@/components/ui/dashboard';
import { COMPLAINT_STATUS_OPTIONS, PLATFORM_OPTIONS } from '@/lib/cs-report/fields';
import type { Complaint } from '@/lib/cs-report/types';

export type ComplaintDraft = {
  id: string | null; date: string; clientName: string; uid: string; account: string; platform: string; description: string; cause: string;
  resolution: string; completionDate: string; status: string; slaMet: '' | 'yes' | 'no'; urgency: string; category: string;
};

export function emptyComplaint(date: string): ComplaintDraft {
  return { id: null, date, clientName: '', uid: '', account: '', platform: 'MT5', description: '', cause: '', resolution: '', completionDate: '', status: 'On Progress', slaMet: '', urgency: '', category: '' };
}

export function draftFromComplaint(c: Complaint): ComplaintDraft {
  return {
    id: c.id, date: c.date, clientName: c.clientName, uid: c.uid, account: c.account, platform: c.platform, description: c.description, cause: c.cause,
    resolution: c.resolution, completionDate: c.completionDate ?? '', status: c.status, slaMet: c.slaMet === null ? '' : c.slaMet ? 'yes' : 'no',
    urgency: c.urgency, category: c.category,
  };
}

export const editedLabel = (name: string | null, at: string | null) => (at
  ? `Last edited${name ? ` by ${name}` : ''} on ${new Date(at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })} WIB`
  : '');

/**
 * Add or edit one complaint case. POST for a new case (recorded under the agent; admins may pass agentId),
 * PATCH /complaints/:id for an existing one. The route checks edit rights.
 */
export function CsComplaintForm({ initial, today, agentId, onSaved, onCancel }: {
  initial: ComplaintDraft; today: string; agentId?: string; onSaved: () => void | Promise<void>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ComplaintDraft>(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ComplaintDraft>) => setDraft(d => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true); setError('');
    const payload: Record<string, unknown> = { ...draft, slaMet: draft.slaMet === '' ? null : draft.slaMet === 'yes' };
    delete payload.id;
    if (!draft.id && agentId) payload.agentId = agentId;
    const response = await fetch(draft.id ? `/api/cs-report/complaints/${draft.id}` : '/api/cs-report/complaints', {
      method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!response.ok) { setError(body.error || `Could not save the complaint (${response.status}).`); return; }
    await onSaved();
  };

  return <div className="grid grid-cols-1 gap-4 border-b border-[var(--mos-border-subtle)] p-5 md:grid-cols-4">
    <FormField label="Complaint date" required><TextInput type="date" value={draft.date} max={today} onChange={e => set({ date: e.target.value })} /></FormField>
    <FormField label="Client name"><TextInput value={draft.clientName} onChange={e => set({ clientName: e.target.value })} /></FormField>
    <FormField label="UID"><TextInput value={draft.uid} onChange={e => set({ uid: e.target.value })} /></FormField>
    <FormField label="Account"><TextInput value={draft.account} onChange={e => set({ account: e.target.value })} /></FormField>
    <FormField label="Platform">
      <Select value={draft.platform} onChange={e => set({ platform: e.target.value })}>
        {[...new Set([...PLATFORM_OPTIONS, draft.platform].filter(Boolean))].map(p => <option key={p} value={p}>{p}</option>)}
      </Select>
    </FormField>
    <FormField label="Complaint description" required className="md:col-span-3"><TextArea value={draft.description} onChange={e => set({ description: e.target.value })} className="min-h-20" /></FormField>
    <FormField label="Cause analysis" className="md:col-span-2"><TextArea value={draft.cause} onChange={e => set({ cause: e.target.value })} className="min-h-20" /></FormField>
    <FormField label="Resolution actions" className="md:col-span-2"><TextArea value={draft.resolution} onChange={e => set({ resolution: e.target.value })} className="min-h-20" /></FormField>
    <FormField label="Category" hint="optional"><TextInput value={draft.category} onChange={e => set({ category: e.target.value })} /></FormField>
    <FormField label="Completion date"><TextInput type="date" value={draft.completionDate} min={draft.date} onChange={e => set({ completionDate: e.target.value })} /></FormField>
    <FormField label="Status">
      <Select value={draft.status} onChange={e => set({ status: e.target.value })}>
        {[...new Set([...COMPLAINT_STATUS_OPTIONS, draft.status].filter(Boolean))].map(s => <option key={s} value={s}>{s}</option>)}
      </Select>
    </FormField>
    <FormField label="SLA met">
      <Select value={draft.slaMet} onChange={e => set({ slaMet: e.target.value as ComplaintDraft['slaMet'] })}>
        <option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option>
      </Select>
    </FormField>
    <div className="flex flex-wrap items-end gap-2 md:col-span-4">
      <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : draft.id ? 'Update complaint' : 'Save complaint'}</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  </div>;
}

/** DELETE with a confirm dialog. Returns an error message, or '' when deleted or cancelled. */
export async function deleteComplaintWithConfirm(id: string): Promise<string | null> {
  if (!window.confirm('Delete this complaint case? This cannot be undone.')) return null;
  const response = await fetch(`/api/cs-report/complaints/${id}`, { method: 'DELETE' });
  if (response.ok) return '';
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error || `Could not delete (${response.status}).`;
}
