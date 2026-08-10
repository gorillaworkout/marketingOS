'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, Panel, PageHeader, PageStack, StatusBadge } from '@/components/ui/dashboard';
import InlineModelSelector from '@/components/InlineModelSelector';

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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-research/chat');
      if (!res.ok) throw new Error('Failed to load conversations');
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch (e) {
      console.error('Load conversations error:', e);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load active conversation
  useEffect(() => {
    if (!activeConvoId) { setMessages([]); setModel(''); return; }
    fetch(`/api/ai-research/chat?id=${activeConvoId}`)
      .then(res => res.json())
      .then(data => {
        setMessages(data.messages || []);
        setModel(data.model || '');
      })
      .catch(() => setError('Failed to load conversation'));
  }, [activeConvoId]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Send message
  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setError('');
    const userMsg: Message = { role: 'user', content: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai-research/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [userMsg],
          conversationId: activeConvoId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = JSON.parse(trimmed.slice(6));

          if (data.type === 'token') {
            assistantContent += data.content;
            setStreaming(assistantContent);
          } else if (data.type === 'done') {
            setStreaming('');
            setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);
            if (data.conversationId && !activeConvoId) {
              setActiveConvoId(data.conversationId);
            }
            setModel(data.model || model);
            loadConversations();
          } else if (data.type === 'error') {
            throw new Error(data.error);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
      setStreaming('');
    } finally {
      setLoading(false);
    }
  };

  // New conversation
  const newConversation = () => {
    setActiveConvoId(null);
    setMessages([]);
    setStreaming('');
    setError('');
    setModel('');
    inputRef.current?.focus();
  };

  // Delete conversation
  const deleteConversation = async (id: string) => {
    try {
      await fetch(`/api/ai-research/chat?id=${id}`, { method: 'DELETE' });
      if (activeConvoId === id) newConversation();
      loadConversations();
    } catch {
      setError('Failed to delete conversation');
    }
  };

  // Handle Enter key (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <PageStack>
      <PageHeader
        eyebrow="AI Research"
        title="AI Research Assistant"
        description="Ask questions, research topics, analyze data — powered by GorillaWorkout LLM"
        actions={<InlineModelSelector feature="ai-research" />}
      />

      <div className="flex gap-0 min-h-[calc(100vh-220px)]">
        {/* Sidebar - Conversations */}
        <div className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-200 overflow-hidden border-r border-[var(--mos-border)] flex-shrink-0`}>
          <div className="p-3">
            <button
              onClick={newConversation}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              + New Conversation
            </button>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`group px-3 py-2.5 cursor-pointer border-b border-[var(--mos-border-subtle)] transition-colors ${
                  activeConvoId === conv.id
                    ? 'bg-indigo-600/10 border-l-2 border-l-indigo-500'
                    : 'hover:bg-[var(--mos-hover)] border-l-2 border-l-transparent'
                }`}
                onClick={() => setActiveConvoId(conv.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--mos-text)] truncate">{conv.title}</p>
                    <p className="text-[10px] text-[var(--mos-text-muted)] mt-0.5">
                      {conv.messageCount} messages · {new Date(conv.updatedAt).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 text-[var(--mos-text-muted)] hover:text-red-400 p-1 transition-all"
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-[var(--mos-text-muted)] text-center py-8 px-4">
                No conversations yet. Start a new one!
              </p>
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toggle sidebar + model info bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--mos-border)] bg-[var(--mos-bg)]">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] p-1"
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            {model && (
              <StatusBadge tone="info">{model.replace('ag/', '').replace('cc/', '')}</StatusBadge>
            )}
            <div className="w-5" />{/* Spacer for centering */}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6" style={{ maxHeight: 'calc(100vh - 380px)' }}>
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-[var(--mos-text)] mb-2">AI Research Assistant</h3>
                <p className="text-sm text-[var(--mos-text-muted)] max-w-md">
                  Ask anything — riset topik trading, analisis berita, strategi marketing, atau sekadar brainstorming ide.
                </p>
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg">
                  {[
                    'What are the key factors affecting gold prices today?',
                    'Buatkan strategi konten Instagram untuk broker forex',
                    'Analisis sentimen pasar setelah Fed rate decision',
                    'Explain the impact of OPEC+ decisions on crude oil',
                  ].map(suggestion => (
                    <button
                      key={suggestion}
                      onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                      className="text-left text-xs text-[var(--mos-text-muted)] hover:text-[var(--mos-text)] bg-[var(--mos-raised)] hover:bg-[var(--mos-hover)] border border-[var(--mos-border)] rounded-lg px-3 py-2.5 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] sm:max-w-[70%]`}>
                  <div className={`flex items-center gap-2 mb-1 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--mos-text-muted)]">
                      {msg.role === 'user' ? 'You' : 'GorillaWorkout AI'}
                    </span>
                  </div>
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-md'
                        : 'bg-[var(--mos-raised)] border border-[var(--mos-border)] text-[var(--mos-text)] rounded-bl-md'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}

            {/* Streaming message */}
            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] sm:max-w-[70%]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--mos-text-muted)]">
                      GorillaWorkout AI
                    </span>
                    <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  </div>
                  <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-[var(--mos-raised)] border border-[var(--mos-border)] text-[var(--mos-text)] text-sm leading-relaxed whitespace-pre-wrap">
                    {streaming}
                    <span className="inline-block w-1 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                  </div>
                </div>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="flex justify-center">
                <div className="bg-red-500/10 border border-red-400/20 text-red-300 text-sm px-4 py-2 rounded-lg max-w-md text-center">
                  {error}
                  <button onClick={() => setError('')} className="ml-2 underline hover:text-red-200">Dismiss</button>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-[var(--mos-border)] px-4 py-3 bg-[var(--mos-bg)]">
            <div className="max-w-4xl mx-auto">
              <div className="flex gap-3 items-end">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Tanyakan apapun — riset, analisis, strategi..."
                  disabled={loading}
                  className="flex-1 min-h-[48px] max-h-[120px] resize-none bg-[var(--mos-raised)] border border-[var(--mos-border)] rounded-xl px-4 py-3 text-sm text-[var(--mos-text)] placeholder-[var(--mos-text-muted)] focus:outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30"
                  rows={2}
                />
                <button
                  onClick={sendMessage}
                  disabled={loading || !input.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white p-3 rounded-xl transition-colors flex-shrink-0"
                >
                  {loading ? (
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  )}
                </button>
              </div>
              <p className="text-[10px] text-[var(--mos-text-faint)] mt-2 text-center">
                Enter to send · Shift+Enter for newline · GorillaWorkout AI may produce inaccurate information
              </p>
            </div>
          </div>
        </div>
      </div>

    </PageStack>
  );
}
