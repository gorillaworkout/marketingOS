'use client';

import { useEffect, useState } from 'react';
import { Button, FormField, LoadingState, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextInput } from '@/components/ui/dashboard';
import type { LlmMode } from '@/lib/llm-provider-defaults';
import { EMBEDDINGS_FAILOVER_NOTE } from '@/lib/llm-provider-defaults';
import { groupModelsByProvider } from '@/lib/model-groups';
import { FREE_TEXT_CHAIN, IMAGE_SHORTLIST, TEXT_SHORTLIST, TIER_FEATURES, TIER_PAID_TARGET, type ModelTier } from '@/lib/model-tiers';

type TierRow = { tier: ModelTier; dupoinPrimary: string; paidTarget: string };
type Health = { provider: 'dupoin' | 'openrouter'; model: string; kind: string; status: string; latencyMs: number; message: string; testedAt: string };
type Preference = { feature: string; label: string; description: string; allowedModels: Array<{ id: string; name: string }>; currentModel: string; defaultModel: string };
type ProviderView = {
  mode: LlmMode;
  keyConfigured: boolean;
  keyHint: string | null;
  keyReadable: boolean;
  chatFallbacks: string[];
  usePaidOpenRouter: boolean;
  tiers: TierRow[];
  health: Health[];
  status: { activeProvider: string; lastFailoverAt: string | null; lastError: string | null; circuitOpenUntil: string | null };
};

const TIER_COPY: Record<ModelTier, { title: string; detail: string }> = {
  smart: { title: 'Smart', detail: 'Event Plan, Article Market News, Market Research, and SEO Content.' },
  fast: { title: 'Fast', detail: 'Social Post, Video Script, and Knowledge analyze.' },
  research: { title: 'Research', detail: 'AI Research, including FAQ, Excel, and HTML helpers.' },
  image: { title: 'Image', detail: 'Image generation. OpenRouter image calls need credits.' },
};

const DUPON_LABELS: Record<string, string> = {
  'cc/claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'cc/claude-opus-5-5': 'Claude Opus 5.5',
  'cx/gpt-5.6-sol': 'GPT-5.6 Sol',
  'ag/gemini-3-flash': 'Gemini 3 Flash',
  'ag/gemini-3.1-flash-image': 'Gemini 3.1 Flash Image',
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
}

function badgeTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'rate_limited' || status === 'credits') return 'warning';
  if (status === 'blocked' || status === 'error') return 'danger';
  return 'neutral';
}

function badgeLabel(status: string): string {
  if (status === 'active') return 'Active';
  if (status === 'rate_limited') return 'Rate-limited';
  if (status === 'blocked') return 'Blocked/Unavailable';
  if (status === 'credits') return 'Needs credits';
  if (status === 'error') return 'Error';
  return 'Not tested';
}

