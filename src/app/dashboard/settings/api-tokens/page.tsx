'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, FormField, LoadingState, PageHeader, PageStack, Panel, StatusBadge, TextInput } from '@/components/ui/dashboard';

interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function formatWhen(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ApiTokensPage() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [pendingRevoke, setPendingRevoke] = useState<ApiToken | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/settings/tokens');
    const body = await response.json() as { tokens?: ApiToken[]; error?: string };
    if (!response.ok) throw new Error(body.error || 'Could not load API tokens.');
    setTokens(body.tokens || []);
    setError('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load API tokens.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const createToken = async () => {
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/settings/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await response.json() as { token?: string; error?: string };
      if (!response.ok || !body.token) throw new Error(body.error || 'Could not create that token.');
      setName('');
      setCopied(false);
      setCreatedToken(body.token);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create that token.');
    } finally {
      setCreating(false);
    }
  };

  const closeSecret = () => {
    setCreatedToken(null);
    setCopied(false);
  };

  const copySecret = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const saveName = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      const response = await fetch(`/api/settings/tokens/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not rename that token.');
      setEditingId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename that token.');
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      const response = await fetch(`/api/settings/tokens/${id}`, { method: 'DELETE' });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not revoke that token.');
      setPendingRevoke(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke that token.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageStack>
      <PageHeader
        eyebrow="AI workspace"
        title="API tokens"
        description="Create a personal token to sync AI Research memory with Codex on your laptop."
      />
      <Panel>
        <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); void createToken(); }}>
          <FormField label="Token name" hint="40 characters" className="min-w-0 flex-1">
            <TextInput
              value={name}
              maxLength={80}
              placeholder="Laptop Codex"
              aria-label="Token name"
              onChange={event => setName(event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={creating || !name.trim()}>Create token</Button>
        </form>
        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      </Panel>
      {loading ? <LoadingState label="Loading tokens" /> : tokens.length === 0 ? (
        <Panel>
          <EmptyState
            title="No API tokens"
            description="No API tokens yet. Create one to sync memory with Codex on your laptop."
          />
        </Panel>
      ) : (
        <Panel padding="none">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[var(--mos-border-subtle)] text-[11px] uppercase tracking-[0.12em] text-[var(--mos-text-faint)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Prefix</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Last used</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map(token => (
                  <tr key={token.id} className="border-b border-[var(--mos-border-subtle)] last:border-b-0">
                    <td className="px-5 py-4 text-[var(--mos-text)]">
                      {editingId === token.id ? (
                        <TextInput aria-label={`Rename ${token.name}`} value={editName} onChange={event => setEditName(event.target.value)} />
                      ) : token.name}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-[var(--mos-text-secondary)]">{token.tokenPrefix}</td>
                    <td className="px-5 py-4 text-[var(--mos-text-muted)]">{formatWhen(token.createdAt)}</td>
                    <td className="px-5 py-4 text-[var(--mos-text-muted)]">{token.lastUsedAt ? formatWhen(token.lastUsedAt) : 'Never'}</td>
                    <td className="px-5 py-4">
                      {token.revokedAt ? <StatusBadge tone="danger">Revoked</StatusBadge> : editingId === token.id ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="primary" disabled={busyId === token.id} onClick={() => void saveName(token.id)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => { setEditingId(token.id); setEditName(token.name); }}>Rename</Button>
                          <Button size="sm" variant="danger" onClick={() => setPendingRevoke(token)}>Revoke</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {createdToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="api-token-secret-title" className="w-full max-w-lg rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-6 shadow-[var(--mos-shadow-panel)]">
            <h2 id="api-token-secret-title" className="text-lg font-[560] text-[var(--mos-text)]">Copy your token</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--mos-text-muted)]">This token is shown once. Store it as MARKETINGOS_API_TOKEN.</p>
            <p className="mt-4 break-all rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-3 py-3 font-mono text-sm text-[var(--mos-text)]" data-testid="api-token-secret">{createdToken}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="primary" onClick={() => void copySecret()}>Copy</Button>
              {copied && <span className="self-center text-xs text-[var(--mos-text-muted)]">Copied</span>}
              <Button onClick={closeSecret}>Close</Button>
            </div>
          </div>
        </div>
      )}
      {pendingRevoke && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="api-token-revoke-title" className="w-full max-w-lg rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)] p-6 shadow-[var(--mos-shadow-panel)]">
            <h2 id="api-token-revoke-title" className="text-lg font-[560] text-[var(--mos-text)]">Revoke {pendingRevoke.name}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--mos-text-muted)]">Revoke this token? Codex on your laptop will stop syncing until you create a new one.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingRevoke(null)}>Cancel</Button>
              <Button variant="danger" disabled={busyId === pendingRevoke.id} onClick={() => void revoke(pendingRevoke.id)}>Revoke</Button>
            </div>
          </div>
        </div>
      )}
    </PageStack>
  );
}
