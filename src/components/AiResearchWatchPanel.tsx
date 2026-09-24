'use client';

import { useEffect, useState } from 'react';

type WatchItem = {
  id: string;
  topic: string;
  keywords: string[];
  status: 'active' | 'paused';
  lastDigest: string;
  lastCheckedAt: string | null;
};

export function AiResearchWatchPanel({
  open,
  seed,
  onClose,
}: {
  open: boolean;
  seed: string;
  onClose: () => void;
}) {
  const [watches, setWatches] = useState<WatchItem[]>([]);
  const [limit, setLimit] = useState(20);
  const [topic, setTopic] = useState('');
  const [keywords, setKeywords] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [deleteArmed, setDeleteArmed] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ai-research/watches', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not load watches');
      setWatches(Array.isArray(payload.watches) ? payload.watches : []);
      if (typeof payload.limit === 'number') setLimit(payload.limit);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load watches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !seed) return;
    const timer = window.setTimeout(() => setTopic(seed), 0);
    return () => window.clearTimeout(timer);
  }, [open, seed]);

  if (!open) return null;

  const createWatch = async () => {
    setBusy('create');
    setError('');
    try {
      const response = await fetch('/api/ai-research/watches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, keywords }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not create the watch');
      setTopic('');
      setKeywords('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the watch');
    } finally {
      setBusy('');
    }
  };

  const patchWatch = async (id: string, body: Record<string, unknown>, kind: 'check' | 'status') => {
    setBusy(`${id}:${kind}`);
    setError('');
    try {
      const response = await fetch('/api/ai-research/watches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not update the watch');
      if (payload.watch) {
        setWatches(current => current.map(item => item.id === id ? payload.watch as WatchItem : item));
      }
      if (payload.message) setError(payload.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the watch');
    } finally {
      setBusy('');
    }
  };

  const removeWatch = async (id: string) => {
    setBusy(`${id}:delete`);
    setError('');
    try {
      const response = await fetch(`/api/ai-research/watches?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not delete the watch');
      setDeleteArmed('');
      setWatches(current => current.filter(item => item.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the watch');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" data-testid="ai-research-watch-panel">
      <button type="button" aria-label="Close watches" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <aside className="relative flex h-full w-[min(100vw,24rem)] flex-col border-l border-[var(--mos-border)] bg-[var(--mos-bg)] shadow-2xl">
        <div className="flex items-start justify-between gap-2 border-b border-[var(--mos-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--mos-text)]">Topic watches</h2>
            <p className="mt-0.5 text-[11px] text-[var(--mos-text-muted)]">{watches.length}/{limit} watches · check daily or now</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-[11px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]">
            Close
          </button>
        </div>
        <form
          className="space-y-2 border-b border-[var(--mos-border)] px-4 py-3"
          onSubmit={event => {
            event.preventDefault();
            void createWatch();
          }}
        >
          <input
            value={topic}
            onChange={event => setTopic(event.target.value)}
            placeholder="Topic, for example gold or a competitor name"
            aria-label="Watch topic"
            maxLength={120}
            className="w-full rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2.5 py-1.5 text-xs text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
          />
          <input
            value={keywords}
            onChange={event => setKeywords(event.target.value)}
            placeholder="Extra keywords, separated by commas"
            aria-label="Watch keywords"
            className="w-full rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2.5 py-1.5 text-xs text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
          />
          <button
            type="submit"
            data-testid="ai-research-watch-create"
            disabled={busy === 'create' || watches.length >= limit}
            className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy === 'create' ? 'Saving…' : 'Watch topic'}
          </button>
        </form>
        {error && <p className="px-4 pt-2 text-[11px] text-amber-200">{error}</p>}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {loading && watches.length === 0 && <p className="text-[11px] text-[var(--mos-text-muted)]">Loading watches…</p>}
          {!loading && watches.length === 0 && (
            <p className="text-[11px] leading-5 text-[var(--mos-text-muted)]">No watches yet. Add a topic such as gold, the rupiah, or a competitor name.</p>
          )}
          {watches.map(watch => (
            <article key={watch.id} className="rounded-xl border border-[var(--mos-border)] bg-[var(--mos-raised)] p-3" data-testid="ai-research-watch-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-[var(--mos-text)]">{watch.topic}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--mos-text-muted)]">
                    {watch.status === 'active' ? 'Active' : 'Paused'}
                    {watch.keywords.length ? ` · ${watch.keywords.join(', ')}` : ''}
                  </p>
                </div>
              </div>
              <p className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-[var(--mos-text-secondary)]">
                {watch.lastDigest || 'No summary yet. Press Check now.'}
              </p>
              {watch.lastCheckedAt && (
                <p className="mt-1 text-[10px] text-[var(--mos-text-faint)]">
                  Checked {new Date(watch.lastCheckedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busy === `${watch.id}:check`}
                  onClick={() => { void patchWatch(watch.id, { action: 'check' }, 'check'); }}
                  className="rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  {busy === `${watch.id}:check` ? 'Checking…' : 'Check now'}
                </button>
                <button
                  type="button"
                  disabled={busy.startsWith(`${watch.id}:`)}
                  onClick={() => { void patchWatch(watch.id, { status: watch.status === 'active' ? 'paused' : 'active' }, 'status'); }}
                  className="rounded-lg border border-[var(--mos-border)] px-2 py-1 text-[10px] text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40"
                >
                  {watch.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                {deleteArmed === watch.id ? (
                  <button
                    type="button"
                    disabled={busy === `${watch.id}:delete`}
                    onClick={() => { void removeWatch(watch.id); }}
                    className="rounded-lg bg-red-600 px-2 py-1 text-[10px] font-medium text-white"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteArmed(watch.id)}
                    className="rounded-lg px-2 py-1 text-[10px] text-[var(--mos-text-muted)] hover:text-red-300"
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
