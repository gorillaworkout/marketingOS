'use client';

import { useEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore } from 'react';
import { AiResearchAnswerTools } from '@/components/AiResearchAnswerTools';
import { AiResearchExportActions } from '@/components/AiResearchExportActions';
import { AiResearchPinFact } from '@/components/AiResearchPinFact';
import { AiResearchCameraButton } from '@/components/AiResearchCameraButton';
import { AiResearchVoiceButton } from '@/components/AiResearchVoiceButton';
import { AiResearchWatchPanel } from '@/components/AiResearchWatchPanel';
import { AiResearchFileChip, AiResearchMarkdown } from '@/components/AiResearchMarkdown';
import { AiResearchSourcesPanel } from '@/components/AiResearchSourcesPanel';
import {
  AI_RESEARCH_DEEP_STATUS,
  AI_RESEARCH_MODE_STORAGE_KEY,
} from '@/lib/ai-research-deep';
import {
  AI_RESEARCH_ASSISTANT_NAME,
  AI_RESEARCH_ATTACHMENT_ONLY_PROMPT,
  AI_RESEARCH_FILE_ONLY_PROMPT,
  AI_RESEARCH_FILE_PICKER_ACCEPT,
  AI_RESEARCH_IMAGE_ONLY_PROMPT,
  AI_RESEARCH_MAX_DOCUMENT_BYTES,
  AI_RESEARCH_MAX_DOCUMENTS,
  AI_RESEARCH_MAX_FILE_BYTES,
  AI_RESEARCH_MAX_FILES,
  AI_RESEARCH_MAX_IMAGE_BYTES,
  AI_RESEARCH_MAX_IMAGES,
  AI_RESEARCH_MAX_TOTAL_DOCUMENT_BYTES,
  AI_RESEARCH_MAX_TOTAL_FILE_BYTES,
  AI_RESEARCH_MAX_TOTAL_IMAGE_BYTES,
  classifyResearchAttachment,
  inferResearchFileType,
} from '@/lib/ai-research';
import {
  RESEARCH_DISCONNECT_BANNER,
  RESEARCH_FAILED_BANNER,
  normalizeInspectorSource,
  type InspectorResearchSource,
  type ResearchGatherStatus,
} from '@/lib/ai-research-inspector';
import { buildCompareUserPrompt } from '@/lib/ai-research-compare';
import { suggestAiResearchFollowUps } from '@/lib/ai-research-followups';
import { conversationBelongsToProject } from '@/lib/ai-research-projects';
import {
  AI_RESEARCH_MAX_CONTEXT_URLS,
  contextUrlBlockReason,
  scanContextUrls,
} from '@/lib/ai-research-urls';
import { appendVoiceTranscript } from '@/lib/ai-research-voice';

interface ChatImage {
  mimeType: string;
  dataUrl: string;
  name?: string;
}

interface ChatFile {
  mimeType: string;
  dataUrl?: string;
  name?: string;
  extractedText?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
  files?: ChatFile[];
  researchMode?: 'deep';
  sources?: Array<{ title: string; url: string }>;
}

interface Conversation {
  id: string;
  title: string;
  model: string;
  projectId?: string | null;
  updatedAt: string;
  messageCount: number;
}

interface ResearchProject {
  id: string;
  name: string;
  notes: string;
  updatedAt: string;
}

interface ModelOption { id: string; name: string; tier: string; provider: string }

interface ModelHealthResult {
  model: string;
  name: string;
  status: 'ok' | 'fail' | 'stale';
  httpStatus: number | null;
  error: string | null;
  snippet: string | null;
  checkedAt: string;
  latencyMs: number;
}

interface PendingAttachment {
  id: string;
  file: File;
  kind: 'image' | 'spreadsheet' | 'document';
  previewUrl?: string;
}

function attachmentKind(file: File): PendingAttachment['kind'] | null {
  return classifyResearchAttachment(file.type, file.name);
}

function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (Array.from(dataTransfer.types).includes('Files')) return true;
  return Array.from(dataTransfer.items).some(item => item.kind === 'file');
}

function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const listed = Array.from(data.files);
  if (listed.length > 0) return listed;
  const extracted: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) extracted.push(file);
  }
  return extracted;
}

function clipboardPlainText(data: DataTransfer): string {
  try {
    return data.getData('text/plain');
  } catch {
    return '';
  }
}

function plainTextIsOnlyFileNames(text: string, files: File[]): boolean {
  const names = new Set(files.map(file => file.name.trim()).filter(Boolean));
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(line => names.has(line));
}

function dragPointerLeftZone(event: React.DragEvent<HTMLElement>): boolean {
  if (event.clientX === 0 && event.clientY === 0) return true;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left
    || event.clientX > rect.right
    || event.clientY < rect.top
    || event.clientY > rect.bottom;
}

const researchModeListeners = new Set<() => void>();

function readStoredResearchMode(): 'fast' | 'deep' {
  try {
    return window.localStorage.getItem(AI_RESEARCH_MODE_STORAGE_KEY) === 'deep' ? 'deep' : 'fast';
  } catch {
    return 'fast';
  }
}

let memoryResearchMode: 'fast' | 'deep' | null = null;

function subscribeResearchMode(listener: () => void) {
  researchModeListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== AI_RESEARCH_MODE_STORAGE_KEY) return;
    memoryResearchMode = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    researchModeListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getResearchModeSnapshot(): 'fast' | 'deep' {
  return memoryResearchMode || readStoredResearchMode();
}

function writeResearchMode(mode: 'fast' | 'deep') {
  memoryResearchMode = mode;
  try {
    window.localStorage.setItem(AI_RESEARCH_MODE_STORAGE_KEY, mode);
  } catch {
    // The in-memory toggle still applies to the next send.
  }
  researchModeListeners.forEach(listener => listener());
}

