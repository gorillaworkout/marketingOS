'use client';

import { useState } from 'react';

type BudgetItem = { category: string; estimatedCost: number; notes: string };
type Budget = { currency: 'IDR'; total?: number; items: BudgetItem[]; contingency?: number };
type EventPlanOption = {
  style: string;
  styleLabel: string;
  objective?: string;
  concept?: string;
  theme?: string;
  venue?: string;
  speakers?: unknown;
  budget?: unknown;
  timeline?: string;
};
type GenerationEvent = {
  step?: string;
  progress?: number;
  message?: string;
  result?: { success?: boolean; options?: EventPlanOption[]; usage?: { plan?: unknown } };
};
type TokenUsage = { inputTokens?: number; outputTokens?: number; model?: string };

export function formatIDR(value: number | string) {
  const amount = typeof value === 'number' ? value : Number(String(value).replace(/\D/g, ''));
  return `Rp ${Number.isFinite(amount) ? Math.max(0, Math.floor(amount)).toLocaleString('id-ID') : '0'}`;
}

function formatTargetDate(value: string) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(date);
}

function asRupiah(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const digits = value.replace(/\D/g, '');
    return digits ? Number(digits) : undefined;
  }
  return undefined;
}

function normalizeBudget(value: unknown): Budget | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const source = candidate as Record<string, unknown>;
  const items = Array.isArray(source.items) ? source.items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    return [{
      category: typeof entry.category === 'string' ? entry.category : 'Other',
      estimatedCost: asRupiah(entry.estimatedCost) ?? 0,
      notes: typeof entry.notes === 'string' ? entry.notes : '—',
    }];
  }) : [];
  return {
    currency: 'IDR',
    total: asRupiah(source.total),
    contingency: asRupiah(source.contingency),
    items,
  };
}

