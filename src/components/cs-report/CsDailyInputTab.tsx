'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, DataTableFrame, FormField, LoadingState, Panel, SectionHeader, Select, StatusBadge, TextArea, TextInput } from '@/components/ui/dashboard';
import { CATEGORY_FIELDS, CHANNEL_FIELDS, COMPLAINT_STATUS_OPTIONS, DEFAULT_FOLLOW_UP_MINUTES, OTHER_COUNT_FIELDS, PLATFORM_OPTIONS, STATUS_LABELS, STATUSES, type CsStatus } from '@/lib/cs-report/fields';
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

type ComplaintForm = { id: string | null; clientName: string; uid: string; account: string; platform: string; description: string; cause: string; resolution: string; completionDate: string; status: string; slaMet: '' | 'yes' | 'no'; category: string };
const emptyComplaint = (): ComplaintForm => ({ id: null, clientName: '', uid: '', account: '', platform: 'MT5', description: '', cause: '', resolution: '', completionDate: '', status: 'On Progress', slaMet: '', category: '' });

export function CsDailyInputTab() {
  const [date, setDate] = useState('');
  const [agentId, setAgentId] = useState('');
  const [data, setData] = useState<Loaded | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [complaint, setComplaint] = useState<ComplaintForm | null>(null);
  const [complaintError, setComplaintError] = useState('');

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
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/cs-report/entries', { cache: 'no-store' }).then(r => r.json().then(b => ({ ok: r.ok, b }))).then(({ ok, b }) => {
      if (cancelled) return;
      if (!ok) { setError(b.error || 'Could not load the daily input.'); return; }
      setData(b); setDate(b.date); setForm(formFromEntry(b.entry));
    }).catch(() => { if (!cancelled) setError('Could not load the daily input.'); });
    return () => { cancelled = true; };
  }, []);

  if (!data && !error) return <LoadingState label="Loading Daily Input" />;

  const onLeave = form.status !== 'present';
  const set = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));
  const save = async () => {
    setSaving(true); setMessage(''); setError('');
    const payload: Record<string, unknown> = { date, status: form.status, unsolvedUids: form.unsolvedUids, followUpMinutes: form.followUpMinutes, frequentQuestion: form.frequentQuestion, difficultQuestion: form.difficultQuestion };
    for (const k of COUNT_KEYS) payload[k] = form[k] === '' ? null : Number(form[k]);
    if (data?.isAdmin && agentId) payload.agentId = agentId;
    const response = await fetch('/api/cs-report/entries', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!response.ok) { setError(body.error || `Could not save (${response.status}).`); return; }
    setMessage(`Saved for ${date}. Saving again on the same date updates this entry.`);
    await load(date, agentId);
  };

  const saveComplaint = async () => {
    if (!complaint) return;
    setComplaintError('');
    const payload: Record<string, unknown> = { ...complaint, date, slaMet: complaint.slaMet === '' ? null : complaint.slaMet === 'yes' };
    delete payload.id;
    if (data?.isAdmin && agentId) payload.agentId = agentId;
    const response = await fetch(complaint.id ? `/api/cs-report/complaints/${complaint.id}` : '/api/cs-report/complaints', {
      method: complaint.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setComplaintError(body.error || `Could not save the complaint (${response.status}).`); return; }
    setComplaint(null);
    await load(date, agentId);
  };

  const removeComplaint = async (id: string) => {
    if (!window.confirm('Delete this complaint?')) return;
    const response = await fetch(`/api/cs-report/complaints/${id}`, { method: 'DELETE' });
    if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; setComplaintError(body.error || 'Could not delete.'); return; }
    await load(date, agentId);
  };

  const numberField = (field: { key: string; label: string }) => (
    <FormField key={field.key} label={field.label} required={!onLeave}>
      <TextInput type="number" inputMode="numeric" min={0} step={1} value={form[field.key]} onChange={e => set(field.key, e.target.value)} placeholder={onLeave ? 'optional' : '0'} />
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
            <Select value={agentId} onChange={e => { setAgentId(e.target.value); void load(date, e.target.value); }} className="w-64">
              <option value="">My own entry</option>
              {data.agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.linked ? '' : ' (name only)'}</option>)}
            </Select>
          </FormField>
          : <div className="pb-2 text-sm text-[var(--mos-text-secondary)]">Agent: <span className="text-[var(--mos-text)]">{data?.agent.name}</span></div>}
        <div className="pb-2">{data?.entry
          ? <StatusBadge tone="success" dot>Saved {data.entry.source === 'upload' ? '(imported)' : ''}</StatusBadge>
          : <StatusBadge tone="warning" dot>Not filled yet</StatusBadge>}</div>
      </div>
    </Panel>

    {error && <Panel padding="compact"><p className="text-sm text-red-300">{error}</p></Panel>}

    <Panel>
      <SectionHeader title="Status" description="On Sick or Annual Leave the numbers are optional." />
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
        <FormField label={`Not followed up within ${form.followUpMinutes || DEFAULT_FOLLOW_UP_MINUTES} minutes`} required={!onLeave}>
          <TextInput type="number" min={0} step={1} value={form.notFollowedUp} onChange={e => set('notFollowedUp', e.target.value)} placeholder={onLeave ? 'optional' : '0'} />
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
        {message && <span className="text-xs text-emerald-300">{message}</span>}
      </div>
    </Panel>

    <DataTableFrame title={`Complaints on ${date}`} description="Add complaint cases one by one. You can edit or delete the ones you added."
      action={!complaint && <Button size="sm" variant="primary" onClick={() => { setComplaint(emptyComplaint()); setComplaintError(''); }}>Add complaint</Button>}>
      {complaint && <div className="grid grid-cols-1 gap-4 border-b border-[var(--mos-border-subtle)] p-5 md:grid-cols-4">
        <FormField label="Client name"><TextInput value={complaint.clientName} onChange={e => setComplaint({ ...complaint, clientName: e.target.value })} /></FormField>
        <FormField label="UID"><TextInput value={complaint.uid} onChange={e => setComplaint({ ...complaint, uid: e.target.value })} /></FormField>
        <FormField label="Account"><TextInput value={complaint.account} onChange={e => setComplaint({ ...complaint, account: e.target.value })} /></FormField>
        <FormField label="Platform">
          <Select value={complaint.platform} onChange={e => setComplaint({ ...complaint, platform: e.target.value })}>
            {[...new Set([...PLATFORM_OPTIONS, complaint.platform].filter(Boolean))].map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
        </FormField>
        <FormField label="Complaint description" required className="md:col-span-2"><TextArea value={complaint.description} onChange={e => setComplaint({ ...complaint, description: e.target.value })} className="min-h-20" /></FormField>
        <FormField label="Cause analysis" className="md:col-span-2"><TextArea value={complaint.cause} onChange={e => setComplaint({ ...complaint, cause: e.target.value })} className="min-h-20" /></FormField>
        <FormField label="Resolution actions" className="md:col-span-2"><TextArea value={complaint.resolution} onChange={e => setComplaint({ ...complaint, resolution: e.target.value })} className="min-h-20" /></FormField>
        <FormField label="Category" hint="optional"><TextInput value={complaint.category} onChange={e => setComplaint({ ...complaint, category: e.target.value })} /></FormField>
        <FormField label="Completion date"><TextInput type="date" value={complaint.completionDate} min={date} onChange={e => setComplaint({ ...complaint, completionDate: e.target.value })} /></FormField>
        <FormField label="Status">
          <Select value={complaint.status} onChange={e => setComplaint({ ...complaint, status: e.target.value })}>
            {[...new Set([...COMPLAINT_STATUS_OPTIONS, complaint.status].filter(Boolean))].map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </FormField>
        <FormField label="SLA met">
          <Select value={complaint.slaMet} onChange={e => setComplaint({ ...complaint, slaMet: e.target.value as ComplaintForm['slaMet'] })}>
            <option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option>
          </Select>
        </FormField>
        <div className="flex items-end gap-2 md:col-span-4">
          <Button variant="primary" size="sm" onClick={saveComplaint}>{complaint.id ? 'Update complaint' : 'Save complaint'}</Button>
          <Button size="sm" variant="ghost" onClick={() => setComplaint(null)}>Cancel</Button>
          {complaintError && <span className="text-xs text-red-300">{complaintError}</span>}
        </div>
      </div>}
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
              <Button size="sm" variant="ghost" onClick={() => { setComplaintError(''); setComplaint({ id: c.id, clientName: c.clientName, uid: c.uid, account: c.account, platform: c.platform, description: c.description, cause: c.cause, resolution: c.resolution, completionDate: c.completionDate ?? '', status: c.status, slaMet: c.slaMet === null ? '' : c.slaMet ? 'yes' : 'no', category: c.category }); }}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => removeComplaint(c.id)}>Delete</Button>
            </td>
          </tr>)}
          {!data?.complaints.length && <tr><td colSpan={8} className="p-6 text-center text-xs text-[var(--mos-text-faint)]">No complaints recorded for this date.</td></tr>}
        </tbody>
      </table>
    </DataTableFrame>
  </div>;
}
