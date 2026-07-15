'use client';
import { useState } from 'react';

export default function EventPlanPage() {
  const [eventName, setEventName] = useState('');
  const [theme, setTheme] = useState('');
  const [location, setLocation] = useState('Jakarta');
  const [budget, setBudget] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [tokenUsage, setTokenUsage] = useState<any>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/event-plan/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName, theme, location, budget, targetDate }),
      });
      const data = await res.json();
      if (data.success) { setResult(data.plan); setTokenUsage(data.usage); }
      else { setError(data.error || 'Generation failed'); }
    } catch (e: any) { setError(e.message || 'Network error'); }
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div><h1 className="text-2xl font-bold text-white">📋 Event Plan</h1><p className="text-gray-400 mt-1">Plan events with AI-powered research, proposals, and budgeting</p></div>

      <form onSubmit={handleGenerate} className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Event Name</label>
            <input type="text" value={eventName} onChange={e => setEventName(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Bloomberg Awarding Night" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Location</label>
            <input type="text" value={location} onChange={e => setLocation(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
              placeholder="Jakarta" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Theme</label>
            <input type="text" value={theme} onChange={e => setTheme(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Financial Awards" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Budget (IDR)</label>
            <input type="text" value={budget} onChange={e => setBudget(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Rp 50.000.000" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Target Date</label>
            <input type="text" value={targetDate} onChange={e => setTargetDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., August 2026" />
          </div>
        </div>
        <button type="submit" disabled={loading || !eventName}
          className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
          {loading ? '🤖 Generating...' : '📋 Generate Plan'}
        </button>
      </form>

      {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg">{error}</div>}

      {result && (
        <div className="space-y-6">
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <h3 className="text-lg font-semibold text-white mb-4">📋 Event Plan</h3>
            {result.objective && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">🎯 Objective</label><p className="text-white mt-1 bg-gray-700/30 p-3 rounded-lg">{result.objective}</p></div>}
            {result.concept && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">💡 Concept</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{result.concept}</p></div>}
            {result.theme && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">🎨 Theme</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{result.theme}</p></div>}
            {result.venue && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">📍 Venue</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{result.venue}</p></div>}
            {result.speakers && result.speakers.length > 0 && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">🎤 Speakers</label><ul className="mt-1 space-y-1">{result.speakers.map((s: string, i: number) => <li key={i} className="text-gray-300 bg-gray-700/30 p-2 rounded-lg">• {s}</li>)}</ul></div>}
            {result.budget && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">💰 Budget</label><pre className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg text-sm">{JSON.stringify(result.budget, null, 2)}</pre></div>}
            {result.timeline && <div><label className="text-xs text-gray-500 uppercase tracking-wide">📅 Timeline</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg whitespace-pre-wrap">{result.timeline}</p></div>}
          </div>
          {tokenUsage && (
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
              <h3 className="text-lg font-semibold text-white mb-2">💰 Token Usage</h3>
              <p className="text-gray-400">{tokenUsage.inputTokens + tokenUsage.outputTokens} tokens · <span className="text-green-400">${(tokenUsage.cost || 0).toFixed(6)}</span></p>
              {tokenUsage.model && <p className="text-xs text-gray-500 mt-1">Model: <span className="text-gray-400">{tokenUsage.model}</span></p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}