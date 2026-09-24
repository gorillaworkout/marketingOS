'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Button,
  EmptyState,
  FormField,
  Panel,
  PageHeader,
  PageStack,
  SectionHeader,
  Select,
  StatusBadge,
  TextArea,
  Toolbar,
} from '@/components/ui/dashboard';
import InlineModelSelector from '@/components/InlineModelSelector';
import { AI_RESEARCH_HANDOFF_QUERY, AI_RESEARCH_HANDOFF_VALUE, readAiResearchHandoff } from '@/lib/ai-research-handoff';
import type { QCResult } from '@/lib/openai';
import { readStoredVideoScriptQc } from '@/lib/video-script-qc';
import {
  readStoredVideoScriptResearch,
  type VideoScriptCitation,
  type VideoScriptWebResearch,
} from '@/lib/video-script-research';

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
  webResearch?: VideoScriptWebResearch;
  qcResults?: QCResult[];
}

interface PreviewOption {
  style: string;
  styleLabel: string;
  hook: string;
  hookOptions: string[];
  context: string;
  highlight: string;
  brandTieIn: string;
  cta: string;
  citations?: VideoScriptCitation[];
}

interface ScriptOption extends PreviewOption {
  fullScript: string;
}

const STEP_LABELS: Record<string, string> = {
  research: 'Web research',
  preview: 'Generating 3 preview options',
  full: 'Generating full script',
  qc: 'Script quality check',
  done: 'Complete',
  error: 'Error',
};

const STEP_ICONS: Record<string, string> = {
  research: '01',
  preview: '02',
  full: '02',
  qc: '03',
  done: '04',
  error: '!',
};

const STYLE_COLORS: Record<string, { border: string; accent: string }> = {
  'high-energy': { border: 'border-orange-500/40', accent: 'text-orange-400' },
  professional: { border: 'border-blue-500/40', accent: 'text-blue-400' },
  cinematic: { border: 'border-purple-500/40', accent: 'text-purple-400' },
};

function safeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function VideoScriptCitations({ citations, detailed = false }: { citations?: VideoScriptCitation[]; detailed?: boolean }) {
  const safe = (Array.isArray(citations) ? citations : []).flatMap((citation) => {
    const href = safeHttpUrl(citation?.url || '');
    if (!href) return [];
    return [{ ...citation, url: href }];
  });
  if (!safe.length) return null;
  return (
    <div data-testid="video-script-citations" className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--mos-text-faint)]">Sources</p>
      {safe.map((citation) => (
        <div key={citation.url}>
          <a
            href={citation.url}
            target="_blank"
            rel="noreferrer"
            onClick={(click) => click.stopPropagation()}
            className="block truncate text-[11px] text-blue-300 hover:underline"
          >
            {citation.title || citation.url}
          </a>
          {detailed && citation.snippet && (
            <p className="mt-1 text-[11px] leading-5 text-[var(--mos-text-muted)]">{citation.snippet}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function VideoScriptWebSources({ research }: { research: VideoScriptWebResearch }) {
  return (
    <Panel>
      <SectionHeader
        className="mb-4"
        title="Web sources"
        description={
          research.status === 'grounded'
            ? 'Open-web pages and reference links used to ground this script.'
            : research.status === 'skipped'
              ? 'Live web grounding did not run for this script.'
              : 'Open-web search ran and did not return a usable page.'
        }
      />
      {research.status === 'skipped' && (
        <div role="status" data-testid="video-script-web-skipped" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
          {research.skippedReason || 'Web grounding was skipped. The script uses brand knowledge only.'}
        </div>
      )}
      {research.status === 'empty' && (
        <div role="status" data-testid="video-script-web-empty" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
          {research.warnings[0] || 'Open-web search returned no usable sources. The script uses brand knowledge only.'}
        </div>
      )}
      {research.status !== 'skipped' && research.queries.length > 0 && (
        <p className="mt-3 text-xs text-[var(--mos-text-muted)]">Searches: {research.queries.join(' · ')}</p>
      )}
      {research.warnings.length > 0 && (
        <p className="mt-2 text-xs text-[var(--mos-text-muted)]">{research.warnings.join(' ')}</p>
      )}
      {research.sources.length > 0 && (
        <div data-testid="video-script-web-sources" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {research.sources.map((source) => (
            <div key={source.url} className="rounded-lg border border-[var(--mos-border)] bg-[var(--mos-surface)] p-3">
              <a href={source.url} target="_blank" rel="noreferrer" className="block text-sm font-medium text-blue-300 hover:underline">
                {source.title}
              </a>
              <p className="mt-1 truncate text-[11px] text-[var(--mos-text-faint)]">{source.url}</p>
              {source.snippet && (
                <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--mos-text-secondary)]">{source.snippet}</p>
              )}
              <p className="mt-2 text-[10px] uppercase tracking-wide text-[var(--mos-text-faint)]">
                {source.kind === 'reference' ? 'Reference link' : 'Open web'} · {source.read ? 'Page read' : 'Search snippet'}
              </p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function VideoScriptQcPanel({ result }: { result?: QCResult | null }) {
  if (!result) return null;
  return (
    <div data-testid="video-script-qc" className="bg-[var(--mos-surface)] rounded-lg p-4 border border-[var(--mos-border)]">
      <div className="flex items-center justify-between mb-2 gap-3">
        <h4 className="text-sm font-semibold text-white">Script quality check</h4>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          result.allPassed ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
        }`}>
          {result.score}% — {result.allPassed ? 'All passed' : 'Has warnings'}
        </span>
      </div>
      <p className="mb-2 text-[11px] leading-5 text-[var(--mos-text-muted)]">
        Warnings do not block the script. Creative voiceover is allowed when it does not state unsourced numbers, prices, or quotations.
      </p>
      <div className="space-y-1.5">
        {result.checks.map((check) => (
          <div key={check.name} className="flex items-start gap-2">
            <span className={`text-xs font-medium w-32 shrink-0 ${check.passed ? 'text-[var(--mos-text-secondary)]' : 'text-yellow-300'}`}>{check.label}</span>
            <span className={`text-xs ${check.passed ? 'text-[var(--mos-text-muted)]' : 'text-yellow-300/80'}`}>{check.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VideoScriptPage() {
  const [event, setEvent] = useState('');
  const [platform, setPlatform] = useState('Instagram Reels');
  const [duration, setDuration] = useState('30-45 seconds');
  const [targetAudience, setTargetAudience] = useState('');
  const [references, setReferences] = useState('');
  const [researchHandoff, setResearchHandoff] = useState(false);
  const [webResearch, setWebResearch] = useState<VideoScriptWebResearch | null>(null);
  const [qcResults, setQcResults] = useState<QCResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewOptions, setPreviewOptions] = useState<PreviewOption[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [step, setStep] = useState<'form' | 'preview' | 'edit' | 'full'>('form');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [tokenUsage, setTokenUsage] = useState<any>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const [knowledgeSaved, setKnowledgeSaved] = useState(false);
  const [ratingMessage, setRatingMessage] = useState('');
  const [recentScripts, setRecentScripts] = useState<any[]>([]);
  const [viewingScript, setViewingScript] = useState<any>(null);

  // Editable prompt for full generation
  const [editedPrompt, setEditedPrompt] = useState('');

  // Streaming progress state
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const template = params.get('template');
    if (template) setEvent(template);
    if (params.get(AI_RESEARCH_HANDOFF_QUERY) !== AI_RESEARCH_HANDOFF_VALUE) return;
    const handoff = readAiResearchHandoff('video-script');
    if (!handoff?.brief) return;
    // Prefill only. Do not call handleGeneratePreview.
    setEvent(handoff.brief);
    if (handoff.references) setReferences(handoff.references);
    setResearchHandoff(true);
  }, []);

  const fetchScripts = async () => {
    try {
      const res = await fetch('/api/dashboard/history?type=video-script');
      const data = await res.json();
      if (data.tasks) setRecentScripts(data.tasks);
    } catch {}
  };

  const applyStreamMeta = (payload: { webResearch?: unknown; qcResults?: unknown }) => {
    if (payload.webResearch) {
      const research = readStoredVideoScriptResearch(payload.webResearch);
      if (research) setWebResearch(research);
    }
    if (payload.qcResults) setQcResults(readStoredVideoScriptQc(payload.qcResults));
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

  /**
   * Step 1: Generate 3 preview options
   */
  const handleGeneratePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;
    setLoading(true);
    setError('');
    setPreviewOptions(null);
    setResult(null);
    setTokenUsage(null);
    setViewingScript(null);
    setSelectedIndex(null);
    setStep('preview');
    setKnowledgeSaved(false);
    setTaskId(null);
    setWebResearch(null);
    setQcResults([]);
    setProgress({ step: 'research', progress: 0, message: 'Starting web research...', elapsed: 0 });

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const startTime = startElapsedTimer();

    try {
      const res = await fetch('/api/video-script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', event, platform, duration, targetAudience, references }),
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

            applyStreamMeta(event);

            if (event.step === 'error') {
              setError(event.message);
              setProgress(null);
              stopElapsedTimer();
              setLoading(false);
              setStep('form');
              return;
            }

            if (event.step === 'done' && event.result) {
              const r = event.result as any;
              applyStreamMeta(r);
              if (r.success) {
                setPreviewOptions(r.options || []);
                setTokenUsage(r.usage);
                setStep('preview');
              }
              setProgress({ step: 'done', progress: 100, message: 'Preview complete!', elapsed });
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
      setStep('form');
    }
    setLoading(false);
  };

  /**
   * When user selects a preview option, move to edit step
   */
  const handleSelectPreview = (index: number) => {
    if (!previewOptions) return;
    setSelectedIndex(index);
    setStep('edit');

    const selected = previewOptions[index];
    // Build the editable prompt from the brief + selected option
    setEditedPrompt(
      `Brief: ${event}\n\n` +
      `Platform: ${platform}\nDuration: ${duration}\nTarget Audience: ${targetAudience || 'General'}\n\n` +
      `Selected Style: ${selected.styleLabel}\n` +
      `Hook: ${selected.hook}\n` +
      `Context: ${selected.context}\n` +
      `Highlight: ${selected.highlight}\n` +
      `Brand Tie-In: ${selected.brandTieIn}\n` +
      `CTA: ${selected.cta}\n\n` +
      `--- Additional instructions ---\n`
    );
  };

  /**
   * Step 2: Generate full script from selected preview + edited prompt
   */
  const handleGenerateFull = async () => {
    if (!previewOptions || selectedIndex === null) return;
    setLoading(true);
    setError('');
    setResult(null);
    setStep('full');
    setWebResearch(null);
    setQcResults([]);
    setProgress({ step: 'research', progress: 0, message: 'Starting web research...', elapsed: 0 });

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const startTime = startElapsedTimer();

    const selected = previewOptions[selectedIndex];

    try {
      const res = await fetch('/api/video-script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'full',
          event,
          platform,
          duration,
          targetAudience,
          references,
          selectedOption: selected,
          editedPrompt,
          style: selected.style,
        }),
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

            applyStreamMeta(event);

            if (event.step === 'error') {
              setError(event.message);
              setProgress(null);
              stopElapsedTimer();
              setLoading(false);
              return;
            }

            if (event.step === 'done' && event.result) {
              const r = event.result as any;
              applyStreamMeta(r);
              if (r.success) {
                setResult(r);
                setTaskId(r.taskId);
                setTokenUsage(r.usage);
                fetchScripts();
              }
              setProgress({ step: 'done', progress: 100, message: 'Full script complete!', elapsed });
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

  const handleSaveKnowledge = async () => {
    if (!result || !previewOptions || selectedIndex === null || savingKnowledge) return;
    setSavingKnowledge(true);
    setKnowledgeSaved(false);

    const selected = previewOptions[selectedIndex];
    const rejected = previewOptions.filter((_, i) => i !== selectedIndex);

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
        setRatingMessage(msgs[rating] || 'Rated');
        setTimeout(() => setRatingMessage(''), 3000);
      }
    } catch {}
  };

  const viewScript = (script: any) => {
    setViewingScript(script);
    setPreviewOptions(null);
    setResult(null);
    setSelectedIndex(null);
    setKnowledgeSaved(false);
    setError('');
    try {
      const raw = typeof script.output_data === 'string'
        ? JSON.parse(script.output_data || '{}')
        : (script.output_data || {});

      // Saved scripts hold the three generated directions under `options`.
      // Restore them into the same preview UI a fresh generation uses, and put
      // the wizard on a step that actually renders results -- setStep('form')
      // used to hide everything that had just been loaded.
      if (Array.isArray(raw.options) && raw.options.length > 0) {
        const hasFinal = raw.options.some((o: any) => o && o.fullScript);
        setResult({ ...raw, taskId: script.id });
        if (hasFinal) {
          // Saved scripts are finished scripts: the full view reads
          // result.options[0], so land on 'full' rather than a preview grid
          // that would offer a single card leading nowhere.
          setStep('full');
        } else {
          setPreviewOptions(raw.options);
          setSelectedIndex(raw.selectedIndex ?? 0);
          setStep('preview');
        }
      } else if (Object.keys(raw).length > 0) {
        setResult({ ...raw, taskId: script.id });
        setStep('full');
      } else {
        setStep('form');
      }
      setTaskId(script.id);

      // Replay the original brief so the form is not blank when reopened.
      if (typeof raw.event === 'string' && raw.event) setEvent(raw.event);
      else if (typeof script.brief === 'string' && script.brief) setEvent(script.brief);
      if (typeof raw.platform === 'string' && raw.platform) setPlatform(raw.platform);
      if (typeof raw.duration === 'string' && raw.duration) setDuration(raw.duration);
      if (typeof raw.targetAudience === 'string' && raw.targetAudience) setTargetAudience(raw.targetAudience);
      if (typeof raw.references === 'string') setReferences(raw.references);
      setWebResearch(readStoredVideoScriptResearch(raw.webResearch));
      setQcResults(readStoredVideoScriptQc(raw.qcResults));
    } catch {
      setStep('form');
    }
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  const downloadJSON = () => {
    const dataToExport = result
      ? { platform, event, duration, targetAudience, references, options: result.options || [result.script], usage: tokenUsage, generatedAt: new Date().toISOString(), webResearch, qcResults }
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

  const progressSteps = step === 'full' ? ['research', 'full', 'qc'] : ['research', 'preview', 'qc'];

  const getStepStatus = (stepName: string): 'completed' | 'active' | 'pending' => {
    if (!progress) return 'pending';
    const stepOrder = [...progressSteps, 'done'];
    const currentIdx = stepOrder.indexOf(progress.step);
    const targetIdx = stepOrder.indexOf(stepName);
    if (currentIdx > targetIdx) return 'completed';
    if (currentIdx === targetIdx) return 'active';
    return 'pending';
  };

  const selectedPreview = selectedIndex !== null && previewOptions ? previewOptions[selectedIndex] : null;
  const fullScriptOption = result?.options?.[0] || result?.script || null;

  const handleBackToPreview = () => {
    setStep('preview');
    setSelectedIndex(null);
    setResult(null);
    setEditedPrompt('');
  };

  const handleStartOver = () => {
    setStep('form');
    setPreviewOptions(null);
    setResult(null);
    setSelectedIndex(null);
    setError('');
    setTokenUsage(null);
    setTaskId(null);
    setKnowledgeSaved(false);
    setRatingMessage('');
    setEditedPrompt('');
    setWebResearch(null);
    setQcResults([]);
    setResearchHandoff(false);
  };

  return (
    <PageStack className="max-w-6xl">
      <PageHeader eyebrow="Create / Video" title="Video script" description="Compare three directions, refine the selected concept, then generate the full script." />
      <InlineModelSelector feature="video-script" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form + Result */}
        <div className="lg:col-span-2 space-y-6">
          {/* Step Tracker */}
          {step !== 'form' && (
            <Toolbar>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex items-center gap-1.5 ${step === 'preview' || step === 'edit' || step === 'full' ? 'text-green-400' : 'text-gray-600'}`}>
                    <span className="text-xs">01</span>
                    <span className="text-xs font-medium">Preview</span>
                  </div>
                  <span className="text-gray-600">—</span>
                  <div className={`flex items-center gap-1.5 ${step === 'edit' || step === 'full' ? 'text-green-400' : 'text-gray-600'}`}>
                    <span className="text-xs">02</span>
                    <span className="text-xs font-medium">Edit</span>
                  </div>
                  <span className="text-gray-600">—</span>
                  <div className={`flex items-center gap-1.5 ${step === 'full' && result ? 'text-green-400' : 'text-gray-600'}`}>
                    <span className="text-xs">03</span>
                    <span className="text-xs font-medium">Generate</span>
                  </div>
                </div>
                <Button size="sm" onClick={handleStartOver}>Start over</Button>
              </div>
            </Toolbar>
          )}

          {/* Step 1: Input Form */}
          {step === 'form' && (
            <Panel>
            <form onSubmit={handleGeneratePreview} className="space-y-5">
              <SectionHeader title="Video brief" description="Set the format and audience before comparing creative directions." />
              {researchHandoff && (
                <p role="status" data-testid="video-script-research-handoff" className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs leading-5 text-indigo-100">
                  Filled from Dupoin AI Research. Not published yet — edit this brief before you generate.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField label="Platform">
                  <Select value={platform} onChange={e => setPlatform(e.target.value)}>
                    <option>Instagram Reels</option><option>TikTok</option><option>YouTube Shorts</option><option>YouTube</option>
                  </Select>
                </FormField>
                <FormField label="Duration">
                  <Select value={duration} onChange={e => setDuration(e.target.value)}>
                    <option>15-30 seconds</option><option>30-45 seconds</option><option>45-60 seconds</option><option>1-3 minutes</option>
                  </Select>
                </FormField>
                <FormField label="Target audience">
                  <Select value={targetAudience} onChange={e => setTargetAudience(e.target.value)}>
                    <option value="">Choose an audience...</option>
                    <option value="Beginner trader">Beginner trader</option>
                    <option value="Active trader">Active trader</option>
                    <option value="Professional trader">Professional trader</option>
                    <option value="Investor">Investor</option>
                    <option value="Finance enthusiast">Finance enthusiast</option>
                    <option value="Students">Students</option>
                    <option value="Business owner">Business owner</option>
                    <option value="Young professional">Young professional</option>
                    <option value="General Public">General Public</option>
                  </Select>
                </FormField>
              </div>
              <FormField label="Event / topic" required>
                <TextArea value={event} onChange={e => setEvent(e.target.value)} rows={3}
                  placeholder="Describe the event or topic for the video..." required />
              </FormField>
              <FormField label="Reference links" hint="Optional. Public URLs are read with Jina. Generation also searches the open web for the topic, format, and competitors.">
                <TextArea value={references} onChange={e => setReferences(e.target.value)} rows={2}
                  placeholder="https://example.com/article" />
              </FormField>
              <div className="flex items-center gap-3">
                <Button type="submit" variant="primary" disabled={loading || !event}>
                  {loading ? 'Generating three previews…' : 'Generate three preview options'}
                </Button>
              </div>
            </form>
            </Panel>
          )}

          {/* Streaming Progress Indicator */}
          {progress && loading && (
            <Panel className="space-y-4">
              <SectionHeader title={step === 'full' ? 'Generating full script' : 'Generating preview options'} description={progress.message} action={<StatusBadge tone="info" dot>{progress.progress}%</StatusBadge>} />

              <div className="relative h-3 bg-[var(--mos-raised)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--mos-accent)] transition-all duration-700 ease-out"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-[var(--mos-text-secondary)]">{progress.message}</p>
                <span className="text-sm font-mono text-green-400">{progress.progress}%</span>
              </div>

              <div className="space-y-2 pt-2">
                {progressSteps.map((stepName) => {
                  const status = getStepStatus(stepName);
                  return (
                    <div key={stepName} className={`flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors ${
                      status === 'active' ? 'bg-green-500/10' : status === 'completed' ? 'bg-green-500/5' : ''
                    }`}>
                      <span className={`text-sm ${
                        status === 'completed' ? 'text-green-400' : status === 'active' ? 'text-green-400' : 'text-gray-600'
                      }`}>
                        {status === 'completed' ? '●' : status === 'active' ? `${STEP_ICONS[stepName]}` : '○'}
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

              <div className="flex items-center gap-2 pt-2 border-t border-[var(--mos-border)]">
                <span className="text-xs text-[var(--mos-text-faint)]">Elapsed: {progress.elapsed}s</span>
                {progress.elapsed > 30 && (
                  <span className="text-xs text-yellow-500/70">— {step === 'full' ? 'generating full script' : 'generating 3 previews in parallel'}</span>
                )}
              </div>
            </Panel>
          )}

          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg">{error}</div>}

          {webResearch && !loading && <VideoScriptWebSources research={webResearch} />}

          {/* Step 2 Preview: 3 Option Cards */}
          {previewOptions && previewOptions.length > 0 && step !== 'form' && !loading && step !== 'full' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader title="Select a preferred style" description="Choose one direction to refine into the full script." />
                {step === 'edit' && selectedIndex !== null && (
                  <button onClick={handleBackToPreview}
                    className="text-xs px-3 py-1.5 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-secondary)] rounded-lg transition-colors">
                    ← Back to options
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {previewOptions.map((opt, index) => {
                  const isSelected = selectedIndex === index;
                  const colors = STYLE_COLORS[opt.style] || STYLE_COLORS['high-energy'];

                  // If we're in edit mode for a different option, show this as disabled
                  const isDisabled = step === 'edit' && selectedIndex !== null && !isSelected;

                  return (
                    <Panel
                      padding="none"
                      key={index}
                      className={`transition-all ${
                        isDisabled
                          ? 'opacity-40 cursor-default border-[var(--mos-border)]'
                          : isSelected
                          ? 'border-[var(--mos-accent-border)] ring-2 ring-[var(--mos-accent-ring)] cursor-pointer'
                          : 'border-[var(--mos-border)] hover:border-[var(--mos-border)] cursor-pointer'
                      }`}
                      onClick={() => !isDisabled && !isSelected && handleSelectPreview(index)}
                    >
                      <div className="p-5">
                        {/* Style Label */}
                        <div className="flex items-center justify-between mb-3">
                          <span className={`text-sm font-bold ${colors.accent}`}>{opt.styleLabel}</span>
                          {isSelected && <StatusBadge tone="success" dot>Selected</StatusBadge>}
                        </div>

                        {/* Hook preview */}
                        {opt.hook && (
                          <p className="text-white font-semibold text-sm mb-2 leading-snug">"{opt.hook}"</p>
                        )}

                        {/* Context */}
                        {opt.context && (
                          <p className="text-[var(--mos-text-muted)] text-xs leading-relaxed mb-3 line-clamp-3">{opt.context}</p>
                        )}

                        {/* Tags */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {opt.hook && <span className="text-[10px] px-1.5 py-0.5 bg-[var(--mos-raised)] text-green-300 rounded">Hook</span>}
                          {opt.context && <span className="text-[10px] px-1.5 py-0.5 bg-[var(--mos-raised)] text-blue-300 rounded">Context</span>}
                          {opt.highlight && <span className="text-[10px] px-1.5 py-0.5 bg-[var(--mos-raised)] text-purple-300 rounded">Highlight</span>}
                          {opt.brandTieIn && <span className="text-[10px] px-1.5 py-0.5 bg-[var(--mos-raised)] text-green-300 rounded">Brand</span>}
                          {opt.cta && <span className="text-[10px] px-1.5 py-0.5 bg-[var(--mos-raised)] text-yellow-300 rounded">CTA</span>}
                          {qcResults[index] && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${qcResults[index].allPassed ? 'bg-green-500/15 text-green-300' : 'bg-yellow-500/15 text-yellow-300'}`}>
                              QC {qcResults[index].score}%
                            </span>
                          )}
                        </div>
                        <VideoScriptCitations citations={opt.citations} />

                        {/* Select button */}
                        {!isSelected && !isDisabled && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSelectPreview(index); }}
                            className="w-full mt-2 px-4 py-2 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-white text-sm font-medium rounded-lg transition-colors border border-[var(--mos-border)]"
                          >
                            Choose & edit
                          </button>
                        )}

                        {isDisabled && (
                          <div className="w-full mt-2 px-4 py-2 bg-[var(--mos-raised)] text-[var(--mos-text-faint)] text-sm font-medium rounded-lg border border-[var(--mos-border)] text-center">
                            🔒 Already selected
                          </div>
                        )}

                        {/* Expanded preview details when selected */}
                        {isSelected && (
                          <div className="mt-4 space-y-3 pt-4 border-t border-[var(--mos-border)]">
                            {opt.highlight && (
                              <div>
                                <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Highlight</label>
                                <p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-2.5 rounded-lg text-sm">{opt.highlight}</p>
                              </div>
                            )}
                            {opt.brandTieIn && (
                              <div>
                                <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Brand Tie-In</label>
                                <p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-2.5 rounded-lg text-sm">{opt.brandTieIn}</p>
                              </div>
                            )}
                            {opt.cta && (
                              <div>
                                <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">CTA</label>
                                <p className="text-blue-400 mt-1 bg-[var(--mos-raised)] p-2.5 rounded-lg text-sm">{opt.cta}</p>
                              </div>
                            )}
                            <VideoScriptQcPanel result={qcResults[index]} />
                          </div>
                        )}
                      </div>
                    </Panel>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2.5: Editable Prompt + Generate Full Button */}
          {step === 'edit' && selectedPreview && !loading && (
            <Panel className="space-y-4">
              <SectionHeader title="Refine the full-script prompt" description="Customize the pre-filled direction before generating the complete script." />

              <div className="bg-[var(--mos-raised)] rounded-lg p-3 border border-[var(--mos-border)]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-[var(--mos-text-muted)]">Selected Style:</span>
                  <StatusBadge tone="info">{selectedPreview.styleLabel}</StatusBadge>
                </div>
                <p className="text-xs text-[var(--mos-text-faint)]">
                  Hook: <span className="text-[var(--mos-text-secondary)]">{selectedPreview.hook}</span>
                </p>
                <p className="text-xs text-[var(--mos-text-faint)] mt-1">
                  Context: <span className="text-[var(--mos-text-secondary)]">{selectedPreview.context}</span>
                </p>
              </div>

              <TextArea
                value={editedPrompt}
                onChange={e => setEditedPrompt(e.target.value)}
                rows={12}
                className="font-mono"
                placeholder="Edit the prompt for the full script generation..."
              />

              <div className="flex items-center gap-3">
                <Button
                  variant="primary"
                  onClick={handleGenerateFull}
                  disabled={loading || !editedPrompt}
                >
                  {loading ? 'Generating full script…' : 'Generate full script'}
                </Button>
                <Button onClick={handleBackToPreview}>Choose different style</Button>
              </div>
            </Panel>
          )}

          {/* Step 3: Full Script Result */}
          {fullScriptOption && step === 'full' && !loading && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader title="Generated script" description="Final script based on the selected and edited direction." />
                <div className="flex gap-2">
                  <button onClick={handleStartOver}
                    className="text-xs px-3 py-1.5 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-secondary)] rounded-lg transition-colors">
                      Generate new
                  </button>
                </div>
              </div>

              <Panel padding="none">
                {/* Style header */}
                <div className="flex items-center justify-between border-b border-[var(--mos-border-subtle)] px-5 py-3">
                  <span className="text-sm font-bold text-green-400">
                    {fullScriptOption.styleLabel || 'Script'}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => copyToClipboard(fullScriptOption.fullScript || JSON.stringify(fullScriptOption))}
                      className="text-xs px-2.5 py-1 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-secondary)] rounded-lg transition-colors">
                      Copy
                    </button>
                    <button onClick={() => {
                      const sourceLines = (Array.isArray(fullScriptOption.citations) ? fullScriptOption.citations : [])
                        .map((citation: VideoScriptCitation) => `- ${citation.title} (${citation.url})`)
                        .join('\n');
                      copyToClipboard(
                        `Hook: ${fullScriptOption.hook}\n\nContext: ${fullScriptOption.context}\n\nHighlight: ${fullScriptOption.highlight}\n\nBrand Tie-In: ${fullScriptOption.brandTieIn}\n\nCTA: ${fullScriptOption.cta}\n\n---\n\nFull Script:\n${fullScriptOption.fullScript}${sourceLines ? `\n\nSources:\n${sourceLines}` : ''}`
                      );
                    }}
                      className="text-xs px-2.5 py-1 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-secondary)] rounded-lg transition-colors">
                      Copy all
                    </button>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {/* Hook */}
                  {fullScriptOption.hook && (
                    <div>
                      <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Hook</label>
                      <p className="text-white font-semibold mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">"{fullScriptOption.hook}"</p>
                    </div>
                  )}

                  {/* Context */}
                  {fullScriptOption.context && (
                    <div>
                      <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Context</label>
                      <p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{fullScriptOption.context}</p>
                    </div>
                  )}

                  {/* Highlight */}
                  {fullScriptOption.highlight && (
                    <div>
                      <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Highlight</label>
                      <p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{fullScriptOption.highlight}</p>
                    </div>
                  )}

                  {/* Brand Tie-In */}
                  {fullScriptOption.brandTieIn && (
                    <div>
                      <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Brand Tie-In</label>
                      <p className="text-[var(--mos-text-secondary)] mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{fullScriptOption.brandTieIn}</p>
                    </div>
                  )}

                  {/* CTA */}
                  {fullScriptOption.cta && (
                    <div>
                      <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">CTA</label>
                      <p className="text-blue-400 mt-1 bg-[var(--mos-raised)] p-3 rounded-lg">{fullScriptOption.cta}</p>
                    </div>
                  )}

                  {/* Full Script */}
                  {fullScriptOption.fullScript && (
                    <div>
                      <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Full Script</label>
                      <p className="text-white mt-1 bg-[var(--mos-raised)] p-4 rounded-lg whitespace-pre-wrap font-mono text-sm leading-relaxed">{fullScriptOption.fullScript}</p>
                    </div>
                  )}

                  <VideoScriptCitations citations={fullScriptOption.citations} detailed />
                  <VideoScriptQcPanel result={qcResults[0]} />
                </div>
              </Panel>

              {/* Knowledge saved notification */}
              {knowledgeSaved && (
                <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg flex items-center gap-2">
                  <span>Knowledge saved! Style profile updated. This helps future generations match your preferences.</span>
                </div>
              )}

              {/* Save Knowledge Button */}
              <div className="flex items-center gap-3">
                <Button variant="primary" onClick={handleSaveKnowledge} disabled={savingKnowledge || knowledgeSaved}>
                  {savingKnowledge ? 'Saving…' : knowledgeSaved ? 'Saved to Knowledge' : 'Save to Knowledge'}
                </Button>
              </div>
            </div>
          )}

          {/* Token Usage + Download + Rating */}
          {(result || (fullScriptOption && step === 'full')) && tokenUsage && (
            <Panel>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <h3 className="text-sm font-semibold text-white mb-2">Token usage</h3>
                  {tokenUsage && (
                    <div className="space-y-1 text-sm">
                      {tokenUsage.videoScript && (
                        <>
                          <p className="text-[var(--mos-text-muted)]">
                            Video Script: <span className="text-white">{(tokenUsage.videoScript?.inputTokens || 0) + (tokenUsage.videoScript?.outputTokens || 0)}</span> tokens · <span className="text-green-400">${(tokenUsage.videoScript?.cost || 0).toFixed(6)}</span>
                          </p>
                          <div className="pt-2 mt-2 border-t border-[var(--mos-border)] flex items-center gap-3">
                            <span className="text-[var(--mos-text-secondary)] font-medium">
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
                            <p className="text-xs text-[var(--mos-text-faint)] pt-1">
                              Model: <span className="text-blue-400">{tokenUsage.videoScript.model}</span>
                              <span className="ml-2 px-1.5 py-0.5 bg-indigo-500/15 text-indigo-300 rounded text-xs">GorillaWorkout LLM</span>
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--mos-text-faint)]">Rate this:</span>
                  <button onClick={() => rateResult(5)} className="px-2 py-1 text-lg hover:bg-[var(--mos-raised)] rounded transition-colors" title="Excellent">⭐</button>
                  <button onClick={() => rateResult(4)} className="px-2 py-1 text-lg hover:bg-[var(--mos-raised)] rounded transition-colors" title="Good">👍</button>
                  <button onClick={() => rateResult(3)} className="px-2 py-1 text-lg hover:bg-[var(--mos-raised)] rounded transition-colors" title="Okay">😐</button>
                  <button onClick={() => rateResult(1)} className="px-2 py-1 text-lg hover:bg-[var(--mos-raised)] rounded transition-colors" title="Bad">👎</button>
                  <div className="w-px h-6 bg-[var(--mos-raised)] mx-2"></div>
                  <Button onClick={downloadJSON}>Download JSON</Button>
                </div>
              </div>
              {ratingMessage && <p className="text-xs text-green-400 mt-2">{ratingMessage}</p>}
            </Panel>
          )}

          {/* Viewing script from history */}
          {viewingScript && !previewOptions && !result && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionHeader title="Historical script" description="Previously generated output." />
                <button onClick={() => setViewingScript(null)}
                  className="text-xs px-3 py-1.5 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-secondary)] rounded-lg">
                  ✕ Close
                </button>
              </div>
              <Panel>
                <p className="text-[var(--mos-text-faint)] text-sm">
                  This script was saved in an older format and cannot be shown in the
                  editor. The raw output is below.
                </p>
                <pre className="mt-3 max-h-80 overflow-auto text-xs text-[var(--mos-text-muted)] whitespace-pre-wrap">
{(() => {
  try {
    const raw = typeof viewingScript.output_data === 'string'
      ? JSON.parse(viewingScript.output_data)
      : viewingScript.output_data;
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(viewingScript.output_data ?? '');
  }
})()}
                </pre>
              </Panel>
            </div>
          )}
        </div>

        {/* Right: Recent Scripts */}
        <div className="lg:col-span-1">
          <Panel padding="none" className="sticky top-8">
            <div className="p-4 border-b border-[var(--mos-border)]">
              <h3 className="text-sm font-semibold text-white">Recent scripts</h3>
              <p className="text-xs text-[var(--mos-text-faint)] mt-1">Click to view previous generations</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {recentScripts.length > 0 ? recentScripts.map((script: any) => (
                <div key={script.id}
                  onClick={() => viewScript(script)}
                  className={`p-3 border-b border-[var(--mos-border)] cursor-pointer hover:bg-[var(--mos-raised)] transition-colors ${viewingScript?.id === script.id ? 'bg-green-600/10 border-l-2 border-l-green-500' : ''}`}>
                  <p className="text-sm text-[var(--mos-text-secondary)] truncate">{script.title}</p>
                  <p className="text-xs text-gray-600 mt-1">{new Date(script.created_at).toLocaleDateString()}</p>
                </div>
              )) : <EmptyState title="No scripts yet" description="Generated scripts will appear here." className="min-h-40" />}
            </div>
          </Panel>
        </div>
      </div>

      {/* Shimmer animation keyframes */}
      <style jsx global>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </PageStack>
  );
}
