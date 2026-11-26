'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, DataTableFrame, FormField, LoadingState, Panel, SectionHeader, Select, StatusBadge, TextArea, TextInput } from '@/components/ui/dashboard';
import { CATEGORY_FIELDS, CHANNEL_FIELDS, DEFAULT_FOLLOW_UP_MINUTES, OTHER_COUNT_FIELDS, STATUS_LABELS, STATUSES, type CsStatus } from '@/lib/cs-report/fields';
import { parseDailyEntryInput } from '@/lib/cs-report/validate';
import { conversations } from '@/lib/cs-report/metrics';
import { CsComplaintForm, deleteComplaintWithConfirm, draftFromComplaint, editedLabel, emptyComplaint, type ComplaintDraft } from './CsComplaintForm';
import type { Complaint, DailyEntry } from '@/lib/cs-report/types';

type Loaded = {
  date: string; today: string; isAdmin: boolean;
  agent: { id: string | null; name: string };
  entry: DailyEntry | null; complaints: Complaint[];
  agents: Array<{ id: string; name: string; linked: boolean }>;
};

const COUNT_KEYS = [...CHANNEL_FIELDS, ...CATEGORY_FIELDS, ...OTHER_COUNT_FIELDS].map(f => f.key);
type FormState = Record<string, string> & { status: CsStatus };

function emptyForm(): FormState {
  return { status: 'present', unsolvedUids: '', followUpMinutes: String(DEFAULT_FOLLOW_UP_MINUTES), frequentQuestion: '', difficultQuestion: '', ...Object.fromEntries(COUNT_KEYS.map(k => [k, ''])) } as FormState;
}

function formFromEntry(entry: DailyEntry | null): FormState {
  if (!entry) return emptyForm();
  const form = emptyForm();
  form.status = entry.status;
  form.unsolvedUids = entry.unsolvedUids;
  form.followUpMinutes = String(entry.followUpMinutes);
  form.frequentQuestion = entry.frequentQuestion;
  form.difficultQuestion = entry.difficultQuestion;
  for (const k of COUNT_KEYS) { const v = entry[k]; form[k] = v === null ? '' : String(v); }
  return form;
}


