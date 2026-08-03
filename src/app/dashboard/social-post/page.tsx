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

interface QCCheck {
  name: string;
  label: string;
  passed: boolean;
  detail: string;
}

interface QCResult {
  allPassed: boolean;
  checks: QCCheck[];
  score: number;
}

interface ResearchPost {
  brief: string;
  style: string;
  rating: number;
  caption: string;
}

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
  researchPosts?: ResearchPost[];
  qcResults?: QCResult[];
}

interface ImageJobResponse {
  jobId?: string;
  status?: string;
  progress?: number;
  message?: string;
  error?: string;
  result?: { success?: boolean; imageUrl?: string; fileName?: string; sopName?: string; model?: string };
}

async function readImageJobResponse(response: Response): Promise<ImageJobResponse> {
  try {
    return await response.json() as ImageJobResponse;
  } catch {
    return {};
  }
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
  research: 'Research past posts',
  draft: 'Generating options',
  qc: 'Quality check',
  'image-prompt': 'Image prompt',
  done: 'Complete',
  error: 'Error',
};

const STEP_ICONS: Record<string, string> = {
  research: '01',
  draft: '02',
  qc: '03',
  'image-prompt': '04',
  done: '05',
  error: '!',
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
  const [imageModel, setImageModel] = useState('gpt-5.6-terra');
  const [availableImageModels, setAvailableImageModels] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [imageProgress, setImageProgress] = useState<ImageProgressState | null>(null);
  const imageProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imagePollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageRunRef = useRef(0);
  const [ratingMessage, setRatingMessage] = useState('');
  const [recentPosts, setRecentPosts] = useState<any[]>([]);
  const [imageHistory, setImageHistory] = useState<any[]>([]);
  const [recentPostsError, setRecentPostsError] = useState('');
  const [viewingPost, setViewingPost] = useState<any>(null);

  // Selected option state
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const [knowledgeSaved, setKnowledgeSaved] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState('');

  // SOP state
  const [researchPosts, setResearchPosts] = useState<ResearchPost[]>([]);
  const [qcResults, setQcResults] = useState<QCResult[]>([]);
  const [dupoinFileName, setDupoinFileName] = useState('');
  const [postStatus, setPostStatus] = useState<string>('draft');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Streaming progress state
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const template = params.get('template');
    if (template) setBrief(template);
    
    // Fetch available image models
    fetch('/api/image-models')
      .then(res => res.json())
      .then(data => {
        if (data.models && Array.isArray(data.models)) {
          setAvailableImageModels(data.models);
          if (data.defaultModel) {
            setImageModel(data.defaultModel);
          }
        }
      })
      .catch(err => console.error('Failed to load image models:', err));
  }, []);

  // Load recent posts on mount
  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    try {
      const res = await fetch('/api/dashboard/history?type=social-post');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `History request failed (${res.status})`);
      if (data.tasks) setRecentPosts(data.tasks);
      setRecentPostsError('');
    } catch (err) {
      setRecentPostsError(err instanceof Error ? err.message : 'Unable to load recent posts');
    }
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

  const stopImageTracking = useCallback(() => {
    if (imageProgressTimerRef.current) {
      clearInterval(imageProgressTimerRef.current);
      imageProgressTimerRef.current = null;
    }
    if (imagePollTimerRef.current) {
      clearInterval(imagePollTimerRef.current);
      imagePollTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopElapsedTimer();
      imageRunRef.current += 1;
      stopImageTracking();
      abortControllerRef.current?.abort();
    };
  }, [stopElapsedTimer, stopImageTracking]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setOptions(null);
    setResult(null);
    setGeneratedImage(null);
    setImageHistory([]);
    setTokenUsage(null);
    setViewingPost(null);
    setSelectedIndex(null);
    setKnowledgeSaved(false);
    setKnowledgeError('');
    setTaskId(null);
    setResearchPosts([]);
    setQcResults([]);
    setDupoinFileName('');
    setPostStatus('draft');
    setStatusMessage('');
    setProgress({ step: 'draft', progress: 0, message: 'Starting generation...', elapsed: 0 });

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
                if (r.qcResults) setQcResults(r.qcResults);
                if (r.dupoinFileName) setDupoinFileName(r.dupoinFileName);
                if (r.researchPosts) setResearchPosts(r.researchPosts);
                if (r.status) setPostStatus(r.status);
                fetchPosts();
              }
              setProgress({ step: 'done', progress: 100, message: 'Complete!', elapsed });
              stopElapsedTimer();
              setTimeout(() => setProgress(null), 3000);
              setLoading(false);
              return;
            }

            // Capture research and QC data from intermediate events
            if (event.researchPosts) setResearchPosts(event.researchPosts);
            if (event.qcResults) setQcResults(event.qcResults);

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
    setKnowledgeError('');

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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Knowledge save failed (${res.status})`);
      }

      setKnowledgeSaved(true);
      setEditableImagePrompt(selected.imagePrompt || '');
      setTimeout(() => setKnowledgeSaved(false), 5000);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      console.error('Failed to save knowledge:', e);
      setKnowledgeError(`Gagal menyimpan ke Knowledge: ${message}`);
      setSelectedIndex(null);
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

  const updatePostStatus = async (newStatus: string) => {
    if (!taskId || statusUpdating) return;
    setStatusUpdating(true);
    setStatusMessage('');
    try {
      const res = await fetch('/api/social-post/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, status: newStatus }),
      });
      if (res.ok) {
        const data = await res.json();
        setPostStatus(newStatus);
        setStatusMessage(data.message || `Status updated to ${newStatus}`);
        setTimeout(() => setStatusMessage(''), 5000);
      } else {
        const data = await res.json();
        setStatusMessage(data.error || 'Failed to update status');
      }
    } catch {
      setStatusMessage('Network error');
    }
    setStatusUpdating(false);
  };

  const STATUS_OPTIONS = [
    { value: 'draft', label: '📝 Draft', color: 'text-[var(--mos-text-muted)]' },
    { value: 'review', label: '👀 Review', color: 'text-yellow-400' },
    { value: 'approved', label: 'Approved', color: 'text-green-400' },
    { value: 'published', label: 'Published', color: 'text-blue-400' },
    { value: 'archived', label: '📦 Archived', color: 'text-[var(--mos-text-faint)]' },
  ];

  const generateImage = async () => {
    if (!editableImagePrompt.trim()) return;
    imageRunRef.current += 1;
    const runId = imageRunRef.current;
    stopImageTracking();
    setGeneratingImage(true);
    setError('');
    setGeneratedImage(null);
    setImageProgress({ step: 'trying', progress: 5, message: 'Starting image generation...', elapsed: 0 });

    const startTime = Date.now();
    imageProgressTimerRef.current = setInterval(() => {
      setImageProgress(prev => prev ? { ...prev, elapsed: Math.floor((Date.now() - startTime) / 1000) } : null);
    }, 1000);

    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: editableImagePrompt, taskId, type: 'social-post', brief: brief || editableImagePrompt.substring(0, 100), model: imageModel }),
      });

      const startup = await readImageJobResponse(res);
      if (!res.ok) throw new Error(startup.error || `Unable to start image generation (HTTP ${res.status}).`);
      if (typeof startup.jobId !== 'string') throw new Error('Image generation did not return a job ID.');
      const jobId = startup.jobId;

      const poll = async (): Promise<boolean> => {
        if (imageRunRef.current !== runId) return true;
        try {
          const statusResponse = await fetch(`/api/generate-image?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
          const status = await readImageJobResponse(statusResponse);
          if (!statusResponse.ok) throw new Error(status.error || `Unable to check image generation status (HTTP ${statusResponse.status}).`);
          if (imageRunRef.current !== runId) return true;

          setImageProgress({
            step: status.status || 'generating',
            progress: typeof status.progress === 'number' ? status.progress : 0,
            message: status.message || 'Generating image...',
            elapsed: Math.floor((Date.now() - startTime) / 1000),
          });

          if (status.status === 'done' && status.result?.success && status.result.imageUrl) {
            setGeneratedImage(status.result.imageUrl);
            setGeneratingImage(false);
            stopImageTracking();
            // The image is now attached to the task row; refresh history views.
            fetchPosts();
            if (taskId) {
              setImageHistory(prev => [...prev, {
                imageUrl: status.result!.imageUrl,
                fileName: status.result!.fileName,
                sopName: status.result!.sopName,
                model: imageModel,
                prompt: editableImagePrompt,
                generatedAt: new Date().toISOString(),
              }]);
            }
            setTimeout(() => {
              if (imageRunRef.current === runId) setImageProgress(null);
            }, 3000);
            return true;
          }
          if (status.status === 'error') {
            setError(status.error || status.message || 'Image generation failed.');
            setGeneratingImage(false);
            stopImageTracking();
            return true;
          }
          return false;
        } catch (pollError: any) {
          if (imageRunRef.current === runId) {
            setError(pollError.message || 'Unable to check image generation status.');
            setImageProgress(null);
            setGeneratingImage(false);
            stopImageTracking();
          }
          return true;
        }
      };

      const finished = await poll();
      if (!finished && imageRunRef.current === runId) {
        imagePollTimerRef.current = setInterval(() => { void poll(); }, 1500);
      }
    } catch (e: any) {
      if (imageRunRef.current === runId) {
        setError(e.message || 'Unable to start image generation.');
        setImageProgress(null);
        setGeneratingImage(false);
        stopImageTracking();
      }
    }
  };

  const viewPost = (post: any) => {
    setViewingPost(post);
    setOptions(null);
    setResult(null);
    setSelectedIndex(null);
    setGeneratedImage(null);
    setKnowledgeSaved(false);
    setError('');
    setResearchPosts([]);
    setQcResults([]);
    setDupoinFileName('');
    setPostStatus(post.status || 'draft');
    setBrief(post.brief || '');
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
      // Load SOP data if available
      if (data.qcResults) setQcResults(data.qcResults);
      if (data.dupoinFileName) setDupoinFileName(data.dupoinFileName);
      if (data.researchPosts) setResearchPosts(data.researchPosts);
      // Replay previously generated images for this post
      const history = Array.isArray(data.images) ? data.images : [];
      setImageHistory(history);
      const latest = history[history.length - 1];
      const restoredUrl = latest?.imageUrl || data.imageUrl || null;
      if (restoredUrl) setGeneratedImage(restoredUrl);
    } catch {}
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);
  const downloadJSON = () => {
    const dataToExport = options ? { platform, brief, options, usage: tokenUsage, generatedAt: new Date().toISOString(), qcResults, dupoinFileName, status: postStatus }
      : result ? { platform, brief, caption: result.caption, imagePrompt: result.imagePrompt, usage: tokenUsage, generatedAt: new Date().toISOString(), qcResults, dupoinFileName, status: postStatus }
      : null;
    if (!dataToExport) return;
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dupoinFileName ? `${dupoinFileName}.json` : `social-post-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Determine which steps are completed
  const getStepStatus = (stepName: string): 'completed' | 'active' | 'pending' => {
    if (!progress) return 'pending';
    const stepOrder = ['research', 'draft', 'qc', 'image-prompt', 'done'];
    const currentIdx = stepOrder.indexOf(progress.step);
    const targetIdx = stepOrder.indexOf(stepName);
    if (currentIdx > targetIdx) return 'completed';
    if (currentIdx === targetIdx) return 'active';
    return 'pending';
  };

  const selectedOption = selectedIndex !== null && options ? options[selectedIndex] : null;

  return (
    <PageStack className="max-w-6xl">
      <PageHeader eyebrow="Create / Social" title="Social media post" description="Generate three structured options with research, quality control, naming, and delivery review." />
      <InlineModelSelector feature="social-post" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form + Result */}
        <div className="lg:col-span-2 space-y-6">
          {/* Form */}
          <Panel>
          <form onSubmit={handleGenerate} className="space-y-5">
            <SectionHeader title="Generation brief" description="Define the channel, audience, objective, and content direction." />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Platform">
                <Select value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option>Instagram</option><option>TikTok</option><option>LinkedIn</option><option>Twitter/X</option><option>Facebook</option>
                </Select>
              </FormField>
              <FormField label="Target audience">
                <Select value={targetAudience} onChange={e => setTargetAudience(e.target.value)}>
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
                </Select>
              </FormField>
              <FormField label="Goal">
                <Select value={goal} onChange={e => setGoal(e.target.value)}>
                  <option>Awareness</option><option>Engagement</option><option>Lead Generation</option><option>Education</option><option>Event Promotion</option>
                </Select>
              </FormField>
            </div>
            <FormField label="Brief" required>
              <TextArea value={brief} onChange={e => setBrief(e.target.value)} rows={3}
                placeholder="Describe what you want to post about..." required />
            </FormField>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={loading || !brief}>
                {loading ? 'Generating three options…' : 'Generate three options'}
              </Button>
              {options && !loading && (
                <Button type="button" onClick={handleGenerate as any}>Generate three more</Button>
              )}
            </div>
          </form>
          </Panel>

          {/* Streaming Progress Indicator */}
          {progress && loading && (
            <Panel className="space-y-4">
              <SectionHeader title="Generating style options" description={progress.message} action={<StatusBadge tone="info" dot>{progress.progress}%</StatusBadge>} />

              {/* Progress bar */}
              <div className="relative h-3 bg-[var(--mos-raised)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--mos-accent)] transition-all duration-700 ease-out"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>

              {/* Percentage + message */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-[var(--mos-text-secondary)]">{progress.message}</p>
                <span className="text-sm font-mono text-blue-400">{progress.progress}%</span>
              </div>

              {/* Step indicators */}
              <div className="space-y-2 pt-2">
                {['research', 'draft', 'qc', 'image-prompt'].map((stepName) => {
                  const status = getStepStatus(stepName);
                  return (
                    <div key={stepName} className={`flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors ${
                      status === 'active' ? 'bg-blue-500/10' : status === 'completed' ? 'bg-green-500/5' : ''
                    }`}>
                      <span className={`text-sm ${
                        status === 'completed' ? 'text-green-400' : status === 'active' ? 'text-blue-400' : 'text-gray-600'
                      }`}>
                        {status === 'completed' ? '●' : status === 'active' ? `${STEP_ICONS[stepName]}` : '○'}
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
              <div className="flex items-center gap-2 pt-2 border-t border-[var(--mos-border)]">
                <span className="text-xs text-[var(--mos-text-faint)]">Elapsed: {progress.elapsed}s</span>
                {progress.elapsed > 30 && (
                  <span className="text-xs text-yellow-500/70">— generating 3 options in parallel</span>
                )}
              </div>
            </Panel>
          )}

          {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg">{error}</div>}

          {/* Knowledge saved notification */}
          {knowledgeSaved && (
            <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg flex items-center gap-2">
              <span></span>
              <span>Tersimpan ke Knowledge. Pilihan ini akan membantu generation berikutnya mengikuti preferensi Anda.</span>
            </div>
          )}
          {savingKnowledge && (
            <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 px-4 py-3 rounded-lg">
              Menyimpan pilihan ke Knowledge…
            </div>
          )}
          {knowledgeError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg" role="alert">
              {knowledgeError} Silakan pilih ulang untuk mencoba lagi.
            </div>
          )}

          {/* Research Reference Cards */}
          {researchPosts.length > 0 && !loading && (
            <Panel>
              <SectionHeader className="mb-4" title="Previous similar posts" description="Research references used to inform this generation." />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {researchPosts.map((post, i) => (
                  <div key={i} className="bg-[var(--mos-surface)] rounded-lg p-3 border border-[var(--mos-border)]">
                    <p className="text-xs text-[var(--mos-text-muted)] truncate mb-1">📝 {post.brief}</p>
                    <p className="text-xs text-[var(--mos-text-secondary)] leading-relaxed line-clamp-3">{post.caption}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        post.style === 'bold' ? 'bg-orange-500/15 text-orange-400' :
                        post.style === 'professional' ? 'bg-blue-500/15 text-blue-400' :
                        post.style === 'creative' ? 'bg-purple-500/15 text-purple-400' :
                        'bg-[var(--mos-raised)] text-[var(--mos-text-muted)]'
                      }`}>{post.style}</span>
                      {post.rating > 0 && (
                        <span className="text-[10px] text-yellow-400">{'⭐'.repeat(Math.min(post.rating, 5))}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* 3-Option Comparison Cards */}
          {options && options.length > 0 && !loading && (
            <div className="space-y-4">
              <SectionHeader title="Select a preferred style" description="Review all three options, then approve one for Knowledge." />
              {selectedIndex === null && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <p className="text-sm font-medium text-amber-200">Belum masuk Knowledge</p>
                  <p className="mt-1 text-xs text-[var(--mos-text-secondary)]">Pilih satu output yang disetujui. Hanya pilihan tersebut yang disimpan agar Knowledge tidak belajar dari draft yang ditolak.</p>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {options.map((opt, index) => {
                  const isSelected = selectedIndex === index;
                  const styleColors: Record<string, { border: string; accent: string }> = {
                    bold: { border: 'border-orange-500/40', accent: 'text-orange-400' },
                    professional: { border: 'border-blue-500/40', accent: 'text-blue-400' },
                    creative: { border: 'border-purple-500/40', accent: 'text-purple-400' },
                  };
                  const colors = styleColors[opt.style] || styleColors.bold;

                  return (
                    <Panel
                      padding="none"
                      key={index}
                      className={`cursor-pointer transition-all ${
                        isSelected
                          ? 'border-[var(--mos-accent-border)] ring-2 ring-[var(--mos-accent-ring)]'
                          : 'hover:border-[var(--mos-border-strong)]'
                      } ${isSelected && selectedIndex !== null ? 'md:col-span-3' : ''}`}
                      onClick={() => !isSelected && handleSelectOption(index)}
                    >
                      <div className="p-5">
                        {/* Style Label */}
                        <div className="flex items-center justify-between mb-3">
                          <span className={`text-sm font-bold ${colors.accent}`}>{opt.styleLabel}</span>
                          {isSelected && <StatusBadge tone="success" dot>Selected</StatusBadge>}
                        </div>

                        {/* Hook */}
                        {opt.hook && (
                          <p className="text-white font-semibold text-sm mb-2 leading-snug">"{opt.hook}"</p>
                        )}

                        {/* Caption preview */}
                        <p className="text-[var(--mos-text-secondary)] text-xs leading-relaxed mb-3" style={{
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
                              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-[var(--mos-raised)] text-blue-300 rounded">
                                {tag.startsWith('#') ? tag : `#${tag}`}
                              </span>
                            ))}
                            {!isSelected && opt.hashtags.length > 3 && (
                              <span className="text-[10px] text-[var(--mos-text-faint)]">+{opt.hashtags.length - 3}</span>
                            )}
                          </div>
                        )}

                        {/* Select button */}
                        {!isSelected && (
                          <Button
                            onClick={(e) => { e.stopPropagation(); handleSelectOption(index); }}
                            disabled={savingKnowledge}
                            className="mt-2 w-full"
                          >
                            {savingKnowledge ? 'Menyimpan…' : 'Pilih dan simpan ke Knowledge'}
                          </Button>
                        )}

                        {/* Expanded content when selected */}
                        {isSelected && (
                          <div className="mt-4 space-y-4 pt-4 border-t border-[var(--mos-border)]">
                            {/* Full caption */}
                            <div className="bg-white rounded-[var(--mos-radius-panel)] p-5 max-w-md mx-auto">
                              {opt.hook && <p className="text-gray-900 font-semibold text-base mb-3">{opt.hook}</p>}
                              <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{opt.caption}</p>
                              {opt.hashtags && opt.hashtags.length > 0 && (
                                <p className="text-blue-600 text-sm mt-3">{opt.hashtags.join(' ')}</p>
                              )}
                            </div>

                            {/* Copy button */}
                            <div className="flex gap-2 flex-wrap">
                              <button onClick={() => copyToClipboard(opt.caption)}
                                className="text-xs px-3 py-1.5 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-secondary)] rounded-lg">
                                Copy Caption
                              </button>
                              <button onClick={() => copyToClipboard(opt.hook + '\n\n' + opt.caption + '\n\n' + opt.hashtags.join(' '))}
                                className="text-xs px-3 py-1.5 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-secondary)] rounded-lg">
                                Copy All
                              </button>
                              <button onClick={() => setSelectedIndex(null)}
                                className="text-xs px-3 py-1.5 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-secondary)] rounded-lg ml-auto">
                                ✕ Deselect
                              </button>
                            </div>

                            {/* QC Checklist for this option */}
                            {qcResults[index] && (
                              <div className="bg-[var(--mos-surface)] rounded-lg p-4 border border-[var(--mos-border)]">
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="text-sm font-semibold text-white">Quality Check</h4>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    qcResults[index].allPassed
                                      ? 'bg-green-500/20 text-green-400'
                                      : 'bg-yellow-500/20 text-yellow-400'
                                  }`}>
                                    {qcResults[index].score}% — {qcResults[index].allPassed ? 'All Passed' : 'Has Warnings'}
                                  </span>
                                </div>
                                <div className="space-y-1.5">
                                  {qcResults[index].checks.map((check, ci) => (
                                    <div key={ci} className="flex items-center gap-2">
                                      <span className={`text-sm ${check.passed ? 'text-green-400' : 'text-yellow-400'}`}>
                                        {check.passed ? '' : ''}
                                      </span>
                                      <span className="text-xs text-[var(--mos-text-secondary)] font-medium w-28 shrink-0">{check.label}</span>
                                      <span className={`text-xs ${check.passed ? 'text-[var(--mos-text-muted)]' : 'text-yellow-300/80'}`}>
                                        {check.detail}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Panel>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legacy single result (for viewing old posts) */}
          {result && result.caption && !options && (
            <div className="space-y-6">
              <Panel>
                <div className="flex items-center justify-between mb-4">
                  <SectionHeader title="Caption" description="Previously generated social copy." />
                  <Button size="sm" onClick={() => copyToClipboard(result.caption?.caption || '')}>Copy</Button>
                </div>
                <div className="bg-white rounded-[var(--mos-radius-panel)] p-5 max-w-md mx-auto">
                  {result.caption?.hook && <p className="text-gray-900 font-semibold text-base mb-3">{result.caption.hook}</p>}
                  <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{result.caption?.caption}</p>
                  {result.caption?.hashtags?.length > 0 && <p className="text-blue-600 text-sm mt-3">{result.caption.hashtags.join(' ')}</p>}
                </div>
              </Panel>
            </div>
          )}

          {/* Image Prompt + Generate (shown when options exist or result exists) */}
          {(options || result) && (
            <Panel padding="none">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-[var(--mos-border-subtle)] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="text-sm font-[560] text-[var(--mos-text)]">Image prompt</h3>
                    <p className="text-xs text-[var(--mos-text-muted)]">Edit prompt sesuai kebutuhan sebelum generate gambar</p>
                  </div>
                </div>
                <Button size="sm" onClick={() => copyToClipboard(editableImagePrompt)}>Copy</Button>
              </div>

              {/* Editor */}
              <div className="p-6 space-y-4">
                <div className="relative">
                  <TextArea
                    value={editableImagePrompt}
                    onChange={(e) => setEditableImagePrompt(e.target.value)}
                    style={{ minHeight: '120px', maxHeight: '400px', resize: 'vertical' }}
                    className="font-mono"
                    placeholder="Deskripsikan gambar yang ingin di-generate..."
                    rows={6}
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
                        className="px-2.5 py-1 bg-[var(--mos-raised)] hover:bg-[var(--mos-raised)] text-[var(--mos-text-muted)] text-xs rounded-full border border-[var(--mos-border)] transition-colors">
                        + {tag}
                      </button>
                    ))}
                  </div>
                )}

                {/* Image Model Selector */}
                <div className="space-y-2">
                  <label className="block text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Image Generation Model</label>
                  <Select value={imageModel} onChange={(e) => setImageModel(e.target.value)}>
                    {availableImageModels.length > 0 ? (
                      availableImageModels.map(model => (
                        <option key={model.id} value={model.id}>
                          {model.name} — {model.description}
                        </option>
                      ))
                    ) : (
                      <option value="gpt-5.6-terra">gpt-5.6-terra — Codex · image_gen tool</option>
                    )}
                  </Select>
                  <p className="text-xs text-[var(--mos-text-faint)]">Model digunakan melalui Codex CLI (ChatGPT Plus office account)</p>
                </div>

                {/* Generate button */}
                <Button variant="primary" className="w-full" onClick={generateImage} disabled={generatingImage || !editableImagePrompt.trim()}>
                  {generatingImage ? 'Generating image…' : 'Generate image'}
                </Button>

                {/* Image Generation Progress */}
                {imageProgress && generatingImage && (
                  <div className="mt-4 space-y-3">
                    <div className="relative h-2.5 bg-[var(--mos-raised)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--mos-accent)] transition-all duration-700 ease-out"
                        style={{ width: `${imageProgress.progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-[var(--mos-text-secondary)]">{imageProgress.message}</p>
                      <span className="text-xs font-mono text-purple-400">{imageProgress.progress}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--mos-text-faint)]">{imageProgress.elapsed}s elapsed</span>
                      {imageProgress.elapsed > 30 && (
                        <span className="text-xs text-yellow-500/70">— may take up to 120s</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {/* Generated Image */}
          {generatedImage && (
            <Panel>
              <div className="flex items-center justify-between mb-4">
                <SectionHeader title="Generated image" description="Final visual asset for this post." />
                <a href={generatedImage} download className="inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-xs font-medium text-[var(--mos-text-secondary)]">Download</a>
              </div>
              <div className="bg-[var(--mos-surface)] rounded-lg p-2 flex items-center justify-center">
                <img src={generatedImage} alt="Generated" className="max-w-full max-h-[500px] rounded-lg" />
              </div>
            </Panel>
          )}

          {/* Image generation history for this post */}
          {imageHistory.length > 0 && (
            <Panel>
              <SectionHeader title="Image history" description={`${imageHistory.length} image(s) generated for this post.`} />
              <div className="mt-4 space-y-2">
                {imageHistory.slice().reverse().map((img: any, i: number) => (
                  <div key={`${img.fileName || img.imageUrl}-${i}`} className="flex items-center gap-3 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] p-2">
                    <img src={img.imageUrl} alt={img.sopName || 'Generated'} className="h-14 w-14 rounded object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-[var(--mos-text-secondary)]">{img.sopName || img.fileName}</p>
                      <p className="text-[10px] text-[var(--mos-text-faint)]">
                        {img.model || 'unknown model'}
                        {img.generatedAt ? ` · ${new Date(img.generatedAt).toLocaleString('id-ID')}` : ''}
                      </p>
                    </div>
                    <button type="button" onClick={() => setGeneratedImage(img.imageUrl)} className="shrink-0 text-[10px] text-[var(--mos-text-secondary)] underline">View</button>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Token Usage + Download + Rating + Status */}
          {(options || result) && (
            <Panel className="space-y-4">
              {/* Naming Convention */}
              {dupoinFileName && (
                <div className="bg-[var(--mos-surface)] rounded-lg p-4 border border-[var(--mos-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-white">File naming convention</h4>
                    <Button size="sm" onClick={() => copyToClipboard(dupoinFileName)}>Copy name</Button>
                  </div>
                  <p className="text-sm font-mono text-blue-300 bg-[var(--mos-raised)] px-3 py-2 rounded border border-[var(--mos-border)]">{dupoinFileName}</p>
                  <p className="text-xs text-[var(--mos-text-faint)] mt-1">Format: DUPOIN_[NamaKonten]_[Tipe]_[Versi]_[Tanggal]</p>
                </div>
              )}

              {/* Status Tracking */}
              <div className="bg-[var(--mos-surface)] rounded-lg p-4 border border-[var(--mos-border)]">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-white">Delivery status</h4>
                  {statusMessage && (
                    <span className="text-xs text-green-400 animate-pulse">{statusMessage}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {STATUS_OPTIONS.map((opt) => {
                    const isActive = postStatus === opt.value;
                    const currentIdx = STATUS_OPTIONS.findIndex(s => s.value === postStatus);
                    const optIdx = STATUS_OPTIONS.findIndex(s => s.value === opt.value);
                    const isPast = optIdx < currentIdx;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => updatePostStatus(opt.value)}
                        disabled={statusUpdating || isActive}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                          isActive
                            ? 'bg-blue-600/30 border-blue-500/50 text-blue-300 font-semibold ring-1 ring-blue-500/30'
                            : isPast
                              ? 'bg-[var(--mos-raised)] border-[var(--mos-border)] text-[var(--mos-text-faint)] line-through'
                              : 'bg-[var(--mos-raised)] border-[var(--mos-border)] text-[var(--mos-text-muted)] hover:bg-[var(--mos-raised)] hover:text-[var(--mos-text-secondary)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {postStatus === 'published' && (
                  <div className="mt-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                    <p className="text-xs text-blue-300"><strong>Kirim ke Admin Social Media</strong> untuk proses posting ke platform.</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <h3 className="text-sm font-semibold text-white mb-2">Token usage</h3>
                  {tokenUsage && (
                    <div className="space-y-1 text-sm">
                      <p className="text-[var(--mos-text-muted)]">
                        Caption (3 options): <span className="text-white">{(tokenUsage.caption?.inputTokens || 0) + (tokenUsage.caption?.outputTokens || 0)}</span> tokens · <span className="text-green-400">${((tokenUsage.caption?.cost || 0) + (tokenUsage.imagePrompt?.cost || 0)).toFixed(6)}</span>
                      </p>
                      {tokenUsage.imagePrompt && (
                        <p className="text-[var(--mos-text-muted)]">
                          Image Prompt: <span className="text-white">{(tokenUsage.imagePrompt?.inputTokens || 0) + (tokenUsage.imagePrompt?.outputTokens || 0)}</span> tokens
                        </p>
                      )}
                      <div className="pt-2 mt-2 border-t border-[var(--mos-border)] flex items-center gap-3">
                        <span className="text-[var(--mos-text-secondary)] font-medium">
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
                        <p className="text-xs text-[var(--mos-text-faint)] pt-1">
                          Model: <span className="text-blue-400">{tokenUsage.caption.model}</span>
                          <span className="ml-2 px-1.5 py-0.5 bg-indigo-500/15 text-indigo-300 rounded text-xs">GorillaWorkout LLM</span>
                        </p>
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
        </div>

        {/* Right: Recent Posts */}
        <div className="lg:col-span-1">
          <Panel padding="none" className="sticky top-8">
            <div className="p-4 border-b border-[var(--mos-border)]">
              <h3 className="text-sm font-semibold text-white">Recent posts</h3>
              <p className="text-xs text-[var(--mos-text-faint)] mt-1">Click to view previous generations</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {recentPostsError && (
                <p className="p-3 text-xs text-red-300 border-b border-[var(--mos-border)]">{recentPostsError}</p>
              )}
              {recentPosts.length > 0 ? recentPosts.map((post: any) => (
                <div key={post.id}
                  onClick={() => viewPost(post)}
                  className={`p-3 border-b border-[var(--mos-border)] cursor-pointer hover:bg-[var(--mos-raised)] transition-colors ${viewingPost?.id === post.id ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--mos-text-secondary)] truncate flex-1">{post.title}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ml-2 shrink-0 ${
                      post.status === 'published' ? 'bg-blue-500/20 text-blue-400' :
                      post.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                      post.status === 'review' ? 'bg-yellow-500/20 text-yellow-400' :
                      post.status === 'archived' ? 'bg-[var(--mos-raised)] text-[var(--mos-text-faint)]' :
                      'bg-[var(--mos-raised)] text-[var(--mos-text-faint)]'
                    }`}>
                      {post.status || 'draft'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{new Date(post.created_at).toLocaleDateString()}</p>
                </div>
              )) : <EmptyState title="No posts yet" description="Generated posts will appear here." className="min-h-40" />}
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
