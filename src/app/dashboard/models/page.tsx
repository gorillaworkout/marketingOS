'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, LoadingState, PageHeader, PageStack, Panel, StatusBadge } from '@/components/ui/dashboard';
import { FIT_LABELS, GUIDANCE_FEATURE_LABELS, MODEL_GUIDANCE_DISCLAIMER, getModelGuidance, type GuidanceLevel } from '@/lib/model-guidance';
import type { GenerationFeature } from '@/lib/model-routing';

interface ModelInfo { id: string; name: string; tier: 'budget' | 'balanced' | 'premium'; provider: 'gorillaworkout' }
interface Preference { feature: GenerationFeature; label: string; description: string; allowedModels: ModelInfo[]; currentModel: string; defaultModel: string }
interface Assignment { feature: GenerationFeature; metadata: { label: string; description: string; adminOnly: boolean }; allowedModels: ModelInfo[]; defaultModel: string }
interface DraftAssignment { allowedModels: string[]; defaultModel: string }
interface Gateway { label: string; endpoint: string; status: 'available' | 'not_configured' }

type PageView = 'library' | 'preferences' | 'organization';

const FIT_TONE: Record<GuidanceLevel, string> = {
  excellent: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  good: 'border-sky-400/20 bg-sky-400/10 text-sky-200',
  specialist: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
  limited: 'border-white/10 bg-white/[0.035] text-[var(--mos-text-muted)]',
};

