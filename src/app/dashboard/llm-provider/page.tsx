'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, FormField, LoadingState, PageHeader, PageStack, Panel, SectionHeader, StatusBadge, TextInput } from '@/components/ui/dashboard';
import type { LlmMode } from '@/lib/llm-provider-defaults';

type Mapping = { dupoinModel: string; openrouterModel: string; kind: 'chat' | 'image' | 'embedding' };
type Audit = { id: string; actorId: string | null; action: string; detail: string; createdAt: string };
type View = {
  mode: LlmMode;
  keyConfigured: boolean;
  keyReadable: boolean;
  keyHint: string | null;
  defaultChatModel: string;
  defaultImageModel: string;
  defaultEmbeddingModel: string;
  mappings: Mapping[];
  status: {
    activeProvider: 'dupoin' | 'openrouter';
    lastFailoverAt: string | null;
    lastError: string | null;
    circuitOpenUntil: string | null;
    consecutiveFailures: number;
  };
  audit: Audit[];
  notes: { embeddings: string; images: string; freeModels: string };
  circuitOpen: boolean;
};

const MODES: Array<{ id: LlmMode; label: string; detail: string }> = [
  { id: 'dupoin', label: 'Dupoin', detail: 'LLM Dupoin only. This is the default and matches the server environment.' },
  { id: 'openrouter', label: 'OpenRouter', detail: 'Send every chat and image request to OpenRouter.' },
  { id: 'auto', label: 'Automatic', detail: 'Try LLM Dupoin first. If it times out or returns a network error, 429, or 5xx, use OpenRouter.' },
];

function formatWhen(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
}