function watchTopicSeed(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function defaultPromptForAttachments(images: number, files: number): string {
  if (images && files) return AI_RESEARCH_ATTACHMENT_ONLY_PROMPT;
  if (files) return AI_RESEARCH_FILE_ONLY_PROMPT;
  return AI_RESEARCH_IMAGE_ONLY_PROMPT;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(`Could not read ${file.name}`));
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

const PREVIEW_MAX_EDGE = 1280;

async function fileToChatImage(file: File): Promise<ChatImage> {
  if (file.type === 'image/gif') {
    return { mimeType: file.type, dataUrl: await readFileAsDataUrl(file), name: file.name };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not compress image');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const dataUrl = canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.82 : undefined);
    return { mimeType, dataUrl, name: file.name };
  } catch {
    return { mimeType: file.type, dataUrl: await readFileAsDataUrl(file), name: file.name };
  }
}

export default function AIResearchPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectDraftOpen, setProjectDraftOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [deleteProjectArmed, setDeleteProjectArmed] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [researchSourceCount, setResearchSourceCount] = useState<number | null>(null);
  const [inspectorSources, setInspectorSources] = useState<InspectorResearchSource[]>([]);
  const [groundingStatus, setGroundingStatus] = useState<ResearchGatherStatus | null>(null);
  const [pinnedSourceUrls, setPinnedSourceUrls] = useState<string[]>([]);
  const [sourcesPanelOpen, setSourcesPanelOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchSeed, setWatchSeed] = useState('');
  const [researchNotice, setResearchNotice] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(null);
  const [urlNotices, setUrlNotices] = useState<string[]>([]);
  const [linkDraftOpen, setLinkDraftOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('');
  const [error, setError] = useState('');
  const researchMode = useSyncExternalStore<'fast' | 'deep'>(
    subscribeResearchMode,
    getResearchModeSnapshot,
    () => 'fast',
  );
  const [runMode, setRunMode] = useState<'fast' | 'deep'>('fast');
  const [deepStatus, setDeepStatus] = useState('');
  const [model, setModel] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [allowedModels, setAllowedModels] = useState<ModelOption[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthResults, setHealthResults] = useState<ModelHealthResult[] | null>(null);
  const [healthError, setHealthError] = useState('');
  const [healthOpen, setHealthOpen] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextLoadRef = useRef(false);
  const sendingRef = useRef(false);
  const sourcesRef = useRef<Array<{ title: string; url: string }>>([]);

  const selectResearchMode = (mode: 'fast' | 'deep') => {
    writeResearchMode(mode);
  };

  useEffect(() => {
    const root = document.documentElement;
    const previousRoot = root.style.overflow;
    const previousBody = document.body.style.overflow;
    root.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previousRoot;
      document.body.style.overflow = previousBody;
    };
  }, []);

  useEffect(() => {
    fetch('/api/settings/model')
      .then(res => res.json())
      .then(data => {
        const match = data.features?.find((f: { feature: string }) => f.feature === 'ai-research');
        if (match) {
          setAllowedModels(match.allowedModels || []);
          setCurrentModel(match.currentModel);
          setDefaultModel(match.defaultModel);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      pendingAttachments.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, [pendingAttachments]);

  const checkModelHealth = async () => {
    setHealthChecking(true);
    setHealthError('');
    setHealthOpen(true);
    try {
      const res = await fetch('/api/ai-research/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as { results?: ModelHealthResult[]; error?: string };
      if (!res.ok || !Array.isArray(data.results)) {
        throw new Error(data.error || `Health check failed (${res.status})`);
      }
      setHealthResults(data.results);
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : 'Health check failed');
    } finally {
      setHealthChecking(false);
    }
  };

  const saveModelPreference = async (modelId: string | null) => {
    setSavingModel(true);
    try {
      const res = await fetch('/api/settings/model', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature: 'ai-research', model: modelId }),
      });
      const data = await res.json();
      if (res.ok) setCurrentModel(data.currentModel);
    } finally { setSavingModel(false); }
  };

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-research/projects');
      if (!res.ok) return;
      const data = await res.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch {}
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const scope = activeProjectId ? encodeURIComponent(activeProjectId) : 'inbox';
      const res = await fetch(`/api/ai-research/chat?project=${scope}`);
      if (res.ok) { const data = await res.json(); setConversations(data.conversations || []); }
    } catch {}
  }, [activeProjectId]);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (!activeConvoId) return;
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    let cancelled = false;
    fetch(`/api/ai-research/chat?id=${activeConvoId}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data.messages)) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load conversation');
        }
        return data as { messages: Message[]; model?: string };
      })
      .then(data => {
        if (cancelled) return;
        setMessages(data.messages);
        setModel(data.model || '');
        setInspectorSources([]);
        setGroundingStatus(null);
        setResearchSourceCount(null);
        setResearchNotice(null);
        setUrlNotices([]);
        setPinnedSourceUrls([]);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load conversation');
      });
    return () => { cancelled = true; };
  }, [activeConvoId]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTo({ top: transcript.scrollHeight });
  }, [messages, streaming, loading]);

  const clearPendingAttachments = () => {
    setPendingAttachments(prev => {
      prev.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addAttachments = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (!incoming.length) return;

    setError('');
    setPendingAttachments(prev => {
      const next = [...prev];
      for (const file of incoming) {
        const kind = attachmentKind(file);
        if (!kind) {
          setError('Unsupported attachment. Use JPEG, PNG, WebP, GIF, XLSX, XLS, CSV, PDF, DOCX, or PPTX.');
          continue;
        }
        const images = next.filter(item => item.kind === 'image');
        const spreadsheets = next.filter(item => item.kind === 'spreadsheet');
        const documents = next.filter(item => item.kind === 'document');
        if (kind === 'image') {
          if (file.size > AI_RESEARCH_MAX_IMAGE_BYTES) {
            setError(`${file.name} is larger than 4 MB.`);
            continue;
          }
          if (images.length >= AI_RESEARCH_MAX_IMAGES) {
            setError(`You can attach up to ${AI_RESEARCH_MAX_IMAGES} images per message.`);
            break;
          }
          const total = images.reduce((sum, item) => sum + item.file.size, 0) + file.size;
          if (total > AI_RESEARCH_MAX_TOTAL_IMAGE_BYTES) {
            setError('Attached images exceed the 6 MB total limit.');
            break;
          }
          next.push({
            id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`,
            file,
            kind,
            previewUrl: URL.createObjectURL(file),
          });
          continue;
        }
        if (kind === 'document') {
          if (file.size > AI_RESEARCH_MAX_DOCUMENT_BYTES) {
            setError(`${file.name} is larger than ${AI_RESEARCH_MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`);
            continue;
          }
          if (documents.length >= AI_RESEARCH_MAX_DOCUMENTS) {
            setError(`You can attach up to ${AI_RESEARCH_MAX_DOCUMENTS} documents per message.`);
            break;
          }
          const total = documents.reduce((sum, item) => sum + item.file.size, 0) + file.size;
          if (total > AI_RESEARCH_MAX_TOTAL_DOCUMENT_BYTES) {
            setError(`Attached documents exceed the ${AI_RESEARCH_MAX_TOTAL_DOCUMENT_BYTES / (1024 * 1024)} MB total limit.`);
            break;
          }
          next.push({
            id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`,
            file,
            kind,
          });
          continue;
        }
        if (file.size > AI_RESEARCH_MAX_FILE_BYTES) {
          setError(`${file.name} is larger than 2 MB.`);
          continue;
        }
        if (spreadsheets.length >= AI_RESEARCH_MAX_FILES) {
          setError(`You can attach up to ${AI_RESEARCH_MAX_FILES} spreadsheets per message.`);
          break;
        }
        const total = spreadsheets.reduce((sum, item) => sum + item.file.size, 0) + file.size;
        if (total > AI_RESEARCH_MAX_TOTAL_FILE_BYTES) {
          setError('Attached spreadsheets exceed the 4 MB total limit.');
          break;
        }
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`,
          file,
          kind,
        });
      }
      return next;
    });
  };

  const handleAttachmentDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!loading) setFileDragActive(true);
  };

  const handleAttachmentDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = loading ? 'none' : 'copy';
    if (!loading) setFileDragActive(true);
  };

  const handleAttachmentDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!fileDragActive && !dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (dragPointerLeftZone(event)) setFileDragActive(false);
  };

  const appendContextUrls = (urls: string[]) => {
    if (!urls.length) return;
    const existing = new Set(scanContextUrls(input).accepted.map(item => item.url));
    const room = AI_RESEARCH_MAX_CONTEXT_URLS - existing.size;
    const nextUrls = urls.filter(url => !existing.has(url)).slice(0, Math.max(0, room));
    if (!nextUrls.length) {
      if (urls.some(url => !existing.has(url))) {
        setError(`At most ${AI_RESEARCH_MAX_CONTEXT_URLS} links per message.`);
      }
      return;
    }
    setError('');
    setInput(prev => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed} ${nextUrls.join(' ')}` : nextUrls.join(' ');
    });
  };

  const handleAttachmentDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const files = event.dataTransfer?.files;
    const isFileDrop = dragHasFiles(event.dataTransfer) || Boolean(files && files.length > 0);
    if (isFileDrop) {
      event.preventDefault();
      event.stopPropagation();
      setFileDragActive(false);
      if (loading || !files?.length) return;
      addAttachments(files);
      return;
    }
    const droppedText = `${event.dataTransfer?.getData('text/uri-list') || ''}\n${event.dataTransfer?.getData('text/plain') || ''}`;
    const dropped = scanContextUrls(droppedText).accepted;
    if (!dropped.length) return;
    event.preventDefault();
    event.stopPropagation();
    setFileDragActive(false);
    if (loading) return;
    appendContextUrls(dropped.map(item => item.url));
  };

  const handleComposerPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromClipboard(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    if (loading) return;
    const text = clipboardPlainText(event.clipboardData);
    if (text && !plainTextIsOnlyFileNames(text, files)) {
      const el = event.currentTarget;
      const start = el.selectionStart ?? input.length;
      const end = el.selectionEnd ?? input.length;
      const next = `${input.slice(0, start)}${text}${input.slice(end)}`;
      setInput(next);
      const cursor = start + text.length;
      requestAnimationFrame(() => {
        const node = inputRef.current;
        if (!node) return;
        node.style.height = 'auto';
        node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
        node.setSelectionRange(cursor, cursor);
      });
    }
    addAttachments(files);
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments(prev => {
      const target = prev.find(item => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(item => item.id !== id);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sendMessage = async (rawText?: string) => {
    const fromChip = typeof rawText === 'string';
    const trimmed = (fromChip ? rawText : input).trim();
    const attachments = fromChip ? [] : pendingAttachments;
    const compareRequest = !fromChip && compareMode
      ? { a: compareA.trim(), b: compareB.trim() }
      : null;
    if (compareRequest && (!compareRequest.a || !compareRequest.b)) return;
    if ((!trimmed && attachments.length === 0 && !compareRequest) || loading || sendingRef.current) return;
    sendingRef.current = true;
    setError('');
    setUrlNotices([]);

    const pendingImages = attachments.filter(item => item.kind === 'image');
    const pendingFiles = attachments.filter(item => item.kind === 'spreadsheet' || item.kind === 'document');
    let images: ChatImage[] = [];
    let files: ChatFile[] = [];
    try {
      images = await Promise.all(pendingImages.map(item => fileToChatImage(item.file)));
      files = await Promise.all(pendingFiles.map(async item => ({
        mimeType: inferResearchFileType(item.file.type, item.file.name) || item.file.type || 'application/octet-stream',
        dataUrl: await readFileAsDataUrl(item.file),
        name: item.file.name,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the attached file');
      sendingRef.current = false;
      return;
    }

    const userMsg: Message = {
      role: 'user',
      content: compareRequest
        ? buildCompareUserPrompt(compareRequest.a, compareRequest.b, trimmed)
        : (trimmed || defaultPromptForAttachments(images.length, files.length)),
      images: images.length ? images : undefined,
      files: files.length ? files : undefined,
    };
    setMessages(prev => [...prev, userMsg]);
    if (!fromChip) {
      setInput('');
      clearPendingAttachments();
      setLinkDraft('');
      setLinkDraftOpen(false);
    }
    const sentMode = compareRequest ? 'fast' : researchMode;
    sourcesRef.current = [];
    setRunMode(sentMode);
    setDeepStatus(sentMode === 'deep' ? AI_RESEARCH_DEEP_STATUS.plan : '');
    setStreaming('');
    setResearchSourceCount(null);
    setInspectorSources([]);
    setGroundingStatus(null);
    setResearchNotice(null);
    setLoading(true);
    if (!fromChip && inputRef.current) inputRef.current.style.height = 'auto';

    try {
      const res = await fetch('/api/ai-research/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [userMsg],
          conversationId: activeConvoId,
          pinnedSourceUrls,
          mode: sentMode,
          projectId: activeProjectId,
          ...(compareRequest ? { compare: compareRequest } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Server error (${res.status})`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '', content = '';
      let streamCompleted = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data: ')) continue;
          let d: {
            type?: string;
            content?: string;
            conversationId?: string;
            model?: string;
            error?: string;
            sourceCount?: number;
            grounding?: ResearchGatherStatus;
            sources?: InspectorResearchSource[];
            failures?: Array<{ url?: string; error?: string }>;
            message?: string;
          };
          try { d = JSON.parse(t.slice(6)); } catch { continue; }
          if (d.type === 'start') {
            if (d.conversationId && !activeConvoId) {
              skipNextLoadRef.current = true;
              setActiveConvoId(d.conversationId);
            }
            if (d.model) setModel(d.model);
            loadConversations();
          } else if (d.type === 'context-urls') {
            const notes = Array.isArray(d.failures)
              ? d.failures.flatMap(item => {
                  const url = typeof item?.url === 'string' ? item.url : '';
                  const reason = typeof item?.error === 'string' ? item.error : 'could not be fetched';
                  if (!url) return [];
                  return [`Link could not be fetched (${reason}): ${url}. The question was still sent without that page.`];
                })
              : [];
            if (notes.length) setUrlNotices(notes);
          } else if (d.type === 'research') {
            const sources = Array.isArray(d.sources)
              ? d.sources.flatMap(item => {
                  const normalized = normalizeInspectorSource(item);
                  return normalized ? [normalized] : [];
                })
              : [];
            const count = typeof d.sourceCount === 'number' ? d.sourceCount : sources.length;
            setResearchSourceCount(count);
            setInspectorSources(sources);
            if (d.grounding === 'ok' || d.grounding === 'failed' || d.grounding === 'skipped' || d.grounding === 'empty') {
              setGroundingStatus(d.grounding);
            }
            sourcesRef.current = sources.map(source => ({ title: source.title, url: source.url }));
            if (d.grounding === 'failed') {
              setResearchNotice({ tone: 'danger', text: RESEARCH_FAILED_BANNER });
              setSourcesPanelOpen(true);
            } else if (sources.length > 0) {
              setSourcesPanelOpen(true);
            }
          } else if (d.type === 'status') {
            if (typeof d.message === 'string' && d.message.trim()) setDeepStatus(d.message);
          } else if (d.type === 'token') { content += d.content || ''; setStreaming(content); }
          else if (d.type === 'done') {
            streamCompleted = true;
            setStreaming('');
            setDeepStatus('');
            setMessages(prev => [...prev, {
              role: 'assistant',
              content,
              researchMode: sentMode === 'deep' ? 'deep' : undefined,
              sources: sourcesRef.current.length ? [...sourcesRef.current] : undefined,
            }]);
            if (d.conversationId && !activeConvoId) {
              skipNextLoadRef.current = true;
              setActiveConvoId(d.conversationId);
            }
            setModel(d.model || model);
            loadConversations();
          } else if (d.type === 'error') {
            streamCompleted = true;
            throw new Error(d.error);
          }
        }
      }
      if (!streamCompleted) {
        if (content) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content,
            researchMode: sentMode === 'deep' ? 'deep' : undefined,
            sources: sourcesRef.current.length ? [...sourcesRef.current] : undefined,
          }]);
        }
        setStreaming('');
        setDeepStatus('');
        setResearchNotice({ tone: 'warning', text: RESEARCH_DISCONNECT_BANNER });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
      setStreaming('');
    } finally {
      sendingRef.current = false;
      setLoading(false);
    }
  };

  const newConversation = () => {
    setActiveConvoId(null);
    setMessages([]);
    setStreaming('');
    setResearchSourceCount(null);
    setInspectorSources([]);
    setGroundingStatus(null);
    setPinnedSourceUrls([]);
    setResearchNotice(null);
    setUrlNotices([]);
    setDeepStatus('');
    setLinkDraft('');
    setLinkDraftOpen(false);
    setError('');
    setModel('');
    clearPendingAttachments();
    setTimeout(() => inputRef.current?.focus(), 50);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const togglePinnedSource = (url: string) => {
    setPinnedSourceUrls(prev => prev.includes(url) ? prev.filter(item => item !== url) : [...prev, url]);
  };

  const deleteConversation = async (id: string) => {
    try { await fetch(`/api/ai-research/chat?id=${id}`, { method: 'DELETE' }); if (activeConvoId === id) newConversation(); loadConversations(); }
    catch { setError('Failed to delete conversation'); }
  };

  const resetThreadView = () => {
    setActiveConvoId(null);
    setMessages([]);
    setStreaming('');
    setResearchSourceCount(null);
    setInspectorSources([]);
    setGroundingStatus(null);
    setPinnedSourceUrls([]);
    setResearchNotice(null);
    setUrlNotices([]);
    setDeepStatus('');
    setError('');
    setModel('');
  };

  const selectProject = (id: string | null) => {
    if (id === activeProjectId) return;
    const project = projects.find(item => item.id === id);
    setActiveProjectId(id);
    setNotesDraft(project?.notes || '');
    setRenameDraft(project?.name || '');
    setProjectError('');
    setRenameOpen(false);
    setDeleteProjectArmed(false);
    setConversations([]);
    resetThreadView();
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const createProject = async () => {
    const name = projectDraft.trim();
    if (!name) {
      setProjectError('Project name is required.');
      return;
    }
    setProjectError('');
    try {
      const res = await fetch('/api/ai-research/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not create the project');
      setProjectDraft('');
      setProjectDraftOpen(false);
      await loadProjects();
      if (data.project?.id) selectProject(data.project.id);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : 'Could not create the project');
    }
  };

  const renameProject = async () => {
    if (!activeProjectId) return;
    const name = renameDraft.trim();
    if (!name) {
      setProjectError('Project name is required.');
      return;
    }
    setProjectError('');
    try {
      const res = await fetch('/api/ai-research/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeProjectId, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not rename the project');
      setRenameOpen(false);
      await loadProjects();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : 'Could not rename the project');
    }
  };

  const saveProjectNotes = async () => {
    if (!activeProjectId) return;
    const project = projects.find(item => item.id === activeProjectId);
    if (!project || project.notes === notesDraft) return;
    try {
      const res = await fetch('/api/ai-research/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeProjectId, notes: notesDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not save the notes');
      await loadProjects();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : 'Could not save the notes');
    }
  };

  const deleteProject = async () => {
    if (!activeProjectId) return;
    setProjectError('');
    try {
      const res = await fetch(`/api/ai-research/projects?id=${encodeURIComponent(activeProjectId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not delete the project');
      setDeleteProjectArmed(false);
      await loadProjects();
      selectProject(null);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : 'Could not delete the project');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const resizeComposer = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const applyVoiceTranscript = (spoken: string) => {
    setInput(prev => appendVoiceTranscript(prev, spoken));
    requestAnimationFrame(resizeComposer);
  };

  const linkScan = scanContextUrls(input);
  const followUps = useMemo(() => {
    if (loading || streaming) return [];
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    if (!last || last.role !== 'assistant') return [];
    const previousUser = [...messages].slice(0, lastIndex).reverse().find(message => message.role === 'user');
    if (!previousUser?.content.trim()) return [];
    return suggestAiResearchFollowUps({
      query: previousUser.content,
      answer: last.content,
      sources: inspectorSources,
    });
  }, [messages, loading, streaming, inspectorSources]);
  const followUpIndex = followUps.length ? messages.length - 1 : -1;

  const removeContextUrl = (raw: string) => {
    setInput(prev => prev
      .replace(raw, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .trim());
  };

  const commitLinkDraft = () => {
    const raw = linkDraft.trim();
    if (!raw) return;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const reason = contextUrlBlockReason(withScheme);
    if (reason) {
      setError(`Link blocked (${reason}). Use a public http(s) URL.`);
      return;
    }
    const canonical = scanContextUrls(withScheme).accepted[0]?.url;
    if (!canonical) {
      setError('Enter an http or https link.');
      return;
    }
    const existing = scanContextUrls(input).accepted;
    if (existing.length >= AI_RESEARCH_MAX_CONTEXT_URLS && !existing.some(item => item.url === canonical)) {
      setError(`At most ${AI_RESEARCH_MAX_CONTEXT_URLS} links per message.`);
      return;
    }
    appendContextUrls([canonical]);
    setLinkDraft('');
    setLinkDraftOpen(false);
    setError('');
    inputRef.current?.focus();
  };

  const canSend = !loading && (
    compareMode
      ? Boolean(compareA.trim() && compareB.trim())
      : Boolean(input.trim() || pendingAttachments.length)
  );
  const activeProject = projects.find(item => item.id === activeProjectId) || null;
  const visibleConversations = conversations.filter(conv =>
    conversationBelongsToProject(conv.projectId ?? null, activeProjectId),
  );
  const selectedModelId = currentModel || defaultModel;
  const selectedHealth = healthResults?.find(result => result.model === selectedModelId);
  const failCount = healthResults?.filter(result => result.status === 'fail').length || 0;
  const staleCount = healthResults?.filter(result => result.status === 'stale').length || 0;
  const lastCheckedAt = healthResults?.[0]?.checkedAt;
  const healthBadgeLabel = healthChecking
    ? 'Checking'
    : !healthResults
      ? null
      : failCount > 0
        ? failCount === healthResults.length ? 'FAIL' : `${failCount} FAIL`
        : staleCount > 0
          ? staleCount === healthResults.length ? 'STALE' : `${staleCount} STALE`
          : 'OK';
  const healthBadgeTone = healthChecking
    ? 'neutral'
    : !healthResults
      ? 'neutral'
      : failCount === healthResults.length && failCount > 0
        ? 'danger'
        : failCount > 0 || staleCount > 0
          ? 'warning'
          : 'success';

  const formatCheckedAt = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div
      data-testid="ai-research-shell"
      className="fixed inset-x-0 bottom-0 top-14 z-10 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--mos-bg)] lg:left-[264px] lg:top-0"
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--mos-border)] bg-[var(--mos-bg)] flex-shrink-0 flex-wrap">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] hover:bg-[var(--mos-hover)] rounded-lg transition-colors"
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 18h16.5" />
          </svg>
        </button>

        <span className="text-sm font-semibold text-[var(--mos-text)] truncate">AI Research</span>
        <span className="hidden sm:inline max-w-[160px] truncate text-[11px] text-[var(--mos-text-muted)]">
          {activeProject ? activeProject.name : 'General chat'}
        </span>

        <div className="ml-auto relative flex items-center gap-1.5 min-w-0">
          <select
            value={selectedModelId}
            disabled={savingModel}
            onChange={e => saveModelPreference(e.target.value)}
            aria-label="AI Research model"
            className="min-h-7 rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2 py-1 text-[11px] text-[var(--mos-text)] outline-none focus:border-indigo-400/60 max-w-[140px] sm:max-w-[160px] truncate"
          >
            {allowedModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button
            type="button"
            onClick={checkModelHealth}
            disabled={healthChecking}
            aria-busy={healthChecking}
            className="min-h-7 flex-shrink-0 rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2 py-1 text-[11px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-50 transition-colors"
            title="Ping allowed AI Research models on the GorillaWorkout gateway"
          >
            {healthChecking ? 'Checking…' : 'Check'}
          </button>
          {healthBadgeLabel && (
            <button
              type="button"
              onClick={() => setHealthOpen(open => !open)}
              className={`inline-flex h-7 max-w-[140px] items-center gap-1 truncate rounded-lg border px-2 text-[10px] font-medium ${
                healthBadgeTone === 'success'
                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                  : healthBadgeTone === 'danger'
                    ? 'border-red-400/20 bg-red-400/10 text-red-300'
                    : healthBadgeTone === 'warning'
                      ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                      : 'border-white/[0.07] bg-white/[0.035] text-[var(--mos-text-muted)]'
              }`}
              title="Show per-model health details"
              aria-expanded={healthOpen}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80 flex-shrink-0" />
              {healthBadgeLabel}
            </button>
          )}
          {(healthOpen && (healthResults || healthError)) && (
            <div
              role="status"
              aria-live="polite"
              className="absolute right-0 top-full z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] p-2 shadow-lg"
            >
              {healthError && <p className="px-1 py-1 text-[11px] text-red-300">{healthError}</p>}
              {healthResults?.map(result => (
                <div key={result.model} className="flex items-start justify-between gap-2 px-1 py-1.5 border-b border-[var(--mos-border-subtle)] last:border-b-0">
                  <div className="min-w-0">
                    <p className="text-[11px] text-[var(--mos-text)] truncate">{result.name}</p>
                    <p className={`text-[10px] leading-4 mt-0.5 ${
                      result.status === 'fail' ? 'text-red-300' : result.status === 'stale' ? 'text-amber-200' : 'text-[var(--mos-text-muted)]'
                    }`}>
                      {result.httpStatus ? `HTTP ${result.httpStatus}` : 'No HTTP status'}
                      {result.status === 'fail' && result.error ? ` · ${result.error}` : ''}
                      {result.status === 'stale' && result.error ? ` · ${result.error}` : ''}
                    </p>
                    {result.snippet && result.snippet !== result.error && (
                      <p className="text-[10px] text-[var(--mos-text-faint)] leading-4 mt-0.5 break-words">{result.snippet}</p>
                    )}
                  </div>
                  <span className={`flex-shrink-0 text-[10px] font-semibold ${
                    result.status === 'ok' ? 'text-emerald-300' : result.status === 'stale' ? 'text-amber-200' : 'text-red-300'
                  }`}>
                    {result.status === 'ok' ? 'OK' : result.status === 'stale' ? 'STALE' : 'FAIL'}
                  </span>
                </div>
              ))}
              {lastCheckedAt && (
                <p className="px-1 pt-1 text-[9px] text-[var(--mos-text-faint)]">
                  Last checked {formatCheckedAt(lastCheckedAt)}
                  {selectedHealth ? ` · ${selectedHealth.latencyMs}ms` : ''}
                </p>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          data-testid="ai-research-watch-open"
          onClick={() => setWatchOpen(true)}
          className="min-h-7 flex-shrink-0 rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2 py-1 text-[11px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)] transition-colors"
        >
          Watches
        </button>
        <button
          type="button"
          onClick={() => setSourcesPanelOpen(open => !open)}
          aria-expanded={sourcesPanelOpen}
          className="min-h-7 flex-shrink-0 rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2 py-1 text-[11px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)] transition-colors"
          title="Sources used"
        >
          Sources{typeof researchSourceCount === 'number' ? ` (${researchSourceCount})` : inspectorSources.length ? ` (${inspectorSources.length})` : ''}
        </button>
        <button
          onClick={newConversation}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium py-1.5 px-3 rounded-lg transition-colors flex-shrink-0"
        >
          + New
        </button>
      </div>

      {/* Main area: sidebar + chat */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className={`${sidebarOpen ? 'w-72' : 'w-0'} flex min-h-0 flex-shrink-0 flex-col overflow-hidden border-r border-[var(--mos-border)] bg-[var(--mos-bg)] transition-all duration-200`}>
          <div className="max-h-[min(52%,20rem)] shrink-0 space-y-2 overflow-y-auto border-b border-[var(--mos-border)] p-3" data-testid="ai-research-project-switcher">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--mos-text-muted)]">Research projects</p>
            <button
              type="button"
              data-testid="ai-research-project-inbox"
              aria-pressed={!activeProjectId}
              onClick={() => selectProject(null)}
              className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                !activeProjectId
                  ? 'bg-indigo-600/15 text-[var(--mos-text)]'
                  : 'text-[var(--mos-text-muted)] hover:bg-[var(--mos-hover)] hover:text-[var(--mos-text)]'
              }`}
            >
              General chat
            </button>
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {projects.map(project => (
                <button
                  key={project.id}
                  type="button"
                  data-testid="ai-research-project"
                  aria-pressed={activeProjectId === project.id}
                  onClick={() => selectProject(project.id)}
                  className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs truncate transition-colors ${
                    activeProjectId === project.id
                      ? 'bg-indigo-600/15 text-[var(--mos-text)]'
                      : 'text-[var(--mos-text-muted)] hover:bg-[var(--mos-hover)] hover:text-[var(--mos-text)]'
                  }`}
                >
                  {project.name}
                </button>
              ))}
            </div>
            {projectDraftOpen ? (
              <form
                className="space-y-1.5"
                onSubmit={event => {
                  event.preventDefault();
                  void createProject();
                }}
              >
                <input
                  value={projectDraft}
                  onChange={event => setProjectDraft(event.target.value)}
                  placeholder="Project name, for example gold"
                  aria-label="New project name"
                  className="w-full rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2 py-1.5 text-xs text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
                />
                <div className="flex gap-1.5">
                  <button type="submit" className="flex-1 rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-500">
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setProjectDraftOpen(false); setProjectDraft(''); setProjectError(''); }}
                    className="rounded-lg border border-[var(--mos-border)] px-2 py-1 text-[11px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                data-testid="ai-research-project-create"
                onClick={() => { setProjectDraftOpen(true); setProjectError(''); }}
                className="w-full rounded-lg border border-dashed border-[var(--mos-border)] px-2 py-1.5 text-[11px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] hover:bg-[var(--mos-hover)]"
              >
                + New project
              </button>
            )}
            {activeProject && (
              <div className="space-y-1.5 rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] p-2">
                {renameOpen ? (
                  <form
                    className="space-y-1.5"
                    onSubmit={event => {
                      event.preventDefault();
                      void renameProject();
                    }}
                  >
                    <input
                      value={renameDraft}
                      onChange={event => setRenameDraft(event.target.value)}
                      aria-label="Rename project"
                      className="w-full rounded-lg border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2 py-1 text-xs text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
                    />
                    <div className="flex gap-1.5">
                      <button type="submit" className="flex-1 rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white">Save</button>
                      <button type="button" onClick={() => setRenameOpen(false)} className="rounded-lg px-2 py-1 text-[11px] text-[var(--mos-text-muted)]">Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-1">
                    <p className="min-w-0 truncate text-[11px] font-medium text-[var(--mos-text)]">{activeProject.name}</p>
                    <button
                      type="button"
                      onClick={() => { setRenameDraft(activeProject.name); setRenameOpen(true); }}
                      className="flex-shrink-0 text-[10px] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]"
                    >
                      Rename
                    </button>
                  </div>
                )}
                <label className="block text-[10px] text-[var(--mos-text-muted)]">
                  Pinned notes
                  <textarea
                    value={notesDraft}
                    onChange={event => setNotesDraft(event.target.value)}
                    onBlur={() => { void saveProjectNotes(); }}
                    rows={3}
                    placeholder="Facts or limits this project should remember"
                    aria-label="Pinned notes"
                    className="mt-1 w-full resize-none rounded-lg border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2 py-1 text-[11px] text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
                  />
                </label>
                {deleteProjectArmed ? (
                  <div className="space-y-1.5" data-testid="ai-research-project-delete-confirm">
                    <p className="text-[10px] leading-4 text-amber-200">Delete this project? Conversations return to General chat.</p>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => { void deleteProject(); }} className="flex-1 rounded-lg bg-red-600 px-2 py-1 text-[11px] font-medium text-white">Delete</button>
                      <button type="button" onClick={() => setDeleteProjectArmed(false)} className="rounded-lg px-2 py-1 text-[11px] text-[var(--mos-text-muted)]">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="ai-research-project-delete"
                    onClick={() => setDeleteProjectArmed(true)}
                    className="text-[10px] text-[var(--mos-text-muted)] hover:text-red-300"
                  >
                    Delete project
                  </button>
                )}
              </div>
            )}
            {projectError && <p className="text-[10px] text-red-300">{projectError}</p>}
            <button
              onClick={newConversation}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium py-2 rounded-lg transition-colors"
            >
              New chat
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {visibleConversations.map(conv => (
              <div
                key={conv.id}
                className={`group px-3 py-2.5 cursor-pointer border-b border-[var(--mos-border-subtle)] transition-colors ${
                  activeConvoId === conv.id
                    ? 'bg-indigo-600/10 border-l-2 border-l-indigo-500'
                    : 'hover:bg-[var(--mos-hover)] border-l-2 border-l-transparent'
                }`}
                onClick={() => { setActiveConvoId(conv.id); if (window.innerWidth < 768) setSidebarOpen(false); }}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-[var(--mos-text)] truncate">{conv.title}</p>
                    <p className="text-[9px] text-[var(--mos-text-muted)] mt-0.5">
                      {conv.messageCount} msgs · {new Date(conv.updatedAt).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 text-[var(--mos-text-muted)] hover:text-red-400 p-0.5 transition-all flex-shrink-0"
                    title="Delete"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
            {visibleConversations.length === 0 && (
              <p className="text-[10px] text-[var(--mos-text-muted)] text-center py-8 px-3">No conversations yet</p>
            )}
          </div>
        </div>

        {/* Chat column is the file drop zone (messages + composer). */}
        <div
          data-testid="ai-research-drop-zone"
          data-drag-active={fileDragActive ? 'true' : 'false'}
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${fileDragActive ? 'ring-2 ring-inset ring-indigo-400' : ''}`}
          onDragEnter={handleAttachmentDragEnter}
          onDragOver={handleAttachmentDragOver}
          onDragLeave={handleAttachmentDragLeave}
          onDrop={handleAttachmentDrop}
        >
          {fileDragActive && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-indigo-500/10"
            >
              <div className="rounded-2xl border-2 border-dashed border-indigo-300 bg-[var(--mos-raised)]/95 px-5 py-4 text-center shadow-lg">
                <p className="text-sm font-semibold text-[var(--mos-text)]">Drop to attach</p>
                <p className="mt-1 text-[11px] text-[var(--mos-text-muted)]">Images, Excel, CSV, PDF, Word, or PowerPoint</p>
              </div>
            </div>
          )}
          {/* Messages — only this region scrolls */}
          <div
            ref={transcriptRef}
            data-testid="ai-research-transcript"
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
          >
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
              {/* Empty state */}
              {messages.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center pt-12 sm:pt-20 pb-8 text-center">
                  <div className="w-14 h-14 rounded-full bg-indigo-600/10 flex items-center justify-center mb-5">
                    <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-semibold text-[var(--mos-text)] mb-2">{AI_RESEARCH_ASSISTANT_NAME}</h2>
                  <p className="text-sm text-[var(--mos-text-muted)] max-w-md">
                    {activeProject
                      ? `Research in the ${activeProject.name} project. Questions here remember this project's notes and conversations.`
                      : 'Ask anything — research a trading topic, analyze news, plan marketing, or attach an image, Excel, CSV, PDF, Word, or PowerPoint file for the AI to read.'}
                  </p>
                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                    {[
                      'Who is Sella Susriana at Dupoin?',
                      'What affects gold prices today?',
                      'Draft an Instagram content strategy for a forex broker',
                      'Analyze market sentiment after the Fed rate decision',
                    ].map(s => (
                      <button
                        key={s}
                        onClick={() => { setInput(s); inputRef.current?.focus(); }}
                        className="text-left text-xs text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] bg-[var(--mos-raised)] hover:bg-[var(--mos-hover)] border border-[var(--mos-border)] rounded-xl px-3.5 py-2.5 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages */}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex gap-3 max-w-[85%] sm:max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
                      {msg.role === 'user'
                        ? <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
                        : <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                      }
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[var(--mos-text-muted)] mb-1 px-1 flex items-center gap-1.5">
                        {msg.role === 'user' ? 'You' : AI_RESEARCH_ASSISTANT_NAME}
                        {msg.researchMode === 'deep' && (
                          <span data-testid="ai-research-deep-badge" className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                            Deep
                          </span>
                        )}
                      </p>
                      {msg.images && msg.images.length > 0 && (
                        <div className={`mb-2 flex flex-wrap gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                          {msg.images.map((image, imageIndex) => (
                            <img
                              key={`${image.name || 'image'}-${imageIndex}`}
                              src={image.dataUrl}
                              alt={image.name || `Attached image ${imageIndex + 1}`}
                              className="max-h-40 max-w-[160px] rounded-xl border border-[var(--mos-border)] object-cover"
                            />
                          ))}
                        </div>
                      )}
                      {msg.files && msg.files.length > 0 && (
                        <div className={`mb-2 flex flex-wrap gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                          {msg.files.map((file, fileIndex) => (
                            <AiResearchFileChip key={`${file.name || 'file'}-${fileIndex}`} name={file.name || `File ${fileIndex + 1}`} />
                          ))}
                        </div>
                      )}
                      <div className={`min-w-0 max-w-full px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-md whitespace-pre-wrap'
                          : 'bg-[var(--mos-raised)] border border-[var(--mos-border)] text-[var(--mos-text)] rounded-2xl rounded-tl-md'
                      }`}>
                        {msg.role === 'assistant'
                          ? <AiResearchMarkdown text={msg.content} />
                          : msg.content}
                      </div>
                      {msg.role === 'assistant' && msg.content.trim() && (
                        <>
                          <AiResearchExportActions
                            title={[...messages].slice(0, i).reverse().find(item => item.role === 'user')?.content || 'Dupoin AI research'}
                            answer={msg.content}
                            sources={msg.sources?.length ? msg.sources : (i === messages.length - 1 ? inspectorSources : [])}
                            mode={msg.researchMode}
                          />
                          <AiResearchAnswerTools
                            query={[...messages].slice(0, i).reverse().find(item => item.role === 'user')?.content || ''}
                            answer={msg.content}
                            sources={msg.sources?.length ? msg.sources : (i === messages.length - 1 ? inspectorSources : [])}
                            conversationId={activeConvoId}
                          />
                          <AiResearchPinFact
                            answer={msg.content}
                            sources={msg.sources?.length ? msg.sources : (i === messages.length - 1 ? inspectorSources : [])}
                            conversationId={activeConvoId}
                            projectId={activeProjectId}
                            topicSuggestion={watchTopicSeed([...messages].slice(0, i).reverse().find(item => item.role === 'user')?.content || '')}
                            onWatchTopic={topic => { setWatchSeed(topic); setWatchOpen(true); }}
                          />
                        </>
                      )}
                      {i === followUpIndex && (
                        <div className="mt-2" data-testid="ai-research-followups">
                          <p className="mb-1.5 px-1 text-[10px] font-semibold text-[var(--mos-text-muted)]">Follow-up questions</p>
                          <div className="flex flex-wrap gap-1.5">
                            {followUps.map(suggestion => (
                              <button
                                key={suggestion}
                                type="button"
                                onClick={() => sendMessage(suggestion)}
                                className="rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-3 py-1.5 text-left text-[11px] text-[var(--mos-text)] transition-colors hover:bg-[var(--mos-hover)]"
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Thinking / typing bubble before the first stream token */}
              {loading && !streaming && (
                <div className="flex justify-start" role="status" aria-live="polite" aria-label={`${AI_RESEARCH_ASSISTANT_NAME} is researching`}>
                  <div className="flex gap-3 max-w-[85%] sm:max-w-[75%]">
                    <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[var(--mos-text-muted)] mb-1 px-1 flex items-center gap-2">
                        {AI_RESEARCH_ASSISTANT_NAME}
                        {runMode === 'deep' && (
                          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">Deep</span>
                        )}
                        <span className="text-[9px] font-medium text-emerald-300/80">
                          {runMode === 'deep' && deepStatus
                            ? deepStatus
                            : groundingStatus === 'failed'
                              ? 'Source search failed'
                              : researchSourceCount
                                ? `Researching ${researchSourceCount} sources`
                                : 'Researching'}
                        </span>
                      </p>
                      <div
                        data-testid="ai-research-thinking"
                        className="px-4 py-3 bg-[var(--mos-raised)] border border-[var(--mos-border)] text-[var(--mos-text)] rounded-2xl rounded-tl-md"
                      >
                        {runMode === 'deep' && (
                          <p className="mb-2 text-[11px] text-[var(--mos-text-muted)]">{deepStatus || 'Writing the deep research answer…'}</p>
                        )}
                        <span className="sr-only">Thinking</span>
                        <span className="ai-research-typing-dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Streaming indicator */}
              {streaming && (
                <div className="flex justify-start">
                  <div className="flex gap-3 max-w-[85%] sm:max-w-[75%]">
                    <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09z" /></svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[var(--mos-text-muted)] mb-1 px-1 flex items-center gap-2">
                        {AI_RESEARCH_ASSISTANT_NAME}
                        {runMode === 'deep' && (
                          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                            {deepStatus || 'Deep'}
                          </span>
                        )}
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      </p>
                      <div className="px-4 py-2.5 bg-[var(--mos-raised)] border border-[var(--mos-border)] text-[var(--mos-text)] rounded-2xl rounded-tl-md text-sm leading-relaxed">
                        <AiResearchMarkdown
                          text={streaming}
                          trailing={<span className="inline-block w-1 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle" data-testid="ai-research-stream-cursor" />}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Gather / disconnect banners */}
              {researchNotice && (
                <div className="flex justify-center" role="status" aria-live="polite">
                  <div className={`text-sm px-4 py-2.5 rounded-xl text-center max-w-md border ${
                    researchNotice.tone === 'danger'
                      ? 'bg-red-500/10 border-red-400/20 text-red-300'
                      : 'bg-amber-400/10 border-amber-400/20 text-amber-100'
                  }`}>
                    {researchNotice.text}
                    <button onClick={() => setResearchNotice(null)} className="ml-2 underline hover:opacity-80">Close</button>
                  </div>
                </div>
              )}

              {/* Error */}
              {urlNotices.length > 0 && (
                <div className="flex justify-center" data-testid="ai-research-url-error">
                  <div className="max-w-md rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-2.5 text-center text-sm text-amber-100" role="status">
                    {urlNotices.map(notice => (
                      <p key={notice} className="leading-5">{notice}</p>
                    ))}
                    <button type="button" onClick={() => setUrlNotices([])} className="mt-1 underline hover:opacity-80">Close</button>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex justify-center">
                  <div className="bg-red-500/10 border border-red-400/20 text-red-300 text-sm px-4 py-2.5 rounded-xl text-center max-w-md">
                    {error}
                    <button onClick={() => setError('')} className="ml-2 underline hover:text-red-200">Dismiss</button>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Composer stays in the column; tall attachment stacks scroll inside it */}
          <div
            data-testid="ai-research-composer"
            className="min-h-0 max-h-80 shrink overflow-y-auto overscroll-contain border-t border-[var(--mos-border)] bg-[var(--mos-bg)] px-4 py-3"
          >
            <div className="max-w-3xl mx-auto">
              {(linkScan.accepted.length > 0 || linkScan.blocked.length > 0 || linkScan.overflow.length > 0 || linkDraftOpen) && (
                <div className="mb-2 space-y-1.5" data-testid="ai-research-context-links">
                  {linkScan.accepted.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {linkScan.accepted.map(item => (
                        <span key={item.url} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-[var(--mos-text)]">
                          <span className="truncate">{item.url.replace(/^https?:\/\//, '')}</span>
                          <button
                            type="button"
                            onClick={() => removeContextUrl(item.raw)}
                            className="text-[var(--mos-text-muted)] hover:text-red-300"
                            title="Remove link"
                            aria-label={`Remove link ${item.url}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {linkScan.blocked.map(item => (
                    <p key={item.url} className="text-[11px] text-amber-200" role="status">
                      Link blocked ({contextUrlBlockReason(item.url) || 'address is not public'}): {item.url}. The question can still be sent without that page.
                    </p>
                  ))}
                  {linkScan.overflow.length > 0 && (
                    <p className="text-[11px] text-amber-200" role="status">
                      Only the first {AI_RESEARCH_MAX_CONTEXT_URLS} links are fetched. Skipped: {linkScan.overflow.map(item => item.url).join(', ')}
                    </p>
                  )}
                  {linkDraftOpen && (
                    <form
                      className="flex gap-2"
                      onSubmit={event => {
                        event.preventDefault();
                        commitLinkDraft();
                      }}
                    >
                      <input
                        value={linkDraft}
                        onChange={event => setLinkDraft(event.target.value)}
                        placeholder="https://..."
                        aria-label="Link for context"
                        className="min-h-8 flex-1 rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2.5 text-[12px] text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
                      />
                      <button type="submit" className="rounded-lg bg-indigo-600 px-2.5 text-[11px] font-medium text-white hover:bg-indigo-500">
                        Tambah
                      </button>
                    </form>
                  )}
                </div>
              )}
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label="Research mode"
                    data-testid="ai-research-mode-toggle"
                    className="inline-flex rounded-xl border border-[var(--mos-border)] bg-[var(--mos-raised)] p-0.5"
                  >
                    {([
                      ['fast', 'Fast'],
                      ['deep', 'Deep'],
                    ] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={researchMode === mode}
                        disabled={loading}
                        onClick={() => selectResearchMode(mode)}
                        className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                          researchMode === mode
                            ? 'bg-indigo-600 text-white'
                            : 'text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    data-testid="ai-research-compare-toggle"
                    aria-pressed={compareMode}
                    disabled={loading}
                    onClick={() => setCompareMode(open => !open)}
                    className={`rounded-xl border px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                      compareMode
                        ? 'border-indigo-400/40 bg-indigo-600 text-white'
                        : 'border-[var(--mos-border)] bg-[var(--mos-raised)] text-[var(--mos-text-muted)] hover:text-[var(--mos-text)]'
                    }`}
                  >
                    Compare
                  </button>
                </div>
                <p className="text-[10px] text-[var(--mos-text-muted)]">
                  {compareMode
                    ? 'Compare uses fast research for both sides. Prices and facts come only from sources.'
                    : researchMode === 'deep'
                      ? 'Deep: several search rounds, then a synthesis. Takes longer.'
                      : 'Fast: one research pass.'}
                </p>
              </div>
              {compareMode && (
                <div className="mb-2 grid gap-2 sm:grid-cols-2" data-testid="ai-research-compare-fields">
                  <input
                    value={compareA}
                    onChange={event => setCompareA(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    disabled={loading}
                    placeholder="Entity / claim A"
                    aria-label="Entity or claim A"
                    className="min-h-9 rounded-xl border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-sm text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
                  />
                  <input
                    value={compareB}
                    onChange={event => setCompareB(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    disabled={loading}
                    placeholder="Entity / claim B"
                    aria-label="Entity or claim B"
                    className="min-h-9 rounded-xl border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-sm text-[var(--mos-text)] outline-none focus:border-indigo-400/60"
                  />
                </div>
              )}
              {pendingAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pendingAttachments.map(item => (
                    item.kind === 'image' && item.previewUrl ? (
                      <div key={item.id} className="relative">
                        <img
                          src={item.previewUrl}
                          alt={item.file.name}
                          className="h-16 w-16 rounded-lg border border-[var(--mos-border)] object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removePendingAttachment(item.id)}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] text-white"
                          title={`Remove ${item.file.name}`}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <AiResearchFileChip
                        key={item.id}
                        name={item.file.name}
                        onRemove={() => removePendingAttachment(item.id)}
                      />
                    )
                  ))}
                </div>
              )}
              {voiceStatus && (
                <p
                  role="status"
                  data-testid="ai-research-voice-status"
                  className="mb-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-100"
                >
                  {voiceStatus}
                </p>
              )}
              <div className={`flex gap-2 items-end bg-[var(--mos-raised)] border rounded-2xl px-3 py-3 transition-all ${
                fileDragActive
                  ? 'border-indigo-400 ring-2 ring-indigo-400/40'
                  : 'border-[var(--mos-border)] focus-within:border-indigo-400/60 focus-within:ring-1 focus-within:ring-indigo-400/30'
              }`}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={AI_RESEARCH_FILE_PICKER_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={e => {
                    if (e.target.files) addAttachments(e.target.files);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] disabled:opacity-30 p-2 rounded-xl transition-colors flex-shrink-0"
                  title="Attach images, spreadsheets, PDF, Word, or PowerPoint"
                  aria-label="Attach images, spreadsheets, PDF, Word, or PowerPoint"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 8.25l-10.94 10.939a1.5 1.5 0 01-2.121-2.121l8.485-8.486" />
                  </svg>
                </button>
                <AiResearchCameraButton
                  disabled={loading}
                  onCapture={file => addAttachments([file])}
                  onError={message => setError(message)}
                />
                <button
                  type="button"
                  onClick={() => setLinkDraftOpen(open => !open)}
                  disabled={loading}
                  className="text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] disabled:opacity-30 p-2 rounded-xl transition-colors flex-shrink-0"
                  title="Add a link as context"
                  aria-label="Add a link as context"
                  aria-expanded={linkDraftOpen}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.81 15.312a4.5 4.5 0 01-1.242-7.244l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757" />
                  </svg>
                </button>
                <AiResearchVoiceButton disabled={loading} onTranscript={applyVoiceTranscript} onStatus={setVoiceStatus} />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={autoResize}
                  onKeyDown={handleKeyDown}
                  onPaste={handleComposerPaste}
                  placeholder={compareMode
                    ? 'Comparison focus (optional) — for example price, regulation, or risk'
                    : 'Ask anything — drag, paste, or click to attach an image, Excel, CSV, PDF, Word, or PowerPoint file... Paste an http(s) link to use it as context.'}
                  disabled={loading}
                  rows={1}
                  className="flex-1 min-h-[24px] max-h-[160px] resize-none bg-transparent border-none text-sm text-[var(--mos-text)] placeholder-[var(--mos-text-muted)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => { void sendMessage(); }}
                  disabled={!canSend}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white p-2 rounded-xl transition-colors flex-shrink-0"
                  title="Send message"
                >
                  {loading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  )}
                </button>
              </div>
              <p className="text-[9px] text-[var(--mos-text-faint)] text-center mt-2">
                {AI_RESEARCH_ASSISTANT_NAME} may produce inaccurate information. Enter to send · Shift+Enter for a new line · The mic uses the browser Web Speech API (id-ID, or English if id-ID is not supported; Chrome, Edge, Safari). Drag, paste, or click the icon for images, Excel/CSV, PDF, Word, and PowerPoint (max 4 of each). The camera button takes a photo and attaches it. Paste http(s) links, up to {AI_RESEARCH_MAX_CONTEXT_URLS} per message.
              </p>
            </div>
          </div>
        </div>
        <AiResearchWatchPanel open={watchOpen} seed={watchSeed} onClose={() => setWatchOpen(false)} />
        <AiResearchSourcesPanel
          open={sourcesPanelOpen}
          onClose={() => setSourcesPanelOpen(false)}
          sources={inspectorSources}
          grounding={groundingStatus}
          pinnedUrls={pinnedSourceUrls}
          onTogglePin={togglePinnedSource}
          loading={loading}
        />
      </div>
      <style>{`
        .ai-research-typing-dots {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 12px;
        }
        .ai-research-typing-dots span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--mos-accent-soft);
          opacity: 0.28;
          animation: ai-research-typing 1.05s infinite ease-in-out;
        }
        .ai-research-typing-dots span:nth-child(2) { animation-delay: 0.16s; }
        .ai-research-typing-dots span:nth-child(3) { animation-delay: 0.32s; }
        @keyframes ai-research-typing {
          0%, 80%, 100% { opacity: 0.28; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
}