export default function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftAssignment>>({});
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [userRole, setUserRole] = useState('member');
  const [view, setView] = useState<PageView>('library');
  const [selectedFeature, setSelectedFeature] = useState<GenerationFeature>('social-post');
  const [familyFilter, setFamilyFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [savingPreference, setSavingPreference] = useState<string | null>(null);
  const [savingAssignment, setSavingAssignment] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { tone: 'success' | 'danger'; text: string }>>({});

  const load = useCallback(async () => {
    setLoading(true); setPageError('');
    try {
      const [authResponse, modelsResponse, settingsResponse] = await Promise.all([
        fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }) }),
        fetch('/api/models'),
        fetch('/api/settings/model'),
      ]);
      if (!authResponse.ok || !modelsResponse.ok || !settingsResponse.ok) throw new Error('Unable to load the model workspace.');
      const auth = await authResponse.json() as { user?: { role?: string } };
      const modelData = await modelsResponse.json() as { provider: Gateway; models: ModelInfo[] };
      const settingsData = await settingsResponse.json() as { features: Preference[] };
      const role = auth.user?.role || 'member';
      setUserRole(role); setModels(modelData.models); setGateway(modelData.provider); setPreferences(settingsData.features);
      setSelectedFeature(current => settingsData.features.some(feature => feature.feature === current) ? current : (settingsData.features[0]?.feature || current));
      if (role === 'admin') {
        const assignmentResponse = await fetch('/api/admin/model-assignments');
        if (!assignmentResponse.ok) throw new Error('Unable to load organization assignments.');
        const assignmentData = await assignmentResponse.json() as { assignments: Assignment[] };
        setAssignments(assignmentData.assignments);
        setDrafts(Object.fromEntries(assignmentData.assignments.map(item => [item.feature, { allowedModels: item.allowedModels.map(model => model.id), defaultModel: item.defaultModel }])));
      }
    } catch (error) { setPageError(error instanceof Error ? error.message : 'Unable to load the model workspace.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const families = useMemo(() => ['All', ...new Set(models.map(model => getModelGuidance(model.id).family))], [models]);
  const visibleModels = useMemo(() => models.filter(model => {
    const guidance = getModelGuidance(model.id);
    const matchesFamily = familyFilter === 'All' || guidance.family === familyFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${model.name} ${model.id} ${guidance.summary} ${guidance.bestFor.join(' ')}`.toLowerCase().includes(query);
    return matchesFamily && matchesSearch;
  }).sort((a, b) => {
    const order: Record<GuidanceLevel, number> = { excellent: 0, good: 1, specialist: 2, limited: 3 };
    return order[getModelGuidance(a.id).workflowFit[selectedFeature]] - order[getModelGuidance(b.id).workflowFit[selectedFeature]] || a.name.localeCompare(b.name);
  }), [models, familyFilter, search, selectedFeature]);

  const savePreference = async (feature: GenerationFeature, model: string | null) => {
    setSavingPreference(feature); setMessages(previous => ({ ...previous, [`pref-${feature}`]: { tone: 'success', text: '' } }));
    try {
      const response = await fetch('/api/settings/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature, model }) });
      const data = await response.json() as { error?: string; currentModel?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to save preference.');
      setPreferences(previous => previous.map(item => item.feature === feature ? { ...item, currentModel: data.currentModel || item.defaultModel } : item));
      setMessages(previous => ({ ...previous, [`pref-${feature}`]: { tone: 'success', text: model === null ? 'Using organization default.' : 'Personal preference saved.' } }));
    } catch (error) { setMessages(previous => ({ ...previous, [`pref-${feature}`]: { tone: 'danger', text: error instanceof Error ? error.message : 'Unable to save preference.' } })); }
    finally { setSavingPreference(null); }
  };

  const toggleAllowed = (feature: GenerationFeature, modelId: string) => setDrafts(previous => {
    const current = previous[feature]; const selected = current.allowedModels.includes(modelId);
    const allowedModels = selected ? current.allowedModels.filter(id => id !== modelId) : [...current.allowedModels, modelId];
    return { ...previous, [feature]: { allowedModels, defaultModel: selected && current.defaultModel === modelId ? (allowedModels[0] || '') : current.defaultModel } };
  });

  const saveAssignment = async (feature: GenerationFeature) => {
    setSavingAssignment(feature); setMessages(previous => ({ ...previous, [`admin-${feature}`]: { tone: 'success', text: '' } }));
    try {
      const response = await fetch('/api/admin/model-assignments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature, ...drafts[feature] }) });
      const data = await response.json() as { error?: string; assignment?: Assignment };
      if (!response.ok) throw new Error(data.error || 'Unable to save assignment.');
      if (data.assignment) setAssignments(previous => previous.map(item => item.feature === feature ? data.assignment! : item));
      setMessages(previous => ({ ...previous, [`admin-${feature}`]: { tone: 'success', text: 'Organization assignment saved.' } }));
      await load();
    } catch (error) { setMessages(previous => ({ ...previous, [`admin-${feature}`]: { tone: 'danger', text: error instanceof Error ? error.message : 'Unable to save assignment.' } })); }
    finally { setSavingAssignment(null); }
  };

  if (loading) return <LoadingState label="Loading model library" />;
  const activePreference = preferences.find(item => item.feature === selectedFeature);

  return <PageStack className="max-w-[1440px]">
    <PageHeader eyebrow="AI governance / Learning center" title="Models" description="Pelajari karakter setiap model, bandingkan kecocokannya untuk tiap workflow, lalu tentukan model yang tersedia dan model pilihanmu dalam satu halaman penuh." />

    {pageError && <Panel className="border-red-400/20 bg-red-400/5" padding="compact"><div className="flex items-center justify-between gap-3"><p role="alert" className="text-sm text-red-300">{pageError}</p><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></div></Panel>}

    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Panel padding="compact"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--mos-text-faint)]">Generation gateway</p><h2 className="mt-1 text-base font-semibold text-[var(--mos-text)]">{gateway?.label || 'GorillaWorkout LLM'}</h2><p className="mt-1 font-mono text-[10px] text-[var(--mos-text-faint)]">{gateway?.endpoint}</p></div><StatusBadge tone={gateway?.status === 'available' ? 'success' : 'warning'} dot>{gateway?.status === 'available' ? 'Configured' : 'Not configured'}</StatusBadge></div></Panel>
      <Panel padding="compact" className="bg-indigo-400/[0.035]"><p className="text-xs font-medium text-indigo-100">How to use this page</p><p className="mt-1 text-[11px] leading-5 text-[var(--mos-text-muted)]">Pilih workflow untuk melihat rekomendasi kontekstual. {MODEL_GUIDANCE_DISCLAIMER}</p></Panel>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="border-sky-400/15 bg-sky-400/[0.035]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-sky-300">Social Post recommendation</p>
        <h2 className="mt-2 text-base font-semibold text-[var(--mos-text)]">Mulai dengan Gemini Flash, naik ke Claude untuk nuansa copy</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--mos-text-muted)]">Gemini Flash cocok untuk iterasi cepat, variasi hook, caption, dan image prompt. Claude Sonnet lebih cocok ketika prioritasnya tone natural, storytelling, dan copy yang terasa ditulis manusia. Pecut Free tetap berguna untuk eksperimen non-urgent, tetapi latency-nya variabel.</p>
      </Panel>
      <Panel className="border-violet-400/15 bg-violet-400/[0.035]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-violet-300">Video Script recommendation</p>
        <h2 className="mt-2 text-base font-semibold text-[var(--mos-text)]">Gemini Flash untuk preview, Claude Sonnet untuk narasi</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--mos-text-muted)]">Gemini Flash efisien saat membuat beberapa hook dan opsi preview. Claude Sonnet unggul untuk VO panjang, alur cerita, dan transisi yang natural. Model reasoning premium lebih berguna untuk brief kompleks atau review, bukan default semua script.</p>
      </Panel>
    </div>

    <div className="flex flex-wrap gap-2 border-b border-[var(--mos-border-subtle)] pb-3">
      <Button size="sm" className="min-h-11" variant={view === 'library' ? 'primary' : 'secondary'} onClick={() => setView('library')}>Model library</Button>
      <Button size="sm" className="min-h-11" variant={view === 'preferences' ? 'primary' : 'secondary'} onClick={() => setView('preferences')}>My preferences</Button>
      {userRole === 'admin' && <Button size="sm" className="min-h-11" variant={view === 'organization' ? 'primary' : 'secondary'} onClick={() => setView('organization')}>Organization policy</Button>}
    </div>

    {view === 'library' ? <>
      <Panel padding="compact"><div className="grid gap-3 lg:grid-cols-[1fr_auto]"><div className="flex gap-2 overflow-x-auto pb-1">{preferences.map(feature => <button key={feature.feature} onClick={() => setSelectedFeature(feature.feature)} className={`min-h-10 shrink-0 rounded-[7px] border px-3 text-xs font-medium transition ${selectedFeature === feature.feature ? 'border-indigo-300/30 bg-indigo-400/12 text-indigo-100' : 'border-[var(--mos-border)] text-[var(--mos-text-muted)] hover:bg-white/[0.035]'}`}>{feature.label}</button>)}</div><div className="flex gap-2"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search model or use case" className="min-h-10 w-full min-w-0 rounded-[7px] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-xs text-[var(--mos-text)] outline-none focus:border-indigo-400/50 lg:w-64"/><select value={familyFilter} onChange={event => setFamilyFilter(event.target.value)} className="min-h-10 rounded-[7px] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-xs text-[var(--mos-text)]">{families.map(family => <option key={family}>{family}</option>)}</select></div></div></Panel>

      <div><div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-semibold text-[var(--mos-text)]">Model library for {GUIDANCE_FEATURE_LABELS[selectedFeature]}</h2><p className="mt-1 text-xs text-[var(--mos-text-muted)]">Sorted by workflow fit. {visibleModels.length} models shown.</p></div><div className="flex flex-wrap gap-1.5">{(['excellent','good','specialist','limited'] as GuidanceLevel[]).map(level => <span key={level} className={`rounded-full border px-2 py-1 text-[10px] ${FIT_TONE[level]}`}>{FIT_LABELS[level]}</span>)}</div></div>
      <div className="grid gap-4 xl:grid-cols-2">{visibleModels.map(model => { const guidance = getModelGuidance(model.id); const fitLevel = guidance.workflowFit[selectedFeature]; const allowed = activePreference?.allowedModels.some(item => item.id === model.id); const selected = activePreference?.currentModel === model.id; return <Panel key={model.id} className={selected ? 'border-indigo-300/30 bg-indigo-400/[0.04]' : ''}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-[var(--mos-text)]">{model.name}</h3><StatusBadge>{model.tier}</StatusBadge>{selected && <StatusBadge tone="info">Your choice</StatusBadge>}</div><p className="mt-1 break-all font-mono text-[10px] text-[var(--mos-text-faint)]">{model.id}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${FIT_TONE[fitLevel]}`}>{FIT_LABELS[fitLevel]}</span></div>
        <p className="mt-4 text-sm leading-6 text-[var(--mos-text-secondary)]">{guidance.summary}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">Strengths</p><ul className="mt-2 space-y-1.5">{guidance.strengths.map(item => <li key={item} className="flex gap-2 text-xs leading-5 text-[var(--mos-text-muted)]"><span className="text-emerald-300">+</span>{item}</li>)}</ul></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300">Trade-offs</p><ul className="mt-2 space-y-1.5">{guidance.tradeoffs.map(item => <li key={item} className="flex gap-2 text-xs leading-5 text-[var(--mos-text-muted)]"><span className="text-amber-300">−</span>{item}</li>)}</ul></div></div>
        <div className="mt-4 flex flex-wrap gap-2"><span className="rounded-[5px] bg-white/[0.04] px-2 py-1 text-[10px] text-[var(--mos-text-muted)]">Speed: {guidance.speed}</span><span className="rounded-[5px] bg-white/[0.04] px-2 py-1 text-[10px] text-[var(--mos-text-muted)]">Reasoning: {guidance.reasoning}</span><span className="rounded-[5px] bg-white/[0.04] px-2 py-1 text-[10px] text-[var(--mos-text-muted)]">Family: {guidance.family}</span></div>
        <div className="mt-4 border-t border-[var(--mos-border-subtle)] pt-3"><p className="text-[10px] leading-4 text-[var(--mos-text-faint)]">{guidance.note}</p>{allowed ? <Button size="sm" className="mt-3" disabled={selected || savingPreference === selectedFeature} onClick={() => void savePreference(selectedFeature, model.id)}>{selected ? 'Selected for this workflow' : 'Use for this workflow'}</Button> : <p className="mt-3 text-[11px] text-amber-200">Not enabled by the organization for this workflow.</p>}</div>
      </Panel>; })}</div></div>
    </> : view === 'preferences' ? <div className="space-y-5">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-indigo-300">Personal scope</p><h2 className="mt-1 text-lg font-semibold text-[var(--mos-text)]">My preferences</h2><p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">Pilihan di sini hanya berlaku untuk akunmu. Organization default tetap ditentukan administrator dan menjadi effective model ketika tidak ada personal override.</p></div>
      {preferences.length === 0 && <Panel className="border-amber-400/15 bg-amber-400/[0.035]"><h2 className="text-base font-semibold text-[var(--mos-text)]">No workflow preference available yet</h2><p className="mt-2 text-xs leading-5 text-[var(--mos-text-muted)]">Kamu tetap dapat mempelajari seluruh model di Model library. Pilihan personal akan muncul setelah administrator mengaktifkan Social Post, Video Script, atau Event Plan untuk department kamu.</p></Panel>}
      <div className="grid gap-4 lg:grid-cols-2">{preferences.map(preference => {const message=messages[`pref-${preference.feature}`];const effective=preference.allowedModels.find(model=>model.id===preference.currentModel)?.name||preference.currentModel;const organizationDefault=preference.allowedModels.find(model=>model.id===preference.defaultModel)?.name||preference.defaultModel;return <Panel key={preference.feature}><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-[var(--mos-text)]">{preference.label}</h2><p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">{preference.description}</p></div><StatusBadge tone="info">Personal scope</StatusBadge></div><div className="mt-4 grid gap-2 rounded-[7px] border border-[var(--mos-border-subtle)] bg-black/10 p-3 sm:grid-cols-2"><div><p className="text-[10px] uppercase tracking-[0.1em] text-[var(--mos-text-faint)]">Effective model</p><p className="mt-1 text-xs font-medium text-[var(--mos-text-secondary)]">{effective}</p></div><div><p className="text-[10px] uppercase tracking-[0.1em] text-[var(--mos-text-faint)]">Organization default</p><p className="mt-1 text-xs font-medium text-[var(--mos-text-secondary)]">{organizationDefault}</p></div></div><label className="mt-4 block"><span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--mos-text-faint)]">Personal override</span><select value={preference.currentModel} onChange={event => void savePreference(preference.feature, event.target.value)} disabled={savingPreference === preference.feature} className="mt-2 min-h-11 w-full rounded-[7px] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-sm text-[var(--mos-text)]">{preference.allowedModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className={`text-xs ${message?.tone === 'danger' ? 'text-red-300' : 'text-emerald-300'}`}>{message?.text}</p><Button size="sm" variant="secondary" onClick={() => void savePreference(preference.feature, null)}>Remove personal override</Button></div></Panel>})}</div>
    </div> : <div className="space-y-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-indigo-300">Admin-only scope</p><h2 className="mt-1 text-lg font-semibold text-[var(--mos-text)]">Organization policy</h2><p className="mt-1 text-xs text-[var(--mos-text-muted)]">Tentukan allowed models dan organization default untuk setiap workflow. Perubahan berlaku ke seluruh organisasi dan preference stale dinormalisasi secara atomik.</p></div><div className="grid gap-4 xl:grid-cols-2">{assignments.map(assignment => {const draft=drafts[assignment.feature];if(!draft)return null;const message=messages[`admin-${assignment.feature}`];return <Panel key={assignment.feature}><div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-[var(--mos-text)]">{assignment.metadata.label}</h3><p className="mt-1 text-xs text-[var(--mos-text-muted)]">{assignment.metadata.description}</p></div><StatusBadge>{draft.allowedModels.length} allowed</StatusBadge></div><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--mos-text-faint)]">Allowed models</p><div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-[7px] border border-[var(--mos-border)] bg-black/10 p-2">{models.map(model=>{const checked=draft.allowedModels.includes(model.id);const g=getModelGuidance(model.id);return <label key={model.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[6px] px-2.5 py-2 ${checked?'bg-indigo-400/10':'hover:bg-white/[0.035]'}`}><input type="checkbox" checked={checked} onChange={()=>toggleAllowed(assignment.feature,model.id)} className="h-4 w-4 accent-indigo-400"/><span className="min-w-0 flex-1"><span className="block truncate text-xs text-[var(--mos-text-secondary)]">{model.name}</span><span className="block truncate text-[10px] text-[var(--mos-text-faint)]">{g.family} · {FIT_LABELS[g.workflowFit[assignment.feature]]}</span></span><StatusBadge>{model.tier}</StatusBadge></label>})}</div><label className="mt-4 block"><span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--mos-text-faint)]">Organization default</span><select value={draft.defaultModel} onChange={event=>setDrafts(previous=>({...previous,[assignment.feature]:{...previous[assignment.feature],defaultModel:event.target.value}}))} className="mt-2 min-h-11 w-full rounded-[7px] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-sm text-[var(--mos-text)]">{models.filter(model=>draft.allowedModels.includes(model.id)).map(model=><option key={model.id} value={model.id}>{model.name}</option>)}</select></label><div className="mt-4 flex items-center justify-between gap-2"><p className={`text-xs ${message?.tone==='danger'?'text-red-300':'text-emerald-300'}`}>{message?.text}</p><Button size="sm" disabled={savingAssignment===assignment.feature||!draft.allowedModels.length||!draft.defaultModel} onClick={()=>void saveAssignment(assignment.feature)}>{savingAssignment===assignment.feature?'Saving…':'Save organization policy'}</Button></div></Panel>})}</div></div>}
  </PageStack>;
}
