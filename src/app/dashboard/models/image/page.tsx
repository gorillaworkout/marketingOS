'use client';

import { useEffect, useState } from 'react';
import { Button, LoadingState, PageHeader, PageStack, Panel, StatusBadge } from '@/components/ui/dashboard';

interface ImageModel {
  id: string;
  name: string;
  description: string;
}

export default function ImageModelsPage() {
  const [availableModels, setAvailableModels] = useState<ImageModel[]>([]);
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/image-models');
      if (!response.ok) throw new Error('Failed to load image model settings');
      const data = await response.json();
      setAvailableModels(data.availableModels || []);
      setAllowedModels(data.allowedModels || []);
      setDefaultModel(data.defaultModel || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const toggleModel = (modelId: string) => {
    const isAllowed = allowedModels.includes(modelId);
    if (isAllowed) {
      const newAllowed = allowedModels.filter(id => id !== modelId);
      setAllowedModels(newAllowed);
      if (defaultModel === modelId && newAllowed.length > 0) {
        setDefaultModel(newAllowed[0]);
      }
    } else {
      setAllowedModels([...allowedModels, modelId]);
    }
  };

  const save = async () => {
    if (allowedModels.length === 0) {
      setError('At least one model must be allowed');
      return;
    }
    if (!allowedModels.includes(defaultModel)) {
      setError('Default model must be one of the allowed models');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/image-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedModels, defaultModel }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save settings');
      setMessage('Image model settings saved successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Loading image model settings" />;

  return (
    <PageStack className="max-w-4xl">
      <PageHeader
        eyebrow="Administration / AI Governance"
        title="Image Generation Models"
        description="Control which image models are available to users. Changes apply organization-wide."
      />

      {error && (
        <Panel className="border-red-400/20 bg-red-400/5" padding="compact">
          <p className="text-sm text-red-300">{error}</p>
        </Panel>
      )}

      {message && (
        <Panel className="border-green-400/20 bg-green-400/5" padding="compact">
          <p className="text-sm text-green-300">{message}</p>
        </Panel>
      )}

      <Panel>
        <div>
          <h2 className="text-lg font-semibold text-[var(--mos-text)]">Available Models</h2>
          <p className="mt-1 text-xs text-[var(--mos-text-muted)]">
            Select which Codex image models users can choose from. At least one model must be enabled.
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {availableModels.map(model => {
            const isAllowed = allowedModels.includes(model.id);
            const isDefault = defaultModel === model.id;
            return (
              <div
                key={model.id}
                className={`flex items-start gap-3 rounded-lg border p-4 transition ${
                  isAllowed
                    ? 'border-indigo-400/30 bg-indigo-400/5'
                    : 'border-[var(--mos-border)] bg-[var(--mos-raised)]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isAllowed}
                  onChange={() => toggleModel(model.id)}
                  className="mt-1 h-4 w-4 accent-indigo-400"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-[var(--mos-text)]">{model.name}</h3>
                    {isDefault && <StatusBadge tone="info">Default</StatusBadge>}
                    {isAllowed && !isDefault && (
                      <button
                        onClick={() => setDefaultModel(model.id)}
                        className="text-xs text-indigo-300 hover:underline"
                      >
                        Set as default
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{model.description}</p>
                  <p className="mt-1 font-mono text-[10px] text-[var(--mos-text-faint)]">{model.id}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel className="border-amber-400/15 bg-amber-400/[0.035]">
        <h3 className="text-sm font-medium text-amber-100">ℹ️ About Codex Image Models</h3>
        <p className="mt-2 text-xs leading-5 text-[var(--mos-text-muted)]">
          Image generation menggunakan <strong>Codex CLI</strong> yang terhubung ke{' '}
          <strong>ChatGPT Plus office account</strong>. Model yang dipilih di sini akan muncul sebagai dropdown
          di Social Post page saat user mau generate image.
        </p>
        <ul className="mt-3 space-y-1 text-xs text-[var(--mos-text-muted)]">
          <li>• <strong>gpt-5.6-terra:</strong> Quality tertinggi, processing ~60-90 detik</li>
          <li>• <strong>Catatan:</strong> <code>gpt-image-2</code> adalah nama tool image generation di dalam Codex, bukan model yang bisa dipilih — akun ChatGPT menolaknya sebagai model chat.</li>
        </ul>
      </Panel>

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={load} disabled={saving}>
          Reset
        </Button>
        <Button variant="primary" onClick={save} disabled={saving || allowedModels.length === 0}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </PageStack>
  );
}
