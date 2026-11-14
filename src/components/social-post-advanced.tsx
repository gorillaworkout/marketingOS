'use client';

import { useEffect, useState } from 'react';
import { Button, FormField, SectionHeader, Select, TextArea, TextInput } from '@/components/ui/dashboard';
import type { BrandVoiceChoice } from '@/lib/social-post-library';

type CampaignRecord = {
  id: string;
  name: string;
  status: string;
  startsOn?: string | null;
  endsOn?: string | null;
  objective?: string | null;
  keyFacts?: string[];
  approvedClaims?: string[];
  links?: { label: string; url: string }[];
  hashtags?: string[];
  notes?: string | null;
  updatedByName?: string | null;
  updatedAt?: string | null;
  canDelete?: boolean;
};

type Sample = { id: string; platform?: string | null; content_type?: string | null; caption: string };

const EMPTY_CAMPAIGN = {
  name: '', status: 'active', startsOn: '', endsOn: '', objective: '', keyFacts: '', approvedClaims: '', links: '', hashtags: '', notes: '',
};

export function SocialPostAdvanced({
  voices,
  brandGuidelineId,
  onBrandGuidelineId,
  onVoicesChanged,
  campaignId,
  onCampaignId,
  brief,
}: {
  voices: BrandVoiceChoice[];
  brandGuidelineId: string;
  onBrandGuidelineId: (id: string) => void;
  onVoicesChanged: () => void;
  campaignId: string;
  onCampaignId: (id: string) => void;
  brief: string;
}) {
  const voice = voices.find(item => item.id === brandGuidelineId) || null;
  const [samples, setSamples] = useState<Sample[]>([]);
  const [character, setCharacter] = useState(voice?.voice_character || '');
  const [banned, setBanned] = useState((voice?.banned_phrases || []).join('\n'));
  const [draftVoiceId, setDraftVoiceId] = useState(brandGuidelineId);
  if (draftVoiceId !== brandGuidelineId) {
    setDraftVoiceId(brandGuidelineId);
    setCharacter(voice?.voice_character || '');
    setBanned((voice?.banned_phrases || []).join('\n'));
  }
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [suggestion, setSuggestion] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_CAMPAIGN);
  const [editingId, setEditingId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!brandGuidelineId) return;
    let cancelled = false;
    fetch(`/api/brand-guidelines/${brandGuidelineId}/samples`)
      .then(response => response.ok ? response.json() : { samples: [] })
      .then(data => { if (!cancelled) setSamples(Array.isArray(data.samples) ? data.samples.slice(0, 2) : []); })
      .catch(() => { if (!cancelled) setSamples([]); });
    return () => { cancelled = true; };
  }, [brandGuidelineId]);

  const loadCampaigns = () => {
    fetch('/api/campaigns')
      .then(response => response.ok ? response.json() : { campaigns: [] })
      .then(data => setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []))
      .catch(() => setCampaigns([]));
  };

  useEffect(() => { loadCampaigns(); }, []);

  useEffect(() => {
    if (campaignId || brief.trim().length < 8) return;
    const timer = setTimeout(() => {
      fetch(`/api/campaigns?suggest=${encodeURIComponent(brief.slice(0, 500))}`)
        .then(response => response.ok ? response.json() : null)
        .then(data => setSuggestion(data?.suggestion?.id ? data.suggestion : null))
        .catch(() => setSuggestion(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [brief, campaignId]);

  const selectedCampaign = campaigns.find(item => item.id === campaignId) || null;

  const saveVoice = async () => {
    if (!voice) return;
    const response = await fetch('/api/brand-guidelines', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: voice.id,
        voice_character: character,
        banned_phrases: banned.split('\n').map(line => line.trim()).filter(Boolean),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? 'Brand voice saved.' : data.error || 'Could not save the brand voice.');
    if (response.ok) onVoicesChanged();
  };

  const startCampaign = (campaign?: CampaignRecord) => {
    setEditing(true);
    setEditingId(campaign?.id || '');
    setForm(campaign ? {
      name: campaign.name,
      status: campaign.status,
      startsOn: campaign.startsOn || '',
      endsOn: campaign.endsOn || '',
      objective: campaign.objective || '',
      keyFacts: (campaign.keyFacts || []).join('\n'),
      approvedClaims: (campaign.approvedClaims || []).join('\n'),
      links: (campaign.links || []).map(link => `${link.label} | ${link.url}`).join('\n'),
      hashtags: (campaign.hashtags || []).join(' '),
      notes: campaign.notes || '',
    } : EMPTY_CAMPAIGN);
  };

  const saveCampaign = async () => {
    const links = form.links.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [label, url] = line.split('|').map(part => part.trim());
      return { label: url ? label : line, url: url || label };
    });
    const response = await fetch('/api/campaigns', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(editingId ? { id: editingId } : {}),
        name: form.name,
        status: form.status,
        startsOn: form.startsOn || null,
        endsOn: form.endsOn || null,
        objective: form.objective,
        keyFacts: form.keyFacts.split('\n'),
        approvedClaims: form.approvedClaims.split('\n'),
        links,
        hashtags: form.hashtags.split(/[\s,]+/),
        notes: form.notes,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.error || 'Could not save the campaign.'); return; }
    setMessage(editingId ? 'Campaign updated.' : 'Campaign saved.');
    setEditing(false);
    if (data.id) onCampaignId(data.id);
    loadCampaigns();
  };

  const removeCampaign = async () => {
    if (!selectedCampaign) return;
    const response = await fetch(`/api/campaigns?id=${selectedCampaign.id}`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.error || 'Could not delete the campaign.'); return; }
    onCampaignId('');
    setMessage('Campaign deleted.');
    loadCampaigns();
  };

  return (
    <div className="mt-3 space-y-4">
      <section className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3">
        <SectionHeader title="Brand voice" description="Personal voices stay with you. A shared voice can only be edited by an admin." />
        <FormField label="Voice">
          <Select value={brandGuidelineId} onChange={event => onBrandGuidelineId(event.target.value)}>
            <option value="">None</option>
            {voices.map(item => <option key={item.id} value={item.id}>{item.brand_name}{item.is_shared ? ' (shared)' : ''}</option>)}
          </Select>
        </FormField>
        {voice && (
          <div className="mt-3 space-y-2 text-xs text-[var(--mos-text-secondary)]">
            {voice.tone_of_voice && <p>Tone: {voice.tone_of_voice}</p>}
            {samples.length > 0 && (
              <ul className="space-y-1">
                {samples.map(sample => <li key={sample.id} className="line-clamp-2">{sample.caption}</li>)}
              </ul>
            )}
            {voice.can_edit && (
              <div className="space-y-2 pt-1">
                <TextArea value={character} onChange={event => setCharacter(event.target.value)} rows={3} maxLength={1500} placeholder="Voice character, up to 1,500 characters" />
                <TextArea value={banned} onChange={event => setBanned(event.target.value)} rows={2} placeholder="Banned phrases, one per line" />
                <Button type="button" onClick={() => void saveVoice()}>Save voice</Button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3">
        <SectionHeader title="Campaign" description="A campaign is added to the prompt only after you select it. Anyone with Social Post can edit one. Deletes stay with the creator or an admin." />
        <FormField label="Campaign memory">
          <Select value={campaignId} onChange={event => onCampaignId(event.target.value)}>
            <option value="">None</option>
            {campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </FormField>
        {!campaignId && brief.trim().length >= 8 && suggestion && (
          <p className="mt-2 text-xs text-[var(--mos-text-secondary)]">
            Suggested: {suggestion.name}. It is not used until you select it.{' '}
            <button type="button" className="text-[var(--mos-accent)] underline" onClick={() => onCampaignId(suggestion.id)}>Use this campaign</button>
          </p>
        )}
        {selectedCampaign && (
          <p className="mt-2 text-[11px] text-[var(--mos-text-faint)]">
            {selectedCampaign.updatedByName ? `Updated by ${selectedCampaign.updatedByName}` : 'Updated'}
            {selectedCampaign.updatedAt ? ` · ${new Date(selectedCampaign.updatedAt).toLocaleString()}` : ''}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={() => startCampaign(selectedCampaign || undefined)}>{selectedCampaign ? 'Edit campaign' : 'New campaign'}</Button>
          {selectedCampaign && <Button type="button" onClick={() => startCampaign()}>New campaign</Button>}
          {selectedCampaign?.canDelete && <Button type="button" variant="danger" onClick={() => void removeCampaign()}>Delete</Button>}
        </div>
        {editing && (
          <div className="mt-3 space-y-2">
            <TextInput value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Campaign name" />
            <Select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="ended">Ended</option>
              <option value="archived">Archived</option>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <TextInput type="date" value={form.startsOn} onChange={event => setForm({ ...form, startsOn: event.target.value })} aria-label="Starts on" />
              <TextInput type="date" value={form.endsOn} onChange={event => setForm({ ...form, endsOn: event.target.value })} aria-label="Ends on" />
            </div>
            <TextArea value={form.objective} onChange={event => setForm({ ...form, objective: event.target.value })} rows={2} placeholder="Objective" />
            <TextArea value={form.keyFacts} onChange={event => setForm({ ...form, keyFacts: event.target.value })} rows={3} placeholder="Key facts, one per line. These are the only promo facts the model may state." />
            <TextArea value={form.approvedClaims} onChange={event => setForm({ ...form, approvedClaims: event.target.value })} rows={2} placeholder="Approved claims, one per line" />
            <TextArea value={form.links} onChange={event => setForm({ ...form, links: event.target.value })} rows={2} placeholder="Links, one per line: Label | https://..." />
            <TextInput value={form.hashtags} onChange={event => setForm({ ...form, hashtags: event.target.value })} placeholder="#campaign #dupoin" />
            <TextArea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} rows={2} placeholder="Notes" />
            <div className="flex gap-2">
              <Button type="button" variant="primary" onClick={() => void saveCampaign()}>Save campaign</Button>
              <Button type="button" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </section>
      {message && <p className="text-xs text-[var(--mos-text-secondary)]">{message}</p>}
      <p className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 py-2 text-xs text-[var(--mos-text-muted)]">Competitor — coming soon</p>
    </div>
  );
}
