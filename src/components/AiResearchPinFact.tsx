'use client';

import { useEffect, useMemo, useState } from 'react';
import { extractPinnableClaims, KNOWLEDGE_GRAPH_PATH } from '@/lib/knowledge-pin';

type PinSource = { title?: string; url: string };

type PinDraft = {
  text: string;
  sourceUrls: string[];
};

export function AiResearchPinFact({
  answer,
  sources,
  conversationId,
  projectId,
  topicSuggestion,
  onWatchTopic,
}: {
  answer: string;
  sources: PinSource[];
  conversationId?: string | null;
  projectId?: string | null;
  topicSuggestion?: string;
  onWatchTopic?: (topic: string) => void;
}) {
  const claims = useMemo(() => extractPinnableClaims(answer, sources), [answer, sources]);
  const [draft, setDraft] = useState<PinDraft | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ graphUrl: string } | null>(null);

  const availableUrls = useMemo(() => {
    const urls = [...(draft?.sourceUrls || []), ...sources.map(source => source.url)];
    const unique: string[] = [];
    for (const url of urls) {
      if (url && !unique.includes(url)) unique.push(url);
    }
    return unique.slice(0, 12);
  }, [draft, sources]);

  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setDraft(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, saving]);

  const openDraft = (text: string, sourceUrls: string[]) => {
    const urls = sourceUrls.length ? sourceUrls : sources.map(source => source.url);
    setDraft({ text, sourceUrls: urls });
    setSelectedUrls(urls);
    setError('');
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/knowledge/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType: 'ai-research',
          brief: draft.text,
          selectedOutput: draft.text,
          sourceUrls: selectedUrls,
          conversationId: conversationId || null,
          projectId: projectId || null,
          platform: 'web',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Gagal menyimpan fakta');
      const knowledgeId = typeof payload.knowledgeId === 'string' ? payload.knowledgeId : '';
      const graphUrl = typeof payload.graphUrl === 'string'
        ? payload.graphUrl
        : knowledgeId
          ? `${KNOWLEDGE_GRAPH_PATH}?focus=${encodeURIComponent(knowledgeId)}`
          : KNOWLEDGE_GRAPH_PATH;
      setDraft(null);
      setToast({ graphUrl });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal menyimpan fakta');
    } finally {
      setSaving(false);
    }
  };

  if (!answer.trim()) return null;

  return (
    <div className="mt-2" data-testid="ai-research-pin-fact">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => openDraft(answer.trim().slice(0, 4_000), sources.map(source => source.url))}
          className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-100 hover:bg-emerald-500/20"
        >
          Pin ke Knowledge Graph
        </button>
        {topicSuggestion && topicSuggestion.trim().length >= 2 && onWatchTopic && (
          <button
            type="button"
            onClick={() => onWatchTopic(topicSuggestion.trim().slice(0, 120))}
            className="rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
          >
            Pantau topik ini
          </button>
        )}
        {claims.map(claim => (
          <button
            key={claim.text}
            type="button"
            onClick={() => openDraft(claim.text, claim.sourceUrls)}
            className="max-w-[240px] truncate rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
            title={claim.text}
          >
            Simpan fakta: {claim.text.slice(0, 72)}
          </button>
        ))}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pin-fact-title"
            data-testid="ai-research-pin-modal"
            className="w-full max-w-lg rounded-2xl border border-[var(--mos-border)] bg-[var(--mos-raised)] p-4 shadow-2xl"
          >
            <h3 id="pin-fact-title" className="text-sm font-semibold text-[var(--mos-text)]">Simpan fakta</h3>
            <p className="mt-1 text-[11px] leading-4 text-[var(--mos-text-muted)]">
              Sunting teks sebelum disimpan ke Knowledge Graph. Izin sama dengan simpan knowledge lain.
            </p>
            <textarea
              value={draft.text}
              onChange={event => setDraft({ ...draft, text: event.target.value })}
              rows={6}
              aria-label="Teks fakta"
              className="mt-3 w-full resize-y rounded-xl border border-[var(--mos-border)] bg-[var(--mos-bg)] px-3 py-2 text-sm text-[var(--mos-text)] outline-none focus:border-emerald-400/50"
            />
            {availableUrls.length > 0 && (
              <fieldset className="mt-3 space-y-1.5">
                <legend className="text-[10px] font-semibold uppercase tracking-wide text-[var(--mos-text-muted)]">Sumber</legend>
                {availableUrls.map(url => (
                  <label key={url} className="flex items-start gap-2 text-[11px] text-[var(--mos-text)]">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedUrls.includes(url)}
                      onChange={event => {
                        setSelectedUrls(current => event.target.checked
                          ? [...current, url]
                          : current.filter(item => item !== url));
                      }}
                    />
                    <span className="min-w-0 break-all">{url}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={saving}
                className="rounded-lg px-3 py-1.5 text-[11px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => { void save(); }}
                disabled={saving || draft.text.trim().length < 8}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                {saving ? 'Menyimpan…' : 'Simpan fakta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          data-testid="ai-research-pin-toast"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-emerald-400/30 bg-[var(--mos-raised)] px-3 py-2.5 shadow-xl"
        >
          <p className="text-xs text-[var(--mos-text)]">Fakta tersimpan di Knowledge Graph.</p>
          <div className="mt-1.5 flex items-center gap-3">
            <a href={toast.graphUrl} className="text-[11px] font-medium text-emerald-200 underline underline-offset-2">
              Buka di Knowledge Graph
            </a>
            <button type="button" onClick={() => setToast(null)} className="text-[11px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]">
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
