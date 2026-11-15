'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button, DataTableFrame, EmptyState, FormField, LoadingState, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextArea, TextInput,
} from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import { ProposalSettingsEditor } from '@/components/partnership/proposal-settings-editor';
import {
  SECTION_KEYS, SECTION_LABELS, TEMPLATE_LABELS, computeTotals, formatRupiah,
  type ExposureSelection, type NeedItem, type OfflineSelection, type ProposalContent, type ProposalInput, type ProposalTemplate, type SectionKey,
} from '@/lib/partnership/proposal';
import { DEFAULT_PROPOSAL_SETTINGS, type ProposalSettings } from '@/lib/partnership/proposal-settings';

type Summary = {
  id: string; partnerName: string; template: ProposalTemplate; language: 'id' | 'en'; status: 'draft' | 'final'; version: number;
  packageTotal: number; createdByName: string | null; updatedByName: string | null; updatedAt: string; canDelete: boolean;
};
type Version = { id: string; version: number; note: string; createdByName: string | null; createdAt: string };
type Detail = {
  proposal: Summary & { input: ProposalInput; content: ProposalContent; partnerLogo: string | null; model: string | null };
  versions: Version[];
  canDelete: boolean;
};
type View = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'settings' };

const when = (value: string) => new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function emptyInput(settings: ProposalSettings): ProposalInput {
  return {
    partnerName: '', partnerDescription: '', objective: 'User Acquisition', collaborationScheme: '', userBenefit: '',
    exposures: settings.rateCard.slice(0, 4).map(item => ({ itemId: item.id, content: item.content, platform: item.platform, quantityLabel: item.quantityLabel, unitValue: item.value, units: 1 })),
    offline: [], needs: [], baseFee: null, notes: '', language: 'id', template: 'slide', useCompetitorInsights: false, year: String(new Date().getFullYear()),
  };
}

const NARRATIVE_EDITORS: Partial<Record<SectionKey, Array<{ field: keyof ProposalContent; label: string; list?: boolean; rows?: number }>>> = {
  projectOverview: [{ field: 'title', label: 'Cover title', rows: 1 }, { field: 'projectOverview', label: 'Project overview', rows: 6 }],
  marketLandscape: [{ field: 'marketInsight', label: 'Market insight (optional, from Competitor Intelligence)', rows: 3 }],
  collaborationScheme: [
    { field: 'schemeGoal', label: 'Main goal line', rows: 1 },
    { field: 'schemeHeading', label: 'Reward heading', rows: 1 },
    { field: 'schemeBullets', label: 'Scheme points (one per line)', list: true, rows: 4 },
    { field: 'userJourney', label: 'User journey steps (one per line, max 4 on slides)', list: true, rows: 4 },
  ],
  digitalExposure: [{ field: 'exposureHighlights', label: '"What we offer" bullets (one per line)', list: true, rows: 4 }],
  valuePackage: [{ field: 'partnerSupport', label: 'Support from partner (one per line)', list: true, rows: 3 }],
  notes: [{ field: 'notes', label: 'Notes on costs (one per line)', list: true, rows: 3 }],
};

