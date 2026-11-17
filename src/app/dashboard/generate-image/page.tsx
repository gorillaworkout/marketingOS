'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  EmptyState,
  FormField,
  PageHeader,
  PageStack,
  Panel,
  SectionHeader,
  Select,
  StatusBadge,
  TextArea,
} from '@/components/ui/dashboard';
import { DEFAULT_IMAGE_ASPECT_RATIO, IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from '@/lib/image-aspect-ratio';
import { applyDupoinImagePromptLocks, stripDupoinImagePromptLocks, type DupoinLogoChoice } from '@/lib/dupoin-image-prompt';
import {
  AVAILABLE_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL,
  imageModelLabel,
  livePaidImageModels,
  selectableImageModel,
  type ImageModelInfo,
} from '@/lib/image-models';
import { IMAGE_REMIX_QUERY, readImageRemix } from '@/lib/image-remix';
import {
  GENERATE_IMAGE_HANDOFF_QUERY,
  GENERATE_IMAGE_HANDOFF_VALUE,
  readGenerateImageHandoff,
} from '@/lib/generate-image-handoff';
import { prepareUpload, type PreparedUpload } from '@/lib/client-image-upload';

const MAX_REFERENCES = 4;
const MAX_ASSETS = 4;

interface ImageJobResponse {
  jobId?: string;
  status?: string;
  progress?: number;
  message?: string;
  error?: string;
  result?: {
    success?: boolean;
    imageUrl?: string;
    fileName?: string;
    model?: string;
    usedModel?: string;
    fallbackFrom?: string;
    fallbackMessage?: string;
    aspectRatio?: ImageAspectRatio;
    paid?: boolean;
    costUsd?: number | null;
    referenceCount?: number;
    assetCount?: number;
  };
}

interface HistoryItem {
  fileName: string;
  imageUrl: string;
  prompt: string;
  brief?: string;
  model: string;
  aspectRatio: string;
  logo: DupoinLogoChoice;
  footer: boolean;
  includeSwipeLeft: boolean;
  brandStyle?: boolean;
  referenceCount?: number;
  assetCount?: number;
  paid?: boolean;
  costUsd?: number | null;
  taskId?: string | null;
  generatedAt: string;
}

interface GeneratedResult {
  url: string;
  modelLabel: string;
  paid: boolean;
  costUsd: number | null;
  notice: string;
  referenceCount: number;
  assetCount: number;
}

const LOGO_OPTIONS: Array<{ value: DupoinLogoChoice; label: string; hint: string }> = [
  { value: 'dupoin', label: 'Dupoin logo', hint: 'Dupoin wordmark and CNN laurel, top left.' },
  { value: 'academy', label: 'Dupoin Academy logo', hint: 'Dupoin Academy logo, top center.' },
  { value: 'none', label: 'No logo', hint: 'No header logo is added.' },
];

const QUICK_TAGS = ['professional', 'minimalist', 'vibrant colors', 'dark theme', 'with text overlay', 'photorealistic'];

async function readJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return {} as T;
  }
}

