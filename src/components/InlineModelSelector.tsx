'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Panel, StatusBadge } from '@/components/ui/dashboard';
import { getModelGuidance, MODEL_GUIDANCE_DISCLAIMER } from '@/lib/model-guidance';
import type { GenerationFeature } from '@/lib/model-routing';

interface ModelInfo {
  id: string;
  name: string;
  tier: 'budget' | 'balanced' | 'premium';
  provider: 'gorillaworkout';
}

interface FeaturePreference {
  feature: GenerationFeature;
  label: string;
  description: string;
  allowedModels: ModelInfo[];
  currentModel: string;
  defaultModel: string;
}

export default function InlineModelSelector({ feature }: { feature: GenerationFeature }) {
  const [preference, setPreference] = useState<FeaturePreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/settings/model').then(async response => {
      const data = await response.json() as { features?: FeaturePreference[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Model options could not be loaded.');
      const match = data.features?.find(item => item.feature === feature) || null;
      if (active) setPreference(match);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Model options could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [feature]);

  const selectedModel = useMemo(() => preference?.allowedModels.find(model => model.id === preference.currentModel), [preference]);
  const defaultModel = useMemo(() => preference?.allowedModels.find(model => model.id === preference.defaultModel), [preference]);
  const guidance = selectedModel ? getModelGuidance(selectedModel.id) : null;

  const save = async (model: string | null) => {
    if (!preference) return;
    setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/settings/model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, model }),
      });
      const data = await response.json() as { currentModel?: string; error?: string };
      if (!response.ok || !data.currentModel) throw new Error(data.error || 'Model preference could not be saved.');
      setPreference(current => current ? { ...current, currentModel: data.currentModel! } : current);
      setMessage(model === null ? 'Mengikuti organization default.' : 'Model untuk workflow ini sudah disimpan.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Model preference could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Panel padding="compact"><p className="text-xs text-[var(--mos-text-muted)]">Loading model options…</p></Panel>;
  if (error && !preference) return <Panel padding="compact" className="border-red-400/20 bg-red-400/5"><p role="alert" className="text-xs text-red-300">{error}</p></Panel>;
  if (!preference) return <Panel padding="compact" className="border-amber-400/15 bg-amber-400/[0.035]"><p className="text-xs leading-5 text-amber-100">Model selection belum tersedia untuk workflow ini. Hubungi administrator untuk memeriksa entitlement fitur.</p></Panel>;

  return <Panel padding="compact" className="border-indigo-300/15 bg-indigo-400/[0.025]">
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,360px)_1fr] lg:items-start">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-indigo-300">Model for {preference.label}</p>
          <StatusBadge tone="info">Personal preference</StatusBadge>
        </div>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-[var(--mos-text-secondary)]">Pilih model</span>
          <select
            aria-label={`Model for ${preference.label}`}
            value={preference.currentModel}
            disabled={saving}
            onChange={event => void save(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-[7px] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-sm text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
          >
            {preference.allowedModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" disabled={saving || preference.currentModel === preference.defaultModel} onClick={() => void save(null)}>Use organization default</Button>
          <span className="text-[10px] text-[var(--mos-text-faint)]">Organization default: {defaultModel?.name || preference.defaultModel}</span>
        </div>
        {message && <p role="status" className="mt-2 text-xs text-emerald-300">{message}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      </div>

      {selectedModel && guidance && <div className="rounded-[7px] border border-[var(--mos-border-subtle)] bg-black/10 p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="text-sm font-semibold text-[var(--mos-text)]">{selectedModel.name}</p><p className="mt-0.5 text-[10px] text-[var(--mos-text-faint)]">{guidance.family} · Speed {guidance.speed} · Reasoning {guidance.reasoning}</p></div>
          <StatusBadge>{selectedModel.tier}</StatusBadge>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--mos-text-muted)]">{guidance.summary}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-300">Strengths</p><p className="mt-1 text-[11px] leading-5 text-[var(--mos-text-muted)]">{guidance.strengths.slice(0, 2).join(' · ')}</p></div>
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-300">Trade-offs</p><p className="mt-1 text-[11px] leading-5 text-[var(--mos-text-muted)]">{guidance.tradeoffs.slice(0, 2).join(' · ')}</p></div>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-[var(--mos-text-faint)]">Operational guidance. {MODEL_GUIDANCE_DISCLAIMER}</p>
      </div>}
    </div>
  </Panel>;
}
