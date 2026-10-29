'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  Button, DataTableFrame, LoadingState, PageHeader, PageStack, Panel, StatusBadge, TextArea, TextInput,
} from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import { ContentStatusBadge } from '@/components/seo/ContentStatusBadge';
import { ACTION_LABELS, type ContentAction, type ContentStatus } from '@/lib/seo/content-status';
import { diffStats, lineDiff } from '@/lib/seo/diff';
import { markdownToHtml } from '@/lib/seo/markdown';

type Draft = {
  id: string; site_id: string; site_name: string; site_url: string; queue_item_id: string | null; keyword: string; case_study: string | null;
  instructions: string | null; target_page_url: string | null; brand_guideline_name: string | null; sop_id?: string | null; sop_title?: string | null; title: string; slug: string;
  meta_description: string; body_markdown: string; status: ContentStatus; current_version: number; model: string | null;
  fallback_label: string | null; published_url: string | null; published_at: string | null; approved_by_name: string | null;
  approved_at: string | null; created_by_name: string | null; updated_by_name: string | null; created_at: string; updated_at: string;
};
type Version = {
  id: string; version: number; source: 'create' | 'edit' | 'ai-draft' | 'ai-rewrite' | 'restore'; title: string; slug: string; meta_description: string;
  body_markdown?: string; note: string | null; model: string | null; fallback_label: string | null; created_by_name: string | null; created_at: string;
};
type Detail = { draft: Draft; versions: Version[]; actions: ContentAction[]; canApprove: boolean };
type Form = { title: string; slug: string; metaDescription: string; bodyMarkdown: string };

const SOURCE_LABELS: Record<Version['source'], string> = { create: 'Created', edit: 'Edit', 'ai-draft': 'AI draft', 'ai-rewrite': 'AI rewrite', restore: 'Restore' };
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const toForm = (draft: Draft): Form => ({ title: draft.title, slug: draft.slug, metaDescription: draft.meta_description, bodyMarkdown: draft.body_markdown });
const asText = (item: { title: string; slug: string; meta_description?: string; metaDescription?: string; body_markdown?: string; bodyMarkdown?: string }) =>
  `# ${item.title}\nslug: ${item.slug}\nmeta: ${item.meta_description ?? item.metaDescription ?? ''}\n\n${item.body_markdown ?? item.bodyMarkdown ?? ''}`;