function formatUsd(value: number | null | undefined, digits = 3): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(digits)}`;
}

function UploadList({
  items,
  onRemove,
  testId,
}: {
  items: PreparedUpload[];
  onRemove: (id: string) => void;
  testId: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid={testId}>
      {items.map(item => (
        <li key={item.id} className="group relative overflow-hidden rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.dataUrl} alt={item.name} className="h-28 w-full object-cover" />
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="truncate text-[11px] text-[var(--mos-text-muted)]" title={item.name}>{item.name}</span>
            <button type="button" onClick={() => onRemove(item.id)} className="shrink-0 text-[11px] font-medium text-red-300 hover:underline" aria-label={`Remove ${item.name}`}>
              Remove
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function GenerateImagePage() {
  const [prompt, setPrompt] = useState('');
  const [brief, setBrief] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState('');
  const [references, setReferences] = useState<PreparedUpload[]>([]);
  const [assets, setAssets] = useState<PreparedUpload[]>([]);
  const [assetNote, setAssetNote] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [logo, setLogo] = useState<DupoinLogoChoice>('dupoin');
  const [footer, setFooter] = useState(true);
  const [includeSwipeLeft, setIncludeSwipeLeft] = useState(false);
  const [brandStyle, setBrandStyle] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>(DEFAULT_IMAGE_ASPECT_RATIO);
  const [freeModels, setFreeModels] = useState<ImageModelInfo[]>(AVAILABLE_IMAGE_MODELS);
  const [paidModels, setPaidModels] = useState<ImageModelInfo[]>(() => livePaidImageModels());
  const [paidEnabled, setPaidEnabled] = useState(false);
  const [model, setModel] = useState(DEFAULT_IMAGE_MODEL);
  const modelLocked = useRef(false);
  const [balance, setBalance] = useState<{ remainingUsd: number | null; configured: boolean } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ progress: number; message: string; elapsed: number } | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState('');
  const runRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const allModels = useMemo(() => [...freeModels, ...paidModels], [freeModels, paidModels]);
  // A paid model cannot stay selected while the admin has paid OpenRouter turned off.
  const requestedModel = allModels.find(item => item.id === model);
  const effectiveModel = requestedModel?.paid && !paidEnabled ? (freeModels[0]?.id ?? DEFAULT_IMAGE_MODEL) : model;
  const selectedModel = allModels.find(item => item.id === effectiveModel);
  const selectedPaid = selectedModel?.paid === true;
  const uploadCount = references.length + assets.length;
  const maxInputs = selectedModel?.maxInputImages ?? 1;
  const tooManyInputs = uploadCount > maxInputs;

  const stopTracking = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    pollRef.current = null;
    tickRef.current = null;
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/generate-image/history', { cache: 'no-store' });
      const data = await readJson<{ images?: HistoryItem[]; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || `History request failed (${response.status})`);
      setHistory(Array.isArray(data.images) ? data.images : []);
      setHistoryError('');
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Unable to load your images');
    }
  }, []);

  useEffect(() => {
    fetch('/api/image-models')
      .then(response => response.json())
      .then((data: { models?: ImageModelInfo[]; defaultModel?: string; paidModels?: ImageModelInfo[]; paidEnabled?: boolean }) => {
        if (Array.isArray(data.models) && data.models.length > 0) setFreeModels(data.models);
        if (Array.isArray(data.paidModels)) setPaidModels(data.paidModels);
        setPaidEnabled(data.paidEnabled === true);
        if (data.defaultModel) setModel(current => (modelLocked.current ? current : data.defaultModel as string));
      })
      .catch(err => console.error('Failed to load image models:', err));
    fetch('/api/generate-image/history', { cache: 'no-store' })
      .then(async response => {
        const data = await readJson<{ images?: HistoryItem[]; error?: string }>(response);
        if (!response.ok) throw new Error(data.error || `History request failed (${response.status})`);
        setHistory(Array.isArray(data.images) ? data.images : []);
      })
      .catch(err => setHistoryError(err instanceof Error ? err.message : 'Unable to load your images'));
    return () => {
      runRef.current += 1;
      stopTracking();
    };
  }, [stopTracking]);

  useEffect(() => {
    if (!selectedPaid) return;
    let cancelled = false;
    fetch('/api/image-models/balance', { cache: 'no-store' })
      .then(response => response.json())
      .then(data => { if (!cancelled) setBalance({ remainingUsd: typeof data.remainingUsd === 'number' ? data.remainingUsd : null, configured: data.configured === true }); })
      .catch(() => { if (!cancelled) setBalance({ remainingUsd: null, configured: false }); });
    return () => { cancelled = true; };
  }, [selectedPaid, effectiveModel]);

  useEffect(() => {
    if (!previewImage) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewImage(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewImage]);

  const readUrlOnce = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(IMAGE_REMIX_QUERY) === '1') {
      const remix = readImageRemix('generate-image');
      if (remix) {
        setPrompt(stripDupoinImagePromptLocks(remix.prompt));
        if (remix.brief) setBrief(remix.brief);
        if ((IMAGE_ASPECT_RATIOS as readonly string[]).includes(remix.aspectRatio || '')) setAspectRatio(remix.aspectRatio as ImageAspectRatio);
        setIncludeSwipeLeft(remix.includeSwipeLeft === true);
        setLogo(remix.logo ?? (remix.dupoinAcademy ? 'academy' : 'dupoin'));
        setFooter(remix.footer !== false);
        if (remix.model) {
          modelLocked.current = true;
          setModel(selectableImageModel(remix.model, [...AVAILABLE_IMAGE_MODELS, ...livePaidImageModels()]));
        }
        if (remix.taskId) setTaskId(remix.taskId);
        if (remix.imageUrl) {
          setResult({ url: remix.imageUrl, modelLabel: remix.model ? imageModelLabel(remix.model) : '', paid: false, costUsd: null, notice: '', referenceCount: 0, assetCount: 0 });
        }
        setSourceNotice('Loaded from the gallery. Adjust the prompt or options, then generate again. Reference images are not saved with past images, so upload them again if you need them.');
      }
    } else if (params.get(GENERATE_IMAGE_HANDOFF_QUERY) === GENERATE_IMAGE_HANDOFF_VALUE) {
      const handoff = readGenerateImageHandoff();
      if (handoff) {
        const fromCaption = [handoff.hook && `Headline: ${handoff.hook}`, handoff.caption && `Caption: ${handoff.caption.slice(0, 600)}`]
          .filter(Boolean)
          .join('\n');
        setPrompt(handoff.prompt ? stripDupoinImagePromptLocks(handoff.prompt) : `Social media visual for this post.\n${fromCaption}`);
        if (handoff.brief) setBrief(handoff.brief);
        if (handoff.taskId) setTaskId(handoff.taskId);
        setSourceNotice('Filled from Social Post. The image will be saved on that post too.');
      }
    }
  };

  // Read the URL once: a gallery remix, or a Social Post caption handoff.
  // Deferred one tick so the first render matches the server render.
  useEffect(() => {
    const timer = window.setTimeout(() => readUrlOnce(), 0);
    return () => window.clearTimeout(timer);
  }, []);


  const addFiles = async (files: FileList | null, kind: 'reference' | 'asset') => {
    if (!files || files.length === 0) return;
    setUploadError('');
    const current = kind === 'reference' ? references : assets;
    const max = kind === 'reference' ? MAX_REFERENCES : MAX_ASSETS;
    const room = max - current.length;
    if (room <= 0) {
      setUploadError(`You can add up to ${max} ${kind === 'reference' ? 'visual references' : 'assets'}.`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    const prepared: PreparedUpload[] = [];
    for (const file of picked) {
      try {
        prepared.push(await prepareUpload(file));
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'That file could not be used.');
      }
    }
    if (files.length > room) setUploadError(`Only ${max} ${kind === 'reference' ? 'visual references' : 'assets'} are allowed; extra files were skipped.`);
    if (kind === 'reference') setReferences(prev => [...prev, ...prepared].slice(0, max));
    else setAssets(prev => [...prev, ...prepared].slice(0, max));
  };

  const finalPromptPreview = useMemo(
    () => (prompt.trim() ? applyDupoinImagePromptLocks(prompt, aspectRatio, { includeSwipeLeft, logo, footer, brandStyle }) : ''),
    [prompt, aspectRatio, includeSwipeLeft, logo, footer, brandStyle],
  );

  const generate = async () => {
    if (!prompt.trim() || tooManyInputs) return;
    runRef.current += 1;
    const runId = runRef.current;
    stopTracking();
    setGenerating(true);
    setError('');
    setResult(null);
    setPreviewImage(null);
    const started = Date.now();
    setProgress({ progress: 5, message: 'Starting image generation...', elapsed: 0 });
    tickRef.current = setInterval(() => {
      setProgress(prev => (prev ? { ...prev, elapsed: Math.floor((Date.now() - started) / 1000) } : prev));
    }, 1000);

    const fail = (message: string) => {
      if (runRef.current !== runId) return;
      setError(message);
      setProgress(null);
      setGenerating(false);
      stopTracking();
    };

    try {
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          type: 'generate-image',
          brief: brief || prompt.trim().slice(0, 100),
          model: effectiveModel,
          taskId,
          aspectRatio,
          includeSwipeLeft,
          logo,
          dupoinAcademy: logo === 'academy',
          footer,
          brandStyle,
          referenceImages: references.map(item => item.dataUrl),
          assetImages: assets.map(item => item.dataUrl),
          assetNote: assetNote.trim(),
        }),
      });
      const startup = await readJson<ImageJobResponse>(response);
      if (!response.ok) throw new Error(startup.error || `Unable to start image generation (HTTP ${response.status}).`);
      if (typeof startup.jobId !== 'string') throw new Error('Image generation did not return a job ID.');
      const jobId = startup.jobId;

      const poll = async (): Promise<boolean> => {
        if (runRef.current !== runId) return true;
        try {
          const statusResponse = await fetch(`/api/generate-image?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
          const status = await readJson<ImageJobResponse>(statusResponse);
          if (!statusResponse.ok) throw new Error(status.error || `Unable to check image generation status (HTTP ${statusResponse.status}).`);
          if (runRef.current !== runId) return true;
          setProgress({
            progress: typeof status.progress === 'number' ? status.progress : 0,
            message: status.message || 'Generating image...',
            elapsed: Math.floor((Date.now() - started) / 1000),
          });
          if (status.status === 'done' && status.result?.success && status.result.imageUrl) {
            const used = status.result.usedModel || effectiveModel;
            setResult({
              url: status.result.imageUrl,
              modelLabel: status.result.model || imageModelLabel(used),
              paid: status.result.paid === true,
              costUsd: typeof status.result.costUsd === 'number' ? status.result.costUsd : null,
              notice: status.result.fallbackMessage || '',
              referenceCount: status.result.referenceCount ?? 0,
              assetCount: status.result.assetCount ?? 0,
            });
            setGenerating(false);
            stopTracking();
            void loadHistory();
            if (selectedPaid) {
              fetch('/api/image-models/balance', { cache: 'no-store' })
                .then(r => r.json())
                .then(data => setBalance({ remainingUsd: typeof data.remainingUsd === 'number' ? data.remainingUsd : null, configured: data.configured === true }))
                .catch(() => {});
            }
            setTimeout(() => { if (runRef.current === runId) setProgress(null); }, 2500);
            return true;
          }
          if (status.status === 'error') {
            fail(status.error || status.message || 'Image generation failed.');
            return true;
          }
          return false;
        } catch (pollError) {
          fail(pollError instanceof Error ? pollError.message : 'Unable to check image generation status.');
          return true;
        }
      };

      const finished = await poll();
      if (!finished && runRef.current === runId) pollRef.current = setInterval(() => { void poll(); }, 1500);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Unable to start image generation.');
    }
  };

  const applyHistoryItem = (item: HistoryItem) => {
    setPrompt(stripDupoinImagePromptLocks(item.prompt));
    if (item.brief) setBrief(item.brief);
    if ((IMAGE_ASPECT_RATIOS as readonly string[]).includes(item.aspectRatio)) setAspectRatio(item.aspectRatio as ImageAspectRatio);
    setLogo(item.logo || 'dupoin');
    setFooter(item.footer !== false);
    setIncludeSwipeLeft(item.includeSwipeLeft === true);
    setBrandStyle(item.brandStyle !== false);
    modelLocked.current = true;
    setModel(selectableImageModel(item.model, allModels));
    setTaskId(item.taskId || null);
    setResult({ url: item.imageUrl, modelLabel: imageModelLabel(item.model), paid: item.paid === true, costUsd: item.costUsd ?? null, notice: '', referenceCount: item.referenceCount ?? 0, assetCount: item.assetCount ?? 0 });
    setSourceNotice('Loaded from your history. Upload references again if you need them.');
    document.getElementById('generate-image-prompt')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <PageStack className="max-w-6xl">
      <PageHeader
        eyebrow="Create / Image"
        title="Generate image"
        description="Create a visual from a prompt. Upload reference images to steer the look and assets to place inside the image."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel id="generate-image-prompt">
            <SectionHeader title="Prompt" description="Describe the scene, the headline text, and the mood." />
            {sourceNotice && (
              <p role="status" data-testid="generate-image-source" className="mt-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs leading-5 text-indigo-100">
                {sourceNotice}
              </p>
            )}
            <div className="relative mt-4">
              <TextArea
                data-testid="generate-image-prompt-input"
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                rows={6}
                className="font-mono"
                style={{ minHeight: '140px', maxHeight: '420px', resize: 'vertical' }}
                placeholder="e.g. A confident trader at a desk with gold price charts, headline “Gold hits a new high”, calm evening light"
              />
              <span className="absolute bottom-3 right-3 text-xs text-gray-600">{prompt.length} chars</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setPrompt(prev => (prev.trim() ? `${prev}, ${tag}` : tag))}
                  className="rounded-full border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2.5 py-1 text-xs text-[var(--mos-text-muted)]"
                >
                  + {tag}
                </button>
              ))}
            </div>
            {finalPromptPreview && (
              <details className="mt-4 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-[var(--mos-text-secondary)]">Final prompt sent to the model</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-[var(--mos-text-muted)]">{finalPromptPreview}</pre>
                {uploadCount > 0 && (
                  <p className="mt-2 text-[11px] text-[var(--mos-text-faint)]">Instructions for your {uploadCount} uploaded image(s) are added before this text.</p>
                )}
              </details>
            )}
          </Panel>

          <Panel>
            <SectionHeader
              title="Visual references"
              description="The model sees these images and follows their style, layout, colors, and mood. Up to 4."
              action={<StatusBadge tone={references.length ? 'info' : 'neutral'}>{references.length}/{MAX_REFERENCES}</StatusBadge>}
            />
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--mos-radius-control)] border border-dashed border-[var(--mos-border-strong)] bg-[var(--mos-surface)] px-4 py-6 text-center">
              <span className="text-sm font-medium text-[var(--mos-text-secondary)]">Upload reference images</span>
              <span className="text-xs text-[var(--mos-text-faint)]">PNG, JPEG, or WebP · up to 20 MB each</span>
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                data-testid="generate-image-reference-input"
                onChange={event => { void addFiles(event.target.files, 'reference'); event.target.value = ''; }}
              />
            </label>
            <UploadList items={references} onRemove={id => setReferences(prev => prev.filter(item => item.id !== id))} testId="generate-image-references" />
          </Panel>

          <Panel>
            <SectionHeader
              title="Assets to include"
              description="Images that must appear inside the result, such as a product photo, a person, or a chart. Up to 4."
              action={<StatusBadge tone={assets.length ? 'info' : 'neutral'}>{assets.length}/{MAX_ASSETS}</StatusBadge>}
            />
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--mos-radius-control)] border border-dashed border-[var(--mos-border-strong)] bg-[var(--mos-surface)] px-4 py-6 text-center">
              <span className="text-sm font-medium text-[var(--mos-text-secondary)]">Upload assets</span>
              <span className="text-xs text-[var(--mos-text-faint)]">Transparent PNGs keep their cut-out</span>
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                data-testid="generate-image-asset-input"
                onChange={event => { void addFiles(event.target.files, 'asset'); event.target.value = ''; }}
              />
            </label>
            <UploadList items={assets} onRemove={id => setAssets(prev => prev.filter(item => item.id !== id))} testId="generate-image-assets" />
            {(assets.length > 0 || references.length > 0) && (
              <FormField label="How to use the uploads" hint="Optional. 500 characters or fewer.">
                <input
                  value={assetNote}
                  maxLength={500}
                  onChange={event => setAssetNote(event.target.value)}
                  placeholder="e.g. Put the product photo on the right, the person on the left"
                  className="h-9 w-full rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-3 text-sm"
                />
              </FormField>
            )}
            {uploadError && <p className="mt-3 text-xs text-red-300" role="alert">{uploadError}</p>}
          </Panel>

          <Panel className="space-y-5">
            <SectionHeader title="Branding" description="Logo and footer are added after the image is generated, so they are always exact." />
            <fieldset>
              <legend className="mb-2 text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">Logo</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Logo">
                {LOGO_OPTIONS.map(option => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-2 rounded-[var(--mos-radius-control)] border px-3 py-2.5 ${logo === option.value ? 'border-[var(--mos-accent)] bg-[var(--mos-raised)]' : 'border-[var(--mos-border)] bg-[var(--mos-surface)]'}`}
                  >
                    <input
                      type="radio"
                      name="generate-image-logo"
                      value={option.value}
                      checked={logo === option.value}
                      data-testid={`generate-image-logo-${option.value}`}
                      onChange={() => setLogo(option.value)}
                      className="mt-0.5 accent-cyan-500"
                    />
                    <span>
                      <span className="block text-sm font-medium text-[var(--mos-text-secondary)]">{option.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--mos-text-faint)]">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-cyan-500" checked={footer} data-testid="generate-image-footer" onChange={event => setFooter(event.target.checked)} />
                <span>
                  <span className="block text-sm font-medium text-[var(--mos-text-secondary)]">Regulatory footer</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--mos-text-faint)]">Regulation line and risk warning at the bottom.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-cyan-500" checked={includeSwipeLeft} data-testid="generate-image-swipe-left" onChange={event => setIncludeSwipeLeft(event.target.checked)} />
                <span>
                  <span className="block text-sm font-medium text-[var(--mos-text-secondary)]">Swipe left button</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--mos-text-faint)]">Centered pill near the bottom.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-surface)] px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-cyan-500" checked={brandStyle} data-testid="generate-image-brand-style" onChange={event => setBrandStyle(event.target.checked)} />
                <span>
                  <span className="block text-sm font-medium text-[var(--mos-text-secondary)]">Dupoin style</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--mos-text-faint)]">Navy field and Dupoin Blue. Turn off to follow your reference’s look.</span>
                </span>
              </label>
            </div>
            {!footer && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Without the footer, the regulation line and risk warning are not on the image. Check that this is allowed before you publish it.
              </p>
            )}
          </Panel>

          <Panel className="space-y-4">
            <SectionHeader title="Model and size" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField label="Image model">
                <Select value={effectiveModel} data-testid="generate-image-model" onChange={event => { modelLocked.current = true; setModel(event.target.value); }}>
                  <optgroup label="Free (included)">
                    {freeModels.map(item => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </optgroup>
                  {paidModels.length > 0 && (
                    <optgroup label={paidEnabled ? 'Paid · OpenRouter credits' : 'Paid · turned off in AI Models'}>
                      {paidModels.map(item => (
                        <option key={item.id} value={item.id} disabled={!paidEnabled}>
                          {item.name} · ≈ {formatUsd(item.estimatedCostUsd)}/image
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </FormField>
              <FormField label="Aspect ratio">
                <Select value={aspectRatio} onChange={event => setAspectRatio(event.target.value as ImageAspectRatio)}>
                  {IMAGE_ASPECT_RATIOS.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
                </Select>
              </FormField>
            </div>
            {!paidEnabled && paidModels.length > 0 && (
              <p className="text-xs text-[var(--mos-text-faint)]" data-testid="generate-image-paid-off">
                Nano Banana and GPT Image models are paid per image through OpenRouter. An admin can turn on “Use paid OpenRouter models” in AI Models to use them.
              </p>
            )}
            {selectedPaid && selectedModel && (
              <div className="rounded-[var(--mos-radius-control)] border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-100" data-testid="generate-image-cost-notice">
                <p className="font-medium">Paid model: {selectedModel.name}</p>
                <p>Estimated cost ≈ {formatUsd(selectedModel.estimatedCostUsd)} per image (OpenRouter credits). The actual charge is shown after the image is ready.</p>
                <p>OpenRouter balance: {balance ? (balance.remainingUsd !== null ? formatUsd(balance.remainingUsd, 2) : (balance.configured ? 'unavailable' : 'no API key')) : 'checking…'}</p>
                <p>If the credit runs out, the free model is used instead.</p>
              </div>
            )}
            {uploadCount > 0 && (
              <p className="text-xs text-[var(--mos-text-faint)]">
                {selectedModel?.provider === 'gateway'
                  ? `This free model receives one image, so your ${uploadCount} upload(s) are merged into one labelled reference sheet.`
                  : `${uploadCount} upload(s) are sent to the model as separate input images.`}
              </p>
            )}
            {tooManyInputs && (
              <p className="text-xs text-red-300" role="alert">{selectedModel?.name || 'This model'} accepts at most {maxInputs} input image(s). Remove some uploads or pick another model.</p>
            )}
            <Button variant="primary" className="w-full" data-testid="generate-image-submit" onClick={() => void generate()} disabled={generating || !prompt.trim() || tooManyInputs}>
              {generating ? 'Generating image…' : selectedPaid ? `Generate image (≈ ${formatUsd(selectedModel?.estimatedCostUsd)})` : 'Generate image'}
            </Button>
            {progress && generating && (
              <div className="space-y-2">
                <div className="relative h-2.5 overflow-hidden rounded-full bg-[var(--mos-raised)]">
                  <div className="h-full rounded-full bg-[var(--mos-accent)] transition-all duration-700 ease-out" style={{ width: `${progress.progress}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <p className="text-[var(--mos-text-secondary)]">{progress.message}</p>
                  <span className="font-mono text-purple-400">{progress.progress}%</span>
                </div>
                <p className="text-xs text-[var(--mos-text-faint)]">{progress.elapsed}s elapsed{progress.elapsed > 30 ? ' — may take up to 120s' : ''}</p>
              </div>
            )}
          </Panel>

          {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400" role="alert">{error}</div>}

          {result && (
            <Panel>
              <div className="mb-4 flex items-center justify-between">
                <SectionHeader
                  title="Generated image"
                  description={[
                    result.modelLabel,
                    result.referenceCount ? `${result.referenceCount} reference(s)` : '',
                    result.assetCount ? `${result.assetCount} asset(s)` : '',
                  ].filter(Boolean).join(' · ') || 'Final visual asset'}
                />
                <a href={result.url} download className="inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-xs font-medium text-[var(--mos-text-secondary)]">Download</a>
              </div>
              {result.notice && (
                <div role="status" className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{result.notice}</div>
              )}
              {result.paid && (
                <p className="mb-3 text-xs text-[var(--mos-text-secondary)]" data-testid="generate-image-actual-cost">Actual cost: {formatUsd(result.costUsd, 4)} (reported by OpenRouter)</p>
              )}
              <div className="flex flex-col items-center gap-2 rounded-lg bg-[var(--mos-surface)] p-2">
                <button type="button" data-testid="generate-image-result" aria-label="Enlarge image" className="cursor-zoom-in rounded-lg" onClick={() => setPreviewImage({ src: result.url, alt: 'Generated image' })}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.url} alt="Generated" className="max-h-[520px] max-w-full rounded-lg" />
                </button>
                <p className="text-xs text-[var(--mos-text-faint)]">Click the image to enlarge.</p>
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-4 lg:col-span-1">
          <Panel padding="none" className="sticky top-8">
            <div className="flex items-center justify-between border-b border-[var(--mos-border)] p-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Your images</h3>
                <p className="mt-1 text-xs text-[var(--mos-text-faint)]">Reuse a past prompt and its options.</p>
              </div>
              <Link href="/dashboard/images" className="text-xs font-medium text-[var(--mos-accent-soft)] hover:underline">Gallery</Link>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {historyError && <p className="border-b border-[var(--mos-border)] p-3 text-xs text-red-300">{historyError}</p>}
              {history.length > 0 ? history.map(item => (
                <div key={item.fileName} className="flex items-center gap-3 border-b border-[var(--mos-border)] p-3" data-testid="generate-image-history-item">
                  <button type="button" onClick={() => setPreviewImage({ src: item.imageUrl, alt: item.fileName })} className="shrink-0 cursor-zoom-in rounded" aria-label={`Enlarge ${item.fileName}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.imageUrl} alt="" className="h-14 w-14 rounded object-cover" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-[var(--mos-text-secondary)]">{stripDupoinImagePromptLocks(item.prompt).slice(0, 80) || item.fileName}</p>
                    <p className="truncate text-[10px] text-[var(--mos-text-faint)]">
                      {imageModelLabel(item.model)} · {item.aspectRatio}
                      {item.paid ? ` · ${formatUsd(item.costUsd, 4)}` : ''}
                      {item.generatedAt ? ` · ${new Date(item.generatedAt).toLocaleString('id-ID')}` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => applyHistoryItem(item)} className="shrink-0 text-xs font-medium text-[var(--mos-accent-soft)] hover:underline">
                    Use
                  </button>
                </div>
              )) : <EmptyState title="No images yet" description="Images you generate here will appear in this list." className="min-h-40" />}
            </div>
          </Panel>
        </div>
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 sm:p-8" role="presentation" onClick={() => setPreviewImage(null)}>
          <div role="dialog" aria-modal="true" aria-label="Image preview" data-testid="generate-image-preview" className="relative flex max-h-full w-full max-w-5xl flex-col items-center" onClick={event => event.stopPropagation()}>
            <button type="button" autoFocus className="mb-3 self-end rounded-[var(--mos-radius-control)] border border-white/20 bg-black/50 px-3 py-1.5 text-xs font-medium text-white" onClick={() => setPreviewImage(null)}>
              Close
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewImage.src} alt={previewImage.alt} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
          </div>
        </div>
      )}
    </PageStack>
  );
}