export function CsDailyInputTab() {
  const [date, setDate] = useState('');
  const [agentId, setAgentId] = useState('');
  const [data, setData] = useState<Loaded | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [complaint, setComplaint] = useState<ComplaintDraft | null>(null);
  const [complaintKey, setComplaintKey] = useState(0);
  const [complaintError, setComplaintError] = useState('');
  const [history, setHistory] = useState<DailyEntry[] | null>(null);

  // "My entries": the selected agent's saved days (last 92 days), newest first. Clicking one loads it into the form.
  const loadHistory = useCallback(async (agent: string) => {
    const params = new URLSearchParams();
    if (agent) params.set('agentId', agent);
    const response = await fetch(`/api/cs-report/entries/list?${params}`, { cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as { entries?: DailyEntry[] };
    setHistory(response.ok ? body.entries ?? [] : []);
  }, []);

  const load = useCallback(async (d: string, agent: string) => {
    const params = new URLSearchParams();
    if (d) params.set('date', d);
    if (agent) params.set('agentId', agent);
    const response = await fetch(`/api/cs-report/entries?${params}`, { cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as Loaded & { error?: string };
    if (!response.ok) { setError(body.error || `Could not load (${response.status}).`); return; }
    setError('');
    setData(body);
    setDate(body.date);
    setForm(formFromEntry(body.entry));
    setComplaint(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/cs-report/entries', { cache: 'no-store' }).then(r => r.json().then(b => ({ ok: r.ok, b }))).then(({ ok, b }) => {
      if (cancelled) return;
      if (!ok) { setError(b.error || 'Could not load the daily input.'); return; }
      setData(b); setDate(b.date); setForm(formFromEntry(b.entry));
      void loadHistory('');
    }).catch(() => { if (!cancelled) setError('Could not load the daily input.'); });
    return () => { cancelled = true; };
  }, [loadHistory]);

  if (!data && !error) return <LoadingState label="Loading Daily Input" />;

  const onLeave = form.status !== 'present';
  const set = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));
  const save = async () => {
    setSaving(true); setMessage(''); setError('');
    const payload: Record<string, unknown> = { date, status: form.status, unsolvedUids: form.unsolvedUids, followUpMinutes: form.followUpMinutes, frequentQuestion: form.frequentQuestion, difficultQuestion: form.difficultQuestion };
    for (const k of COUNT_KEYS) payload[k] = form[k] === '' ? null : Number(form[k]);
    const parsed = parseDailyEntryInput(payload, data?.today ?? date);
    if ('error' in parsed) { setSaving(false); setError(parsed.error); return; }
    if (data?.isAdmin && agentId) payload.agentId = agentId;
    const response = await fetch('/api/cs-report/entries', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!response.ok) { setError(body.error || `Could not save (${response.status}).`); return; }
    setMessage(`Saved for ${date}. Saving again on the same date updates this entry.`);
    await Promise.all([load(date, agentId), loadHistory(agentId)]);
  };

  const openDate = (d: string) => { setMessage(''); setDate(d); void load(d, agentId); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const deleteEntry = async () => {
    if (!data?.entry) return;
    if (!window.confirm(`Delete the daily entry of ${data.agent.name} on ${date}? Complaint cases on this date are kept. This cannot be undone.`)) return;
    setMessage(''); setError('');
    const response = await fetch(`/api/cs-report/entries/${data.entry.id}`, { method: 'DELETE' });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(body.error || `Could not delete (${response.status}).`); return; }
    setMessage(`Deleted the entry for ${date}.`);
    await Promise.all([load(date, agentId), loadHistory(agentId)]);
  };

  const openComplaint = (draft: ComplaintDraft) => { setComplaintError(''); setComplaint(draft); setComplaintKey(k => k + 1); };
  const removeComplaint = async (id: string) => {
    const result = await deleteComplaintWithConfirm(id);
    if (result === null) return;
    if (result) { setComplaintError(result); return; }
    setComplaint(null);
    await load(date, agentId);
  };

  const numberField = (field: { key: string; label: string }) => (
    <FormField key={field.key} label={field.label}>
      <TextInput type="number" inputMode="numeric" min={0} step={1} value={form[field.key]} onChange={e => set(field.key, e.target.value)} placeholder={onLeave ? 'optional' : ''} />
    </FormField>
  );

  return <div className="flex flex-col gap-6">
    <Panel padding="compact">
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="Date" hint="WIB">
          <TextInput type="date" value={date} max={data?.today} onChange={e => { setDate(e.target.value); setMessage(''); void load(e.target.value, agentId); }} className="w-44" />
        </FormField>
        {data?.isAdmin
          ? <FormField label="Agent" hint="admin">
            <Select value={agentId} onChange={e => { setAgentId(e.target.value); setMessage(''); void load(date, e.target.value); void loadHistory(e.target.value); }} className="w-64">
              <option value="">My own entry</option>
              {data.agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.linked ? '' : ' (name only)'}</option>)}
            </Select>
          </FormField>
          : <div className="pb-2 text-sm text-[var(--mos-text-secondary)]">Agent: <span className="text-[var(--mos-text)]">{data?.agent.name}</span></div>}
        <div className="pb-2">{data?.entry
          ? <StatusBadge tone="success" dot>Saved {data.entry.source === 'upload' ? '(imported)' : ''}</StatusBadge>
          : <StatusBadge tone="warning" dot>Not filled yet</StatusBadge>}</div>
        {data?.entry?.updatedAt && <div className="pb-2 text-xs text-[var(--mos-text-faint)]">{editedLabel(data.entry.updatedByName, data.entry.updatedAt)}</div>}
      </div>
      <p className="mt-2 text-xs text-[var(--mos-text-faint)]">Wrong data? Pick any past date (or click a row in My entries below), change the values and press Update entry.</p>
    </Panel>

    {error && <Panel padding="compact"><p className="text-sm text-red-300">{error}</p></Panel>}

    <Panel>
      <SectionHeader title="Status" description={onLeave ? 'On Sick or Annual Leave the numbers are optional.' : 'Leave blank if 0. At least one number is required.'} />
      <div className="mt-3 flex flex-wrap gap-2">
        {STATUSES.map(s => <Button key={s} variant={form.status === s ? 'primary' : 'secondary'} size="sm" onClick={() => set('status', s)}>{STATUS_LABELS[s]}</Button>)}
      </div>

      <SectionHeader className="mt-6" title="Reception per channel" description="Conversations received today per channel." />
      <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-5">{CHANNEL_FIELDS.map(numberField)}</div>

      <SectionHeader className="mt-6" title="Category" description="Conversations per topic." />
      <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-6">{CATEGORY_FIELDS.map(numberField)}</div>

      <SectionHeader className="mt-6" title="Follow-up" />
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-4">
        {OTHER_COUNT_FIELDS.filter(f => f.key !== 'notFollowedUp').map(numberField)}
        <FormField label="Unsolved customer UIDs" hint="optional">
          <TextInput value={form.unsolvedUids} onChange={e => set('unsolvedUids', e.target.value)} placeholder="e.g. 1234567, 7654321" />
        </FormField>
        <FormField label={`Not followed up within ${form.followUpMinutes || DEFAULT_FOLLOW_UP_MINUTES} minutes`}>
          <TextInput type="number" min={0} step={1} value={form.notFollowedUp} onChange={e => set('notFollowedUp', e.target.value)} placeholder={onLeave ? 'optional' : ''} />
        </FormField>
        <FormField label="Follow-up threshold (minutes)" hint={`default ${DEFAULT_FOLLOW_UP_MINUTES}`}>
          <TextInput type="number" min={1} max={240} step={1} value={form.followUpMinutes} onChange={e => set('followUpMinutes', e.target.value)} />
        </FormField>
      </div>

      <SectionHeader className="mt-6" title="Questions" />
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="Most frequently asked question"><TextArea value={form.frequentQuestion} onChange={e => set('frequentQuestion', e.target.value)} className="min-h-20" /></FormField>
        <FormField label="Most difficult question"><TextArea value={form.difficultQuestion} onChange={e => set('difficultQuestion', e.target.value)} className="min-h-20" /></FormField>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save} disabled={saving || !date}>{saving ? 'Saving…' : data?.entry ? 'Update entry' : 'Save entry'}</Button>
        {data?.isAdmin && data.entry && <Button variant="danger" onClick={deleteEntry}>Delete entry</Button>}
        {message && <span className="text-xs text-emerald-300">{message}</span>}
      </div>
    </Panel>

    <DataTableFrame title={`Complaints on ${date}`} description="Add complaint cases one by one. You can edit or delete the ones you added."
      action={!complaint && <Button size="sm" variant="primary" onClick={() => openComplaint(emptyComplaint(date))}>Add complaint</Button>}>
      {complaint && <CsComplaintForm key={complaintKey} initial={complaint} today={data?.today ?? date} agentId={data?.isAdmin && agentId ? agentId : undefined}
        onCancel={() => setComplaint(null)} onSaved={async () => { setComplaint(null); await load(date, agentId); }} />}
      {!complaint && complaintError && <p className="px-5 pt-3 text-xs text-red-300">{complaintError}</p>}
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs text-[var(--mos-text-faint)]">
          <tr><th className="p-3">Client</th><th className="p-3">UID</th><th className="p-3">Platform</th><th className="p-3">Description</th><th className="p-3">Status</th><th className="p-3">SLA</th><th className="p-3">Completed</th><th className="p-3" /></tr>
        </thead>
        <tbody>
          {(data?.complaints ?? []).map(c => <tr key={c.id} className="border-b border-[var(--mos-border)] align-top text-[var(--mos-text-secondary)]">
            <td className="p-3">{c.clientName || '—'}</td><td className="p-3 tabular-nums">{c.uid || '—'}</td><td className="p-3">{c.platform || '—'}</td>
            <td className="max-w-[380px] p-3">{c.description}</td><td className="p-3">{c.status || '—'}</td>
            <td className="p-3">{c.slaMet === null ? '—' : c.slaMet ? 'Yes' : 'No'}</td><td className="p-3">{c.completionDate || '—'}</td>
            <td className="whitespace-nowrap p-3 text-right">
              <Button size="sm" variant="ghost" onClick={() => openComplaint(draftFromComplaint(c))}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => removeComplaint(c.id)}>Delete</Button>
            </td>
          </tr>)}
          {!data?.complaints.length && <tr><td colSpan={8} className="p-6 text-center text-xs text-[var(--mos-text-faint)]">No complaints recorded for this date.</td></tr>}
        </tbody>
      </table>
    </DataTableFrame>

    <DataTableFrame title={data?.isAdmin && agentId ? `Entries of ${data.agent.name}` : 'My entries'} description="Saved daily entries of the last 3 months, newest first. Click a row to open and edit it.">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs text-[var(--mos-text-faint)]">
          <tr><th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3 text-right">Conversations</th><th className="p-3 text-right">Not followed up</th><th className="p-3">Source</th><th className="p-3">Last edited</th><th className="p-3" /></tr>
        </thead>
        <tbody>
          {(history ?? []).map(e => <tr key={e.id} onClick={() => openDate(e.date)}
            className={`cursor-pointer border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)] hover:bg-[var(--mos-surface-hover,rgba(255,255,255,0.04))] ${e.date === date ? 'bg-[rgba(255,255,255,0.05)]' : ''}`}>
            <td className="p-3 tabular-nums text-[var(--mos-text)]">{e.date}</td>
            <td className="p-3">{STATUS_LABELS[e.status]}</td>
            <td className="p-3 text-right tabular-nums">{conversations(e)}</td>
            <td className="p-3 text-right tabular-nums">{e.notFollowedUp ?? '—'}</td>
            <td className="p-3">{e.source === 'upload' ? 'Imported' : 'Web form'}</td>
            <td className="p-3 text-xs">{editedLabel(e.updatedByName, e.updatedAt).replace('Last edited ', '') || '—'}</td>
            <td className="p-3 text-right"><Button size="sm" variant="ghost" onClick={ev => { ev.stopPropagation(); openDate(e.date); }}>Edit</Button></td>
          </tr>)}
          {history && !history.length && <tr><td colSpan={7} className="p-6 text-center text-xs text-[var(--mos-text-faint)]">No saved entries in the last 3 months.</td></tr>}
          {!history && <tr><td colSpan={7} className="p-6 text-center text-xs text-[var(--mos-text-faint)]">Loading…</td></tr>}
        </tbody>
      </table>
    </DataTableFrame>
  </div>;
}
