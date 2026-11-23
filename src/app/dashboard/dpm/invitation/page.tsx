// src/app/dashboard/dpm/invitation/page.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, DataTableFrame, EmptyState, FormField, LoadingState, PageHeader, PageStack, Panel, TextInput } from '@/components/ui/dashboard';
import type { PresentedEvent } from '@/lib/dpm-invitation/present';
import { formatWib, slugIssue, suggestSlug } from '@/lib/dpm-invitation/rules';
import { ACCEPT_IMAGES, InvitationStatusBadge, readJson } from './shared';

type FieldErrors = Partial<Record<'name' | 'slug' | 'closesAt' | 'image', string>>;

export default function DpmInvitationListPage() {
  const router = useRouter();
  const [events, setEvents] = useState<PresentedEvent[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [closesAt, setClosesAt] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dpm/invitations', { cache: 'no-store', signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await readJson<{ events?: PresentedEvent[] }>(response) }))
      .then(({ ok, data }) => {
        if (!ok) setError(data.error || 'Could not load invitations.');
        setEvents(data.events || []);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError('Could not load invitations.');
        setEvents([]);
      });
    return () => controller.abort();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = 'Enter an event name.';
    const issue = slugIssue(slug);
    if (issue) errors.slug = issue;
    if (!image) errors.image = 'Choose an invitation image.';
    setFieldErrors(errors);
    if (Object.keys(errors).length || !image) return;
    setSaving(true);
    setError('');
    const form = new FormData();
    form.set('name', name);
    form.set('slug', slug);
    form.set('closesAt', closesAt);
    form.set('image', image);
    const response = await fetch('/api/dpm/invitations', { method: 'POST', body: form });
    const data = await readJson<{ event?: PresentedEvent }>(response);
    setSaving(false);
    if (response.ok && data.event) { router.push(`/dashboard/dpm/invitation/${data.event.id}`); return; }
    if (data.field) setFieldErrors({ [data.field]: data.error });
    else setError(data.error || 'Could not create the invitation.');
  }

  if (!events) return <LoadingState label="Loading invitations" />;

  return (
    <PageStack>
      <PageHeader eyebrow="DPM" title="Invitation" description="Invitation pages for DPM events. Guests answer without logging in."
        actions={<Button variant="primary" onClick={() => setCreating(value => !value)}>{creating ? 'Cancel' : 'New invitation'}</Button>} />
      {error && <Panel padding="compact" className="text-sm text-red-300">{error}</Panel>}

      {creating && (
        <Panel>
          <form onSubmit={create} className="grid gap-4 md:grid-cols-2" noValidate>
            <FormField label="Event name" required error={fieldErrors.name}>
              <TextInput value={name} maxLength={120} placeholder="DPM Gala Dinner 2027" onChange={e => {
                setName(e.target.value);
                if (!slugTouched) setSlug(suggestSlug(e.target.value));
              }} />
            </FormField>
            <FormField label="Link name" hint={`/i/${slug || 'your-link'}`} required error={fieldErrors.slug}>
              <TextInput value={slug} maxLength={60} onChange={e => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} />
            </FormField>
            <FormField label="Closes at (WIB)" hint="Optional" error={fieldErrors.closesAt}>
              <TextInput type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
            </FormField>
            <FormField label="Invitation image" hint="JPG, PNG or WebP, up to 8 MB" required error={fieldErrors.image}>
              <input type="file" accept={ACCEPT_IMAGES} className="block w-full text-sm text-[var(--mos-text-secondary)]" onChange={e => setImage(e.target.files?.[0] ?? null)} />
            </FormField>
            <div className="md:col-span-2">
              <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create invitation'}</Button>
            </div>
          </form>
        </Panel>
      )}

      <DataTableFrame title="Invitations">
        {events.length === 0 ? (
          <EmptyState title="No invitations yet" description="Create one, then share its link with employees."
            action={<Button variant="primary" onClick={() => setCreating(true)}>New invitation</Button>} />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] text-[var(--mos-text-muted)]">
              <tr>{['Event', 'Link', 'Status', 'Responses', 'Attending', 'Allergies', 'Closes at', 'Last response'].map(h => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {events.map(event => (
                <tr key={event.id} className="border-t border-[var(--mos-border-subtle)]">
                  <td className="px-5 py-3"><Link className="font-medium text-[var(--mos-text)] hover:underline" href={`/dashboard/dpm/invitation/${event.id}`}>{event.name}</Link></td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{event.publicPath}</td>
                  <td className="px-5 py-3"><InvitationStatusBadge event={event} /></td>
                  <td className="px-5 py-3">{event.counts?.total ?? 0}</td>
                  <td className="px-5 py-3">{event.counts?.attending ?? 0}</td>
                  <td className="px-5 py-3">{event.counts?.withAllergies ?? 0}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{event.closesAtWib ?? '—'}</td>
                  <td className="px-5 py-3 text-[var(--mos-text-muted)]">{event.lastResponseAt ? formatWib(new Date(event.lastResponseAt)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableFrame>
    </PageStack>
  );
}
