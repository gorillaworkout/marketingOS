'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

interface User {
  id: string;
  username: string;
  name: string;
  role: string;
  enabledFeatures: string[];
}

interface ModelInfo {
  id: string;
  name: string;
  tier: 'budget' | 'balanced' | 'premium';
  provider: 'openrouter' | 'codex' | 'claude-code' | 'gorillaworkout';
  inputPrice: number;
  outputPrice: number;
}

const providerLabels: Record<string, { icon: string; label: string; badgeColor: string }> = {
  openrouter: { icon: '📡', label: 'OpenRouter', badgeColor: 'bg-purple-500/20 text-purple-400' },
  codex: { icon: '🤖', label: 'Codex (ChatGPT Plus)', badgeColor: 'bg-emerald-500/20 text-emerald-400' },
  'claude-code': { icon: '🟠', label: 'Claude Code (Claude subscription)', badgeColor: 'bg-orange-500/20 text-orange-400' },
  gorillaworkout: { icon: '🦍', label: 'GorillaWorkout LLM API', badgeColor: 'bg-cyan-500/20 text-cyan-300' },
};

const tierColors: Record<string, { dot: string; bg: string; text: string }> = {
  budget: { dot: 'bg-green-400', bg: 'bg-green-500/15', text: 'text-green-400' },
  balanced: { dot: 'bg-yellow-400', bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  premium: { dot: 'bg-red-400', bg: 'bg-red-500/15', text: 'text-red-400' },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentModel, setCurrentModel] = useState<string>('deepseek/deepseek-v4-flash');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [taskModelPreferences, setTaskModelPreferences] = useState<Record<string, string>>({});
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check' }),
    }).then(async res => {
      const data = await res.json();
      if (data.authenticated) {
        setUser(data.user);
        const generationFeature = pathname.split('/').pop() || '';
        const adminOnlyPages = ['/dashboard/tokens', '/dashboard/analytics', '/dashboard/accounts', '/dashboard/templates', '/dashboard/calendar', '/dashboard/images', '/dashboard/knowledge', '/dashboard/knowledge-graph', '/dashboard/brand-guidelines', '/dashboard/history', '/dashboard/sop', '/dashboard/market-research'];
        if (data.user.role !== 'admin' && (adminOnlyPages.includes(pathname) || (['social-post', 'video-script', 'event-plan'].includes(generationFeature) && !data.user.enabledFeatures?.includes(generationFeature)))) {
          router.replace('/dashboard');
        }
      } else {
        router.push('/');
      }
      setLoading(false);
    });
  }, [router, pathname]);

  useEffect(() => {
    fetch('/api/settings/model').then(async res => {
      const data = await res.json();
      if (data.models) {
        setCurrentModel(data.currentModel);
        setModels(data.models);
        if (data.taskModelPreferences) {
          setTaskModelPreferences(data.taskModelPreferences);
        }
      }
    });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    router.push('/');
  };

  const handleModelSelect = async (modelId: string) => {
    setModelDropdownOpen(false);
    if (modelId === currentModel) return;
    const res = await fetch('/api/settings/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId }),
    });
    if (res.ok) {
      setCurrentModel(modelId);
    }
  };

  const handleTaskModelSelect = async (taskType: string, modelId: string) => {
    const res = await fetch('/api/settings/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, taskType }),
    });
    if (res.ok) {
      setTaskModelPreferences(prev => ({ ...prev, [taskType]: modelId }));
      setExpandedTask(null);
    }
  };

  const taskTypes = [
    { key: 'caption', label: 'Caption', icon: '📝' },
    { key: 'image-prompt', label: 'Image Prompt', icon: '🎨' },
    { key: 'video-script', label: 'Video Script', icon: '🎬' },
    { key: 'event-plan', label: 'Event Plan', icon: '📋' },
  ];

  const currentModelInfo = models.find(m => m.id === currentModel);
  const currentTier = currentModelInfo?.tier || 'budget';
  const tc = tierColors[currentTier];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  ];

  const generateItems = [
    { href: '/dashboard/social-post', label: 'Social Post', icon: '📱' },
    { href: '/dashboard/video-script', label: 'Video Script', icon: '🎬' },
    { href: '/dashboard/event-plan', label: 'Event Plan', icon: '📋' },
    { href: '/dashboard/sop', label: 'Article Market News', icon: '📰', adminOnly: true },
    { href: '/dashboard/market-research', label: 'Market Research', icon: '🔎', adminOnly: true },
  ].filter(item => user?.role === 'admin' || (!item.adminOnly && user?.enabledFeatures.includes(item.href.split('/').pop() || '')));

  const resourceItems = [
    { href: '/dashboard/brand-guidelines', label: 'Brand Guidelines', icon: '🏷️' },
    { href: '/dashboard/images', label: 'Image Gallery', icon: '🖼️' },
    { href: '/dashboard/calendar', label: 'Calendar', icon: '📅' },
    { href: '/dashboard/templates', label: 'Templates', icon: '📝' },
    { href: '/dashboard/knowledge', label: 'Knowledge', icon: '📚' },
    { href: '/dashboard/history', label: 'History', icon: '📁' },
  ];

  const adminItems = [
    { href: '/dashboard/knowledge-graph', label: 'Knowledge Graph', icon: '🕸️' },
    { href: '/dashboard/tokens', label: 'Token Usage', icon: '💰' },
    { href: '/dashboard/analytics', label: 'Usage Analytics', icon: '📊' },
    { href: '/dashboard/accounts', label: 'Accounts', icon: '👥' },
    { href: '/dashboard/models', label: 'Models', icon: '🧠' },
  ];

  return (
    <div className="min-h-screen bg-gray-900 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-800/50 border-r border-gray-700/50 flex flex-col">
        <div className="p-6 border-b border-gray-700/50">
          <h1 className="text-xl font-bold text-white">MarketingOS</h1>
          <div className="mt-2">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${tc.bg} ${tc.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${tc.dot}`}></span>
              {currentModelInfo?.name || currentModel}
            </span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}

          {/* Generate Section */}
          <div className="pt-4 pb-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-widest text-gray-500">Generate</p>
          </div>
          {generateItems.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}

          {user?.role === 'admin' && <>
          {/* Resources Section */}
          <div className="pt-4 pb-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-widest text-gray-500">Resources</p>
          </div>
          {resourceItems.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}

          {/* Admin Section */}
          <div className="pt-4 pb-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-widest text-gray-500">Admin</p>
          </div>
          {adminItems.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/20'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}</>}
        </nav>

        {/* Model Selector */}
        <div className="px-4 pb-2" ref={dropdownRef}>
          <div className="relative">
            <button
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-700/50 border border-gray-600/50 hover:border-gray-500/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full ${tc.dot} flex-shrink-0`}></span>
                <span className="text-xs text-gray-300 truncate">{currentModelInfo?.name || currentModel}</span>
              </div>
              <svg className={`w-3.5 h-3.5 text-gray-500 flex-shrink-0 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {modelDropdownOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50">
                <div className="p-2 border-b border-gray-700">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider px-2">AI Model</p>
                </div>
                <div className="p-1 max-h-64 overflow-y-auto">
                  {(['gorillaworkout', 'codex', 'claude-code', 'openrouter'] as const).map(provider => {
                    const providerModels = models.filter(m => m.provider === provider);
                    if (providerModels.length === 0) return null;
                    const pl = providerLabels[provider];
                    return (
                      <div key={provider}>
                        <div className="px-3 py-1.5 flex items-center gap-1.5">
                          <span className="text-[10px]">{pl.icon}</span>
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">{pl.label}</span>
                        </div>
                        {providerModels.map(m => {
                          const mtc = tierColors[m.tier];
                          const isSelected = m.id === currentModel;
                          const pl2 = providerLabels[m.provider];
                          const includedLabel = m.provider === 'codex'
                            ? 'Via Codex · ChatGPT Plus'
                            : m.provider === 'claude-code'
                              ? 'Via Claude Code · Claude subscription'
                              : m.provider === 'gorillaworkout'
                                ? 'Via llm.gorillaworkout.id'
                                : 'Via OpenRouter';
                          return (
                            <button
                              key={m.id}
                              onClick={() => handleModelSelect(m.id)}
                              className={`w-full text-left px-3 py-2 rounded-md flex items-start gap-2 transition-colors ${
                                isSelected ? 'bg-blue-600/20' : 'hover:bg-gray-700/50'
                              }`}
                            >
                              <span className={`w-2 h-2 rounded-full ${mtc.dot} flex-shrink-0 mt-1.5`}></span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className={`text-sm ${isSelected ? 'text-blue-400' : 'text-gray-200'}`}>{m.name}</span>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${pl2.badgeColor}`}>{pl2.label.split(' ')[0]}</span>
                                    {isSelected && <span className="text-blue-400 text-xs">✓</span>}
                                  </div>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-0.5">
                                  {m.inputPrice === 0 && m.outputPrice === 0
                                    ? <span className="text-emerald-400">{includedLabel} · <span className={mtc.text}>{m.tier}</span></span>
                                    : <>${(m.inputPrice * 1_000_000).toFixed(2)}/${(m.outputPrice * 1_000_000).toFixed(2)} per 1M tokens · <span className={mtc.text}>{m.tier}</span></>
                                  }
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                {/* Per-task model overrides */}
                <div className="p-2 border-t border-gray-700">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider px-2 mb-1">Per-Task Override</p>
                  {taskTypes.map(tt => {
                    const taskModel = taskModelPreferences[tt.key];
                    const taskModelInfo = models.find(m => m.id === taskModel);
                    const isExpanded = expandedTask === tt.key;
                    return (
                      <div key={tt.key} className="mb-0.5">
                        <button
                          onClick={() => setExpandedTask(isExpanded ? null : tt.key)}
                          className="w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between hover:bg-gray-700/50 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs">{tt.icon}</span>
                            <span className="text-[11px] text-gray-400">{tt.label}</span>
                          </div>
                          <span className="text-[10px] text-gray-500 truncate max-w-[100px]">
                            {taskModelInfo?.name || <span className="italic">default</span>}
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="ml-4 mt-0.5 mb-1 space-y-0.5 max-h-32 overflow-y-auto">
                            <button
                              onClick={() => {
                                setTaskModelPreferences(prev => { const n = { ...prev }; delete n[tt.key]; return n; });
                                // Remove override (will use global default)
                                fetch('/api/settings/model', {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ model: currentModel, taskType: tt.key }),
                                }).then(() => setExpandedTask(null));
                              }}
                              className="w-full text-left px-2 py-1 rounded text-[11px] text-gray-500 hover:text-gray-300 hover:bg-gray-700/30"
                            >
                              ↩ Use default
                            </button>
                            {models.map(m => {
                              const isSelected = m.id === taskModel;
                              return (
                                <button
                                  key={m.id}
                                  onClick={() => handleTaskModelSelect(tt.key, m.id)}
                                  className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center gap-1.5 ${
                                    isSelected ? 'text-blue-400 bg-blue-600/10' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
                                  }`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${tierColors[m.tier].dot}`}></span>
                                  <span className="truncate">{m.name}</span>
                                  <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full ${providerLabels[m.provider].badgeColor}`}>
                                    {m.provider === 'gorillaworkout' ? 'LLM API' : m.provider === 'claude-code' ? 'Claude' : m.provider === 'codex' ? 'Codex' : 'OpenRouter'}
                                  </span>
                                  {isSelected && <span>✓</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* User info */}
        <div className="p-4 border-t border-gray-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-medium text-white">
                {user?.name?.charAt(0) || '?'}
              </div>
              <div>
                <p className="text-sm text-white">{user?.name}</p>
                <p className="text-xs text-gray-500">{user?.role}</p>
              </div>
            </div>
            <button onClick={handleLogout} className="text-gray-500 hover:text-white text-sm">
              ⏻
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
