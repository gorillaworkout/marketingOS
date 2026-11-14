'use client';

import { useEffect, useState } from 'react';
import { Button, FormField, Panel, SectionHeader, Select, TextArea } from '@/components/ui/dashboard';
import { ANALYZER_DIMENSIONS, type CaptionAnalysisResult } from '@/lib/social-post-competitor';

type Seed = { caption: string; platform: string; goal: string; cta: string; taskId?: string | null; key: number };

const DIMENSION_LABELS: Record<(typeof ANALYZER_DIMENSIONS)[number], string> = {
  hook: 'Hook',
  clarity: 'Clarity',
  brandVoice: 'Brand voice',
  cta: 'Call to action',
  platformFit: 'Platform fit',
  compliance: 'BAPPEBTI compliance',
};

export function CaptionAnalyzer({
  seed,
  onUseCaption,
}: {
  seed: Seed | null;
  onUseCaption: (caption: string) => void;
}) {
  const [caption, setCaption] = useState(seed?.caption || '');
  const [platform, setPlatform] = useState(seed?.platform || 'Instagram');
  const [goal, setGoal] = useState(seed?.goal || '');
  const [cta, setCta] = useState(seed?.cta || '');
  const [seenKey, setSeenKey] = useState<number | null>(seed?.key ?? null);
  if (seed && seed.key !== seenKey) {
    setSeenKey(seed.key);
    setCaption(seed.caption);
    setPlatform(seed.platform);
    setGoal(seed.goal);
    setCta(seed.cta);
  }
  const [result, setResult] = useState<CaptionAnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Array<{ id: string; platform: string | null; caption: string; result: CaptionAnalysisResult; created_at: string }>>([]);

  const loadHistory = () => {
    fetch('/api/social-post/analyze-caption')
      .then(response => response.ok ? response.json() : { analyses: [] })
      .then(data => setHistory(Array.isArray(data.analyses) ? data.analyses : []))
      .catch(() => setHistory([]));
  };

  useEffect(() => { loadHistory(); }, []);

  const run = async (next?: { caption: string; platform: string; goal: string; cta: string; taskId?: string | null }) => {
    const input = next || { caption, platform, goal, cta, taskId: seed?.taskId };
    if (!input.caption.trim()) { setError('Paste a caption to analyze.'); return; }
    setBusy(true);
    setError('');
    const response = await fetch('/api/social-post/analyze-caption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(data.error || 'Could not analyze the caption.'); return; }
    setResult(data.result);
    loadHistory();
  };

  useEffect(() => {
    if (!seed) return;
    const timer = setTimeout(() => { void run(seed); }, 0);
    return () => clearTimeout(timer);
    // The seed key is the user clicking Analyze. The request uses that snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.key]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel className="space-y-4">
          <SectionHeader title="Caption analyzer" description="Score a caption, check BAPPEBTI compliance, and review an improved version before you use it." />
          <FormField label="Platform">
            <Select value={platform} onChange={event => setPlatform(event.target.value)}>
              <option>Instagram</option><option>TikTok</option><option>LinkedIn</option><option>Twitter/X</option><option>Facebook</option>
            </Select>
          </FormField>
          <FormField label="Caption">
            <TextArea value={caption} onChange={event => setCaption(event.target.value)} rows={8} />
          </FormField>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void run()}>{busy ? 'Analyzing…' : 'Analyze caption'}</Button>
          {error && <p className="text-sm text-red-300">{error}</p>}
        </Panel>
        {result && (
          <Panel className="space-y-4">
            <div className="flex items-end justify-between">
              <p className="text-4xl font-semibold text-white">{result.score}</p>
              <p className="text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">Score</p>
            </div>
            {result.summary && <p className="text-sm text-[var(--mos-text-secondary)]">{result.summary}</p>}
            <div className="space-y-2">
              {ANALYZER_DIMENSIONS.map(name => (
                <div key={name}>
                  <div className="mb-1 flex justify-between text-xs text-[var(--mos-text-muted)]">
                    <span>{DIMENSION_LABELS[name]}</span>
                    <span>{result.dimensions[name].score}/5</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--mos-raised)]">
                    <div className="h-1.5 rounded-full bg-[var(--mos-accent)]" style={{ width: `${result.dimensions[name].score * 20}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--mos-text-secondary)]">{result.dimensions[name].note}</p>
                </div>
              ))}
            </div>
            {result.recommendations.length > 0 && (
              <ul className="space-y-2 text-sm">
                {result.recommendations.map((item, index) => (
                  <li key={`${item.issue}-${index}`} className="rounded border border-[var(--mos-border)] px-3 py-2">
                    <span className="text-[11px] uppercase tracking-wide text-[var(--mos-text-faint)]">{item.priority}</span>
                    <p className="text-[var(--mos-text)]">{item.issue}</p>
                    <p className="text-[var(--mos-text-secondary)]">{item.fix}</p>
                  </li>
                ))}
              </ul>
            )}
            {result.rewrittenHook && <p className="text-sm"><span className="text-[var(--mos-text-faint)]">Improved hook: </span>{result.rewrittenHook}</p>}
            {result.improvedCaption && (
              <div className="space-y-2">
                <p className="whitespace-pre-wrap text-sm text-[var(--mos-text-secondary)]">{result.improvedCaption}</p>
                <Button type="button" onClick={() => onUseCaption(result.improvedCaption)}>Use improved caption</Button>
              </div>
            )}
          </Panel>
        )}
      </div>
      <Panel padding="none" className="lg:col-span-1">
        <div className="border-b border-[var(--mos-border)] p-4">
          <h3 className="text-sm font-semibold text-white">Recent analyses</h3>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {history.map(item => (
            <button key={item.id} type="button" className="block w-full border-b border-[var(--mos-border)] p-3 text-left hover:bg-[var(--mos-raised)]" onClick={() => { setCaption(item.caption); setResult(item.result); }}>
              <p className="truncate text-sm text-[var(--mos-text-secondary)]">{item.caption}</p>
              <p className="mt-1 text-[11px] text-[var(--mos-text-faint)]">{item.platform} · {item.result?.score ?? ''}</p>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}
