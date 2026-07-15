'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

interface ProgressState {
  step: string;
  progress: number;
  message: string;
  elapsed: number;
}

interface ProgressEvent {
  step: string;
  progress: number;
  message: string;
  result?: Record<string, unknown>;
}

interface ScriptOption {
  style: string;
  styleLabel: string;
  hook: string;
  context: string;
  highlight: string;
  brandTieIn: string;
  cta: string;
  fullScript: string;
}

const STEP_LABELS: Record<string, string> = {
  draft: 'Generating scripts',
  done: 'Complete',
  error: 'Error',
};

const STEP_ICONS: Record<string, string> = {
  draft: '🎬',
  done: '✅',
  error: '❌',
};

export default function VideoScriptPage() {
  const [event, setEvent] = useState('');
  const [platform, setPlatform] = useState('Instagram Reels');
  const [duration, setDuration] = useState('30-45 seconds');
  const [targetAudience, setTargetAudience] = useState('');
  const [references, setReferences] = useState('');
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ScriptOption[] | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [tokenUsage, setTokenUsage] = useState<any>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const [knowledgeSaved, setKnowledgeSaved] = useState(false);
  const [ratingMessage, setRatingMessage] = useState('');
  const [recentScripts, setRecentScripts] = useState<any[]>([]);
  const [viewingScript, setViewingScript] = useState<any>(null);

  // Streaming progress state
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchScripts = async () => {
    try {
      const res = await fetch('/api/dashboard/history?type=video-script');
      const data = await res.json();
      if (data.tasks) setRecentScripts(data.tasks);
    } catch {}
  };

  const startElapsedTimer = useCallback(() => {
    const startTime = Date.now();
    progressTimerRef.current = setInterval(() => {
      setProgress(prev => prev ? { ...prev, elapsed: Math.floor((Date.now() - startTime) / 1000) } : null);
    }, 1000);
    return startTime;
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  // Load recent scripts on mount
  useEffect(() => { fetchScripts(); }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopElapsedTimer();
      abortControllerRef.current?.abort();
    };
  }, [stopElapsedTimer]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setOptions(null);
    setResult(null);
    setTokenUsage(null);
    setViewingScript(null);
    setSelectedIndex(null);
    setKnowledgeSaved(false);
    setTaskId(null);
    setProgress({ step: 'draft', progress: 0, message: '🚀 Starting generation...', elapsed: 0 });

    // Abort any previous request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const startTime = startElapsedTimer();

    try {
      const res = await fetch('/api/video-script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, platform, duration, targetAudience, references }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event: ProgressEvent = JSON.parse(line.slice(6));
            const elapsed = Math.floor((Date.now() - startTime) / 1000);

            if (event.step === 'error') {
              setError(event.message);
              setProgress(null);
              stopElapsedTimer();
              setLoading(false);
              return;
            }

            if (event.step === 'done' && event.result) {
              const r = event.result as any;
              if (r.success) {
                setOptions(r.options || []);
                setResult(r);
                setTaskId(r.taskId);
                setTokenUsage(r.usage);
                fetchScripts();
              }
              setProgress({ step: 'done', progress: 100, message: '✅ Complete!', elapsed });
              stopElapsedTimer();
              setTimeout(() => setProgress(null), 3000);
              setLoading(false);
              return;
            }

            setProgress({
              step: event.step,
              progress: event.progress,
              message: event.message,
              elapsed,
            });
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message || 'Network error');
      }
      setProgress(null);
      stopElapsedTimer();
    }
    setLoading(false);
  };

  const handleSelectOption = async (index: number) => {
    if (!options || savingKnowledge) return;
    setSelectedIndex(index);
    setSavingKnowledge(true);
    setKnowledgeSaved(false);

    const selected = options[index];
    const rejected = options.filter((_, i) => i !== index);

    try {
      const res = await fetch('/api/knowledge/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType: 'video-script',
          brief: event,
          selectedOutput: selected,
          rejectedOutputs: rejected,
          styleCluster: selected.style,
          platform,
          audience: targetAudience,
        }),
      });

      if (res.ok) {
        setKnowledgeSaved(true);
        setTimeout(() => setKnowledgeSaved(false), 5000);
      }
    } catch (e) {
      console.error('Failed to save knowledge:', e);
    }

    setSavingKnowledge(false);
  };

  const rateResult = async (rating: number) => {
    if (!taskId) return;
    setRatingMessage('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, rating }),
      });
      if (res.ok) {
        const msgs = ['', '👎 Saved', '😐 Saved', '', '👍 Saved', '⭐ Saved'];
        setRatingMessage(msgs[rating] || '✅ Rated');
        setTimeout(() => setRatingMessage(''), 3000);
      }
    } catch {}
  };

  const viewScript = (script: any) => {
    setViewingScript(script);
    setOptions(null);
    setResult(null);
    setSelectedIndex(null);
    setKnowledgeSaved(false);
    setError('');
    try {
      const data = JSON.parse(script.output_data || '{}');
      if (data.options && Array.isArray(data.options)) {
        setOptions(data.options);
        setTaskId(script.id);
      } else {
        setResult({ ...data, taskId: script.id });
        setTaskId(script.id);
      }
    } catch {}
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  const downloadJSON = () => {
    const dataToExport = options
      ? { platform, event, options, usage: tokenUsage, generatedAt: new Date().toISOString() }
      : result
      ? { platform, event, script: result.script || result, usage: tokenUsage, generatedAt: new Date().toISOString() }
      : null;
    if (!dataToExport) return;
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video-script-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStepStatus = (stepName: string): 'completed' | 'active' | 'pending' => {
    if (!progress) return 'pending';
    const stepOrder = ['draft', 'done'];
    const currentIdx = stepOrder.indexOf(progress.step);
    const targetIdx = stepOrder.indexOf(stepName);
    if (currentIdx > targetIdx) return 'completed';
    if (currentIdx === targetIdx) return 'active';
    return 'pending';
  };

  const selectedOption = selectedIndex !== null && options ? options[selectedIndex] : null;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">🎬 Video Script</h1>
        <p className="text-gray-400 mt-1">Generate 3 style options, compare, and pick your favorite</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form + Result */}
        <div className="lg:col-span-2 space-y-6">
          {/* Form */}
          <form onSubmit={handleGenerate} className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Platform</label>
                <select value={platform} onChange={e => setPlatform(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500">
                  <option>Instagram Reels</option><option>TikTok</option><option>YouTube Shorts</option><option>YouTube</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Duration</label>
                <select value={duration} onChange={e => setDuration(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500">
                  <option>15-30 seconds</option><option>30-45 seconds</option><option>45-60 seconds</option><option>1-3 minutes</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Target Audience</label>
                <select value={targetAudience} onChange={e => setTargetAudience(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500">
                  <option value="">Pilih audience...</option>
                  <option value="Trader Pemula">Trader Pemula</option>
                  <option value="Trader Aktif">Trader Aktif</option>
                  <option value="Trader Profesional">Trader Profesional</option>
                  <option value="Investor">Investor</option>
                  <option value="Pecinta Finansial">Pecinta Finansial</option>
                  <option value="Pelajar & Mahasiswa">Pelajar & Mahasiswa</option>
                  <option value="Pengusaha">Pengusaha</option>
                  <option value="Karyawan & Profesional Muda">Karyawan & Profesional Muda</option>
                  <option value="General Public">General Public</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Event / Topic</label>
              <textarea value={event} onChange={e => setEvent(e.target.value)} rows={3}
                className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                placeholder="Describe the event or topic for the video..." required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Reference Links (optional)</label>
              <input type="text" value={references} onChange={e => setReferences(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., TikTok/IG links for inspiration" />
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={loading || !event}
                className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-800/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                {loading ? '⏳ Generating 3 options...' : '🎬 Generate 3 Options'}
              </button>
              {options && !loading && (
                <button type="button" onClick={handleGenerate as any}
                  className="px-4 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 font-medium rounded-lg transition-colors">
                  🔄 Generate 3 lagi
                </button>
              )}
            </div>
          </form>

          {/* Streaming Progress Indicator */}
          {progress && loading && (
            <div className="bg-gray-800/80 rounded-xl p-6 border border-gray-700/50 space-y-4">
              <h3 className="text-lg font-semibold text-white">🤖 Generating 3 Style Scripts...</h3>

              {/* Progress bar */}
              <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${progress.progress}%` }}
                />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2s_infinite]"
                  style={{ animation: 'shimmer 2s infinite' }} />
              </div>

              {/* Percentage + message */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-300">{progress.message}</p>
                <span className="text-sm font-mono text-green-400">{progress.progress}%</span>
              </div>

              {/* Step indicators */}
              <div className="space-y-2 pt-2">
                {['draft'].map((stepName) => {
                  const status = getStepStatus(stepName);
                  return (
                    <div key={stepName} className={`flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors ${
                      status === 'active' ? 'bg-green-500/10' : status === 'completed' ? 'bg-green-500/5' : ''
                    }`}>
                      <span className={`text-sm ${
                        status === 'completed' ? 'text-green-400' : status === 'active' ? 'text-green-400' : 'text-gray-600'
                      }`}>
                        {status === 'completed' ? '✅' : status === 'active' ? `${STEP_ICONS[stepName]}` : '⬚'}
                      </span>
                      <span className={`text-sm ${
                        status === 'completed' ? 'text-green-400' : status === 'active' ? 'text-white font-medium' : 'text-gray-600'
                      }`}>
                        {STEP_LABELS[stepName]}
                      </span>
                      {status === 'active' && (
                        <span className="ml-auto text-xs text-green-400 animate-pulse">running...</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Elapsed time */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-700/50">
                <span className="text-xs text-gray-500">⏱️ Elapsed: {progress.elapsed}s</span>
                {progress.elapsed > 30 && (
                  <span className="text-xs text-yellow-500/70">— generating 3 scripts in parallel</span>
                )}
              </div>
            </div>
          )}

          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg">{error}</div>}

          {/* Knowledge saved notification */}
          {knowledgeSaved && (
            <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg flex items-center gap-2">
              <span>✅</span>
              <span>Knowledge saved! Style profile updated. This helps future generations match your preferences.</span>
            </div>
          )}

          {/* 3-Option Comparison Cards */}
          {options && options.length > 0 && !loading && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">🎯 Pick Your Favorite Style</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {options.map((opt, index) => {
                  const isSelected = selectedIndex === index;
                  const styleColors: Record<string, { border: string; bg: string; accent: string }> = {
                    'high-energy': { border: 'border-orange-500/40', bg: 'from-orange-600/10 to-red-600/10', accent: 'text-orange-400' },
                    professional: { border: 'border-blue-500/40', bg: 'from-blue-600/10 to-indigo-600/10', accent: 'text-blue-400' },
                    cinematic: { border: 'border-purple-500/40', bg: 'from-purple-600/10 to-pink-600/10', accent: 'text-purple-400' },
                  };
                  const colors = styleColors[opt.style] || styleColors['high-energy'];

                  return (
                    <div
                      key={index}
                      className={`bg-gradient-to-br ${colors.bg} rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? `${colors.border} ring-2 ring-offset-2 ring-offset-gray-900 ${colors.border.replace('/40', '/60')}`
                          : 'border-gray-700/50 hover:border-gray-600/50'
                      } ${isSelected && selectedIndex !== null ? 'md:col-span-3' : ''}`}
                      onClick={() => !isSelected && handleSelectOption(index)}
                    >
                      <div className="p-5">
                        {/* Style Label */}
                        <div className="flex items-center justify-between mb-3">
                          <span className={`text-sm font-bold ${colors.accent}`}>{opt.styleLabel}</span>
                          {isSelected && <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full">✅ Selected</span>}
                        </div>

                        {/* Hook preview */}
                        {opt.hook && (
                          <p className="text-white font-semibold text-sm mb-2 leading-snug">"{opt.hook}"</p>
                        )}

                        {/* CTA preview */}
                        {opt.cta && (
                          <p className="text-gray-300 text-xs leading-relaxed mb-3" style={{
                            display: isSelected ? 'block' : '-webkit-box',
                            WebkitLineClamp: isSelected ? undefined : 4,
                            WebkitBoxOrient: 'vertical',
                            overflow: isSelected ? 'visible' : 'hidden',
                          }}>
                            {opt.cta}
                          </p>
                        )}

                        {/* Brief summary when collapsed */}
                        {!isSelected && (
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {opt.context && <span className="text-[10px] px-1.5 py-0.5 bg-gray-700/50 text-blue-300 rounded">📖 Context</span>}
                            {opt.highlight && <span className="text-[10px] px-1.5 py-0.5 bg-gray-700/50 text-purple-300 rounded">✨ Highlight</span>}
                            {opt.brandTieIn && <span className="text-[10px] px-1.5 py-0.5 bg-gray-700/50 text-green-300 rounded">🔗 Brand</span>}
                            {opt.fullScript && <span className="text-[10px] px-1.5 py-0.5 bg-gray-700/50 text-yellow-300 rounded">📜 Script</span>}
                          </div>
                        )}

                        {/* Select button */}
                        {!isSelected && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSelectOption(index); }}
                            disabled={savingKnowledge}
                            className="w-full mt-2 px-4 py-2 bg-gray-700/50 hover:bg-gray-600/50 text-white text-sm font-medium rounded-lg transition-colors border border-gray-600/50"
                          >
                            📌 Pilih ini
                          </button>
                        )}

                        {/* Expanded content when selected */}
                        {isSelected && (
                          <div className="mt-4 space-y-4 pt-4 border-t border-gray-600/30">
                            {opt.hook && (
                              <div>
                                <label className="text-xs text-gray-500 uppercase tracking-wide">🎣 Hook</label>
                                <p className="text-white mt-1 bg-gray-700/30 p-3 rounded-lg">{opt.hook}</p>
                              </div>
                            )}
                            {opt.context && (
                              <div>
                                <label className="text-xs text-gray-500 uppercase tracking-wide">📖 Context</label>
                                <p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{opt.context}</p>
                              </div>
                            )}
                            {opt.highlight && (
                              <div>
                                <label className="text-xs text-gray-500 uppercase tracking-wide">✨ Highlight</label>
                                <p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{opt.highlight}</p>
                              </div>
                            )}
                            {opt.brandTieIn && (
                              <div>
                                <label className="text-xs text-gray-500 uppercase tracking-wide">🔗 Brand Tie-In</label>
                                <p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{opt.brandTieIn}</p>
                              </div>
                            )}
                            {opt.cta && (
                              <div>
                                <label className="text-xs text-gray-500 uppercase tracking-wide">🎯 CTA</label>
                                <p className="text-blue-400 mt-1 bg-gray-700/30 p-3 rounded-lg">{opt.cta}</p>
                              </div>
                            )}
                            {opt.fullScript && (
                              <div>
                                <label className="text-xs text-gray-500 uppercase tracking-wide">📜 Full Script</label>
                                <p className="text-white mt-1 bg-gray-700/50 p-4 rounded-lg whitespace-pre-wrap font-mono text-sm">{opt.fullScript}</p>
                              </div>
                            )}

                            {/* Copy / Deselect buttons */}
                            <div className="flex gap-2 flex-wrap">
                              <button onClick={() => copyToClipboard(opt.fullScript)}
                                className="text-xs px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg">
                                📋 Copy Script
                              </button>
                              <button onClick={() => copyToClipboard(
                                `Hook: ${opt.hook}\n\nContext: ${opt.context}\n\nHighlight: ${opt.highlight}\n\nBrand Tie-In: ${opt.brandTieIn}\n\nCTA: ${opt.cta}\n\n---\n\nFull Script:\n${opt.fullScript}`
                              )}
                                className="text-xs px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg">
                                📋 Copy All
                              </button>
                              <button onClick={() => setSelectedIndex(null)}
                                className="text-xs px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg ml-auto">
                                ✕ Deselect
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legacy single result (backward compat for old format) */}
          {result && result.script && !options && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-green-600/10 to-emerald-600/10 rounded-xl p-6 border border-green-500/20">
                <h3 className="text-lg font-semibold text-white mb-4">📝 Generated Script</h3>
                {(result.script?.hook || result.script?.context || result.script?.highlight || result.script?.brandTieIn || result.script?.cta || result.script?.fullScript) ? (
                  <>
                    {result.script.hook && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">🎣 Hook</label><p className="text-white mt-1 bg-gray-700/30 p-3 rounded-lg">{result.script.hook}</p></div>}
                    {result.script.context && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">📖 Context</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{result.script.context}</p></div>}
                    {result.script.highlight && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">✨ Highlight</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{result.script.highlight}</p></div>}
                    {result.script.brandTieIn && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">🔗 Brand Tie-In</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{result.script.brandTieIn}</p></div>}
                    {result.script.cta && <div className="mb-4"><label className="text-xs text-gray-500 uppercase tracking-wide">🎯 CTA</label><p className="text-blue-400 mt-1 bg-gray-700/30 p-3 rounded-lg">{result.script.cta}</p></div>}
                    {result.script.fullScript && <div><label className="text-xs text-gray-500 uppercase tracking-wide">📜 Full Script</label><p className="text-white mt-1 bg-gray-700/50 p-4 rounded-lg whitespace-pre-wrap font-mono text-sm">{result.script.fullScript}</p></div>}
                  </>
                ) : (
                  <p className="text-gray-300 bg-gray-700/30 p-3 rounded-lg whitespace-pre-wrap">{JSON.stringify(result.script, null, 2)}</p>
                )}
              </div>
            </div>
          )}

          {/* Token Usage + Download + Rating */}
          {(options || result) && (
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <h3 className="text-lg font-semibold text-white mb-2">💰 Token Usage</h3>
                  {tokenUsage && (
                    <div className="space-y-1 text-sm">
                      {tokenUsage.videoScript && (
                        <p className="text-gray-400">
                          Video Script (3 options): <span className="text-white">{(tokenUsage.videoScript?.inputTokens || 0) + (tokenUsage.videoScript?.outputTokens || 0)}</span> tokens · <span className="text-green-400">${(tokenUsage.videoScript?.cost || 0).toFixed(6)}</span>
                        </p>
                      )}
                      <div className="pt-2 mt-2 border-t border-gray-700/50 flex items-center gap-3">
                        <span className="text-gray-300 font-medium">
                          Total: <span className="text-white">{(tokenUsage.videoScript?.inputTokens || 0) + (tokenUsage.videoScript?.outputTokens || 0)}</span> tokens
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          (tokenUsage.videoScript?.cost || 0) < 0.001
                            ? 'bg-green-500/15 text-green-400'
                            : (tokenUsage.videoScript?.cost || 0) < 0.01
                            ? 'bg-yellow-500/15 text-yellow-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}>
                          ${(tokenUsage.videoScript?.cost || 0).toFixed(6)}
                        </span>
                      </div>
                      {tokenUsage.videoScript?.model && (
                        <p className="text-xs text-gray-500 pt-1">
                          Model: <span className="text-blue-400">{tokenUsage.videoScript.model}</span>
                          {tokenUsage.videoScript.model.includes('codex') && (
                            <span className="ml-2 px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded text-xs">ChatGPT Plus</span>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Rate this:</span>
                  <button onClick={() => rateResult(5)} className="px-2 py-1 text-lg hover:bg-gray-700 rounded transition-colors" title="Excellent">⭐</button>
                  <button onClick={() => rateResult(4)} className="px-2 py-1 text-lg hover:bg-gray-700 rounded transition-colors" title="Good">👍</button>
                  <button onClick={() => rateResult(3)} className="px-2 py-1 text-lg hover:bg-gray-700 rounded transition-colors" title="Okay">😐</button>
                  <button onClick={() => rateResult(1)} className="px-2 py-1 text-lg hover:bg-gray-700 rounded transition-colors" title="Bad">👎</button>
                  <div className="w-px h-6 bg-gray-700 mx-2"></div>
                  <button onClick={downloadJSON} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg flex items-center gap-1">⬇️ Download JSON</button>
                </div>
              </div>
              {ratingMessage && <p className="text-xs text-green-400 mt-2">{ratingMessage}</p>}
            </div>
          )}
        </div>

        {/* Right: Recent Scripts */}
        <div className="lg:col-span-1">
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden sticky top-8">
            <div className="p-4 border-b border-gray-700/50">
              <h3 className="text-lg font-semibold text-white">📋 Recent Scripts</h3>
              <p className="text-xs text-gray-500 mt-1">Click to view previous generations</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {recentScripts.length > 0 ? recentScripts.map((script: any) => (
                <div key={script.id}
                  onClick={() => viewScript(script)}
                  className={`p-3 border-b border-gray-800/50 cursor-pointer hover:bg-gray-700/30 transition-colors ${viewingScript?.id === script.id ? 'bg-green-600/10 border-l-2 border-l-green-500' : ''}`}>
                  <p className="text-sm text-gray-300 truncate">{script.title}</p>
                  <p className="text-xs text-gray-600 mt-1">{new Date(script.created_at).toLocaleDateString()}</p>
                </div>
              )) : <p className="text-gray-500 p-4 text-center text-sm">No scripts yet</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Shimmer animation keyframes */}
      <style jsx global>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