export default function ModelsPage() {
  const [role, setRole] = useState('');
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [provider, setProvider] = useState<ProviderView | null>(null);
  const [mode, setMode] = useState<LlmMode>('dupoin');
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [usePaid, setUsePaid] = useState(false);
  const [fallbacks, setFallbacks] = useState(FREE_TEXT_CHAIN.join('\n'));
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [includeImages, setIncludeImages] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }), signal: controller.signal }).then(response => response.json()),
      fetch('/api/settings/model', { signal: controller.signal }).then(response => response.json()),
    ]).then(async ([auth, settings]) => {
      if (controller.signal.aborted) return;
      const nextRole = auth.user?.role || 'member';
      setRole(nextRole);
      setPreferences(settings.features || []);
      if (nextRole !== 'admin') { setLoading(false); return; }
      const admin = await fetch('/api/admin/llm-provider', { cache: 'no-store', signal: controller.signal });
      const data = await admin.json();
      if (!admin.ok) { setError(data.error || 'Could not load AI model settings.'); setLoading(false); return; }
      setProvider(data);
      setMode(data.mode);
      setUsePaid(data.usePaidOpenRouter === true);
      setFallbacks((data.chatFallbacks || FREE_TEXT_CHAIN).join('\n'));
      setTiers(data.tiers || []);
      setHealth(data.health || []);
      setLoading(false);
    }).catch(() => { if (!controller.signal.aborted) { setError('Could not load AI Models.'); setLoading(false); } });
    return () => controller.abort();
  }, []);

  async function savePreference(feature: string, model: string | null) {
    setBusy(feature);
    setError('');
    const response = await fetch('/api/settings/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature, model }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy('');
    if (!response.ok) { setError(data.error || 'Could not save that preference.'); return; }
    setPreferences(current => current.map(item => item.feature === feature ? { ...item, currentModel: data.currentModel } : item));
    setNotice(model ? 'Preference saved.' : 'Using the organization default.');
  }

  async function saveAdmin() {
    setBusy('save');
    setError('');
    const response = await fetch('/api/admin/llm-provider', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        defaultChatModel: FREE_TEXT_CHAIN[0],
        defaultImageModel: 'google/gemini-3.1-flash-image',
        defaultEmbeddingModel: 'liquid/lfm-2.5-embedding-350m:free',
        usePaidOpenRouter: usePaid,
        chatFallbacks: fallbacks.split('\n').map(line => line.trim()).filter(Boolean),
        tiers,
        mappings: [],
        ...(clearKey ? { openrouterKey: null } : key.trim() ? { openrouterKey: key.trim() } : {}),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy('');
    if (!response.ok) { setError(data.error || 'Could not save AI model settings.'); return; }
    setNotice('AI model settings saved.');
    setKey('');
    setClearKey(false);
  }

  async function probe(body: Record<string, unknown>, token: string) {
    setBusy(token);
    setError('');
    const response = await fetch('/api/admin/llm-provider/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    setBusy('');
    if (!response.ok) { setError(data.error || 'Model test failed.'); return; }
    const results = Array.isArray(data.results) ? data.results as Health[] : [];
    setHealth(current => {
      const next = [...current];
      for (const result of results) {
        const index = next.findIndex(row => row.provider === result.provider && row.model === result.model && row.kind === result.kind);
        if (index >= 0) next[index] = result;
        else next.unshift(result);
      }
      return next;
    });
    setNotice(`Tested ${results.length} model${results.length === 1 ? '' : 's'}.`);
  }

  if (loading) return <LoadingState label="Loading AI Models" />;

  const circuitText = provider?.status.circuitOpenUntil ? `Circuit until ${formatWhen(provider.status.circuitOpenUntil)}.` : 'Circuit closed.';

  return (
    <PageStack>
      <PageHeader
        eyebrow="AI Models"
        title="AI Models"
        description="One place for the models MarketingOS actually uses. Powerful Dupoin models come first. OpenRouter free models are the fallback."
      />
      {error && <p className="text-sm text-red-300">{error}</p>}
      {notice && <p className="text-sm text-[var(--mos-text-secondary)]">{notice}</p>}

      <Panel>
        <SectionHeader title="My preferences" />
        <p className="mt-2 text-xs leading-5 text-[var(--mos-text-muted)]">Allowed models are the short Dupoin list. Pick one, or use the organization default.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {preferences.map(preference => (
            <FormField key={preference.feature} label={preference.label} hint={preference.description}>
              <Select
                aria-label={`Model for ${preference.label}`}
                value={preference.currentModel === preference.defaultModel ? '' : preference.currentModel}
                disabled={busy === preference.feature}
                onChange={event => void savePreference(preference.feature, event.target.value || null)}
              >
                <option value="">Use org default ({DUPON_LABELS[preference.defaultModel] || preference.defaultModel})</option>
                {groupModelsByProvider(preference.allowedModels).map(group => <optgroup key={group.label} label={group.label}>{group.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</optgroup>)}
              </Select>
            </FormField>
          ))}
        </div>
      </Panel>

      {role === 'admin' && (
        <>
          <Panel>
            <SectionHeader title="Provider" />
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(['dupoin', 'openrouter', 'auto'] as const).map(option => (
                <label key={option} className="flex cursor-pointer flex-col gap-1 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3 text-sm">
                  <span className="flex items-center gap-2 font-medium"><input type="radio" name="mode" checked={mode === option} onChange={() => setMode(option)} />{option === 'dupoin' ? 'Dupoin' : option === 'openrouter' ? 'OpenRouter' : 'Automatic'}</span>
                  <span className="text-xs text-[var(--mos-text-muted)]">{option === 'auto' ? 'Dupoin first, then the OpenRouter chain.' : option === 'openrouter' ? 'OpenRouter chain for every text request.' : 'LLM Dupoin only. This is the default.'}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <FormField label="OpenRouter API key" hint={provider?.keyConfigured ? (provider.keyHint || 'Saved') : 'Not saved'}>
                <TextInput type="password" autoComplete="off" value={key} placeholder={provider?.keyConfigured ? 'Leave blank to keep the saved key' : 'Paste an OpenRouter API key'} onChange={event => { setKey(event.target.value); setClearKey(false); }} />
              </FormField>
              <div className="text-xs leading-5 text-[var(--mos-text-muted)]">
                <p>{provider?.keyConfigured ? `Saved key ${provider.keyHint || '••••'}. The full key is not shown again.` : 'No OpenRouter key saved.'}</p>
                {provider?.keyConfigured && !provider.keyReadable && <p>The saved key cannot be read. Enter it again.</p>}
                <p className="mt-2">Active provider: {provider?.status.activeProvider === 'openrouter' ? 'OpenRouter' : 'LLM Dupoin'}. Last failover: {formatWhen(provider?.status.lastFailoverAt)}. {circuitText}</p>
                <p>{provider?.status.lastError || 'No failover error recorded.'}</p>
              </div>
            </div>
          </Panel>

          <Panel>
            <SectionHeader title="Tiers" />
            <div className="mt-4 flex flex-col gap-4">
              {tiers.map(tier => {
                const shortlist = tier.tier === 'image' ? IMAGE_SHORTLIST : TEXT_SHORTLIST;
                const features = tier.tier === 'image' ? [] : TIER_FEATURES[tier.tier];
                return (
                  <div key={tier.tier} className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-[var(--mos-text)]">{TIER_COPY[tier.tier].title}</h3>
                      {tier.tier === 'image' && <StatusBadge tone="warning">Needs credits on OpenRouter</StatusBadge>}
                    </div>
                    <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{TIER_COPY[tier.tier].detail} {features.join(', ')}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <FormField label="Dupoin primary">
                        <Select value={tier.dupoinPrimary} onChange={event => setTiers(current => current.map(item => item.tier === tier.tier ? { ...item, dupoinPrimary: event.target.value } : item))}>
                          {shortlist.map(id => <option key={id} value={id}>{DUPON_LABELS[id] || id}</option>)}
                        </Select>
                      </FormField>
                      <FormField label="Paid OpenRouter target">
                        <Select value={tier.paidTarget} onChange={event => setTiers(current => current.map(item => item.tier === tier.tier ? { ...item, paidTarget: event.target.value } : item))}>
                          <option value={TIER_PAID_TARGET[tier.tier]}>{TIER_PAID_TARGET[tier.tier]}</option>
                          {tier.paidTarget !== TIER_PAID_TARGET[tier.tier] && <option value={tier.paidTarget}>{tier.paidTarget}</option>}
                        </Select>
                      </FormField>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ModelBadge health={health} provider="dupoin" model={tier.dupoinPrimary} />
                      <ModelBadge health={health} provider="openrouter" model={usePaid ? tier.paidTarget : (tier.tier === 'image' ? tier.paidTarget : FREE_TEXT_CHAIN[0])} />
                      <Button size="sm" disabled={busy !== ''} onClick={() => void probe({
                        targets: [
                          { provider: 'dupoin', model: tier.dupoinPrimary, kind: tier.tier === 'image' ? 'image' : 'chat' },
                          { provider: 'openrouter', model: tier.tier === 'image' ? tier.paidTarget : (usePaid ? tier.paidTarget : FREE_TEXT_CHAIN[0]), kind: tier.tier === 'image' ? 'image' : 'chat' },
                        ],
                      }, tier.tier)}>{busy === tier.tier ? 'Testing…' : 'Test'}</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel>
            <SectionHeader title="OpenRouter text chain" />
            <p className="mt-2 text-xs leading-5 text-[var(--mos-text-muted)]">Free models, most capable reasoning model first. On 429, 404, or no credits the next line is tried once. Inkling reasoning text is ignored; only the answer is parsed. If that answer is empty, the next model answers.</p>
            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--mos-text-secondary)]">
              <input type="checkbox" checked={usePaid} onChange={event => setUsePaid(event.target.checked)} />
              Use paid OpenRouter models
            </label>
            <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{usePaid ? 'Each tier’s paid target is tried first, then this free chain.' : 'Off. Text uses the free chain only. Turn this on after adding credits.'}</p>
            <textarea aria-label="OpenRouter free chain" value={fallbacks} onChange={event => setFallbacks(event.target.value)} className="mt-3 min-h-24 w-full rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-3 py-2 text-sm" />
          </Panel>

          <Panel>
            <SectionHeader title="Embeddings" />
            <p className="mt-3 text-sm leading-6 text-[var(--mos-text-muted)]">{EMBEDDINGS_FAILOVER_NOTE}</p>
          </Panel>

          <Panel>
            <SectionHeader
              title="Health"
              action={(
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-[var(--mos-text-muted)]">
                    <input type="checkbox" checked={includeImages} onChange={event => setIncludeImages(event.target.checked)} />
                    Include image tests (uses credits)
                  </label>
                  <Button size="sm" disabled={busy !== ''} onClick={() => void probe({ all: true, includeImages }, 'all')}>{busy === 'all' ? 'Testing…' : 'Test all models'}</Button>
                </div>
              )}
            />
            <div className="mt-4 flex flex-col gap-2">
              {health.length === 0 && <p className="text-sm text-[var(--mos-text-muted)]">No tests yet. Test all checks the models in use, without duplicate rows.</p>}
              {health.map(row => (
                <div key={`${row.provider}:${row.kind}:${row.model}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge tone={badgeTone(row.status)}>{badgeLabel(row.status)}{row.status === 'active' && row.latencyMs ? ` ${row.latencyMs}ms` : ''}</StatusBadge>
                  <span className="text-[var(--mos-text-secondary)]">{row.provider === 'dupoin' ? 'Dupoin' : 'OpenRouter'} · {row.model}</span>
                  <span className="text-xs text-[var(--mos-text-faint)]">{formatWhen(row.testedAt)}{row.status === 'rate_limited' ? ' · try again later' : ''}</span>
                </div>
              ))}
            </div>
          </Panel>

          <div><Button variant="primary" disabled={busy === 'save'} onClick={() => void saveAdmin()}>{busy === 'save' ? 'Saving…' : 'Save settings'}</Button></div>
        </>
      )}
    </PageStack>
  );
}

function ModelBadge({ health, provider, model }: { health: Health[]; provider: 'dupoin' | 'openrouter'; model: string }) {
  const row = health.find(item => item.provider === provider && item.model === model);
  return <StatusBadge tone={badgeTone(row?.status || '')}>{provider === 'dupoin' ? 'Dupoin' : 'OpenRouter'} {badgeLabel(row?.status || '')}</StatusBadge>;
}
