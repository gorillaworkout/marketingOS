'use client';
import { useState, useEffect } from 'react';

interface Template {
  id: string;
  name: string;
  type: string;
  platform: string | null;
  brief_template: string | null;
  output_template: string | null;
  tags: string | null;
  use_count: number;
  created_at: string;
}

const TYPES = ['social-post', 'video-script', 'event-plan'];
const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Twitter/X', 'LinkedIn', 'Facebook'];
const TYPE_LABELS: Record<string, string> = {
  'social-post': '📱 Social Post',
  'video-script': '🎬 Video Script',
  'event-plan': '📋 Event Plan',
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [form, setForm] = useState({ name: '', type: 'social-post', platform: '', brief_template: '', output_template: '', tags: '' });
  const [saveMessage, setSaveMessage] = useState('');

  const fetchTemplates = async () => {
    const params = filter !== 'all' ? `?type=${filter}` : '';
    const res = await fetch(`/api/templates${params}`);
    const data = await res.json();
    if (data.templates) setTemplates(data.templates);
  };

  useEffect(() => { fetchTemplates(); }, [filter]);

  const handleSave = async () => {
    if (!form.name || !form.type) return;
    const body: any = {
      name: form.name,
      type: form.type,
      platform: form.platform || null,
      brief_template: form.brief_template || null,
      output_template: form.output_template || null,
      tags: form.tags || null,
    };

    if (editingTemplate) {
      body.id = editingTemplate.id;
      await fetch('/api/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    setShowForm(false);
    setEditingTemplate(null);
    resetForm();
    fetchTemplates();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/templates?id=${id}`, { method: 'DELETE' });
    fetchTemplates();
  };

  const handleUse = async (template: Template) => {
    await fetch('/api/templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: template.id, increment_use: true }),
    });
    // Navigate to the generator with template data
    const url = `/dashboard/${template.type}?template=${encodeURIComponent(template.brief_template || '')}`;
    window.location.href = url;
  };

  const handleEdit = (template: Template) => {
    setEditingTemplate(template);
    setForm({
      name: template.name,
      type: template.type,
      platform: template.platform || '',
      brief_template: template.brief_template || '',
      output_template: template.output_template || '',
      tags: template.tags || '',
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setForm({ name: '', type: 'social-post', platform: '', brief_template: '', output_template: '', tags: '' });
  };

  const handleNew = () => {
    setEditingTemplate(null);
    resetForm();
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Template Library</h1>
          <p className="text-gray-400 text-sm mt-1">Reusable templates for content generation</p>
        </div>
        <button onClick={handleNew} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">
          + New Template
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {['all', ...TYPES].map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              filter === t ? 'bg-blue-600 text-white' : 'bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            {t === 'all' ? 'All' : TYPE_LABELS[t] || t}
          </button>
        ))}
      </div>

      {/* Template Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-white mb-4">{editingTemplate ? 'Edit Template' : 'New Template'}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="Template name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Type *</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Platform</label>
                  <select
                    value={form.platform}
                    onChange={(e) => setForm({ ...form, platform: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="">Any</option>
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Brief Template</label>
                <textarea
                  value={form.brief_template}
                  onChange={(e) => setForm({ ...form, brief_template: e.target.value })}
                  rows={4}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="Template brief with placeholders..."
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Output Template (JSON)</label>
                <textarea
                  value={form.output_template}
                  onChange={(e) => setForm({ ...form, output_template: e.target.value })}
                  rows={3}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono"
                  placeholder='{"format": "...", "sections": [...]}'
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Tags (comma-separated)</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="promo, launch, seasonal"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={handleSave} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-2.5 rounded-lg">
                {editingTemplate ? 'Update' : 'Create'} Template
              </button>
              <button onClick={() => { setShowForm(false); setEditingTemplate(null); }} className="px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2.5 rounded-lg">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Cards */}
      {templates.length === 0 ? (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-12 text-center">
          <p className="text-gray-500">No templates yet. Create your first template to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(template => (
            <div key={template.id} className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-5 hover:border-gray-600/50 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-white font-medium">{template.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{TYPE_LABELS[template.type] || template.type}</p>
                </div>
                <span className="text-xs bg-gray-700/50 text-gray-400 px-2 py-1 rounded-full">
                  Used {template.use_count}x
                </span>
              </div>

              {template.platform && (
                <span className="inline-block text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded mb-2">{template.platform}</span>
              )}

              {template.brief_template && (
                <p className="text-xs text-gray-400 line-clamp-3 mb-3">{template.brief_template}</p>
              )}

              {template.tags && (
                <div className="flex gap-1 flex-wrap mb-3">
                  {template.tags.split(',').map((tag, i) => (
                    <span key={i} className="text-[10px] bg-gray-700/50 text-gray-500 px-2 py-0.5 rounded">{tag.trim()}</span>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-3 border-t border-gray-700/30">
                <button
                  onClick={() => handleUse(template)}
                  className="flex-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs py-2 rounded-lg"
                >
                  Use Template
                </button>
                <button onClick={() => handleEdit(template)} className="text-xs text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-700/50">
                  Edit
                </button>
                <button onClick={() => handleDelete(template.id)} className="text-xs text-red-400 hover:text-red-300 px-3 py-2 rounded-lg hover:bg-red-500/10">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