export default function LlmProviderPage() {
  const [view, setView] = useState<View | null>(null);
  const [mode, setMode] = useState<LlmMode>('dupoin');
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [defaultChatModel, setDefaultChatModel] = useState('');
  const [defaultImageModel, setDefaultImageModel] = useState('');
  const [defaultEmbeddingModel, setDefaultEmbeddingModel] = useState('');
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/llm-provider', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || 'Could not load LLM provider settings.');
      return;
    }
    const until = data.status?.circuitOpenUntil ? Date.parse(data.status.circuitOpenUntil) : 0;
    setError('');
    setView({ ...data, circuitOpen: until > Date.now() });
    setMode(data.mode);
    setDefaultChatModel(data.defaultChatModel);
    setDefaultImageModel(data.defaultImageModel);
    setDefaultEmbeddingModel(data.defaultEmbeddingModel);
    setMappings(data.mappings || []);
    setKey('');
    setClearKey(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/llm-provider', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setError(data.error || 'Could not load LLM provider settings.');
          return;
        }
        const until = data.status?.circuitOpenUntil ? Date.parse(data.status.circuitOpenUntil) : 0;
        setError('');
        setView({ ...data, circuitOpen: until > Date.now() });
        setMode(data.mode);
        setDefaultChatModel(data.defaultChatModel);
        setDefaultImageModel(data.defaultImageModel);
        setDefaultEmbeddingModel(data.defaultEmbeddingModel);
        setMappings(data.mappings || []);
        setKey('');
        setClearKey(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load LLM provider settings.');
      });
    return () => controller.abort();
  }, []);

  async function save() {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/admin/llm-provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          defaultChatModel,
          defaultImageModel,
          defaultEmbeddingModel,
          mappings,
          ...(clearKey ? { openrouterKey: null } : key.trim() ? { openrouterKey: key.trim() } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not save settings.');
        return;
      }
      setNotice('Settings saved.');
      await load();
    } catch {
      setError('Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function test(provider: 'dupoin' | 'openrouter', kind: 'chat' | 'image' | 'embeddings') {
    const token = `${provider}:${kind}`;
    setTesting(token);
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/admin/llm-provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, kind }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Test failed.');
        return;
      }
      const prefix = data.ok ? 'Test passed' : 'Test failed';
      setNotice(`${prefix} (${provider}, ${kind}): ${data.message || ''}`);
    } catch {
      setError('Test failed.');
    } finally {
      setTesting('');
    }
  }

  if (!view && !error) return <LoadingState label="Loading LLM provider" />;

  const active = view?.status.activeProvider === 'openrouter' ? 'OpenRouter' : 'LLM Dupoin';
  const circuitOpen = view?.circuitOpen;

  return (
    <PageStack>
      <PageHeader
        eyebrow="Administration"
        title="LLM Provider"
        description="Choose LLM Dupoin, OpenRouter, or automatic failover. With nothing saved, MarketingOS keeps using LLM Dupoin and the server environment key."
      />
      {error && <p className="text-sm text-red-300">{error}</p>}
      {notice && <p className="text-sm text-[var(--mos-text-secondary)]">{notice}</p>}

      <Panel>
        <SectionHeader title="Mode" />
        <div className="mt-4">
        <div className="grid gap-3 md:grid-cols-3">
          {MODES.map(option => (
            <label key={option.id} className="flex cursor-pointer flex-col gap-2 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3">
              <span className="flex items-center gap-2 text-sm font-medium text-[var(--mos-text)]">
                <input type="radio" name="llm-mode" checked={mode === option.id} onChange={() => setMode(option.id)} />
                {option.label}
              </span>
              <span className="text-xs leading-5 text-[var(--mos-text-muted)]">{option.detail}</span>
            </label>
          ))}
        </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="OpenRouter" />
        <div className="mt-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="API key" hint={view?.keyConfigured ? (view.keyHint || 'Saved') : 'Not saved'}>
            <TextInput
              type="password"
              autoComplete="off"
              value={key}
              placeholder={view?.keyConfigured ? 'Leave blank to keep the saved key' : 'Paste an OpenRouter API key'}
              onChange={event => { setKey(event.target.value); setClearKey(false); }}
            />
          </FormField>
          <div className="flex flex-col justify-end gap-2">
            <p className="text-xs text-[var(--mos-text-muted)]">
              {view?.keyConfigured
                ? `Saved key ${view.keyHint || '••••'}. The full key is not shown again.`
                : 'No OpenRouter key saved.'}
              {view?.keyConfigured && !view.keyReadable ? ' The saved key cannot be read with the current server secret. Enter it again.' : ''}
            </p>
            {view?.keyConfigured && (
              <label className="flex items-center gap-2 text-xs text-[var(--mos-text-secondary)]">
                <input type="checkbox" checked={clearKey} onChange={event => { setClearKey(event.target.checked); if (event.target.checked) setKey(''); }} />
                Remove the saved key
              </label>
            )}
          </div>
          <FormField label="Default chat model" hint="Used when a Dupoin model has no mapping">
            <TextInput value={defaultChatModel} onChange={event => setDefaultChatModel(event.target.value)} />
          </FormField>
          <FormField label="Default image model" hint="No free image model exists">
            <TextInput value={defaultImageModel} onChange={event => setDefaultImageModel(event.target.value)} />
          </FormField>
          <FormField label="Default embedding model" hint="Not written into the local index">
            <TextInput value={defaultEmbeddingModel} onChange={event => setDefaultEmbeddingModel(event.target.value)} />
          </FormField>
        </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Status" />
        <div className="mt-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--mos-text-secondary)]">
          <StatusBadge tone={view?.status.activeProvider === 'openrouter' ? 'warning' : 'success'}>{active}</StatusBadge>
          <span>Last failover: {formatWhen(view?.status.lastFailoverAt ?? null)}</span>
          <span>{circuitOpen ? `Circuit open until ${formatWhen(view?.status.circuitOpenUntil ?? null)}` : 'Circuit closed'}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--mos-text-muted)]">{view?.status.lastError || 'No failover error recorded.'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" disabled={testing !== ''} onClick={() => void test('dupoin', 'chat')}>{testing === 'dupoin:chat' ? 'Testing…' : 'Test Dupoin chat'}</Button>
          <Button size="sm" disabled={testing !== ''} onClick={() => void test('openrouter', 'chat')}>{testing === 'openrouter:chat' ? 'Testing…' : 'Test OpenRouter chat'}</Button>
          <Button size="sm" disabled={testing !== ''} onClick={() => void test('dupoin', 'image')}>{testing === 'dupoin:image' ? 'Testing…' : 'Test Dupoin image'}</Button>
          <Button size="sm" disabled={testing !== ''} onClick={() => void test('openrouter', 'image')}>{testing === 'openrouter:image' ? 'Testing…' : 'Test OpenRouter image'}</Button>
          <Button size="sm" variant="ghost" disabled={testing !== ''} onClick={() => void test('dupoin', 'embeddings')}>Embeddings note</Button>
        </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Free model limits" />
        <p className="mt-3 text-sm leading-6 text-[var(--mos-text-muted)]">{view?.notes.freeModels || 'Free OpenRouter models have a request limit. HTTP 429 stops the request instead of retrying.'}</p>
      </Panel>

      <Panel>
        <SectionHeader title="Embeddings" />
        <p className="mt-3 text-sm leading-6 text-[var(--mos-text-muted)]">{view?.notes.embeddings}</p>
      </Panel>
      <Panel>
        <SectionHeader title="Images" />
        <p className="mt-3 text-sm leading-6 text-[var(--mos-text-muted)]">{view?.notes.images}</p>
      </Panel>

      <Panel>
        <SectionHeader title="Model mapping" action={<Button size="sm" variant="ghost" onClick={() => setMappings(current => [...current, { dupoinModel: '', openrouterModel: '', kind: 'chat' }])}>Add row</Button>} />
        <div className="mt-4">
        <p className="mb-3 text-xs leading-5 text-[var(--mos-text-muted)]">
          Default text rows use google/gemma-4-31b-it:free. Other verified free text models include nvidia/nemotron-3-ultra-550b-a55b:free and openrouter/free. Image rows stay on a paid model because OpenRouter lists no free image model. The embedding row is liquid/lfm-2.5-embedding-350m:free and is not written into the local index. Edit any row to a paid id after credits are added.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-[var(--mos-text-faint)]">
              <tr>
                <th className="pb-2 pr-3 font-medium">Dupoin model</th>
                <th className="pb-2 pr-3 font-medium">OpenRouter model</th>
                <th className="pb-2 pr-3 font-medium">Kind</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping, index) => (
                <tr key={`${mapping.dupoinModel}-${index}`} className="border-t border-[var(--mos-border-subtle)]">
                  <td className="py-2 pr-3"><TextInput value={mapping.dupoinModel} onChange={event => setMappings(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, dupoinModel: event.target.value } : row))} /></td>
                  <td className="py-2 pr-3"><TextInput value={mapping.openrouterModel} onChange={event => setMappings(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, openrouterModel: event.target.value } : row))} /></td>
                  <td className="py-2 pr-3">
                    <select className="h-9 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-2 text-sm" value={mapping.kind} onChange={event => setMappings(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, kind: event.target.value === 'image' ? 'image' : event.target.value === 'embedding' ? 'embedding' : 'chat' } : row))}>
                      <option value="chat">Chat</option>
                      <option value="image">Image</option>
                      <option value="embedding">Embedding</option>
                    </select>
                  </td>
                  <td className="py-2"><Button size="sm" variant="ghost" onClick={() => setMappings(current => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save settings'}</Button>
        </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeader title="Audit" />
        <div className="mt-4">
        {view?.audit.length ? (
          <ul className="flex flex-col gap-3">
            {view.audit.map(entry => (
              <li key={entry.id} className="text-sm text-[var(--mos-text-secondary)]">
                <span className="text-[var(--mos-text)]">{entry.action}</span>
                <span className="mx-2 text-[var(--mos-text-faint)]">{formatWhen(entry.createdAt)}</span>
                <span className="text-[var(--mos-text-faint)]">{entry.actorId || 'system'}</span>
                <p className="mt-1 break-all text-xs leading-5 text-[var(--mos-text-muted)]">{entry.detail}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[var(--mos-text-muted)]">No provider changes or failovers recorded.</p>}
        </div>
      </Panel>
    </PageStack>
  );
}
