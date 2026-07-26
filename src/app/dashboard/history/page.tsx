'use client';
import { useEffect, useState } from 'react';

export default function HistoryPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'social-post' | 'video-script' | 'event-plan'>('all');

  useEffect(() => {
    fetch('/api/dashboard/history').then(r => r.json()).then(d => { setTasks(d.tasks || []); setLoading(false); });
  }, []);

  const typeIcons: Record<string, string> = { 'social-post': '📱', 'video-script': '🎬', 'event-plan': '📋' };
  const typeLabels: Record<string, string> = { 'social-post': 'Social Post', 'video-script': 'Video Script', 'event-plan': 'Event Plan' };
  const filteredTasks = typeFilter === 'all'
    ? tasks
    : typeFilter === 'event-plan'
      ? tasks.filter(task => task.type === 'event-plan')
      : tasks.filter(task => task.type === typeFilter);

  const downloadJSON = (task: any) => {
    const blob = new Blob([task.output_data || '{}'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${task.type}-${task.id.substring(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>;

  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-bold text-white">📁 Task History</h1><p className="text-gray-400 mt-1">View and download all generated content</p></div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'social-post', 'video-script', 'event-plan'] as const).map(type => (
          <button key={type} onClick={() => setTypeFilter(type)} className={`rounded-lg px-3 py-1.5 text-sm ${typeFilter === type ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {type === 'all' ? 'All Tasks' : type === 'event-plan' ? 'Event Plans' : typeLabels[type]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task List */}
        <div className="lg:col-span-1 bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden max-h-[70vh] overflow-y-auto">
          {filteredTasks.length > 0 ? filteredTasks.map((task: any) => (
            <div key={task.id}
              onClick={() => setSelected(task)}
              className={`p-4 border-b border-gray-800/50 cursor-pointer hover:bg-gray-700/30 transition-colors ${selected?.id === task.id ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <span>{typeIcons[task.type] || '📄'}</span>
                <span className="text-xs text-gray-500">{typeLabels[task.type] || task.type}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ml-auto ${
                  task.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>{task.status}</span>
              </div>
              <p className="text-sm text-gray-300 truncate">{task.title}</p>
              <p className="text-xs text-gray-600 mt-1">{new Date(task.created_at).toLocaleString()}</p>
            </div>
          )) : <p className="text-gray-500 p-6 text-center">No tasks yet</p>}
        </div>

        {/* Detail View */}
        <div className="lg:col-span-2">
          {selected ? (
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{typeIcons[selected.type] || '📄'}</span>
                  <div>
                    <h3 className="text-lg font-semibold text-white">{selected.title}</h3>
                    <p className="text-xs text-gray-500">{new Date(selected.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <button onClick={() => downloadJSON(selected)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg flex items-center gap-1">
                  ⬇️ Download
                </button>
              </div>

              <div className="space-y-4">
                {/* Brief */}
                {selected.brief && (
                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wide">Brief</label>
                    <p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{selected.brief}</p>
                  </div>
                )}

                {/* Output Content */}
                {selected.output_data && (() => {
                  try {
                    const data = JSON.parse(selected.output_data);

                    if (selected.type === 'social-post') {
                      const caption = data.captionData || data;
                      return (
                        <>
                          <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">📝 Caption</label>
                            <div className="bg-white rounded-xl p-4 mt-1 max-w-md">
                              {caption.hook && <p className="text-gray-900 font-semibold mb-2">{caption.hook}</p>}
                              <p className="text-gray-800 text-sm whitespace-pre-wrap">{caption.caption || caption.captionData?.caption}</p>
                              {caption.hashtags?.length > 0 && <p className="text-blue-600 text-sm mt-2">{caption.hashtags.join(' ')}</p>}
                            </div>
                          </div>
                          {data.imagePrompt && (
                            <div>
                              <label className="text-xs text-gray-500 uppercase tracking-wide">🎨 Image Prompt</label>
                              <p className="text-gray-300 mt-1 bg-gray-900/50 p-3 rounded-lg font-mono text-sm">{data.imagePrompt}</p>
                            </div>
                          )}
                        </>
                      );
                    }

                    if (selected.type === 'video-script') {
                      const script = data.scriptData || data;
                      return (
                        <>
                          {script.hook && <div><label className="text-xs text-gray-500 uppercase tracking-wide">🎣 Hook</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{script.hook}</p></div>}
                          {script.context && <div><label className="text-xs text-gray-500 uppercase tracking-wide">📖 Context</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{script.context}</p></div>}
                          {script.highlight && <div><label className="text-xs text-gray-500 uppercase tracking-wide">✨ Highlight</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{script.highlight}</p></div>}
                          {script.fullScript && <div><label className="text-xs text-gray-500 uppercase tracking-wide">📜 Full Script</label><pre className="text-gray-300 mt-1 bg-gray-700/50 p-4 rounded-lg text-sm whitespace-pre-wrap font-mono">{script.fullScript}</pre></div>}
                        </>
                      );
                    }

                    if (selected.type === 'event-plan') {
                      const plan = data.options?.[0] || data.planData || data;
                      return (
                        <>
                          {plan.objective && <div><label className="text-xs text-gray-500 uppercase tracking-wide">🎯 Objective</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{plan.objective}</p></div>}
                          {plan.concept && <div><label className="text-xs text-gray-500 uppercase tracking-wide">💡 Concept</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{plan.concept}</p></div>}
                          {plan.venue && <div><label className="text-xs text-gray-500 uppercase tracking-wide">📍 Venue</label><p className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg">{plan.venue}</p></div>}
                          {plan.speakers?.length > 0 && <div><label className="text-xs text-gray-500 uppercase tracking-wide">🎤 Speakers</label><ul className="mt-1 space-y-1">{plan.speakers.map((s: string, i: number) => <li key={i} className="text-gray-300 bg-gray-700/30 p-2 rounded-lg">• {s}</li>)}</ul></div>}
                          {plan.budget && <div><label className="text-xs text-gray-500 uppercase tracking-wide">💰 Budget</label><pre className="text-gray-300 mt-1 bg-gray-700/30 p-3 rounded-lg text-sm">{JSON.stringify(plan.budget, null, 2)}</pre></div>}
                        </>
                      );
                    }

                    return <pre className="text-gray-300 text-sm">{JSON.stringify(data, null, 2)}</pre>;
                  } catch {
                    return <p className="text-gray-400 text-sm">{selected.output_data}</p>;
                  }
                })()}
              </div>
            </div>
          ) : (
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 flex items-center justify-center h-64">
              <p className="text-gray-500">Select a task to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
