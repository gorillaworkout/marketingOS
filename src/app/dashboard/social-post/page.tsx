'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

interface ProgressState {
  step: string;
  progress: number;
  message: string;
  elapsed: number;
}

interface ImageProgressState {
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

interface PostOption {
  style: string;
  styleLabel: string;
  hook: string;
  caption: string;
  hashtags: string[];
  imagePrompt: string;
}

const STEP_LABELS: Record<string, string> = {
  draft: 'Generating options',
  'image-prompt': 'Image prompt',
  done: 'Complete',
  error: 'Error',
};

const STEP_ICONS: Record<string, string> = {
  draft: '📝',
  'image-prompt': '🎨',
  done: '✅',
  error: '❌',
};

export default function SocialPostPage() {
  const [brief, setBrief] = useState('');
  const [platform, setPlatform] = useState('Instagram');
  const [targetAudience, setTargetAudience] = useState('');
  const [goal, setGoal] = useState('Awareness');
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<PostOption[] | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [tokenUsage, setTokenUsage] = useState<any>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [editableImagePrompt, setEditableImagePrompt] = useState('');
  const [imageProgress, setImageProgress] = useState<ImageProgressState | null>(null);
  const imageProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageAbortRef = useRef<AbortController | null>(null);
  const [ratingMessage, setRatingMessage] = useState('');
  const [recentPosts, setRecentPosts] = useState<any[]>([]);
  const [viewingPost, setViewingPost] = useState<any>(null);

  // Selected option state
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const [knowledgeSaved, setKnowledgeSaved] = useState(false);

  // Streaming progress state
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load recent posts on mount
  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    try {
      const res = await fetch('/api/dashboard/history?type=social-post');
      const data = await res.json();
      if (data.tasks) setRecentPosts(data.tasks);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopElapsedTimer();
      if (imageProgressTimerRef.current) { clearInterval(imageProgressTimerRef.current); imageProgressTimerRef.current = null; }
      abortControllerRef.current?.abort();
      imageAbortRef.current?.abort();
    };
  }, [stopElapsedTimer]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setOptions(null);
    setResult(null);
    setGeneratedImage(null);
    setTokenUsage(null);
    setViewingPost(null);
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
      const res = await fetch('/api/social-post/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, platform, targetAudience, goal }),
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
                if (r.options?.[0]) {
                  setEditableImagePrompt(r.options[0].imagePrompt || r.imagePrompt || '');
                }
                fetchPosts();
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
          taskType: 'social-post',
          brief,
          selectedOutput: selected,
          rejectedOutputs: rejected,
          styleCluster: selected.style,
          platform,
          audience: targetAudience,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setKnowledgeSaved(true);
        setEditableImagePrompt(selected.imagePrompt || '');
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

  const generateImage = async () => {
    if (!editableImagePrompt.trim()) return;
    setGeneratingImage(true);
    setError('');
    setGeneratedImage(null);
    setImageProgress({ step: 'trying', progress: 5, message: '🚀 Starting image generation...', elapsed: 0 });

    // Abort any previous request
    imageAbortRef.current?.abort();
    const controller = new AbortController();
    imageAbortRef.current = controller;

    const startTime = Date.now();
    imageProgressTimerRef.current = setInterval(() => {
      setImageProgress(prev => prev ? { ...prev, elapsed: Math.floor((Date.now() - startTime) / 1000) } : null);
    }, 1000);

    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: editableImagePrompt, taskId, type: 'social-post' }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

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
            const event = JSON.parse(line.slice(6));
            const elapsed = Math.floor((Date.now() - startTime) / 1000);

            if (event.step === 'error') {
              setError(event.message);
              setImageProgress(null);
              if (imageProgressTimerRef.current) { clearInterval(imageProgressTimerRef.current); imageProgressTimerRef.current = null; }
              setGeneratingImage(false);
              return;
            }

            if (event.step === 'done' && event.result?.success) {
              setGeneratedImage(event.result.imageUrl);
              setImageProgress({ step: 'done', progress: 100, message: '✅ Image generated!', elapsed });
              if (imageProgressTimerRef.current) { clearInterval(imageProgressTimerRef.current); imageProgressTimerRef.current = null; }
              setTimeout(() => setImageProgress(null), 3000);
              setGeneratingImage(false);
              return;
            }

            setImageProgress({ step: event.step, progress: event.progress, message: event.message, elapsed });
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message || 'Network error');
      setImageProgress(null);
      if (imageProgressTimerRef.current) { clearInterval(imageProgressTimerRef.current); imageProgressTimerRef.current = null; }
    }
    setGeneratingImage(false);
  };

  const viewPost = (post: any) => {
    setViewingPost(post);
    setOptions(null);
    setResult(null);
    setSelectedIndex(null);
    setGeneratedImage(null);
    setKnowledgeSaved(false);
    setError('');
    try {
      const data = JSON.parse(post.output_data || '{}');
      // Handle both old format (single result) and new format (3 options)
      if (data.options && Array.isArray(data.options)) {
        setOptions(data.options);
        setTaskId(post.id);
        if (data.options[0]) {
          setEditableImagePrompt(data.options[0].imagePrompt || data.imagePrompt || '');
        }
      } else {
        // Old format - convert to single option
        const imagePrompt = data.imagePrompt || '';
        setResult({ caption: data.captionData || data, imagePrompt, taskId: post.id });
        setTaskId(post.id);
        setEditableImagePrompt(imagePrompt);
      }
    } catch {}
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);
  const downloadJSON = () => {
    const dataToExport = options ? { platform, brief, options, usage: tokenUsage, generatedAt: new Date().toISOString() }
      : result ? { platform, brief, caption: result.caption, imagePrompt: result.imagePrompt, usage: tokenUsage, generatedAt: new Date().toISOString() }
      : null;
    if (!dataToExport) return;
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `social-post-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Determine which steps are completed
  const getStepStatus = (stepName: string): 'completed' | 'active' | 'pending' => {
    if (!progress) return 'pending';
    const stepOrder = ['draft', 'image-prompt', 'done'];
    const currentIdx = stepOrder.indexOf(progress.step);
    const targetIdx = stepOrder.indexOf(stepName);
    if (currentIdx > targetIdx) return 'completed';
    if (currentIdx === targetIdx) return 'active';
    return 'pending';
  };

  const selectedOption = selectedIndex !== null && options ? options[selectedIndex] : null;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div><h1 className="text-2xl font-bold text-white">📱 Social Media Post</h1><p className="text-gray-400 mt-1">Generate 3 style options, compare, and pick your favorite</p></div>

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
                  <option>Instagram</option><option>TikTok</option><option>LinkedIn</option><option>Twitter/X</option><option>Facebook</option>
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
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Goal</label>
                <select value={goal} onChange={e => setGoal(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500">
                  <option>Awareness</option><option>Engagement</option><option>Lead Generation</option><option>Education</option><option>Event Promotion</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Brief</label>
              <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={3}
                className="w-full px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
                placeholder="Describe what you want to post about..." required />
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={loading || !brief}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                {loading ? '⏳ Generating 3 options...' : '🚀 Generate 3 Options'}
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
              <h3 className="text-lg font-semibold text-white">🤖 Generating 3 Style Options...</h3>

              {/* Progress bar */}
              <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${progress.progress}%` }}
                />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2s_infinite]"
                  style={{ animation: 'shimmer 2s infinite' }} />
              </div>

              {/* Percentage + message */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-300">{progress.message}</p>
                <span className="text-sm font-mono text-blue-400">{progress.progress}%</span>
              </div>

              {/* Step indicators */}
              <div className="space-y-2 pt-2">
                {['draft', 'image-prompt'].map((stepName) => {
                  const status = getStepStatus(stepName);
                  return (
                    <div key={stepName} className={`flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors ${
                      status === 'active' ? 'bg-blue-500/10' : status === 'completed' ? 'bg-green-500/5' : ''
                    }`}>
                      <span className={`text-sm ${
                        status === 'completed' ? 'text-green-400' : status === 'active' ? 'text-blue-400' : 'text-gray-600'
                      }`}>
                        {status === 'completed' ? '✅' : status === 'active' ? `${STEP_ICONS[stepName]}` : '⬚'}
                      </span>
                      <span className={`text-sm ${
                        status === 'completed' ? 'text-green-400' : status === 'active' ? 'text-white font-medium' : 'text-gray-600'
                      }`}>
                        {STEP_LABELS[stepName]}
                      </span>
                      {status === 'active' && (
                        <span className="ml-auto text-xs text-blue-400 animate-pulse">running...</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Elapsed time */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-700/50">
                <span className="text-xs text-gray-500">⏱️ Elapsed: {progress.elapsed}s</span>
                {progress.elapsed > 30 && (
                  <span className="text-xs text-yellow-500/70">— generating 3 options in parallel</span>
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
                    bold: { border: 'border-orange-500/40', bg: 'from-orange-600/10 to-red-600/10', accent: 'text-orange-400' },
                    professional: { border: 'border-blue-500/40', bg: 'from-blue-600/10 to-indigo-600/10', accent: 'text-blue-400' },
                    creative: { border: 'border-purple-500/40', bg: 'from-purple-600/10 to-pink-600/10', accent: 'text-purple-400' },
                  };
                  const colors = styleColors[opt.style] || styleColors.bold;

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

                        {/* Hook */}
                        {opt.hook && (
                          <p className="text-white font-semibold text-sm mb-2 leading-snug">"{opt.hook}"</p>
                        )}

                        {/* Caption preview */}
                        <p className="text-gray-300 text-xs leading-relaxed mb-3" style={{
                          display: isSelected ? 'block' : '-webkit-box',
                          WebkitLineClamp: isSelected ? undefined : 4,
                          WebkitBoxOrient: 'vertical',
                          overflow: isSelected ? 'visible' : 'hidden',
                        }}>
                          {opt.caption}
                        </p>

                        {/* Hashtags */}
                        {opt.hashtags && opt.hashtags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-3">
                            {(isSelected ? opt.hashtags : opt.hashtags.slice(0, 3)).map((tag: string, i: number) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-gray-700/50 text-blue-300 rounded">
                                {tag.startsWith('#') ? tag : `#${tag}`}
                              </span>
                            ))}
                            {!isSelected && opt.hashtags.length > 3 && (
                              <span className="text-[10px] text-gray-500">+{opt.hashtags.length - 3}</span>
                            )}
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
                            {/* Full caption */}
                            <div className="bg-white rounded-xl p-5 max-w-md mx-auto">
                              {opt.hook && <p className="text-gray-900 font-semibold text-base mb-3">{opt.hook}</p>}
                              <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{opt.caption}</p>
                              {opt.hashtags && opt.hashtags.length > 0 && (
                                <p className="text-blue-600 text-sm mt-3">{opt.hashtags.join(' ')}</p>
                              )}
                            </div>

                            {/* Copy button */}
                            <div className="flex gap-2">
                              <button onClick={() => copyToClipboard(opt.caption)}
                                className="text-xs px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg">
                                📋 Copy Caption
                              </button>
                              <button onClick={() => copyToClipboard(opt.hook + '\n\n' + opt.caption + '\n\n' + opt.hashtags.join(' '))}
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

          {/* Legacy single result (for viewing old posts) */}
          {result && result.caption && !options && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-purple-600/10 to-blue-600/10 rounded-xl p-6 border border-purple-500/20">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">📝 Caption</h3>
                  <button onClick={() => copyToClipboard(result.caption?.caption || '')}
                    className="text-xs px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg">📋 Copy</button>
                </div>
                <div className="bg-white rounded-xl p-5 max-w-md mx-auto">
                  {result.caption?.hook && <p className="text-gray-900 font-semibold text-base mb-3">{result.caption.hook}</p>}
                  <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{result.caption?.caption}</p>
                  {result.caption?.hashtags?.length > 0 && <p className="text-blue-600 text-sm mt-3">{result.caption.hashtags.join(' ')}</p>}
                </div>
              </div>
            </div>
          )}

          {/* Image Prompt + Generate (shown when options exist or result exists) */}
          {(options || result) && (
            <div className="bg-gradient-to-br from-indigo-600/10 to-purple-600/10 rounded-xl border border-indigo-500/20 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 bg-gray-800/40 border-b border-indigo-500/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-xl">🎨</div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Image Prompt</h3>
                    <p className="text-xs text-gray-400">Edit prompt sesuai kebutuhan sebelum generate gambar</p>
                  </div>
                </div>
                <button onClick={() => copyToClipboard(editableImagePrompt)}
                  className="text-xs px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg">📋 Copy</button>
              </div>

              {/* Editor */}
              <div className="p-6 space-y-4">
                <div className="relative">
                  <textarea
                    value={editableImagePrompt}
                    onChange={(e) => setEditableImagePrompt(e.target.value)}
                    style={{ minHeight: '120px', height: 'auto', overflow: 'hidden' }}
                    className="w-full bg-gray-900/60 text-gray-200 text-sm leading-relaxed font-mono resize-y focus:outline-none focus:ring-2 focus:ring-purple-500/50 rounded-xl p-4 border border-gray-700/50 placeholder-gray-600"
                    placeholder="Deskripsikan gambar yang ingin di-generate..."
                    ref={(el) => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = Math.max(120, Math.min(el.scrollHeight, 600)) + 'px';
                      }
                    }}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = Math.max(120, Math.min(el.scrollHeight, 600)) + 'px';
                    }}
                  />
                  <div className="absolute bottom-3 right-3 text-xs text-gray-600">
                    {editableImagePrompt.length} chars
                  </div>
                </div>

                {/* Quick suggestions */}
                {editableImagePrompt && (
                  <div className="flex flex-wrap gap-2">
                    {['professional', 'minimalist', 'vibrant colors', 'dark theme', 'with text overlay', '1080x1350'].map(tag => (
                      <button key={tag} onClick={() => setEditableImagePrompt(prev => prev + ', ' + tag)}
                        className="px-2.5 py-1 bg-gray-800/60 hover:bg-gray-700/60 text-gray-400 text-xs rounded-full border border-gray-700/40 transition-colors">
                        + {tag}
                      </button>
                    ))}
                  </div>
                )}

                {/* Generate button */}
                <div className="flex items-center gap-3">
                  <button onClick={generateImage} disabled={generatingImage || !editableImagePrompt.trim()}
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all shadow-lg shadow-purple-500/10">
                    {generatingImage ? '⏳ Generating...' : '🎨 Generate Image with AI'}
                  </button>
                </div>

                {/* Image Generation Progress */}
                {imageProgress && generatingImage && (
                  <div className="mt-4 space-y-3">
                    <div className="relative h-2.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${imageProgress.progress}%` }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                        style={{ animation: 'shimmer 2s infinite' }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-300">{imageProgress.message}</p>
                      <span className="text-xs font-mono text-purple-400">{imageProgress.progress}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">⏱️ {imageProgress.elapsed}s</span>
                      {imageProgress.elapsed > 30 && (
                        <span className="text-xs text-yellow-500/70">— may take up to 120s</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Generated Image */}
          {generatedImage && (
            <div className="bg-gradient-to-br from-green-600/10 to-emerald-600/10 rounded-xl p-6 border border-green-500/20">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">🖼️ Generated Image</h3>
                <a href={generatedImage} download className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">⬇️ Download</a>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2 flex items-center justify-center">
                <img src={generatedImage} alt="Generated" className="max-w-full max-h-[500px] rounded-lg" />
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
                      <p className="text-gray-400">
                        Caption (3 options): <span className="text-white">{(tokenUsage.caption?.inputTokens || 0) + (tokenUsage.caption?.outputTokens || 0)}</span> tokens · <span className="text-green-400">${((tokenUsage.caption?.cost || 0) + (tokenUsage.imagePrompt?.cost || 0)).toFixed(6)}</span>
                      </p>
                      {tokenUsage.imagePrompt && (
                        <p className="text-gray-400">
                          Image Prompt: <span className="text-white">{(tokenUsage.imagePrompt?.inputTokens || 0) + (tokenUsage.imagePrompt?.outputTokens || 0)}</span> tokens
                        </p>
                      )}
                      <div className="pt-2 mt-2 border-t border-gray-700/50 flex items-center gap-3">
                        <span className="text-gray-300 font-medium">
                          Total: <span className="text-white">{((tokenUsage.caption?.inputTokens || 0) + (tokenUsage.caption?.outputTokens || 0) + (tokenUsage.imagePrompt?.inputTokens || 0) + (tokenUsage.imagePrompt?.outputTokens || 0)).toLocaleString()}</span> tokens
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          ((tokenUsage.caption?.cost || 0) + (tokenUsage.imagePrompt?.cost || 0)) < 0.001
                            ? 'bg-green-500/15 text-green-400'
                            : ((tokenUsage.caption?.cost || 0) + (tokenUsage.imagePrompt?.cost || 0)) < 0.01
                            ? 'bg-yellow-500/15 text-yellow-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}>
                          ${((tokenUsage.caption?.cost || 0) + (tokenUsage.imagePrompt?.cost || 0)).toFixed(6)}
                        </span>
                      </div>
                      {tokenUsage.caption?.model && (
                        <p className="text-xs text-gray-500 pt-1">
                          Model: <span className="text-blue-400">{tokenUsage.caption.model}</span>
                          {tokenUsage.caption.model.includes('codex') && (
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

        {/* Right: Recent Posts */}
        <div className="lg:col-span-1">
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden sticky top-8">
            <div className="p-4 border-b border-gray-700/50">
              <h3 className="text-lg font-semibold text-white">📋 Recent Posts</h3>
              <p className="text-xs text-gray-500 mt-1">Click to view previous generations</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {recentPosts.length > 0 ? recentPosts.map((post: any) => (
                <div key={post.id}
                  onClick={() => viewPost(post)}
                  className={`p-3 border-b border-gray-800/50 cursor-pointer hover:bg-gray-700/30 transition-colors ${viewingPost?.id === post.id ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''}`}>
                  <p className="text-sm text-gray-300 truncate">{post.title}</p>
                  <p className="text-xs text-gray-600 mt-1">{new Date(post.created_at).toLocaleDateString()}</p>
                </div>
              )) : <p className="text-gray-500 p-4 text-center text-sm">No posts yet</p>}
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