const FIXED_HINT: Partial<Record<SectionKey, string>> = {
  aboutDupoin: 'Verified facts: company profile, BAPPEBTI/OJK/BI supervision, JFX/KBI/ASPEBTINDO membership, license 423/BAPPEBTI/SI/VII/2004. Not editable here.',
  numbers: 'Figures from Settings (business snapshots, active users, traded lots).',
  demographics: 'Figures from Settings (age and occupation).',
  products: 'From Settings (instrument count and categories).',
  awards: 'Verified awards and the A+++ Bappebti rating. Not editable here.',
  digitalAssets: 'Instagram and website stats from Settings.',
  offlineMaterials: 'Table from the materials picked in the brief.',
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function BriefForm({ input, setInput, settings, logo, setLogo }: {
  input: ProposalInput; setInput: (next: ProposalInput) => void; settings: ProposalSettings; logo: string | null; setLogo: (next: string | null) => void;
}) {
  const [logoError, setLogoError] = useState('');
  const set = <K extends keyof ProposalInput>(key: K, value: ProposalInput[K]) => setInput({ ...input, [key]: value });
  const exposureFor = (id: string) => input.exposures.find(item => item.itemId === id);
  const offlineFor = (id: string) => input.offline.find(item => item.materialId === id);
  const toggleExposure = (id: string, checked: boolean) => {
    const card = settings.rateCard.find(item => item.id === id);
    if (!card) return;
    set('exposures', checked
      ? [...input.exposures, { itemId: id, content: card.content, platform: card.platform, quantityLabel: card.quantityLabel, unitValue: card.value, units: 1 }]
      : input.exposures.filter(item => item.itemId !== id));
  };
  const setUnits = (id: string, units: number) => set('exposures', input.exposures.map(item => (item.itemId === id ? { ...item, units: Math.max(1, Math.min(100, units || 1)) } : item)));
  const toggleOffline = (material: ProposalSettings['offlineMaterials'][number], checked: boolean) => set('offline', checked
    ? [...input.offline, { materialId: material.id, material: material.material, content: material.content, placement: material.placement, quantity: material.quantity }]
    : input.offline.filter(item => item.materialId !== material.id));
  const updateOffline = (id: string, patch: Partial<OfflineSelection>) => set('offline', input.offline.map(item => (item.materialId === id ? { ...item, ...patch } : item)));
  const updateNeed = (index: number, patch: Partial<NeedItem>) => set('needs', input.needs.map((need, i) => (i === index ? { ...need, ...patch } : need)));
  const orphanExposures = input.exposures.filter(item => !settings.rateCard.some(card => card.id === item.itemId));

  const onLogo = async (file: File | undefined) => {
    setLogoError('');
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { setLogoError('Use a PNG or JPEG file.'); return; }
    if (file.size > 700 * 1024) { setLogoError('The logo must be 700 KB or smaller.'); return; }
    setLogo(await readFileAsDataUrl(file));
  };

  const num = (value: string) => (value.trim() === '' ? null : Number(value.replace(/[^\d]/g, '')));

  return <div className="space-y-5">
    <div className="grid gap-3 md:grid-cols-2">
      <FormField label="Partner name" required><TextInput value={input.partnerName} maxLength={120} placeholder="e.g. Kopi Kenangan" onChange={event => set('partnerName', event.target.value)} /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Template">
          <Select value={input.template} onChange={event => set('template', event.target.value as ProposalTemplate)}>
            <option value="slide">{TEMPLATE_LABELS.slide}</option>
            <option value="document">{TEMPLATE_LABELS.document}</option>
          </Select>
        </FormField>
        <FormField label="Language">
          <Select value={input.language} onChange={event => set('language', event.target.value as 'id' | 'en')}>
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Partner industry / description" className="md:col-span-2"><TextArea rows={2} maxLength={2000} value={input.partnerDescription} placeholder="What the partner does, who its customers are" onChange={event => set('partnerDescription', event.target.value)} /></FormField>
      <FormField label="Partner logo (optional, PNG/JPEG up to 700 KB)">
        <div className="flex items-center gap-3">
          <input type="file" accept="image/png,image/jpeg" className="text-xs text-[var(--mos-text-muted)]" onChange={event => { void onLogo(event.target.files?.[0]); event.target.value = ''; }} />
          {logo && <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="Partner logo preview" className="h-10 max-w-[120px] rounded bg-white object-contain p-1" />
            <Button size="sm" variant="ghost" onClick={() => setLogo(null)}>Remove</Button>
          </>}
        </div>
        {logoError && <span className="mt-1 block text-xs text-red-300">{logoError}</span>}
      </FormField>
      <FormField label="Objective"><TextInput value={input.objective} maxLength={300} placeholder="User Acquisition" onChange={event => set('objective', event.target.value)} /></FormField>
      <FormField label="Collaboration scheme" className="md:col-span-2"><TextArea rows={3} maxLength={2000} value={input.collaborationScheme} placeholder="How the collaboration works" onChange={event => set('collaborationScheme', event.target.value)} /></FormField>
      <FormField label="User benefit / promo" className="md:col-span-2"><TextArea rows={2} maxLength={1000} value={input.userBenefit} placeholder="e.g. IDR 30K voucher for new Dupoin users, valid three months" onChange={event => set('userBenefit', event.target.value)} /></FormField>
    </div>

    <div>
      <SectionHeader title="Digital exposure" description="Values come from the rate card in Settings. Units multiply the package." className="mb-2" />
      <div className="space-y-2">
        {settings.rateCard.map(card => {
          const selected = exposureFor(card.id);
          return <div key={card.id} className="flex flex-wrap items-center gap-3 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 py-2 text-sm">
            <label className="flex min-w-[260px] flex-1 items-center gap-2 text-[var(--mos-text-secondary)]">
              <input type="checkbox" checked={Boolean(selected)} onChange={event => toggleExposure(card.id, event.target.checked)} />
              <span><span className="text-[var(--mos-text)]">{card.content}</span> · {card.platform.replace(/\{partner\}/g, input.partnerName || 'Partner')} · {card.quantityLabel}</span>
            </label>
            <span className="tabular-nums text-xs text-[var(--mos-text-muted)]">{formatRupiah(card.value)}</span>
            {selected && <label className="flex items-center gap-2 text-xs text-[var(--mos-text-muted)]">Units
              <TextInput className="w-16" inputMode="numeric" value={String(selected.units)} aria-label={`${card.content} units`} onChange={event => setUnits(card.id, Number(event.target.value.replace(/[^\d]/g, '')))} />
            </label>}
          </div>;
        })}
        {orphanExposures.map((item: ExposureSelection) => <p key={item.itemId} className="text-xs text-amber-200">{item.content} is no longer on the rate card; it keeps its saved value {formatRupiah(item.unitValue)}. Untick to remove: <button type="button" className="underline" onClick={() => set('exposures', input.exposures.filter(row => row.itemId !== item.itemId))}>remove</button></p>)}
      </div>
    </div>

    <div>
      <SectionHeader title="Offline materials" className="mb-2" />
      <div className="space-y-2">
        {settings.offlineMaterials.map(material => {
          const selected = offlineFor(material.id);
          return <div key={material.id} className="flex flex-wrap items-center gap-3 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 py-2 text-sm">
            <label className="flex min-w-[220px] flex-1 items-center gap-2 text-[var(--mos-text-secondary)]">
              <input type="checkbox" checked={Boolean(selected)} onChange={event => toggleOffline(material, event.target.checked)} />
              <span><span className="text-[var(--mos-text)]">{material.material}</span> · {material.content}</span>
            </label>
            {selected && <>
              <TextInput className="w-56" value={selected.placement} aria-label={`${material.material} placement`} placeholder="Placement" onChange={event => updateOffline(material.id, { placement: event.target.value })} />
              <TextInput className="w-16" inputMode="numeric" value={String(selected.quantity)} aria-label={`${material.material} quantity`} onChange={event => updateOffline(material.id, { quantity: Math.max(1, Number(event.target.value.replace(/[^\d]/g, '')) || 1) })} />
            </>}
          </div>;
        })}
      </div>
    </div>

    <div>
      <SectionHeader title="What we need from the partner" description="e.g. 1000 vouchers @ Rp 30.000. Leave value empty for non-cash items." className="mb-2" />
      <div className="space-y-2">
        {input.needs.map((need, index) => <div key={index} className="grid gap-2 md:grid-cols-[1fr_110px_150px_auto]">
          <TextInput value={need.description} placeholder="Description" aria-label={`Need ${index + 1} description`} onChange={event => updateNeed(index, { description: event.target.value })} />
          <TextInput value={need.quantity ?? ''} inputMode="numeric" placeholder="Qty" aria-label={`Need ${index + 1} quantity`} onChange={event => updateNeed(index, { quantity: num(event.target.value) })} />
          <TextInput value={need.unitValue ?? ''} inputMode="numeric" placeholder="Unit value (Rp)" aria-label={`Need ${index + 1} unit value`} onChange={event => updateNeed(index, { unitValue: num(event.target.value) })} />
          <Button size="sm" variant="ghost" onClick={() => set('needs', input.needs.filter((_, i) => i !== index))}>Remove</Button>
        </div>)}
        <Button size="sm" onClick={() => set('needs', [...input.needs, { description: '', quantity: null, unitValue: null }])}>Add item</Button>
      </div>
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      <FormField label="Base partnership fee (Rp)" hint="Empty = (TBD)"><TextInput inputMode="numeric" value={input.baseFee ?? ''} onChange={event => set('baseFee', num(event.target.value))} /></FormField>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-[var(--mos-text-secondary)]">
        <input type="checkbox" checked={input.useCompetitorInsights} onChange={event => set('useCompetitorInsights', event.target.checked)} />
        Use latest Competitor Intelligence insights in Market Landscape
      </label>
      <FormField label="Notes" className="md:col-span-2"><TextArea rows={2} maxLength={2000} value={input.notes} placeholder="Cost notes or terms, one per line" onChange={event => set('notes', event.target.value)} /></FormField>
    </div>
  </div>;
}

function TotalsBar({ input }: { input: ProposalInput }) {
  const totals = computeTotals(input);
  return <div className="grid gap-3 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3 text-sm sm:grid-cols-4">
    <div><p className="text-[11px] text-[var(--mos-text-muted)]">Digital exposure</p><p className="tabular-nums text-[var(--mos-text)]">{formatRupiah(totals.exposureTotal)}</p></div>
    <div><p className="text-[11px] text-[var(--mos-text-muted)]">Partner contribution</p><p className="tabular-nums text-[var(--mos-text)]">{formatRupiah(totals.needTotal)}</p></div>
    <div><p className="text-[11px] text-[var(--mos-text-muted)]">Base fee</p><p className="tabular-nums text-[var(--mos-text)]">{totals.baseFee === null ? '(TBD)' : formatRupiah(totals.baseFee)}</p></div>
    <div><p className="text-[11px] text-[var(--mos-text-muted)]">Package total</p><p className="tabular-nums font-medium text-[var(--mos-accent-soft)]">{formatRupiah(totals.packageTotal)}</p></div>
  </div>;
}

function SectionsEditor({ content, setContent }: { content: ProposalContent; setContent: (next: ProposalContent) => void }) {
  return <div className="space-y-3">
    {SECTION_KEYS.map(key => {
      const editors = NARRATIVE_EDITORS[key] ?? [];
      return <Panel key={key} padding="compact">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--mos-text)]">
            <input type="checkbox" checked={content.include[key]} onChange={event => setContent({ ...content, include: { ...content.include, [key]: event.target.checked } })} />
            {SECTION_LABELS[key]}
          </label>
          {!editors.length && <StatusBadge tone="neutral">Locked</StatusBadge>}
        </div>
        {FIXED_HINT[key] && <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{FIXED_HINT[key]}</p>}
        {content.include[key] && editors.map(editor => {
          const value = content[editor.field];
          const text = Array.isArray(value) ? value.join('\n') : String(value ?? '');
          return <FormField key={editor.field} label={editor.label} className="mt-3">
            {editor.rows === 1
              ? <TextInput value={text} onChange={event => setContent({ ...content, [editor.field]: event.target.value })} />
              : <TextArea rows={editor.rows} value={text} onChange={event => setContent({ ...content, [editor.field]: editor.list ? event.target.value.split('\n') : event.target.value })} />}
          </FormField>;
        })}
      </Panel>;
    })}
  </div>;
}

