'use client';
import { useState, useEffect, useCallback } from 'react';

interface KnowledgeEntry {
  id: string;
  task_type: string;
  brief: string;
  selected_output: string;
  style_cluster: string;
  platform: string;
  audience: string;
  quality_score: number;
  created_at: string;
}

interface StylePreference {
  total_selections: number;
  style_summary: string;
}

interface GraphCluster {
  name: string;
  count: number;
}

interface TimelineBucket {
  date: string;
  bold: number;
  professional: number;
  creative: number;
  unclassified: number;
}

interface SearchResult {
  id: string;
  brief: string;
  selectedOutput: string;
  taskType: string;
  platform: string | null;
  similarity: number;
  styleCluster: string | null;
}

export default function KnowledgePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [stylePrefs, setStylePrefs] = useState<StylePreference | null>(null);
  const [clusters, setClusters] = useState<GraphCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'analytics' | 'entries' | 'search'>('analytics');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetch-on-mount pattern used across all dashboard pages
  const fetchData = useCallback(async () => {
    try {
      const [entriesRes, graphRes] = await Promise.all([
        fetch('/api/knowledge'),
        fetch('/api/knowledge/graph?limit=200'),
      ]);
      const entriesData = await entriesRes.json();
      const graphData = await graphRes.json();
      if (entriesData.entries) setEntries(entriesData.entries);
      if (entriesData.stylePreferences) setStylePrefs(entriesData.stylePreferences);
      if (graphData.clusters) setClusters(graphData.clusters);
    } catch (e) {
      console.error('Failed to load knowledge data', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Semantic Search ---
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      setSearchError('');
      return;
    }
    setSearchLoading(true);
    setSearchError('');
    try {
      const res = await fetch('/api/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit: 15 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      setSearchResults(data.results || []);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed');
      setSearchResults(null);
    }
    setSearchLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  // Debounced search — only fire when query is non-empty and tab is search
  useEffect(() => {
    if (activeTab !== 'search' || !searchQuery.trim()) return;
    const timer = setTimeout(() => handleSearch(searchQuery), 400);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch, activeTab]);

  const getSimilarityColor = (sim: number) => {
    if (sim >= 0.85) return 'text-green-400 bg-green-500/15 border-green-500/30';
    if (sim >= 0.7) return 'text-blue-400 bg-blue-500/15 border-blue-500/30';
    if (sim >= 0.5) return 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30';
    return 'text-gray-400 bg-gray-500/15 border-gray-500/30';
  };

  // --- Style Distribution ---
  const styleCounts = {
    bold: entries.filter(e => e.style_cluster === 'bold').length,
    professional: entries.filter(e => e.style_cluster === 'professional').length,
    creative: entries.filter(e => e.style_cluster === 'creative').length,
    unclassified: entries.filter(e => !e.style_cluster || !['bold', 'professional', 'creative'].includes(e.style_cluster)).length,
  };
  const totalStyles = styleCounts.bold + styleCounts.professional + styleCounts.creative + styleCounts.unclassified;

  const styleBars = [
    { label: 'Bold & Catchy', count: styleCounts.bold, color: 'bg-orange-500', textColor: 'text-orange-300', icon: '🔥', pct: totalStyles ? Math.round((styleCounts.bold / totalStyles) * 100) : 0 },
    { label: 'Professional', count: styleCounts.professional, color: 'bg-blue-500', textColor: 'text-blue-300', icon: '💼', pct: totalStyles ? Math.round((styleCounts.professional / totalStyles) * 100) : 0 },
    { label: 'Creative', count: styleCounts.creative, color: 'bg-purple-500', textColor: 'text-purple-300', icon: '✨', pct: totalStyles ? Math.round((styleCounts.creative / totalStyles) * 100) : 0 },
  ].filter(s => s.count > 0 || totalStyles === 0);

  // --- Selection Timeline (last 14 days) ---
  const buildTimeline = (): TimelineBucket[] => {
    const buckets: Record<string, TimelineBucket> = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { date: key, bold: 0, professional: 0, creative: 0, unclassified: 0 };
    }
    for (const entry of entries) {
      const key = entry.created_at?.slice(0, 10);
      if (buckets[key]) {
        const cluster = entry.style_cluster;
        if (cluster === 'bold') buckets[key].bold++;
        else if (cluster === 'professional') buckets[key].professional++;
        else if (cluster === 'creative') buckets[key].creative++;
        else buckets[key].unclassified++;
      }
    }
    return Object.values(buckets);
  };
  const timeline = buildTimeline();
  const maxTimelineVal = Math.max(1, ...timeline.map(t => t.bold + t.professional + t.creative + t.unclassified));

  // --- Top Examples (most recent per style) ---
  const getTopExamples = (style: string, limit: number = 3) => {
    return entries
      .filter(e => e.style_cluster === style)
      .slice(0, limit);
  };

  const parseOutput = (raw: string) => {
    try { return JSON.parse(raw); } catch { return { caption: raw }; }
  };

  // --- Platform distribution ---
  const platformCounts: Record<string, number> = {};
  entries.forEach(e => {
    const p = e.platform || 'Unknown';
    platformCounts[p] = (platformCounts[p] || 0) + 1;
  });
  const platformEntries = Object.entries(platformCounts).sort((a, b) => b[1] - a[1]);

  const getStyleIcon = (style: string) => {
    if (style === 'bold') return '🔥';
    if (style === 'professional') return '💼';
    if (style === 'creative') return '✨';
    return '📌';
  };

  const getStyleGradient = (style: string) => {
    if (style === 'bold') return 'from-orange-600/15 to-red-600/10 border-orange-500/20';
    if (style === 'professional') return 'from-blue-600/15 to-indigo-600/10 border-blue-500/20';
    if (style === 'creative') return 'from-purple-600/15 to-pink-600/10 border-purple-500/20';
    return 'from-gray-700/30 to-gray-800/30 border-gray-600/20';
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">📊 Knowledge Analytics</h1>
          <p className="text-gray-400 mt-1">Style insights, selection patterns & top examples</p>
        </div>
        <button onClick={fetchData} className="px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
          🔄 Refresh
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-800/60 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${activeTab === 'analytics' ? 'bg-blue-600/30 text-blue-300 font-medium' : 'text-gray-400 hover:text-white'}`}
        >
          📈 Analytics
        </button>
        <button
          onClick={() => setActiveTab('entries')}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${activeTab === 'entries' ? 'bg-blue-600/30 text-blue-300 font-medium' : 'text-gray-400 hover:text-white'}`}
        >
          📋 All Entries
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${activeTab === 'search' ? 'bg-blue-600/30 text-blue-300 font-medium' : 'text-gray-400 hover:text-white'}`}
        >
          🔍 Search
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : activeTab === 'analytics' ? (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
              <div className="text-2xl mb-2">📝</div>
              <div className="text-2xl font-bold text-white">{entries.length}</div>
              <div className="text-xs text-gray-400 mt-1">Total Selections</div>
            </div>
            <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
              <div className="text-2xl mb-2">🏷️</div>
              <div className="text-2xl font-bold text-white">{Object.keys(platformCounts).length}</div>
              <div className="text-xs text-gray-400 mt-1">Platforms Used</div>
            </div>
            <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
              <div className="text-2xl mb-2">⭐</div>
              <div className="text-2xl font-bold text-white">
                {stylePrefs?.total_selections || entries.length}
              </div>
              <div className="text-xs text-gray-400 mt-1">Style Profile Score</div>
            </div>
            <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
              <div className="text-2xl mb-2">🔗</div>
              <div className="text-2xl font-bold text-white">{clusters.length}</div>
              <div className="text-xs text-gray-400 mt-1">Style Clusters</div>
            </div>
          </div>

          {/* Style Distribution Chart */}
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <h3 className="text-lg font-semibold text-white mb-1">🎨 Style Distribution</h3>
            <p className="text-xs text-gray-500 mb-5">Your content style preferences across all selections</p>

            {totalStyles === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-lg mb-1">No selections yet</p>
                <p className="text-sm">Generate social posts and pick options to see your style distribution</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Donut-style visual (CSS only) */}
                <div className="flex flex-col md:flex-row items-center gap-8">
                  {/* Donut */}
                  <div className="relative w-40 h-40 flex-shrink-0">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      {(() => {
                        const segments = styleBars.map(s => s.pct);
                        let offset = 0;
                        const colors = ['#f97316', '#3b82f6', '#a855f7'];
                        return segments.map((pct, i) => {
                          const dashArray = `${pct} ${100 - pct}`;
                          const el = (
                            <circle
                              key={i}
                              cx="18" cy="18" r="15.9"
                              fill="none"
                              stroke={colors[i]}
                              strokeWidth="3.5"
                              strokeDasharray={dashArray}
                              strokeDashoffset={`${-offset}`}
                              className="transition-all duration-700"
                            />
                          );
                          offset += pct;
                          return el;
                        });
                      })()}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-white">{totalStyles}</span>
                      <span className="text-xs text-gray-400">total</span>
                    </div>
                  </div>

                  {/* Bar breakdown */}
                  <div className="flex-1 w-full space-y-3">
                    {styleBars.map(bar => (
                      <div key={bar.label}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-sm font-medium ${bar.textColor}`}>{bar.icon} {bar.label}</span>
                          <span className="text-sm text-gray-300 font-mono">{bar.count} <span className="text-gray-500">({bar.pct}%)</span></span>
                        </div>
                        <div className="h-3 bg-gray-700/50 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${bar.color} transition-all duration-700`}
                            style={{ width: `${bar.pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Platform Breakdown */}
                {platformEntries.length > 0 && (
                  <div className="pt-4 mt-4 border-t border-gray-700/30">
                    <h4 className="text-sm font-medium text-gray-300 mb-3">📱 Platform Breakdown</h4>
                    <div className="flex flex-wrap gap-2">
                      {platformEntries.map(([platform, count]) => (
                        <div key={platform} className="flex items-center gap-2 bg-gray-700/30 rounded-lg px-3 py-1.5">
                          <span className="text-sm text-gray-300">{platform}</span>
                          <span className="text-xs bg-gray-600/50 text-gray-400 px-1.5 py-0.5 rounded-full font-mono">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Selection Timeline */}
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <h3 className="text-lg font-semibold text-white mb-1">📅 Selection Timeline</h3>
            <p className="text-xs text-gray-500 mb-5">Daily selection activity over the last 14 days</p>

            {entries.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No timeline data yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Stacked bar chart */}
                <div className="flex items-end gap-1 h-32">
                  {timeline.map((bucket, i) => {
                    const total = bucket.bold + bucket.professional + bucket.creative + bucket.unclassified;
                    const heightPct = (total / maxTimelineVal) * 100;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center group relative">
                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap">
                          <div className="text-white font-medium mb-1">{new Date(bucket.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</div>
                          {bucket.bold > 0 && <div className="text-orange-400">🔥 Bold: {bucket.bold}</div>}
                          {bucket.professional > 0 && <div className="text-blue-400">💼 Professional: {bucket.professional}</div>}
                          {bucket.creative > 0 && <div className="text-purple-400">✨ Creative: {bucket.creative}</div>}
                        </div>
                        {/* Stacked bars */}
                        <div className="w-full flex flex-col-reverse rounded-t-md overflow-hidden" style={{ height: `${Math.max(heightPct, total > 0 ? 8 : 0)}%` }}>
                          {bucket.bold > 0 && <div className="bg-orange-500 w-full" style={{ flex: bucket.bold }} />}
                          {bucket.professional > 0 && <div className="bg-blue-500 w-full" style={{ flex: bucket.professional }} />}
                          {bucket.creative > 0 && <div className="bg-purple-500 w-full" style={{ flex: bucket.creative }} />}
                        </div>
                        {/* Date label (every other) */}
                        {i % 2 === 0 && (
                          <span className="text-[10px] text-gray-600 mt-1">
                            {new Date(bucket.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'numeric' })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Legend */}
                <div className="flex items-center justify-center gap-4 pt-2">
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-orange-500"></div><span className="text-xs text-gray-400">Bold</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-blue-500"></div><span className="text-xs text-gray-400">Professional</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-purple-500"></div><span className="text-xs text-gray-400">Creative</span></div>
                </div>
              </div>
            )}
          </div>

          {/* Top Examples per Style */}
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <h3 className="text-lg font-semibold text-white mb-1">🏆 Top Examples</h3>
            <p className="text-xs text-gray-500 mb-5">Your most recent selections from each style category</p>

            {entries.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-lg mb-1">No examples yet</p>
                <p className="text-sm">Start generating content to build your example library</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {['bold', 'professional', 'creative'].map(style => {
                  const examples = getTopExamples(style);
                  return (
                    <div key={style} className={`bg-gradient-to-br ${getStyleGradient(style)} rounded-xl p-4 border`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-lg">{getStyleIcon(style)}</span>
                        <h4 className="text-sm font-semibold text-white capitalize">{style}</h4>
                        <span className="text-xs text-gray-500 ml-auto">{styleCounts[style as keyof typeof styleCounts]} picks</span>
                      </div>
                      {examples.length === 0 ? (
                        <p className="text-xs text-gray-500 italic">No {style} selections yet</p>
                      ) : (
                        <div className="space-y-2">
                          {examples.map((ex, i) => {
                            const output = parseOutput(ex.selected_output);
                            return (
                              <div key={ex.id} className="bg-black/20 rounded-lg p-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] bg-gray-700/50 text-gray-400 px-1.5 py-0.5 rounded-full">#{i + 1}</span>
                                  {ex.platform && <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full">{ex.platform}</span>}
                                </div>
                                <p className="text-xs text-gray-300 font-medium truncate">{ex.brief}</p>
                                {output.hook && (
                                  <p className="text-xs text-gray-400 mt-1 italic truncate">&quot;{output.hook}&quot;</p>
                                )}
                                <p className="text-[10px] text-gray-600 mt-1">
                                  {new Date(ex.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Style Profile Summary */}
          {stylePrefs?.style_summary && (
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
              <h3 className="text-lg font-semibold text-white mb-1">🎯 Style Profile Summary</h3>
              <p className="text-xs text-gray-500 mb-4">AI-generated summary of your content preferences</p>
              <div className="bg-gray-900/50 rounded-lg p-4 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {stylePrefs.style_summary}
              </div>
            </div>
          )}
        </>
      ) : activeTab === 'search' ? (
        /* Semantic Search Tab */
        <div className="space-y-4">
          {/* Search Input */}
          <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-lg">🔍</span>
              <h3 className="text-sm font-semibold text-white">Semantic Search</h3>
              <span className="text-xs text-gray-500">AI-powered search through your knowledge base</span>
            </div>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by meaning, not just keywords... e.g. 'trading tips for beginners' or 'motivational post about finance'"
                className="w-full px-4 py-3 bg-gray-900/60 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 text-sm"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setSearchResults(null); setSearchError(''); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
            {searchError && (
              <p className="text-xs text-red-400 mt-2">⚠️ {searchError}</p>
            )}
          </div>

          {/* Search Results */}
          {searchQuery.trim() ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">
                  Results for &quot;{searchQuery}&quot;
                  {searchResults && <span className="text-gray-500 ml-2">({searchResults.length} found)</span>}
                </h3>
                {searchResults && searchResults.length > 0 && (
                  <span className="text-xs text-gray-500">Sorted by relevance</span>
                )}
              </div>

              {searchLoading ? (
                <div className="text-center py-16">
                  <div className="inline-block w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-3"></div>
                  <p className="text-gray-500">Searching with AI embeddings...</p>
                  <p className="text-xs text-gray-600 mt-1">Comparing semantic vectors</p>
                </div>
              ) : searchResults && searchResults.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <p className="text-2xl mb-2">🔍</p>
                  <p className="text-lg mb-1">No matches found</p>
                  <p className="text-sm">Try different keywords or broader terms</p>
                </div>
              ) : searchResults ? (
                searchResults.map(result => {
                  let output;
                  try { output = JSON.parse(result.selectedOutput); } catch { output = { caption: result.selectedOutput }; }
                  const simPercent = Math.round(result.similarity * 100);
                  return (
                    <div key={result.id} className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50 hover:border-blue-500/30 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-lg">{getStyleIcon(result.styleCluster || '')}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${getSimilarityColor(result.similarity)}`}>
                              {simPercent}% match
                            </span>
                            {result.styleCluster && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300">
                                {result.styleCluster}
                              </span>
                            )}
                            {result.platform && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
                                {result.platform}
                              </span>
                            )}
                            {result.taskType && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-600/30 text-gray-400">
                                {result.taskType}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-300 font-medium mb-1">{result.brief}</p>
                          {output.hook && (
                            <p className="text-sm text-white mt-2 italic">&quot;{output.hook}&quot;</p>
                          )}
                          {output.caption && (
                            <p className="text-xs text-gray-400 mt-2 line-clamp-2">{output.caption}</p>
                          )}
                        </div>
                        <div className="flex-shrink-0 w-16 text-center">
                          <div className={`text-xl font-bold ${result.similarity >= 0.85 ? 'text-green-400' : result.similarity >= 0.7 ? 'text-blue-400' : 'text-yellow-400'}`}>
                            {simPercent}
                          </div>
                          <div className="text-[10px] text-gray-500 uppercase tracking-wider">score</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : null}
            </div>
          ) : (
            <div className="text-center py-16 text-gray-500">
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-lg mb-1">Search your knowledge base</p>
              <p className="text-sm">Type a query to find semantically similar content from your past selections</p>
            </div>
          )}
        </div>
      ) : (
        /* All Entries Tab */
        <div className="space-y-3">
          {entries.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-xl mb-2">📚 No knowledge entries yet</p>
              <p className="text-sm">Generate social posts and click &quot;Pilih ini&quot; to start building your style profile!</p>
            </div>
          ) : (
            entries.map(entry => {
              const output = parseOutput(entry.selected_output);
              return (
                <div key={entry.id} className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/50 hover:border-gray-600/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-lg">{getStyleIcon(entry.style_cluster || '')}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-300">{entry.style_cluster || 'default'}</span>
                        {entry.platform && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">{entry.platform}</span>}
                        {entry.audience && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400">{entry.audience}</span>}
                        <span className="text-xs text-gray-600 ml-auto">{new Date(entry.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </div>
                      <p className="text-sm text-gray-300 font-medium mb-1">{entry.brief}</p>
                      {output.hook && <p className="text-sm text-white mt-2 italic">&quot;{output.hook}&quot;</p>}
                      {output.caption && !output.hook && <p className="text-xs text-gray-400 mt-2 line-clamp-2">{output.caption}</p>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
