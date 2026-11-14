'use client';

import { useEffect, useState } from 'react';
import { Button, FormField, SectionHeader, Select, TextArea, TextInput } from '@/components/ui/dashboard';

type Competitor = {
  id: string;
  competitorName: string;
  platform?: string | null;
  sourceUrl?: string | null;
  pastedText?: string | null;
  hasScreenshot?: boolean;
  insight?: string;
  updatedByName?: string | null;
  updatedAt?: string | null;
  canDelete?: boolean;
};

export function CompetitorReferences({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [rows, setRows] = useState<Competitor[]>([]);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('Instagram');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [editingId, setEditingId] = useState('');
  const [message, setMessage] = useState('');

  const load = () => {
    fetch('/api/competitor-references')
      .then(response => response.ok ? response.json() : { competitors: [] })
      .then(data => setRows(Array.isArray(data.competitors) ? data.competitors : []))
      .catch(() => setRows([]));
  };

  useEffect(() => { load(); }, []);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter(item => item !== id));
    else if (selectedIds.length >= 3) setMessage('Select at most 3 competitor references.');
    else onChange([...selectedIds, id]);
  };

  const save = async () => {
    const response = await fetch('/api/competitor-references', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingId || undefined, competitorName: name, platform, pastedText: text, sourceUrl: url }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.error || 'Could not save the competitor reference.'); return data; }
    setMessage(editingId ? 'Competitor reference updated.' : 'Competitor reference saved.');
    setEditingId(data.id || editingId);
    load();
    return data as { id?: string };
  };

  const readArticle = async () => {
    const saved = editingId ? { id: editingId } : await save();
    const id = saved?.id || editingId;
    if (!id) return;
    const response = await fetch('/api/competitor-references', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'fetch-url' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.error || 'That page could not be read. Paste the text instead.'); return; }
    setText(data.text || text);
    setMessage(data.fetched ? 'Article text saved. It will not be fetched again.' : 'Stored text kept. The page was not fetched again.');
    load();
  };

  const upload = async (file?: File) => {
    if (!file || !name.trim()) { setMessage('Add a competitor name before the screenshot.'); return; }
    const form = new FormData();
    form.set('file', file);
    form.set('competitorName', name);
    form.set('platform', platform);
    form.set('pastedText', text);
    const response = await fetch('/api/competitor-references', { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.error || 'The screenshot could not be saved.'); return; }
    setEditingId(data.id);
    setMessage('Screenshot saved privately.');
    load();
  };

  const analyze = async (id: string) => {
    setMessage('Analyzing the approach…');
    const response = await fetch('/api/competitor-references?analyze=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? (data.cached ? 'Using the saved analysis.' : 'Analysis saved. It will not be recomputed.') : data.error || 'Could not analyze this reference.');
    load();
  };

  const remove = async (id: string) => {
    const response = await fetch(`/api/competitor-references?id=${id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.error || 'Could not delete the reference.'); return; }
    onChange(selectedIds.filter(item => item !== id));
    if (editingId === id) setEditingId('');
    load();
  };

  return (
    <section className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3">
      <SectionHeader title="Competitor" description="Paste text, upload a screenshot, or store a URL. Social links are never fetched. A public article is read once, when you click." />
      <div className="mt-2 space-y-2">
        {rows.map(row => (
          <div key={row.id} className="rounded border border-[var(--mos-border)] px-2 py-2 text-xs">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggle(row.id)} />
              <span>
                <span className="font-medium text-[var(--mos-text)]">{row.competitorName}</span>
                {row.platform ? ` · ${row.platform}` : ''}
                <span className="mt-1 block text-[var(--mos-text-muted)]">{row.insight || 'No saved analysis yet.'}</span>
                <span className="mt-1 block text-[11px] text-[var(--mos-text-faint)]">
                  {row.updatedByName ? `Updated by ${row.updatedByName}` : 'Updated'}
                  {row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleString()}` : ''}
                </span>
              </span>
            </label>
            <span className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="underline" onClick={() => { setEditingId(row.id); setName(row.competitorName); setPlatform(row.platform || 'Instagram'); setText(row.pastedText || ''); setUrl(row.sourceUrl || ''); }}>Edit</button>
              <button type="button" className="underline" onClick={() => void analyze(row.id)}>Analyze</button>
              {row.canDelete && <button type="button" className="underline" onClick={() => void remove(row.id)}>Delete</button>}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <TextInput value={name} onChange={event => setName(event.target.value)} placeholder="Competitor name" />
        <Select value={platform} onChange={event => setPlatform(event.target.value)}>
          <option>Instagram</option><option>TikTok</option><option>LinkedIn</option><option>Twitter/X</option><option>Facebook</option>
        </Select>
        <TextArea value={text} onChange={event => setText(event.target.value)} rows={3} maxLength={3000} placeholder="Paste the caption. 3,000 characters." />
        <FormField label="URL" hint="Stored as a link. Social network URLs are never fetched.">
          <TextInput value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void save()}>{editingId ? 'Update' : 'Save'}</Button>
          <Button type="button" onClick={() => void readArticle()}>Read article</Button>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-xs">
            Screenshot
            <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void upload(event.target.files?.[0])} />
          </label>
        </div>
      </div>
      {message && <p className="mt-2 text-xs text-[var(--mos-text-secondary)]">{message}</p>}
    </section>
  );
}