export default function EventPlanPage() {
  const [eventName, setEventName] = useState('');
  const [theme, setTheme] = useState('');
  const [location, setLocation] = useState('Jakarta');
  const [budget, setBudget] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<EventPlanOption[]>([]);
  const [selectedOption, setSelectedOption] = useState(0);
  const [progress, setProgress] = useState<{ message: string; progress?: number } | null>(null);
  const [error, setError] = useState('');
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setOptions([]);
    setSelectedOption(0);
    setTokenUsage(null);
    setProgress({ message: 'Starting event plan generation…', progress: 0 });
    try {
      const res = await fetch('/api/event-plan/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName, theme, location, budget: budget ? Number(budget) : undefined, targetDate }),
      });
      if (!res.ok) throw new Error(`Generation failed (${res.status})`);
      if (!res.body) throw new Error('The generation stream was unavailable');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const consumeLines = (text: string) => {
        buffer += text;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice('data: '.length)) as GenerationEvent;
            if (event.message) setProgress({ message: event.message, progress: event.progress });
            if (event.step === 'error') setError(event.message || 'Generation failed');
            if (event.step === 'done') {
              if (!event.result?.success) setError(event.message || 'Generation failed');
              else {
                const generatedOptions = Array.isArray(event.result.options) ? event.result.options : [];
                setOptions(generatedOptions);
                setSelectedOption(0);
                const usage = event.result.usage?.plan;
                setTokenUsage(usage && typeof usage === 'object' ? usage as TokenUsage : null);
              }
            }
          } catch {
            // Wait for the next line if a proxy delivered an incomplete SSE message.
          }
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        consumeLines(decoder.decode(value, { stream: true }));
      }
      consumeLines(decoder.decode());
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Network error');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const result = options[selectedOption];
  const displayBudget = normalizeBudget(result?.budget);
  const speakers = Array.isArray(result?.speakers) ? result.speakers.filter((speaker): speaker is string => typeof speaker === 'string') : [];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div><h1 className="text-2xl font-bold text-white">📋 Event Plan</h1><p className="text-gray-400 mt-1">Plan events with AI-powered research, proposals, and budgeting</p></div>

      <form onSubmit={handleGenerate} className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-300 mb-1">Event Name</label><input type="text" value={eventName} onChange={e => setEventName(e.target.value)} className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500" placeholder="e.g., Bloomberg Awarding Night" required /></div>
          <div><label className="block text-sm font-medium text-gray-300 mb-1">Location</label><input type="text" value={location} onChange={e => setLocation(e.target.value)} className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500" placeholder="Jakarta" /></div>
          <div><label className="block text-sm font-medium text-gray-300 mb-1">Theme</label><input type="text" value={theme} onChange={e => setTheme(e.target.value)} className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500" placeholder="e.g., Financial Awards" /></div>
          <div><label className="block text-sm font-medium text-gray-300 mb-1">Budget ceiling (IDR)</label><input type="text" inputMode="numeric" value={budget ? formatIDR(budget) : ''} onChange={e => setBudget(e.target.value.replace(/\D/g, ''))} className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500" placeholder="Rp 50.000.000" /></div>
          <div><label className="block text-sm font-medium text-gray-300 mb-1">Event Target Date</label><input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500" /></div>
        </div>
        <button type="submit" disabled={loading || !eventName} className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">{loading ? '🤖 Generating…' : '📋 Generate Plan'}</button>
      </form>

      {loading && progress && <div className="bg-blue-500/10 border border-blue-500/20 text-blue-200 px-4 py-3 rounded-lg" role="status">{progress.progress !== undefined && <span className="font-medium mr-2">{progress.progress}%</span>}{progress.message}</div>}
      {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg" role="alert">{error}</div>}

      {options.length > 0 && result && (
        <div className="space-y-6">
          <section><h2 className="text-lg font-semibold text-white mb-3">Choose a plan style</h2><div className="grid grid-cols-1 md:grid-cols-3 gap-3">{options.map((option, index) => <button type="button" key={`${option.style}-${index}`} onClick={() => setSelectedOption(index)} className={`text-left rounded-xl border p-4 transition-colors ${selectedOption === index ? 'border-orange-500 bg-orange-500/10' : 'border-gray-700/50 bg-gray-800/50 hover:border-gray-500'}`}><p className="font-semibold text-white">{option.styleLabel || option.style}</p><p className="text-sm text-gray-300 mt-2 line-clamp-3">{option.concept || option.objective || 'No concept preview available.'}</p><p className="text-xs text-gray-500 mt-3">{option.objective || 'View full plan'}</p></button>)}</div></section>
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <h3 className="text-lg font-semibold text-white mb-4">📋 {result.styleLabel || 'Event Plan'}</h3>
            {result.objective && <Detail label="🎯 Objective" value={result.objective} />}
            {result.concept && <Detail label="💡 Concept" value={result.concept} />}
            {result.theme && <Detail label="🎨 Theme" value={result.theme} />}
            {result.venue && <Detail label="📍 Venue" value={result.venue} />}
            {targetDate && <Detail label="📅 Event Target Date" value={formatTargetDate(targetDate)} />}
            {speakers.length > 0 && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">🎤 Speakers</label><ul className="mt-1 space-y-1">{speakers.map((speaker, index) => <li key={index} className="text-gray-300 bg-gray-700/30 p-2 rounded-lg">• {speaker}</li>)}</ul></div>}
            <BudgetBreakdown budget={displayBudget} />
            {result.timeline && <Detail label="📅 Timeline" value={result.timeline} preserveWhitespace />}
          </div>
          {tokenUsage && <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50"><h3 className="text-lg font-semibold text-white mb-2">💰 Token Usage</h3><p className="text-gray-400">{(tokenUsage.inputTokens || 0) + (tokenUsage.outputTokens || 0)} tokens</p>{tokenUsage.model && <p className="text-xs text-gray-500 mt-1">Model: <span className="text-gray-400">{tokenUsage.model}</span></p>}</div>}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, preserveWhitespace = false }: { label: string; value: string; preserveWhitespace?: boolean }) {
  return <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">{label}</label><p className={`text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg ${preserveWhitespace ? 'whitespace-pre-wrap' : ''}`}>{value}</p></div>;
}

function BudgetBreakdown({ budget }: { budget: Budget | null }) {
  if (!budget) return <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">💰 Budget Breakdown</label><p className="text-gray-400 mt-1 bg-gray-700/30 p-3 rounded-lg">Budget details were unavailable for this plan.</p></div>;
  return <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">💰 Budget Breakdown</label><div className="mt-1 overflow-x-auto rounded-lg border border-gray-700"><table className="w-full text-sm text-left"><thead className="bg-gray-700/50 text-gray-300"><tr><th className="p-3">Category</th><th className="p-3">Notes</th><th className="p-3 text-right">Estimated cost</th></tr></thead><tbody>{budget.items.length ? budget.items.map((item, index) => <tr key={index} className="border-t border-gray-700 text-gray-300"><td className="p-3">{item.category}</td><td className="p-3">{item.notes}</td><td className="p-3 text-right whitespace-nowrap">{formatIDR(item.estimatedCost)}</td></tr>) : <tr className="border-t border-gray-700 text-gray-400"><td className="p-3" colSpan={3}>No itemized budget details were provided.</td></tr>}</tbody><tfoot className="bg-gray-700/30 text-white"><tr><td className="p-3 font-medium" colSpan={2}>Contingency</td><td className="p-3 text-right whitespace-nowrap">{formatIDR(budget.contingency ?? 0)}</td></tr><tr><td className="p-3 font-semibold" colSpan={2}>Total</td><td className="p-3 text-right font-semibold whitespace-nowrap">{formatIDR(budget.total ?? 0)}</td></tr></tfoot></table></div></div>;
}
