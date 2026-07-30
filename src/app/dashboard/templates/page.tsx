'use client';
import { useState, useEffect } from 'react';
import { Button, EmptyState, FilterGroup, FormField, Panel, PageHeader, PageStack, SectionHeader, Select, StatusBadge, TextArea, TextInput, Toolbar } from '@/components/ui/dashboard';

interface Template {
  id: string;
  name: string;
  type: string;
  platform: string | null;
  brief_template: string | null;
  output_template: string | null;
  tags: string | null;
  use_count: number;
  created_at: string | null;
  is_builtin: boolean;
}

const TYPES = ['social-post', 'video-script', 'event-plan'];
const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Twitter/X', 'LinkedIn', 'Facebook'];
const TYPE_LABELS: Record<string, string> = {
  'social-post': 'Social Post',
  'video-script': 'Video Script',
  'event-plan': 'Event Plan',
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
    <PageStack>
      <PageHeader eyebrow="Library / Reusable briefs" title="Template library" description="Template bawaan dan brief reusable untuk mempercepat content generation. Template buatan Anda tersimpan per akun." actions={<Button variant="primary" onClick={handleNew}>New template</Button>} />

      {/* Filters */}
      <Toolbar><FilterGroup>
        {['all', ...TYPES].map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              filter === t ? 'bg-blue-600 text-white' : 'bg-[var(--mos-raised)] text-[var(--mos-text-muted)] hover:text-white hover:bg-[var(--mos-raised)]'
            }`}
          >
            {t === 'all' ? 'All' : TYPE_LABELS[t] || t}
          </button>
        ))}
      </FilterGroup></Toolbar>

      {/* Template Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <Panel className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <SectionHeader className="mb-4" title={editingTemplate ? 'Edit template' : 'New template'} />
            <div className="space-y-4">
              <FormField label="Name" required>
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Template name"
                />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[var(--mos-text-muted)] mb-1 block">Type *</label>
                  <Select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-[var(--mos-text-muted)] mb-1 block">Platform</label>
                  <Select
                    value={form.platform}
                    onChange={(e) => setForm({ ...form, platform: e.target.value })}
                  >
                    <option value="">Any</option>
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--mos-text-muted)] mb-1 block">Brief Template</label>
                <TextArea
                  value={form.brief_template}
                  onChange={(e) => setForm({ ...form, brief_template: e.target.value })}
                  rows={4}
                  placeholder="Template brief with placeholders..."
                />
              </div>
              <div>
                <label className="text-xs text-[var(--mos-text-muted)] mb-1 block">Output Template (JSON)</label>
                <TextArea
                  value={form.output_template}
                  onChange={(e) => setForm({ ...form, output_template: e.target.value })}
                  rows={3}
                  className="font-mono"
                  placeholder='{"format": "...", "sections": [...]}'
                />
              </div>
              <div>
                <label className="text-xs text-[var(--mos-text-muted)] mb-1 block">Tags (comma-separated)</label>
                <TextInput
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="promo, launch, seasonal"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <Button variant="primary" className="flex-1" onClick={handleSave}>
                {editingTemplate ? 'Update' : 'Create'} Template
              </Button>
              <Button onClick={() => { setShowForm(false); setEditingTemplate(null); }}>
                Cancel
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {/* Template Cards */}
      {templates.length === 0 ? (
        <Panel padding="none"><EmptyState title="No templates yet" description="Create your first template to get started." /></Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(template => (
            <Panel key={template.id} className="transition-colors hover:border-[var(--mos-border-strong)]">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-white font-medium">{template.name}</h3>
                  <p className="text-xs text-[var(--mos-text-faint)] mt-0.5">{TYPE_LABELS[template.type] || template.type}</p>
                </div>
                <StatusBadge>{template.is_builtin ? 'Built-in' : `Used ${template.use_count}x`}</StatusBadge>
              </div>

              {template.platform && (
                <span className="inline-block text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded mb-2">{template.platform}</span>
              )}

              {template.brief_template && (
                <p className="text-xs text-[var(--mos-text-muted)] line-clamp-3 mb-3">{template.brief_template}</p>
              )}

              {template.tags && (
                <div className="flex gap-1 flex-wrap mb-3">
                  {template.tags.split(',').map((tag, i) => (
                    <span key={i} className="text-[10px] bg-[var(--mos-raised)] text-[var(--mos-text-faint)] px-2 py-0.5 rounded">{tag.trim()}</span>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-3 border-t border-[var(--mos-border)]">
                <Button variant="primary" size="sm" className="flex-1" onClick={() => handleUse(template)}>
                  Use Template
                </Button>
                {!template.is_builtin && (
                  <>
                    <Button size="sm" onClick={() => handleEdit(template)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(template.id)}>Delete</Button>
                  </>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </PageStack>
  );
}