export default function ContentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ key: string; detail: Detail | null; error: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [publishUrl, setPublishUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [compare, setCompare] = useState<{ key: string; version: Version | null; error: string } | null>(null);
  const [compareId, setCompareId] = useState('');

  const key = `${id}:${reload}`;
  useEffect(() => {
    let cancelled = false;
    fetchJson<Detail>(`/api/seo/content/${encodeURIComponent(id)}`).then(({ ok, data }) => {
      if (cancelled) return;
      setState({ key, detail: ok ? data : null, error: ok ? '' : data.error || 'Could not load the article.' });
      if (ok) { setForm(toForm(data.draft)); setPublishUrl(current => current || data.draft.published_url || data.draft.target_page_url || ''); }
    }).catch(() => { if (!cancelled) setState({ key, detail: null, error: 'Could not load the article.' }); });
    return () => { cancelled = true; };
  }, [id, key]);

  const compareKey = compareId ? `${compareId}:${reload}` : '';
  useEffect(() => {
    if (!compareId) return;
    let cancelled = false;
    fetchJson<{ version: Version }>(`/api/seo/content/${encodeURIComponent(id)}/versions?versionId=${encodeURIComponent(compareId)}`).then(({ ok, data }) => {
      if (!cancelled) setCompare({ key: compareKey, version: ok ? data.version : null, error: ok ? '' : data.error || 'Could not load the version.' });
    }).catch(() => { if (!cancelled) setCompare({ key: compareKey, version: null, error: 'Could not load the version.' }); });
    return () => { cancelled = true; };
  }, [id, compareId, compareKey]);

  const detail = state?.detail ?? null;
  const draft = detail?.draft ?? null;
  const dirty = !!(draft && form) && (form.title !== draft.title || form.slug !== draft.slug || form.metaDescription !== draft.meta_description || form.bodyMarkdown !== draft.body_markdown);
  const previewHtml = useMemo(() => (preview && form ? markdownToHtml(form.bodyMarkdown) : ''), [preview, form]);
  const shownCompare = compare && compare.key === compareKey ? compare : null;
  const diff = useMemo(() => (shownCompare?.version && draft ? lineDiff(asText(shownCompare.version), asText(draft)) : null), [shownCompare, draft]);
  const words = form?.bodyMarkdown.trim() ? form.bodyMarkdown.trim().split(/\s+/).length : 0;

  const run = async (label: string, request: () => Promise<{ ok: boolean; status: number; data: Record<string, unknown> & { error?: string } }>, success: string) => {
    setBusy(label); setMessage(null);
    try {
      const { ok, status, data } = await request();
      if (ok) setMessage({ tone: 'info', text: data.unchanged ? 'No changes to save.' : success });
      else setMessage({ tone: 'error', text: (data.error || 'Something went wrong.') + (status === 409 ? ' Your unsaved edits are still in the editor; copy them before reloading.' : '') });
      if (ok) { setNote(''); setReload(value => value + 1); }
      return ok;
    } catch {
      setMessage({ tone: 'error', text: 'Something went wrong. Check your connection and try again.' });
      return false;
    } finally {
      setBusy('');
    }
  };

  const patch = (body: Record<string, unknown>) => fetchJson(`/api/seo/content/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if (!state) return <LoadingState label="Loading article" />;
  if (!detail || !draft || !form) return <PageStack>
    <PageHeader eyebrow="SEO OS / Content Studio" title="Article" />
    <Panel><p className="text-sm text-red-300">{state.error}</p><Link href="/dashboard/seo/content" className="mt-2 inline-block text-xs text-[var(--mos-accent-soft)] hover:underline">Back to Content Studio</Link></Panel>
  </PageStack>;

  const save = () => run('save', () => patch({ action: 'save', expectedVersion: draft.current_version, ...form, note }), `Saved as version ${draft.current_version + 1}.`);
  const action = (name: ContentAction) => {
    if (dirty) { setMessage({ tone: 'error', text: 'Save or discard your edits first.' }); return; }
    return run(name, () => patch({ action: name, url: publishUrl }), `${ACTION_LABELS[name]}: done.`);
  };
  const rewrite = () => run('rewrite', () => fetchJson(`/api/seo/content/${encodeURIComponent(id)}/rewrite`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction, expectedVersion: draft.current_version }),
  }), 'AI rewrite saved as a new version.').then(ok => { if (ok) setInstruction(''); });
  const restore = (version: Version) => {
    if (dirty) { setMessage({ tone: 'error', text: 'Save or discard your edits before restoring a version.' }); return; }
    return run(`restore-${version.id}`, () => patch({ action: 'restore', expectedVersion: draft.current_version, versionId: version.id }), `Version ${version.version} restored as version ${draft.current_version + 1}.`);
  };
  const set = (field: keyof Form) => (event: { target: { value: string } }) => setForm(previous => previous && ({ ...previous, [field]: event.target.value }));
  const exportHref = (format: 'md' | 'html') => `/api/seo/content/${encodeURIComponent(id)}/export?format=${format}`;
  const latest = detail.versions[0];
  const stats = diff ? diffStats(diff) : null;

  return <PageStack>
    <PageHeader
      eyebrow={`SEO OS / Content Studio / ${draft.site_name}`}
      title={draft.title || draft.keyword}
      description={`Keyword: ${draft.keyword}${draft.target_page_url ? ` · Improves ${draft.target_page_url}` : ' · New page'}`}
      actions={<div className="flex flex-wrap items-center gap-2">
        <Link href="/dashboard/seo/content" className="text-xs text-[var(--mos-text-muted)] hover:underline">All articles</Link>
        <ContentStatusBadge status={draft.status} />
        <a href={exportHref('md')} className="text-xs text-[var(--mos-accent-soft)] hover:underline">Export Markdown</a>
        <a href={exportHref('html')} className="text-xs text-[var(--mos-accent-soft)] hover:underline">Export HTML</a>
      </div>}
    />

    {message && <Panel><p className={`text-sm ${message.tone === 'error' ? 'text-red-300' : 'text-[var(--mos-text-secondary)]'}`}>{message.text}</p></Panel>}

    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1 text-xs text-[var(--mos-text-muted)]">
          <span>Version {draft.current_version} · {latest ? SOURCE_LABELS[latest.source] : ''} by {draft.updated_by_name ?? draft.created_by_name ?? '—'} · {formatTime(draft.updated_at)}</span>
          <span className="flex flex-wrap items-center gap-2">
            Model: {draft.model ?? '—'}
            {draft.fallback_label && <StatusBadge tone="warning">{draft.fallback_label}</StatusBadge>}
            · Brand: {draft.brand_guideline_name ?? 'Dupoin Futures (default)'}
            {draft.sop_title && <>· Follows SOP: <Link href="/dashboard/seo/sops" className="text-[var(--mos-accent-soft)] hover:underline">{draft.sop_title}</Link></>}
          </span>
          {draft.approved_by_name && <span>Approved by {draft.approved_by_name} · {formatTime(draft.approved_at)}</span>}
          {draft.published_url && <span>Live at <a href={draft.published_url} target="_blank" rel="noreferrer" className="text-[var(--mos-accent-soft)] hover:underline">{draft.published_url}</a> · {formatTime(draft.published_at)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {detail.actions.includes('publish') && <TextInput aria-label="Published URL" value={publishUrl} onChange={event => setPublishUrl(event.target.value)} placeholder={`${draft.site_url.replace(/\/$/, '')}/…`} className="w-72" />}
          {detail.actions.map(name => {
            const blocked = name === 'approve' && !detail.canApprove;
            return <Button key={name} size="sm" variant={name === 'request-changes' || name === 'unqueue' ? 'secondary' : 'primary'} disabled={!!busy || blocked}
              title={blocked ? 'Authors cannot approve their own article. Ask a teammate or an admin.' : undefined} onClick={() => action(name)}>
              {busy === name ? 'Working…' : ACTION_LABELS[name]}
            </Button>;
          })}
        </div>
      </div>
      {detail.actions.includes('approve') && !detail.canApprove && <p className="mt-2 text-xs text-[var(--mos-text-faint)]">You wrote this article, so someone else (or an admin) needs to approve it.</p>}
      {draft.status !== 'draft' && draft.status !== 'published' && <p className="mt-2 text-xs text-[var(--mos-text-faint)]">Saving an edit or an AI rewrite sends the article back to Draft so it gets reviewed again.</p>}
    </Panel>

    <Panel>
      <div className="grid gap-3">
        <label className="grid gap-1 text-xs text-[var(--mos-text-muted)]">Title <span className="text-[var(--mos-text-faint)]">{form.title.length}/60 recommended</span>
          <TextInput value={form.title} onChange={set('title')} maxLength={300} />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-[var(--mos-text-muted)]">Slug
            <TextInput value={form.slug} onChange={set('slug')} maxLength={200} />
          </label>
          <label className="grid gap-1 text-xs text-[var(--mos-text-muted)]">Meta description <span className="text-[var(--mos-text-faint)]">{form.metaDescription.length}/155 recommended</span>
            <TextInput value={form.metaDescription} onChange={set('metaDescription')} maxLength={500} />
          </label>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--mos-text-muted)]">Article (Markdown) · {words.toLocaleString('en-US')} words</span>
          <div className="flex gap-1">
            <Button size="sm" variant={preview ? 'secondary' : 'primary'} onClick={() => setPreview(false)}>Write</Button>
            <Button size="sm" variant={preview ? 'primary' : 'secondary'} onClick={() => setPreview(true)}>Preview</Button>
          </div>
        </div>
        {preview
          // markdownToHtml escapes all raw HTML and only emits safe tags/links, so this is not an XSS sink.
          ? <article className="seo-preview max-h-[70vh] overflow-auto rounded-lg border border-[var(--mos-border)] p-5 text-sm leading-6 text-[var(--mos-text-secondary)] [&_a]:text-[var(--mos-accent-soft)] [&_a]:underline [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-white [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-white [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc [&_blockquote]:border-l-2 [&_blockquote]:pl-3" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          : <TextArea rows={24} value={form.bodyMarkdown} onChange={set('bodyMarkdown')} className="font-mono text-xs leading-5" />}
        <div className="flex flex-wrap items-center gap-2">
          <TextInput value={note} onChange={event => setNote(event.target.value)} placeholder="What changed? (optional, shown in history)" maxLength={500} className="min-w-[240px] flex-1" />
          <Button variant="primary" disabled={!dirty || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save version'}</Button>
          <Button disabled={!dirty || !!busy} onClick={() => setForm(toForm(draft))}>Discard edits</Button>
        </div>
      </div>
    </Panel>

    <Panel>
      <h2 className="mb-2 text-sm font-semibold text-white">AI rewrite</h2>
      <p className="mb-3 text-xs text-[var(--mos-text-muted)]">Rewrites the saved version (not unsaved edits) and stores the result as a new version you can diff or undo.</p>
      <div className="flex flex-wrap gap-2">
        <TextInput value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="e.g. Add an FAQ section, shorten the intro, use more of the case study numbers" maxLength={4000} className="min-w-[280px] flex-1" />
        <Button variant="primary" disabled={!instruction.trim() || !!busy || dirty} title={dirty ? 'Save or discard your edits first' : undefined} onClick={rewrite}>{busy === 'rewrite' ? 'Rewriting…' : 'Rewrite with AI'}</Button>
      </div>
    </Panel>

    {(draft.case_study || draft.instructions) && <Panel>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-white">Brief</summary>
        {draft.instructions && <p className="mt-3 text-xs text-[var(--mos-text-muted)]">Instructions: {draft.instructions}</p>}
        {draft.case_study && <pre className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[var(--mos-text-secondary)]">{draft.case_study}</pre>}
      </details>
    </Panel>}

    <DataTableFrame title={`Version history (${detail.versions.length})`} description="Every save, AI draft, AI rewrite and restore is kept. Compare any version with the current one, or restore it as a new version.">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Version</th><th className="p-3">Change</th><th className="p-3">Model</th><th className="p-3">By</th><th className="p-3">When</th><th className="p-3 text-right" /></tr></thead>
        <tbody>
          {detail.versions.map(version => <tr key={version.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
            <td className="p-3 text-white">v{version.version}{version.version === draft.current_version && <span className="ml-2"><StatusBadge tone="info">Current</StatusBadge></span>}</td>
            <td className="max-w-[280px] p-3"><span className="block">{SOURCE_LABELS[version.source]}</span>{version.note && <span className="block truncate text-xs text-[var(--mos-text-faint)]" title={version.note}>{version.note}</span>}</td>
            <td className="p-3 text-xs">{version.model ?? '—'}{version.fallback_label && <span className="mt-1 block"><StatusBadge tone="warning">{version.fallback_label}</StatusBadge></span>}</td>
            <td className="p-3">{version.created_by_name ?? '—'}</td>
            <td className="p-3">{formatTime(version.created_at)}</td>
            <td className="p-3 text-right">{version.version !== draft.current_version && <span className="flex justify-end gap-2">
              <Button size="sm" variant={compareId === version.id ? 'primary' : 'secondary'} onClick={() => setCompareId(compareId === version.id ? '' : version.id)}>{compareId === version.id ? 'Hide diff' : 'Diff'}</Button>
              <Button size="sm" disabled={!!busy} onClick={() => restore(version)}>{busy === `restore-${version.id}` ? 'Restoring…' : 'Restore'}</Button>
            </span>}</td>
          </tr>)}
        </tbody>
      </table>
    </DataTableFrame>

    {compareId && <Panel>
      {!shownCompare && <p className="text-sm text-[var(--mos-text-muted)]">Loading version…</p>}
      {shownCompare?.error && <p className="text-sm text-red-300">{shownCompare.error}</p>}
      {shownCompare?.version && diff && stats && <>
        <h2 className="mb-2 text-sm font-semibold text-white">v{shownCompare.version.version} → v{draft.current_version} (current) · <span className="text-emerald-300">+{stats.added}</span> <span className="text-red-300">−{stats.removed}</span> lines</h2>
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-[var(--mos-border)] p-3 font-mono text-xs leading-5">
          {diff.map((line, index) => <div key={index} className={line.type === 'add' ? 'bg-emerald-400/10 text-emerald-200' : line.type === 'remove' ? 'bg-red-400/10 text-red-200' : 'text-[var(--mos-text-faint)]'}>
            {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}{line.text || ' '}
          </div>)}
        </pre>
      </>}
    </Panel>}
  </PageStack>;
}
