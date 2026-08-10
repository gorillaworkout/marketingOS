'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
  messageCount: number;
}

interface ModelOption { id: string; name: string; tier: string; provider: string }

export default function AIResearchPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [error, setError] = useState('');
  const [model, setModel] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [allowedModels, setAllowedModels] = useState<ModelOption[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ---- Data loading (keep same logic) ----
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
    if (!activeConvoId) { setMessages([]); setModel(''); return; }
    fetch(`/api/ai-research/chat?id=${activeConvoId}`)
      .then(res => res.json())
      .then(data => { setMessages(data.messages || []); setModel(data.model || ''); })
      .catch(() => setError('Failed to load conversation'));
  }, [activeConvoId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setError('');
    const userMsg: Message = { role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setStreaming('');
    setLoading(true);

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
          const d = JSON.parse(t.slice(6));
          if (d.type === 'token') { content += d.content; setStreaming(content); }
          else if (d.type === 'done') {
            setStreaming('');
            setMessages(prev => [...prev, { role: 'assistant', content }]);
            if (d.conversationId && !activeConvoId) setActiveConvoId(d.conversationId);
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

  // Auto-resize textarea
  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const currentModelName = allowedModels.find(m => m.id === currentModel)?.name || 'Gemini 3 Flash Agent';

  // ---- RENDER ----
  return (
    <div className="h-[calc(100vh-64px)] flex flex-col bg-[var(--mos-bg)]">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--mos-border)] bg-[var(--mos-bg)] flex-shrink-0">
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

        <select
          value={currentModel}
          disabled={savingModel}
          onChange={e => saveModelPreference(e.target.value)}
          className="ml-auto min-h-7 rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2 py-1 text-[11px] text-[var(--mos-text)] outline-none focus:border-indigo-400/60 max-w-[160px] truncate"
        >
          {allowedModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

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
                    Ask anything — riset topik trading, analisis berita, strategi marketing, atau sekadar brainstorming ide.
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
                    {/* Avatar */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-emerald-600'}`}>
                      {msg.role === 'user'
                        ? <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
                        : <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                      }
                    </div>
                    {/* Bubble */}
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[var(--mos-text-muted)] mb-1 px-1">
                        {msg.role === 'user' ? 'You' : 'GorillaWorkout AI'}
                      </p>
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
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
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
              <div className="flex gap-3 items-end bg-[var(--mos-raised)] border border-[var(--mos-border)] rounded-2xl px-4 py-3 focus-within:border-indigo-400/60 focus-within:ring-1 focus-within:ring-indigo-400/30 transition-all">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={autoResize}
                  onKeyDown={handleKeyDown}
                  placeholder="Tanyakan apapun..."
                  disabled={loading}
                  rows={1}
                  className="flex-1 min-h-[24px] max-h-[160px] resize-none bg-transparent border-none text-sm text-[var(--mos-text)] placeholder-[var(--mos-text-muted)] focus:outline-none"
                />
                <button
                  onClick={sendMessage}
                  disabled={loading || !input.trim()}
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
                GorillaWorkout AI may produce inaccurate information. Enter to send · Shift+Enter for newline.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
