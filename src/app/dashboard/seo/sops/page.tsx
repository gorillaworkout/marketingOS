'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, DataTableFrame, EmptyState, LoadingState, PageHeader, PageStack, Panel, Select, StatusBadge, TextArea, TextInput } from '@/components/ui/dashboard';
import { fetchJson, useSeoSites } from '@/components/seo/useSeoSites';
import { markdownToHtml } from '@/lib/seo/markdown';
import { SOP_CATEGORIES, SOP_CATEGORY_LABELS, type SopCategory } from '@/lib/seo/sops';

type SopSummary = { id: string; title: string; category: SopCategory; updated_by_name: string | null; updated_at: string };
type SopRow = SopSummary & { body_md: string };
type Form = { id: string; title: string; category: SopCategory; bodyMd: string };

const PREVIEW_CLASS = 'seo-preview max-h-[70vh] overflow-auto rounded-lg border border-[var(--mos-border)] p-5 text-sm leading-6 text-[var(--mos-text-secondary)] [&_a]:text-[var(--mos-accent-soft)] [&_a]:underline [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-white [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-white [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc [&_blockquote]:border-l-2 [&_blockquote]:pl-3';

function formatTime(value: string): string {
  return new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB';
}

export default function SeoSopsPage() {
  const { data: sitesData, error: sitesError, loading } = useSeoSites();
  const isAdmin = !!sitesData?.isAdmin;
  const [version, setVersion] = useState(0);
  const [list, setList] = useState<{ version: number; sops: SopSummary[]; error: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ sops: SopSummary[] }>('/api/seo/sops').then(({ ok, data }) => {
      if (!cancelled) setList({ version, sops: ok ? data.sops : [], error: ok ? '' : data.error || 'Could not load SOPs.' });
    }).catch(() => { if (!cancelled) setList({ version, sops: [], error: 'Could not load SOPs.' }); });
    return () => { cancelled = true; };
  }, [version]);

  const previewHtml = useMemo(() => (form && preview ? markdownToHtml(form.bodyMd) : ''), [form, preview]);

  if (loading) return <LoadingState label="Loading SEO OS" />;
  const sops = list?.sops ?? [];
  const error = sitesError || list?.error || '';

  const open = async (id: string) => {
    setMessage('');
    const { ok, data } = await fetchJson<{ sop: SopRow }>(`/api/seo/sops/${encodeURIComponent(id)}`);
    if (!ok) { setMessage(data.error || 'Could not load the SOP.'); return; }
    setForm({ id: data.sop.id, title: data.sop.title, category: data.sop.category, bodyMd: data.sop.body_md });
    setPreview(true);
  };

  const save = async () => {
    if (!form) return;
    setBusy(true); setMessage('');
    const body = JSON.stringify({ title: form.title, category: form.category, bodyMd: form.bodyMd });
    const { ok, data } = form.id
      ? await fetchJson(`/api/seo/sops/${encodeURIComponent(form.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      : await fetchJson<{ id: string }>('/api/seo/sops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    setBusy(false);
    if (!ok) { setMessage(data.error || 'Could not save the SOP.'); return; }
    const id = form.id || String((data as { id?: string }).id ?? '');
    setForm({ ...form, id });
    setPreview(true);
    setMessage('Saved.');
    setVersion(value => value + 1);
  };

  const remove = async () => {
    if (!form?.id || !window.confirm(`Delete "${form.title}"? Articles that followed it keep their content.`)) return;
    const { ok, data } = await fetchJson(`/api/seo/sops/${encodeURIComponent(form.id)}`, { method: 'DELETE' });
    if (!ok) { setMessage(data.error || 'Could not delete the SOP.'); return; }
    setForm(null);
    setVersion(value => value + 1);
  };

  return <PageStack>
    <PageHeader eyebrow="SEO OS / SOPs" title="SOPs"
      description="The team's SEO playbooks, in Markdown. Content Studio can follow an SOP as extra instructions when it writes or rewrites an article."
      actions={<Button variant="primary" onClick={() => { setForm({ id: '', title: '', category: 'other', bodyMd: '' }); setPreview(false); setMessage(''); }}>New SOP</Button>} />

    {error && <Panel><p className="text-sm text-red-300">{error}</p></Panel>}
    {message && <Panel><p className="text-sm text-[var(--mos-text-secondary)]">{message}</p></Panel>}

    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <DataTableFrame title={`SOPs (${sops.length})`}>
        {!list ? <div className="p-4"><LoadingState label="Loading SOPs" /></div> : sops.length ? <div className="flex flex-col">
          {SOP_CATEGORIES.filter(category => sops.some(sop => sop.category === category)).map(category => <div key={category} className="border-b border-[var(--mos-border-subtle)] py-2">
            <p className="px-4 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--mos-text-faint)]">{SOP_CATEGORY_LABELS[category]}</p>
            {sops.filter(sop => sop.category === category).map(sop => <button key={sop.id} type="button" onClick={() => open(sop.id)}
              className={`block w-full px-4 py-2 text-left text-sm hover:bg-white/5 ${form?.id === sop.id ? 'text-[var(--mos-text)]' : 'text-[var(--mos-text-secondary)]'}`}>
              {sop.title}
              <span className="block text-[11px] text-[var(--mos-text-faint)]">Updated {formatTime(sop.updated_at)}{sop.updated_by_name ? ` by ${sop.updated_by_name}` : ''}</span>
            </button>)}
          </div>)}
        </div> : <EmptyState title="No SOPs yet" description="Create the first one with New SOP." />}
      </DataTableFrame>

      {form ? <Panel>
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 md:grid-cols-[1fr_220px]">
            <TextInput aria-label="Title" placeholder="Title" value={form.title} maxLength={200} onChange={event => setForm({ ...form, title: event.target.value })} />
            <Select aria-label="Category" value={form.category} onChange={event => setForm({ ...form, category: event.target.value as SopCategory })}>
              {SOP_CATEGORIES.map(category => <option key={category} value={category}>{SOP_CATEGORY_LABELS[category]}</option>)}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={preview ? 'secondary' : 'primary'} onClick={() => setPreview(false)}>Edit</Button>
            <Button size="sm" variant={preview ? 'primary' : 'secondary'} onClick={() => setPreview(true)}>Preview</Button>
            {!form.id && <StatusBadge tone="info">New</StatusBadge>}
          </div>
          {preview
            // markdownToHtml escapes all raw HTML and only emits safe tags/links, so this is not an XSS sink.
            ? <article className={PREVIEW_CLASS} dangerouslySetInnerHTML={{ __html: previewHtml || '<p>Nothing written yet.</p>' }} />
            : <TextArea aria-label="SOP body (Markdown)" value={form.bodyMd} onChange={event => setForm({ ...form, bodyMd: event.target.value })} className="min-h-[50vh] font-mono text-xs" placeholder="# Steps&#10;&#10;1. …" />}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={save} disabled={busy || !form.title.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>Close</Button>
            {isAdmin && form.id && <Button variant="danger" onClick={remove}>Delete</Button>}
          </div>
        </div>
      </Panel> : <Panel><EmptyState title="Pick an SOP" description="Open one from the list to read or edit it." /></Panel>}
    </div>
  </PageStack>;
}
