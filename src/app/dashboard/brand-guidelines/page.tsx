'use client';
import { useState, useEffect } from 'react';
import { Button, PageHeader, PageStack } from '@/components/ui/dashboard';

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
      setSaveMsg(editing ? '✅ Updated!' : '✅ Created!');
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
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 space-y-4">
          <h3 className="text-lg font-semibold text-white">{editing ? 'Edit Guideline' : 'New Brand Guideline'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Brand Name *</label>
              <input value={form.brand_name} onChange={e => setForm({ ...form, brand_name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white" placeholder="Dupoin Futures" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Tone of Voice</label>
              <input value={form.tone_of_voice} onChange={e => setForm({ ...form, tone_of_voice: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white" placeholder="Professional, friendly, trustworthy" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Target Market</label>
            <input value={form.target_market} onChange={e => setForm({ ...form, target_market: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white" placeholder="Indonesian traders, 25-45, middle-upper income" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Key Messages</label>
            <textarea value={form.key_messages} onChange={e => setForm({ ...form, key_messages: e.target.value })} rows={2}
              className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white" placeholder="Trusted broker, fast execution, local support" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">✅ DO (one per line)</label>
              <textarea value={form.do_list} onChange={e => setForm({ ...form, do_list: e.target.value })} rows={4}
                className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white" placeholder={"Use data-driven claims\nInclude risk disclaimers\nShow real platform screenshots"} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">❌ DON&apos;T (one per line)</label>
              <textarea value={form.dont_list} onChange={e => setForm({ ...form, dont_list: e.target.value })} rows={4}
                className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white" placeholder={"Promise guaranteed profits\nUse overly aggressive language\nMention competitors by name"} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Example Content (optional)</label>
            <textarea value={form.examples} onChange={e => setForm({ ...form, examples: e.target.value })} rows={3}
              className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white" placeholder="Paste a sample caption/post that represents the brand voice..." />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg">
              {editing ? '💾 Update' : '✨ Create'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-4">
        {guidelines.length === 0 && !showForm && (
          <div className="bg-gray-800/50 rounded-xl p-8 border border-gray-700/50 text-center">
            <p className="text-4xl mb-3">🏷️</p>
            <p className="text-gray-400">No brand guidelines yet</p>
            <p className="text-gray-600 text-sm mt-1">Create one to make AI-generated content match your brand voice</p>
          </div>
        )}
        {guidelines.map(g => (
          <div key={g.id} className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{g.brand_name}</h3>
                {g.tone_of_voice && <p className="text-sm text-blue-400">{g.tone_of_voice}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(g)} className="text-xs px-3 py-1 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg">✏️ Edit</button>
                <button onClick={() => handleDelete(g.id)} className="text-xs px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg">🗑️ Delete</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {g.target_market && <div><span className="text-gray-500">Target:</span> <span className="text-gray-300">{g.target_market}</span></div>}
              {g.key_messages && <div><span className="text-gray-500">Key Messages:</span> <span className="text-gray-300">{g.key_messages}</span></div>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-sm">
              {g.do_list?.length > 0 && (
                <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/10">
                  <p className="text-green-400 font-medium mb-1">✅ DO</p>
                  <ul className="text-gray-400 space-y-1">{g.do_list.map((d, i) => <li key={i}>• {d}</li>)}</ul>
                </div>
              )}
              {g.dont_list?.length > 0 && (
                <div className="bg-red-500/5 rounded-lg p-3 border border-red-500/10">
                  <p className="text-red-400 font-medium mb-1">❌ DON&apos;T</p>
                  <ul className="text-gray-400 space-y-1">{g.dont_list.map((d, i) => <li key={i}>• {d}</li>)}</ul>
                </div>
              )}
            </div>
            {g.examples && (
              <div className="mt-3 bg-gray-900/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Example Style:</p>
                <p className="text-gray-400 text-sm">{g.examples}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </PageStack>
  );
}
