'use client';

import { useEffect, useState } from 'react';
import { Button, FormField, LoadingState, Panel, SectionHeader, TextArea, TextInput } from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import { formatRupiah } from '@/lib/partnership/proposal';
import type { VerifiedFacts } from '@/lib/partnership/proposal-facts';
import type { LabelValue, OfflineMaterial, ProposalSettings, RateCardItem } from '@/lib/partnership/proposal-settings';
import { RowsEditor } from './rows-editor';

type SettingsResponse = { settings: ProposalSettings; defaults: ProposalSettings; facts: VerifiedFacts; canEdit: boolean; updatedAt: string | null; updatedByName: string | null };

const lv = (): LabelValue => ({ label: '', value: '' });
const LV_COLUMNS = [{ key: 'label' as const, label: 'Label' }, { key: 'value' as const, label: 'Value' }];

/** Admin settings: rate card, offline materials, and the "Dupoin by Numbers" figures. Members see them read-only. */
export function ProposalSettingsEditor({ onSaved }: { onSaved?: (settings: ProposalSettings) => void }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<ProposalSettings | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<SettingsResponse>('/api/partnership/proposal-settings').then(({ ok, data: body }) => {
      if (cancelled) return;
      if (!ok) { setMessage(body.error || 'Could not load settings.'); return; }
      setData(body); setDraft(body.settings);
    });
    return () => { cancelled = true; };
  }, []);

  if (!data || !draft) return message ? <Panel><p className="text-sm text-red-300">{message}</p></Panel> : <LoadingState label="Loading settings" />;
  const readOnly = !data.canEdit;
  const set = <K extends keyof ProposalSettings>(key: K, value: ProposalSettings[K]) => setDraft({ ...draft, [key]: value });

  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const { ok, data: body } = await fetchJson<{ settings: ProposalSettings }>('/api/partnership/proposal-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: draft }) });
      if (!ok) { setMessage(body.error || 'Could not save.'); return; }
      setDraft(body.settings); setMessage('Settings saved. New and re-saved proposals use them.'); onSaved?.(body.settings);
    } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!window.confirm('Reset the rate card and figures to the defaults from the approved proposals?')) return;
    setBusy(true); setMessage('');
    try {
      const { ok, data: body } = await fetchJson<{ settings: ProposalSettings }>('/api/partnership/proposal-settings', { method: 'DELETE' });
      if (!ok) { setMessage(body.error || 'Could not reset.'); return; }
      setDraft(body.settings); setMessage('Settings reset to defaults.'); onSaved?.(body.settings);
    } finally { setBusy(false); }
  };

  const lvBlock = (title: string, key: 'activeUsers' | 'tradedLots' | 'ageDistribution' | 'occupation' | 'marketRegions' | 'instagramStats' | 'websiteStats') => <div>
    <p className="mb-2 text-xs font-medium text-[var(--mos-text-secondary)]">{title}</p>
    <RowsEditor rows={draft[key]} columns={LV_COLUMNS} blank={lv} readOnly={readOnly} onChange={rows => set(key, rows)} />
  </div>;

  return <div className="space-y-4">
    <Panel>
      <SectionHeader
        title="Rate card"
        description={readOnly ? 'Set by an admin. Exposure values and package totals are computed from it.' : 'Values per unit, in Rupiah. Use {partner} in Platform to insert the partner name.'}
        action={!readOnly && <span className="flex gap-2"><Button size="sm" disabled={busy} onClick={reset}>Reset to defaults</Button><Button size="sm" variant="primary" disabled={busy} onClick={save}>Save settings</Button></span>}
        className="mb-3"
      />
      <RowsEditor<RateCardItem>
        rows={draft.rateCard}
        readOnly={readOnly}
        columns={[{ key: 'content', label: 'Content', width: '28%' }, { key: 'platform', label: 'Platform', width: '30%' }, { key: 'quantityLabel', label: 'Quantity', width: '18%' }, { key: 'value', label: 'Value (Rp)', type: 'number', width: '18%' }]}
        blank={() => ({ id: '', content: '', platform: '', quantityLabel: '1x', value: 0 })}
        onChange={rows => set('rateCard', rows)}
        addLabel="Add rate card item"
      />
      <p className="mt-2 text-xs text-[var(--mos-text-faint)]">{draft.rateCard.map(item => `${item.content}: ${formatRupiah(item.value)}`).join(' · ')}</p>
      {message && <p className="mt-3 text-sm text-[var(--mos-accent-soft)]" role="status">{message}</p>}
      {data.updatedAt && <p className="mt-1 text-xs text-[var(--mos-text-faint)]">Last changed {new Date(data.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{data.updatedByName ? ` by ${data.updatedByName}` : ''}.</p>}
    </Panel>

    <Panel>
      <SectionHeader title="Offline materials" className="mb-3" />
      <RowsEditor<OfflineMaterial>
        rows={draft.offlineMaterials}
        readOnly={readOnly}
        columns={[{ key: 'material', label: 'Material' }, { key: 'content', label: 'Content' }, { key: 'placement', label: 'Placement' }, { key: 'quantity', label: 'Qty', type: 'number', width: '10%' }]}
        blank={() => ({ id: '', material: '', content: '', placement: '', quantity: 1 })}
        onChange={rows => set('offlineMaterials', rows)}
        addLabel="Add material"
      />
    </Panel>

    <Panel>
      <SectionHeader title="Dupoin by Numbers" description="Copied from the approved proposals. Update them when Marketing confirms new figures; do not estimate." className="mb-3" />
      <div className="grid gap-4 lg:grid-cols-2">
        {draft.snapshots.map((snapshot, index) => <div key={index} className="space-y-2 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3">
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Year"><TextInput value={snapshot.year} disabled={readOnly} onChange={event => set('snapshots', draft.snapshots.map((item, i) => (i === index ? { ...item, year: event.target.value } : item)))} /></FormField>
            <FormField label="Title"><TextInput value={snapshot.title} disabled={readOnly} onChange={event => set('snapshots', draft.snapshots.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))} /></FormField>
          </div>
          <RowsEditor
            rows={snapshot.cells}
            readOnly={readOnly}
            columns={[{ key: 'value', label: 'Value', width: '22%' }, { key: 'label', label: 'Label' }, { key: 'caption', label: 'Caption' }]}
            blank={() => ({ value: '', label: '', caption: '' })}
            onChange={cells => set('snapshots', draft.snapshots.map((item, i) => (i === index ? { ...item, cells } : item)))}
            addLabel="Add cell"
          />
        </div>)}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {lvBlock('Active users by year', 'activeUsers')}
        {lvBlock('Traded lot volume by year', 'tradedLots')}
        <FormField label="Active users note"><TextArea rows={3} value={draft.activeUsersNote} disabled={readOnly} onChange={event => set('activeUsersNote', event.target.value)} /></FormField>
        <FormField label="Traded lots note"><TextArea rows={3} value={draft.tradedLotsNote} disabled={readOnly} onChange={event => set('tradedLotsNote', event.target.value)} /></FormField>
      </div>
    </Panel>

    <Panel>
      <SectionHeader title="Demographics and market landscape" className="mb-3" />
      <div className="grid gap-4 lg:grid-cols-2">
        {lvBlock('Age distribution', 'ageDistribution')}
        {lvBlock('Occupation', 'occupation')}
        <FormField label="Demographics note" className="lg:col-span-2"><TextInput value={draft.demographicsNote} disabled={readOnly} onChange={event => set('demographicsNote', event.target.value)} /></FormField>
        <FormField label="Market headline" className="lg:col-span-2"><TextInput value={draft.marketHeadline} disabled={readOnly} onChange={event => set('marketHeadline', event.target.value)} /></FormField>
        {lvBlock('User share by region', 'marketRegions')}
      </div>
    </Panel>

    <Panel>
      <SectionHeader title="Products and digital assets" className="mb-3" />
      <div className="grid gap-3 md:grid-cols-3">
        <FormField label="Instrument count"><TextInput value={draft.productCount} disabled={readOnly} onChange={event => set('productCount', event.target.value)} /></FormField>
        <FormField label="Count label"><TextInput value={draft.productLabel} disabled={readOnly} onChange={event => set('productLabel', event.target.value)} /></FormField>
        <FormField label="Categories" hint="Comma separated"><TextInput value={draft.productCategories.join(', ')} disabled={readOnly} onChange={event => set('productCategories', event.target.value.split(',').map(item => item.trim()).filter(Boolean))} /></FormField>
        <FormField label="Instagram handle"><TextInput value={draft.instagramHandle} disabled={readOnly} onChange={event => set('instagramHandle', event.target.value)} /></FormField>
        <FormField label="Instagram URL" className="md:col-span-2"><TextInput value={draft.instagramUrl} disabled={readOnly} spellCheck={false} onChange={event => set('instagramUrl', event.target.value)} /></FormField>
        <FormField label="Website domain"><TextInput value={draft.websiteDomain} disabled={readOnly} onChange={event => set('websiteDomain', event.target.value)} /></FormField>
        <FormField label="Website URL" className="md:col-span-2"><TextInput value={draft.websiteUrl} disabled={readOnly} spellCheck={false} onChange={event => set('websiteUrl', event.target.value)} /></FormField>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {lvBlock('Instagram stats', 'instagramStats')}
        {lvBlock('Website stats', 'websiteStats')}
      </div>
    </Panel>

    <Panel>
      <SectionHeader title="Verified facts (locked)" description="About Dupoin, the license, and awards are fixed text, never written by AI. They change only through a code review." className="mb-3" />
      <ul className="space-y-1 text-sm text-[var(--mos-text-secondary)]">
        <li>{data.facts.licenseLabel}: {data.facts.licenseNumber}</li>
        <li>Supervised by {data.facts.supervision.join(', ')} · Member of {data.facts.memberships.join(', ')}</li>
        {data.facts.awards.map(award => <li key={award.title}>{award.title} {award.year} ({award.by})</li>)}
        <li>{data.facts.rating.title} {data.facts.rating.years} ({data.facts.rating.by})</li>
      </ul>
    </Panel>
  </div>;
}
