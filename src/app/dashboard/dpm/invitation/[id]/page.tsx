// src/app/dashboard/dpm/invitation/[id]/page.tsx
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FilterGroup, FormField, LoadingState, MetricCard, PageHeader, PageStack, Panel, Select, TextInput, Toolbar,
} from '@/components/ui/dashboard';
import type { PresentedEvent, PresentedResponse } from '@/lib/dpm-invitation/present';
import type { ResponseCounts, ResponseFilter } from '@/lib/dpm-invitation/types';
import { ACCEPT_IMAGES, InvitationStatusBadge, readJson } from '../shared';

const FILTERS: Array<[ResponseFilter, string]> = [['all', 'All'], ['attending', 'Attending'], ['not-attending', 'Not attending'], ['allergy', 'Has allergies']];

export default function DpmInvitationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<PresentedEvent | null>(null);
  const [counts, setCounts] = useState<ResponseCounts | null>(null);
  const [responses, setResponses] = useState<PresentedResponse[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [filter, setFilter] = useState<ResponseFilter>('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const applyEvent = useCallback((next: PresentedEvent) => {
    setEvent(next);
    setName(next.name);
    setSlug(next.slug);
    setClosesAt(next.closesAtInput);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/dpm/invitations/${id}`, { cache: 'no-store', signal: controller.signal }).then(r => readJson<{ event?: PresentedEvent }>(r).then(d => ({ ok: r.ok, d }))),
      fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }), signal: controller.signal }).then(r => r.json()),
    ]).then(([result, auth]) => {
      if (controller.signal.aborted) return;
      if (!result.ok || !result.d.event) { setError(result.d.error || 'Invitation not found.'); return; }
      applyEvent(result.d.event);
      setIsAdmin(auth.user?.role === 'admin');
    }).catch(() => { if (!controller.signal.aborted) setError('Could not load the invitation.'); });
    return () => controller.abort();
  }, [id, applyEvent]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const query = new URLSearchParams({ q: debouncedQ, filter }).toString();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dpm/invitations/${id}/responses?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await readJson<{ counts?: ResponseCounts; responses?: PresentedResponse[] }>(response) }))
      .then(({ ok, data }) => {
        if (!ok) { setError(data.error || 'Could not load responses.'); return; }
        setCounts(data.counts || null);
        setResponses(data.responses || []);
      })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load responses.'); });
    return () => controller.abort();
  }, [id, query, reloadKey]);

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true); setError(''); setNotice('');
    const response = await fetch(`/api/dpm/invitations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await readJson<{ event?: PresentedEvent }>(response);
    setBusy(false);
    if (!response.ok || !data.event) { setError(data.error || 'Could not save.'); return; }
    applyEvent(data.event);
    setNotice(done);
  }

  async function replaceImage(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    const form = new FormData();
    form.set('image', file);
    const response = await fetch(`/api/dpm/invitations/${id}/image`, { method: 'PUT', body: form });
    const data = await readJson<{ event?: PresentedEvent }>(response);
    setBusy(false);
    if (!response.ok || !data.event) { setError(data.error || 'Could not replace the image.'); return; }
    applyEvent(data.event);
    setNotice('Image replaced.');
  }

  async function deleteOne(row: PresentedResponse) {
    if (!window.confirm(`Delete this response? ${row.fullName} (${row.email}) will be removed.`)) return;
    const response = await fetch(`/api/dpm/invitations/${id}/responses/${row.id}`, { method: 'DELETE' });
    if (!response.ok) { setError((await readJson(response)).error || 'Could not delete the response.'); return; }
    setNotice('Response deleted.');
    setReloadKey(key => key + 1);
  }

  async function deleteInvitation() {
    if (!event || confirmSlug !== event.slug) return;
    const response = await fetch(`/api/dpm/invitations/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: confirmSlug }) });
    if (!response.ok) { setError((await readJson(response)).error || 'Could not delete the invitation.'); return; }
    router.push('/dashboard/dpm/invitation');
  }

  async function copyLink() {
    if (!event) return;
    await navigator.clipboard.writeText(`${window.location.origin}${event.publicPath}`);
    setNotice('Link copied.');
  }

  if (!event) return error ? <PageStack><EmptyState title={error} action={<Link href="/dashboard/dpm/invitation">Back to invitations</Link>} /></PageStack> : <LoadingState label="Loading invitation" />;

  const slugChanged = slug.trim().toLowerCase() !== event.slug;
  const exportHref = (format: 'xlsx' | 'csv') => `/api/dpm/invitations/${id}/export?format=${format}&${query}`;

  return (
    <PageStack>
      <PageHeader eyebrow="DPM Invitation" title={event.name} description={event.publicPath}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <InvitationStatusBadge event={event} />
            <Button size="sm" onClick={copyLink}>Copy link</Button>
            <a href={event.publicPath} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost">Open page</Button></a>
            {event.status === 'open'
              ? <Button size="sm" disabled={busy} onClick={() => patch({ status: 'closed' }, 'Registration closed.')}>Close registration</Button>
              : <Button size="sm" variant="primary" disabled={busy} onClick={() => patch({ status: 'open' }, 'Registration opened.')}>Open registration</Button>}
          </div>
        )} />
      {error && <Panel padding="compact" className="text-sm text-red-300">{error}</Panel>}
      {notice && <Panel padding="compact" className="text-sm text-emerald-300">{notice}</Panel>}
      {event.status === 'open' && event.closedReason === 'auto' && (
        <Panel padding="compact" className="text-sm text-amber-200">The closing time has passed. Clear or move “Closes at (WIB)” to accept answers again.</Panel>
      )}

      <Panel padding="none" className="grid grid-cols-2 md:grid-cols-4">
        <MetricCard label="Responses" value={counts?.total ?? 0} />
        <MetricCard label="Attending" value={counts?.attending ?? 0} />
        <MetricCard label="Not attending" value={counts?.notAttending ?? 0} />
        <MetricCard label="With allergies" value={counts?.withAllergies ?? 0} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Panel>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Event name"><TextInput value={name} maxLength={120} onChange={e => setName(e.target.value)} /></FormField>
            <FormField label="Link name" hint={`/i/${slug}`}
              error={slugChanged ? `The old link /i/${event.slug} will stop working. Anyone with it will see “This invitation link is not valid.”` : undefined}>
              <TextInput value={slug} maxLength={60} onChange={e => setSlug(e.target.value.toLowerCase())} />
            </FormField>
            <FormField label="Closes at (WIB)" hint={event.closesAtWib ?? 'No closing time'}>
              <TextInput type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
            </FormField>
            <div className="flex items-end gap-2">
              <Button variant="primary" disabled={busy} onClick={() => patch({ name, slug, closesAt }, 'Saved.')}>Save changes</Button>
              {closesAt && <Button variant="ghost" disabled={busy} onClick={() => patch({ closesAt: '' }, 'Closing time cleared.')}>Clear closing time</Button>}
            </div>
          </div>
        </Panel>
        <Panel padding="none" className="p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={event.imageUrl} alt={event.name} width={event.imageWidth} height={event.imageHeight} className="h-auto w-full rounded" />
          <label className="mt-3 block text-xs text-[var(--mos-text-secondary)]">
            Replace image
            <input type="file" accept={ACCEPT_IMAGES} disabled={busy} className="mt-2 block w-full text-xs" onChange={e => void replaceImage(e.target.files?.[0])} />
          </label>
        </Panel>
      </div>

      <Toolbar>
        <FilterGroup>
          <TextInput className="max-w-xs" placeholder="Search name or email" value={q} onChange={e => setQ(e.target.value)} />
          <Select value={filter} onChange={e => setFilter(e.target.value as ResponseFilter)}>
            {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </FilterGroup>
        <div className="flex gap-2">
          <a href={exportHref('xlsx')}><Button size="sm">Export Excel</Button></a>
          <a href={exportHref('csv')}><Button size="sm" variant="ghost">Export CSV</Button></a>
        </div>
      </Toolbar>

      <DataTableFrame title="Responses" description={`${responses.length} shown`}>
        {responses.length === 0 ? (
          <EmptyState title={debouncedQ || filter !== 'all' ? 'No responses match' : 'No responses yet'} description="Share the link to collect answers." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] text-[var(--mos-text-muted)]">
              <tr>{['Full name', 'Email', 'Attending', 'Allergy', 'Allergy notes', 'Updated', 'Submissions', ''].map(h => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {responses.map(row => (
                <tr key={row.id} className="border-t border-[var(--mos-border-subtle)]">
                  <td className="px-5 py-3 text-[var(--mos-text)]">{row.fullName}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{row.email}</td>
                  <td className="px-5 py-3">{row.attending ? 'Yes' : 'No'}</td>
                  <td className="px-5 py-3">{row.hasAllergy === null ? '—' : row.hasAllergy ? 'Yes' : 'No'}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{row.allergyNotes ?? '—'}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{row.updatedAtWib}</td>
                  <td className="px-5 py-3">{row.submissionCount}</td>
                  <td className="px-5 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => void deleteOne(row)}>Delete</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableFrame>

      {isAdmin && (
        <Panel className="border-red-400/20">
          <p className="text-sm font-medium text-red-300">Delete invitation</p>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Deletes the page, the image and all {counts?.total ?? 0} responses. This cannot be undone. Type <strong>{event.slug}</strong> to confirm.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <TextInput className="max-w-xs" value={confirmSlug} onChange={e => setConfirmSlug(e.target.value)} placeholder={event.slug} />
            <Button variant="danger" disabled={confirmSlug !== event.slug} onClick={() => void deleteInvitation()}>Delete invitation</Button>
          </div>
        </Panel>
      )}
    </PageStack>
  );
}