const cleanContent = (content: ProposalContent): ProposalContent => ({
  ...content,
  schemeBullets: content.schemeBullets.map(item => item.trim()).filter(Boolean),
  userJourney: content.userJourney.map(item => item.trim()).filter(Boolean),
  exposureHighlights: content.exposureHighlights.map(item => item.trim()).filter(Boolean),
  partnerSupport: content.partnerSupport.map(item => item.trim()).filter(Boolean),
  notes: content.notes.map(item => item.trim()).filter(Boolean),
});

export default function ProposalBuilderPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [proposals, setProposals] = useState<Summary[] | null>(null);
  const [settings, setSettings] = useState<ProposalSettings>(DEFAULT_PROPOSAL_SETTINGS);
  const [input, setInput] = useState<ProposalInput>(() => emptyInput(DEFAULT_PROPOSAL_SETTINGS));
  const [logo, setLogo] = useState<string | null>(null);
  const [content, setContent] = useState<ProposalContent | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [canTemplate, setCanTemplate] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const { ok, data } = await fetchJson<{ proposals: Summary[] }>('/api/partnership/proposals');
    if (!ok) { setMessage(data.error || 'Could not load proposals.'); return; }
    setProposals(data.proposals);
  }, []);

  const loadSettings = useCallback(async () => {
    const { ok, data } = await fetchJson<{ settings: ProposalSettings }>('/api/partnership/proposal-settings');
    if (ok) setSettings(data.settings);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const { ok, data } = await fetchJson<Detail>(`/api/partnership/proposals/${encodeURIComponent(id)}`);
    if (!ok) { setMessage(data.error || 'Could not load the proposal.'); return; }
    setDetail(data); setInput(data.proposal.input); setContent(data.proposal.content); setLogo(data.proposal.partnerLogo); setDirty(false); setPendingModel(null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList(); void loadSettings(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadList, loadSettings]);

  const openNew = () => { setMessage(''); setCanTemplate(false); setDetail(null); setContent(null); setLogo(null); setInput(emptyInput(settings)); setView({ kind: 'new' }); };
  const openEdit = (id: string) => { setMessage(''); setDetail(null); setView({ kind: 'edit', id }); void loadDetail(id); };
  const editInput = (next: ProposalInput) => { setInput(next); setDirty(true); };
  const editContent = (next: ProposalContent) => { setContent(next); setDirty(true); };
  const editLogo = (next: string | null) => { setLogo(next); setDirty(true); };

  const create = async (mode: 'ai' | 'template') => {
    setBusy(mode === 'ai' ? 'Drafting with AI…' : 'Creating…'); setMessage(''); setCanTemplate(false);
    try {
      const { ok, data } = await fetchJson<{ id: string; droppedSentences: number; canUseTemplate?: boolean }>('/api/partnership/proposals', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input, partnerLogo: logo, mode }),
      });
      if (!ok) { setMessage(data.error || 'Could not create the proposal.'); setCanTemplate(Boolean(data.canUseTemplate)); return; }
      setMessage(data.droppedSentences ? `Draft created. ${data.droppedSentences} AI sentence(s) with unverified numbers or claims were removed.` : 'Draft created. Review every section, then export.');
      await loadList();
      setView({ kind: 'edit', id: data.id });
      await loadDetail(data.id);
    } finally { setBusy(''); }
  };

  const save = async (status?: 'draft' | 'final', note?: string) => {
    if (view.kind !== 'edit' || !content) return;
    setBusy('Saving…'); setMessage('');
    try {
      const { ok, data } = await fetchJson<{ version: number }>(`/api/partnership/proposals/${encodeURIComponent(view.id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input, content: cleanContent(content), partnerLogo: logo, status, note: note || (status === 'final' ? 'Marked final' : 'Edited'), model: pendingModel }),
      });
      if (!ok) { setMessage(data.error || 'Could not save.'); return; }
      setMessage(`Saved as version ${data.version}.`);
      await Promise.all([loadDetail(view.id), loadList()]);
    } finally { setBusy(''); }
  };

  const redraft = async () => {
    if (view.kind !== 'edit') return;
    if (dirty && !window.confirm('Replace the narrative sections with a new AI draft? Unsaved text edits will be lost (form changes are kept).')) return;
    setBusy('Drafting with AI…'); setMessage('');
    try {
      const { ok, data } = await fetchJson<{ content: ProposalContent; model: string | null; droppedSentences: number }>(`/api/partnership/proposals/${encodeURIComponent(view.id)}/draft`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }),
      });
      if (!ok) { setMessage(data.error || 'The AI draft failed. Your current text is unchanged.'); return; }
      setContent(data.content); setDirty(true); setPendingModel(data.model);
      setMessage(`New AI draft loaded${data.model ? ` (${data.model})` : ''}. It is not saved yet — review, then Save draft.`);
    } finally { setBusy(''); }
  };

  const loadVersion = async (version: Version) => {
    if (view.kind !== 'edit') return;
    const { ok, data } = await fetchJson<{ input: ProposalInput; content: ProposalContent }>(`/api/partnership/proposals/${encodeURIComponent(view.id)}/versions/${encodeURIComponent(version.id)}`);
    if (!ok) { setMessage(data.error || 'Could not load that version.'); return; }
    setInput(data.input); setContent(data.content); setDirty(true);
    setMessage(`Version ${version.version} loaded into the editor. Save to make it the latest version.`);
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete the proposal for ${name} and its history?`)) return;
    const { ok, data } = await fetchJson(`/api/partnership/proposals/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!ok) { setMessage(data.error || 'Could not delete.'); return; }
    if (view.kind === 'edit' && view.id === id) setView({ kind: 'list' });
    await loadList();
  };

  const exportHref = (format: 'pdf' | 'pptx', template: ProposalTemplate, inline = false) =>
    view.kind === 'edit' ? `/api/partnership/proposals/${encodeURIComponent(view.id)}/export?format=${format}&template=${template}${inline ? '&inline=1' : ''}` : '#';

  const header = <PageHeader
    eyebrow="Partnership"
    title="Proposal Builder"
    description="B2B collaboration proposals in the Dupoin Slide 16:9 or Document A4 template. AI drafts the narrative; facts, figures, and totals come from verified data and the rate card."
    actions={<>
      <Button variant={view.kind === 'list' ? 'primary' : 'secondary'} onClick={() => { setView({ kind: 'list' }); void loadList(); }}>Proposals</Button>
      <Button variant={view.kind === 'settings' ? 'primary' : 'secondary'} onClick={() => setView({ kind: 'settings' })}>Settings</Button>
      <Button variant={view.kind === 'new' ? 'primary' : 'secondary'} onClick={openNew}>New proposal</Button>
    </>}
  />;

  return <PageStack>
    {header}
    {message && <Panel padding="compact"><p className="text-sm text-[var(--mos-text-secondary)]" role="status">{message}</p>
      {canTemplate && view.kind === 'new' && <Button size="sm" className="mt-2" onClick={() => create('template')}>Create from template instead</Button>}
    </Panel>}

    {view.kind === 'settings' && <ProposalSettingsEditor onSaved={next => setSettings(next)} />}

    {view.kind === 'list' && <DataTableFrame title="Proposals" description="Drafts and final versions, newest first.">
      {!proposals && <LoadingState label="Loading proposals" />}
      {proposals && !proposals.length && <EmptyState title="No proposals yet" description="Create one from a partner brief." action={<Button variant="primary" onClick={openNew}>New proposal</Button>} />}
      {proposals && proposals.length > 0 && <table className="w-full min-w-[820px] text-sm">
        <thead><tr className="border-b border-[var(--mos-border)] text-left text-xs text-[var(--mos-text-muted)]">
          <th className="p-3 font-medium">Partner</th><th className="p-3 font-medium">Template</th><th className="p-3 font-medium">Language</th><th className="p-3 font-medium">Status</th>
          <th className="p-3 text-right font-medium">Package</th><th className="p-3 font-medium">Updated</th><th className="p-3" />
        </tr></thead>
        <tbody>{proposals.map(item => <tr key={item.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
          <td className="p-3"><button type="button" className="font-medium text-[var(--mos-text)] hover:underline" onClick={() => openEdit(item.id)}>{item.partnerName}</button></td>
          <td className="p-3">{TEMPLATE_LABELS[item.template]}</td>
          <td className="p-3 uppercase">{item.language}</td>
          <td className="p-3"><StatusBadge tone={item.status === 'final' ? 'success' : 'neutral'}>{item.status === 'final' ? 'Final' : 'Draft'} · v{item.version}</StatusBadge></td>
          <td className="p-3 text-right tabular-nums">{formatRupiah(item.packageTotal)}</td>
          <td className="p-3 text-xs">{when(item.updatedAt)}{item.updatedByName ? ` · ${item.updatedByName}` : ''}</td>
          <td className="p-3 text-right"><span className="flex justify-end gap-2">
            <Button size="sm" onClick={() => openEdit(item.id)}>Open</Button>
            {item.canDelete && <Button size="sm" variant="ghost" onClick={() => remove(item.id, item.partnerName)}>Delete</Button>}
          </span></td>
        </tr>)}</tbody>
      </table>}
    </DataTableFrame>}

    {view.kind === 'new' && <Panel>
      <SectionHeader title="Partner brief" description="Fill the brief, then let AI draft the narrative or start from the approved template text." className="mb-4" />
      <BriefForm input={input} setInput={setInput} settings={settings} logo={logo} setLogo={setLogo} />
      <div className="mt-5"><TotalsBar input={input} /></div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" disabled={Boolean(busy) || !input.partnerName.trim()} onClick={() => create('ai')}>{busy || 'Draft with AI'}</Button>
        <Button disabled={Boolean(busy) || !input.partnerName.trim()} onClick={() => create('template')}>Start from template</Button>
      </div>
    </Panel>}

    {view.kind === 'edit' && !detail && <LoadingState label="Loading proposal" />}
    {view.kind === 'edit' && detail && content && <>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-[var(--mos-text)]">{detail.proposal.partnerName}</h2>
            <p className="mt-1 text-xs text-[var(--mos-text-muted)]">
              {TEMPLATE_LABELS[input.template]} · {input.language === 'en' ? 'English' : 'Bahasa Indonesia'} · v{detail.proposal.version} · {detail.proposal.status === 'final' ? 'Final' : 'Draft'}
              {detail.proposal.model && ` · drafted with ${detail.proposal.model}`}{dirty && ' · unsaved changes'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={Boolean(busy)} onClick={() => save('draft')}>{busy === 'Saving…' ? busy : 'Save draft'}</Button>
            <Button disabled={Boolean(busy)} onClick={() => save('final')}>Mark final</Button>
            <Button disabled={Boolean(busy)} onClick={redraft}>{busy === 'Drafting with AI…' ? busy : 'Re-draft with AI'}</Button>
            {detail.canDelete && <Button variant="ghost" onClick={() => remove(detail.proposal.id, detail.proposal.partnerName)}>Delete</Button>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--mos-border-subtle)] pt-4">
          <span className="text-xs text-[var(--mos-text-muted)]">Export {dirty ? '(saved version — save first to include edits)' : ''}:</span>
          <a className="inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-xs text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]" href={exportHref('pdf', 'slide')}>PDF · Slide 16:9</a>
          <a className="inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-xs text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]" href={exportHref('pptx', 'slide')}>PPTX · Slide 16:9</a>
          <a className="inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-xs text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]" href={exportHref('pdf', 'document')}>PDF · Document A4</a>
          <a className="inline-flex h-8 items-center rounded-[var(--mos-radius-control)] px-3 text-xs text-[var(--mos-accent-soft)] hover:underline" href={exportHref('pdf', input.template, true)} target="_blank" rel="noopener noreferrer">Preview</a>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <SectionHeader title="Brief" description="Changing exposures or needs updates the computed totals." className="mb-4" />
          <BriefForm input={input} setInput={editInput} settings={settings} logo={logo} setLogo={editLogo} />
          <div className="mt-5"><TotalsBar input={input} /></div>
        </Panel>
        <div className="space-y-4">
          <SectionHeader title="Sections" description="Untick to leave a section out. Narrative text is editable; facts and figures are locked." />
          <SectionsEditor content={content} setContent={editContent} />
          <Panel padding="compact">
            <SectionHeader title="Version history" className="mb-2" />
            <ul className="space-y-1 text-sm">
              {detail.versions.map(version => <li key={version.id} className="flex items-center justify-between gap-2 text-[var(--mos-text-secondary)]">
                <span>v{version.version} · {version.note || 'Saved'} · <span className="text-xs text-[var(--mos-text-muted)]">{when(version.createdAt)}{version.createdByName ? ` · ${version.createdByName}` : ''}</span></span>
                {version.version !== detail.proposal.version && <Button size="sm" variant="ghost" onClick={() => loadVersion(version)}>Load</Button>}
              </li>)}
            </ul>
          </Panel>
        </div>
      </div>
    </>}
  </PageStack>;
}
