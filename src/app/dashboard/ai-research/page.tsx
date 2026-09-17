'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  AI_RESEARCH_ALLOWED_IMAGE_TYPES,
  AI_RESEARCH_IMAGE_ONLY_PROMPT,
  AI_RESEARCH_MAX_IMAGE_BYTES,
  AI_RESEARCH_MAX_IMAGES,
  AI_RESEARCH_MAX_TOTAL_IMAGE_BYTES,
} from '@/lib/ai-research';

interface ChatImage {
  mimeType: string;
  dataUrl: string;
  name?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
}

interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
  messageCount: number;
}

interface ModelOption { id: string; name: string; tier: string; provider: string }

interface ModelHealthResult {
  model: string;
  name: string;
  status: 'ok' | 'fail';
  httpStatus: number | null;
  error: string | null;
  checkedAt: string;
  latencyMs: number;
}

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
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
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [error, setError] = useState('');
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextLoadRef = useRef(false);

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
      pendingImages.forEach(image => URL.revokeObjectURL(image.previewUrl));
    };
  }, [pendingImages]);

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

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-research/chat');
      if (res.ok) { const data = await res.json(); setConversations(data.conversations || []); }
    } catch {}
  }, []);

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
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load conversation');
      });
    return () => { cancelled = true; };
  }, [activeConvoId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const clearPendingImages = () => {
    setPendingImages(prev => {
      prev.forEach(image => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addImages = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (!incoming.length) return;

    setError('');
    setPendingImages(prev => {
      const next = [...prev];
      for (const file of incoming) {
        if (!AI_RESEARCH_ALLOWED_IMAGE_TYPES.includes(file.type as typeof AI_RESEARCH_ALLOWED_IMAGE_TYPES[number])) {
          setError('Unsupported image type. Use JPEG, PNG, WebP, or GIF.');
          continue;
        }
        if (file.size > AI_RESEARCH_MAX_IMAGE_BYTES) {
          setError(`${file.name} is larger than 4 MB.`);
          continue;
        }
        if (next.length >= AI_RESEARCH_MAX_IMAGES) {
          setError(`You can attach up to ${AI_RESEARCH_MAX_IMAGES} images per message.`);
          break;
        }
        const total = next.reduce((sum, item) => sum + item.file.size, 0) + file.size;
        if (total > AI_RESEARCH_MAX_TOTAL_IMAGE_BYTES) {
          setError('Attached images exceed the 6 MB total limit.');
          break;
        }
        next.push({ id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`, file, previewUrl: URL.createObjectURL(file) });
      }
      return next;
    });
  };

  const removePendingImage = (id: string) => {
    setPendingImages(prev => {
      const target = prev.find(image => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(image => image.id !== id);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if ((!trimmed && pendingImages.length === 0) || loading) return;
    setError('');

    let images: ChatImage[] = [];
    try {
      images = await Promise.all(pendingImages.map(item => fileToChatImage(item.file)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the attached image');
      return;
    }

    const userMsg: Message = {
      role: 'user',
      content: trimmed || AI_RESEARCH_IMAGE_ONLY_PROMPT,
      images: images.length ? images : undefined,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    clearPendingImages();
    setStreaming('');
    setLoading(true);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    try {
      const res = await fetch('/api/ai-research/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [userMsg], conversationId: activeConvoId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Server error (${res.status})`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '', content = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data: ')) continue;
          let d: { type?: string; content?: string; conversationId?: string; model?: string; error?: string };
          try { d = JSON.parse(t.slice(6)); } catch { continue; }
          if (d.type === 'start') {
            if (d.conversationId && !activeConvoId) {
              skipNextLoadRef.current = true;
              setActiveConvoId(d.conversationId);
            }
            if (d.model) setModel(d.model);
            loadConversations();
          } else if (d.type === 'token') { content += d.content || ''; setStreaming(content); }
          else if (d.type === 'done') {
            setStreaming('');
            setMessages(prev => [...prev, { role: 'assistant', content }]);
            if (d.conversationId && !activeConvoId) {
              skipNextLoadRef.current = true;
              setActiveConvoId(d.conversationId);
            }
            setModel(d.model || model);
            loadConversations();
          } else if (d.type === 'error') throw new Error(d.error);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
      setStreaming('');
    } finally { setLoading(false); }
  };

  const newConversation = () => {
    setActiveConvoId(null); setMessages([]); setStreaming(''); setError(''); setModel('');
    clearPendingImages();
    setTimeout(() => inputRef.current?.focus(), 50);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const deleteConversation = async (id: string) => {
    try { await fetch(`/api/ai-research/chat?id=${id}`, { method: 'DELETE' }); if (activeConvoId === id) newConversation(); loadConversations(); }
    catch { setError('Failed to delete conversation'); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const canSend = !loading && Boolean(input.trim() || pendingImages.length);
  const selectedModelId = currentModel || defaultModel;
  const selectedHealth = healthResults?.find(result => result.model === selectedModelId);
  const failCount = healthResults?.filter(result => result.status === 'fail').length || 0;
  const lastCheckedAt = healthResults?.[0]?.checkedAt;
  const healthBadgeLabel = healthChecking
    ? 'Checking'
    : !healthResults
      ? null
      : failCount === 0
        ? 'OK'
        : failCount === healthResults.length
          ? 'FAIL'
          : `${failCount} FAIL`;
  const healthBadgeTone = healthChecking
    ? 'neutral'
    : !healthResults
      ? 'neutral'
      : failCount === 0
        ? 'success'
        : failCount === healthResults.length
          ? 'danger'
          : 'warning';

  const formatCheckedAt = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col bg-[var(--mos-bg)]">
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
              title={selectedHealth?.error || healthError || 'Show model health details'}
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
              className="absolute right-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] p-2 shadow-lg"
            >
              {healthError && <p className="px-1 py-1 text-[11px] text-red-300">{healthError}</p>}
              {healthResults?.map(result => (
                <div key={result.model} className="flex items-start justify-between gap-2 px-1 py-1.5 border-b border-[var(--mos-border-subtle)] last:border-b-0">
                  <div className="min-w-0">
                    <p className="text-[11px] text-[var(--mos-text)] truncate">{result.name}</p>
                    {result.status === 'fail' && result.error && (
                      <p className="text-[10px] text-red-300 leading-4 mt-0.5">{result.error}{result.httpStatus ? ` · HTTP ${result.httpStatus}` : ''}</p>
                    )}
                  </div>
                  <span className={`flex-shrink-0 text-[10px] font-semibold ${result.status === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>
                    {result.status === 'ok' ? 'OK' : 'FAIL'}
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
          onClick={newConversation}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium py-1.5 px-3 rounded-lg transition-colors flex-shrink-0"
        >
          + New
        </button>
      </div>

      {/* Main area: sidebar + chat */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <div className={`${sidebarOpen ? 'w-60' : 'w-0'} transition-all duration-200 overflow-hidden border-r border-[var(--mos-border)] flex-shrink-0 bg-[var(--mos-bg)] flex flex-col`}>
          <div className="p-3">
            <button
              onClick={newConversation}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium py-2 rounded-lg transition-colors"
            >
              + New Conversation
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
            {conversations.map(conv => (
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
            {conversations.length === 0 && (
              <p className="text-[10px] text-[var(--mos-text-muted)] text-center py-8 px-3">No conversations yet</p>
            )}
          </div>
        </div>

        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages — only this scrolls */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
              {/* Empty state */}
              {messages.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center pt-12 sm:pt-20 pb-8 text-center">
                  <div className="w-14 h-14 rounded-full bg-indigo-600/10 flex items-center justify-center mb-5">
                    <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-semibold text-[var(--mos-text)] mb-2">GorillaWorkout AI</h2>
                  <p className="text-sm text-[var(--mos-text-muted)] max-w-md">
                    Ask anything — riset topik trading, analisis berita, strategi marketing, atau lampirkan gambar untuk dibaca AI.
                  </p>
                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                    {[
                      'What affects gold prices today?',
                      'Buatkan strategi konten Instagram untuk broker forex',
                      'Analisis sentimen pasar setelah Fed rate decision',
                      'Impact of OPEC+ on crude oil prices',
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
                      <p className="text-[10px] font-semibold text-[var(--mos-text-muted)] mb-1 px-1">
                        {msg.role === 'user' ? 'You' : 'GorillaWorkout AI'}
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
                      <div className={`px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-md'
                          : 'bg-[var(--mos-raised)] border border-[var(--mos-border)] text-[var(--mos-text)] rounded-2xl rounded-tl-md'
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Streaming indicator */}
              {streaming && (
                <div className="flex justify-start">
                  <div className="flex gap-3 max-w-[85%] sm:max-w-[75%]">
                    <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09z" /></svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[var(--mos-text-muted)] mb-1 px-1 flex items-center gap-2">
                        GorillaWorkout AI
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      </p>
                      <div className="px-4 py-2.5 bg-[var(--mos-raised)] border border-[var(--mos-border)] text-[var(--mos-text)] rounded-2xl rounded-tl-md text-sm leading-relaxed whitespace-pre-wrap">
                        {streaming}
                        <span className="inline-block w-1 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex justify-center">
                  <div className="bg-red-500/10 border border-red-400/20 text-red-300 text-sm px-4 py-2.5 rounded-xl text-center max-w-md">
                    {error}
                    <button onClick={() => setError('')} className="ml-2 underline hover:text-red-200">Dismiss</button>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Input — sticky at bottom */}
          <div className="flex-shrink-0 border-t border-[var(--mos-border)] bg-[var(--mos-bg)] px-4 py-3">
            <div className="max-w-3xl mx-auto">
              {pendingImages.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pendingImages.map(image => (
                    <div key={image.id} className="relative">
                      <img
                        src={image.previewUrl}
                        alt={image.file.name}
                        className="h-16 w-16 rounded-lg border border-[var(--mos-border)] object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePendingImage(image.id)}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] text-white"
                        title={`Remove ${image.file.name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end bg-[var(--mos-raised)] border border-[var(--mos-border)] rounded-2xl px-3 py-3 focus-within:border-indigo-400/60 focus-within:ring-1 focus-within:ring-indigo-400/30 transition-all">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={AI_RESEARCH_ALLOWED_IMAGE_TYPES.join(',')}
                  multiple
                  className="hidden"
                  onChange={e => {
                    if (e.target.files) addImages(e.target.files);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] disabled:opacity-30 p-2 rounded-xl transition-colors flex-shrink-0"
                  title="Attach images"
                  aria-label="Attach images"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 8.25l-10.94 10.939a1.5 1.5 0 01-2.121-2.121l8.485-8.486" />
                  </svg>
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={autoResize}
                  onKeyDown={handleKeyDown}
                  placeholder="Tanyakan apapun atau lampirkan gambar..."
                  disabled={loading}
                  rows={1}
                  className="flex-1 min-h-[24px] max-h-[160px] resize-none bg-transparent border-none text-sm text-[var(--mos-text)] placeholder-[var(--mos-text-muted)] focus:outline-none"
                />
                <button
                  onClick={sendMessage}
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
                GorillaWorkout AI may produce inaccurate information. Enter to send · Shift+Enter for newline · JPEG/PNG/WebP/GIF up to 4 images.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
