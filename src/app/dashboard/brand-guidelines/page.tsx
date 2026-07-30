'use client';
import { useState, useEffect } from 'react';
import { Button, EmptyState, FormField, Panel, PageHeader, PageStack, SectionHeader, TextArea, TextInput } from '@/components/ui/dashboard';

interface BrandGuideline {
  id: string;
  brand_name: string;
  tone_of_voice: string | null;
  target_market: string | null;
  key_messages: string | null;
  do_list: string[];
  dont_list: string[];
  examples: string | null;
  created_at: string;
}

export default function BrandGuidelinesPage() {
  const [guidelines, setGuidelines] = useState<BrandGuideline[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BrandGuideline | null>(null);
  const [form, setForm] = useState({
    brand_name: '',
    tone_of_voice: '',
    target_market: '',
    key_messages: '',
    do_list: '',
    dont_list: '',
    examples: '',
  });
  const [saveMsg, setSaveMsg] = useState('');

  const fetchGuidelines = async () => {
    const res = await fetch('/api/brand-guidelines');
    const data = await res.json();
    if (data.guidelines) setGuidelines(data.guidelines);
  };

  useEffect(() => { fetchGuidelines(); }, []);

  const resetForm = () => {
    setForm({ brand_name: '', tone_of_voice: '', target_market: '', key_messages: '', do_list: '', dont_list: '', examples: '' });
    setEditing(null);
    setShowForm(false);
  };

  const startEdit = (g: BrandGuideline) => {
    setForm({
      brand_name: g.brand_name,
      tone_of_voice: g.tone_of_voice || '',
      target_market: g.target_market || '',
      key_messages: g.key_messages || '',
      do_list: (g.do_list || []).join('\n'),
      dont_list: (g.dont_list || []).join('\n'),
      examples: g.examples || '',
    });
    setEditing(g);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.brand_name) return;
    const body = {
      brand_name: form.brand_name,
      tone_of_voice: form.tone_of_voice || null,
      target_market: form.target_market || null,
      key_messages: form.key_messages || null,
      do_list: form.do_list ? form.do_list.split('\n').filter(Boolean) : [],
      dont_list: form.dont_list ? form.dont_list.split('\n').filter(Boolean) : [],
      examples: form.examples || null,
    };

    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `/api/brand-guidelines?id=${editing.id}` : '/api/brand-guidelines';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setSaveMsg(editing ? 'Guideline updated.' : 'Guideline created.');
      setTimeout(() => setSaveMsg(''), 3000);
      resetForm();
      fetchGuidelines();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this brand guideline?')) return;
    await fetch(`/api/brand-guidelines?id=${id}`, { method: 'DELETE' });
    fetchGuidelines();
  };

  return (
    <PageStack className="max-w-5xl">
      <PageHeader eyebrow="Library / Governance" title="Brand guidelines" description="Define brand voice, audience, key messages, and production rules for generated content." actions={
        <Button variant="primary" onClick={() => { resetForm(); setShowForm(true); }}>New guideline</Button>
      } />

      {saveMsg && <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg">{saveMsg}</div>}

      {/* Form */}
      {showForm && (
        <Panel className="space-y-4">
          <SectionHeader title={editing ? 'Edit guideline' : 'New brand guideline'} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Brand name" required><TextInput value={form.brand_name} onChange={e => setForm({ ...form, brand_name: e.target.value })} placeholder="Dupoin Futures" /></FormField>
            <FormField label="Tone of voice"><TextInput value={form.tone_of_voice} onChange={e => setForm({ ...form, tone_of_voice: e.target.value })} placeholder="Professional, friendly, trustworthy" /></FormField>
          </div>
          <FormField label="Target market"><TextInput value={form.target_market} onChange={e => setForm({ ...form, target_market: e.target.value })} placeholder="Indonesian traders, 25-45, middle-upper income" /></FormField>
          <FormField label="Key messages"><TextArea value={form.key_messages} onChange={e => setForm({ ...form, key_messages: e.target.value })} rows={2} placeholder="Trusted broker, fast execution, local support" /></FormField>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Do" hint="One per line"><TextArea value={form.do_list} onChange={e => setForm({ ...form, do_list: e.target.value })} rows={4} placeholder={"Use data-driven claims\nInclude risk disclaimers\nShow real platform screenshots"} /></FormField>
            <FormField label="Don't" hint="One per line"><TextArea value={form.dont_list} onChange={e => setForm({ ...form, dont_list: e.target.value })} rows={4} placeholder={"Promise guaranteed profits\nUse overly aggressive language\nMention competitors by name"} /></FormField>
          </div>
          <FormField label="Example content" hint="Optional"><TextArea value={form.examples} onChange={e => setForm({ ...form, examples: e.target.value })} rows={3} placeholder="Paste a sample caption/post that represents the brand voice..." /></FormField>
          <div className="flex gap-2">
            <Button variant="primary" onClick={handleSave}>{editing ? 'Update' : 'Create'}</Button>
            <Button onClick={resetForm}>Cancel</Button>
          </div>
        </Panel>
      )}

      {/* List */}
      <div className="space-y-4">
        {guidelines.length === 0 && !showForm && (
          <Panel padding="none"><EmptyState title="No brand guidelines yet" description="Create one to make AI-generated content match your brand voice." /></Panel>
        )}
        {guidelines.map(g => (
          <Panel key={g.id}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{g.brand_name}</h3>
                {g.tone_of_voice && <p className="text-sm text-blue-400">{g.tone_of_voice}</p>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => startEdit(g)}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => handleDelete(g.id)}>Delete</Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {g.target_market && <div><span className="text-[var(--mos-text-faint)]">Target:</span> <span className="text-[var(--mos-text-secondary)]">{g.target_market}</span></div>}
              {g.key_messages && <div><span className="text-[var(--mos-text-faint)]">Key Messages:</span> <span className="text-[var(--mos-text-secondary)]">{g.key_messages}</span></div>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-sm">
              {g.do_list?.length > 0 && (
                <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/10">
                  <p className="text-green-400 font-medium mb-1">Do</p>
                  <ul className="text-[var(--mos-text-muted)] space-y-1">{g.do_list.map((d, i) => <li key={i}>• {d}</li>)}</ul>
                </div>
              )}
              {g.dont_list?.length > 0 && (
                <div className="bg-red-500/5 rounded-lg p-3 border border-red-500/10">
                  <p className="text-red-400 font-medium mb-1">Don&apos;t</p>
                  <ul className="text-[var(--mos-text-muted)] space-y-1">{g.dont_list.map((d, i) => <li key={i}>• {d}</li>)}</ul>
                </div>
              )}
            </div>
            {g.examples && (
              <div className="mt-3 bg-[var(--mos-surface)] rounded-lg p-3">
                <p className="text-xs text-[var(--mos-text-faint)] mb-1">Example Style:</p>
                <p className="text-[var(--mos-text-muted)] text-sm">{g.examples}</p>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </PageStack>
  );
}
