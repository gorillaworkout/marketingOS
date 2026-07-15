'use client';
import { useEffect, useState, useCallback } from 'react';

interface KanbanTask {
  id: string;
  title: string;
  body: string;
  assignee: string | null;
  status: 'ready' | 'running' | 'blocked' | 'completed';
  priority: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
}

type Status = 'ready' | 'running' | 'blocked' | 'completed';

const columns: { status: Status; label: string; icon: string; headerColor: string; borderColor: string; dropBg: string }[] = [
  { status: 'ready', label: 'Ready', icon: '📋', headerColor: 'bg-blue-600/20 text-blue-400', borderColor: 'border-l-blue-500', dropBg: 'bg-blue-500/5' },
  { status: 'running', label: 'Running', icon: '🔄', headerColor: 'bg-yellow-600/20 text-yellow-400', borderColor: 'border-l-yellow-500', dropBg: 'bg-yellow-500/5' },
  { status: 'blocked', label: 'Blocked', icon: '⏸️', headerColor: 'bg-red-600/20 text-red-400', borderColor: 'border-l-red-500', dropBg: 'bg-red-500/5' },
  { status: 'completed', label: 'Completed', icon: '✅', headerColor: 'bg-green-600/20 text-green-400', borderColor: 'border-l-green-500', dropBg: 'bg-green-500/5' },
];

const assigneeColors: Record<string, { bg: string; text: string; label: string }> = {
  'fe-agent': { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'FE Agent' },
  'be-agent': { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'BE Agent' },
  'qa-agent': { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'QA Agent' },
  'pm-agent': { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'PM Agent' },
};

const priorityIndicator: Record<number, { dot: string; label: string }> = {
  1: { dot: 'bg-red-400', label: 'High' },
  2: { dot: 'bg-yellow-400', label: 'Medium' },
  3: { dot: 'bg-gray-400', label: 'Low' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function KanbanPage() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<Status | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState<string>('');
  const [newTask, setNewTask] = useState({ title: '', body: '', assignee: '', priority: 2 });

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterAssignee) params.set('assignee', filterAssignee);
      const res = await fetch(`/api/kanban?${params}`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (e) {
      console.error('Failed to fetch tasks', e);
    } finally {
      setLoading(false);
    }
  }, [filterAssignee]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const updateTaskStatus = async (taskId: string, newStatus: Status) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    await fetch('/api/kanban', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskId, status: newStatus }),
    });
  };

  const createTask = async () => {
    if (!newTask.title.trim()) return;
    const res = await fetch('/api/kanban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTask),
    });
    if (res.ok) {
      setShowModal(false);
      setNewTask({ title: '', body: '', assignee: '', priority: 2 });
      fetchTasks();
    }
  };

  const deleteTask = async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    await fetch(`/api/kanban?id=${taskId}`, { method: 'DELETE' });
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedId(taskId);
  };

  const handleDragOver = (e: React.DragEvent, status: Status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, status: Status) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      updateTaskStatus(taskId, status);
    }
    setDraggedId(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverColumn(null);
  };

  // Stats
  const stats = {
    total: tasks.length,
    ready: tasks.filter(t => t.status === 'ready').length,
    running: tasks.filter(t => t.status === 'running').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📋 Kanban Board</h1>
          <p className="text-gray-400 mt-1">Manage agent tasks across workflow stages</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New Task
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="text-2xl font-bold text-white">{stats.total}</div>
          <div className="text-xs text-gray-400">Total Tasks</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="text-2xl font-bold text-blue-400">{stats.ready}</div>
          <div className="text-xs text-gray-400">Ready</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="text-2xl font-bold text-yellow-400">{stats.running}</div>
          <div className="text-xs text-gray-400">Running</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="text-2xl font-bold text-red-400">{stats.blocked}</div>
          <div className="text-xs text-gray-400">Blocked</div>
        </div>
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          <div className="text-2xl font-bold text-green-400">{stats.completed}</div>
          <div className="text-xs text-gray-400">Completed</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">Filter:</span>
        {['', 'fe-agent', 'be-agent', 'qa-agent', 'pm-agent'].map(a => (
          <button
            key={a}
            onClick={() => setFilterAssignee(a)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterAssignee === a
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:text-white'
            }`}
          >
            {a ? (assigneeColors[a]?.label || a) : 'All'}
          </button>
        ))}
      </div>

      {/* Kanban Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {columns.map(col => {
          const columnTasks = tasks.filter(t => t.status === col.status);
          const isDropTarget = dragOverColumn === col.status;
          return (
            <div
              key={col.status}
              className={`flex flex-col rounded-xl border border-gray-700/50 transition-colors ${
                isDropTarget ? col.dropBg + ' border-gray-600' : 'bg-gray-800/30'
              }`}
              onDragOver={(e) => handleDragOver(e, col.status)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.status)}
            >
              {/* Column Header */}
              <div className={`px-4 py-3 rounded-t-xl ${col.headerColor} border-b border-gray-700/50`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{col.icon}</span>
                    <span className="font-semibold text-sm">{col.label}</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700/50">{columnTasks.length}</span>
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 p-2 space-y-2 min-h-[200px]">
                {columnTasks.map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragEnd={handleDragEnd}
                    className={`bg-gray-800/80 rounded-lg p-3 border-l-4 ${col.borderColor} cursor-grab active:cursor-grabbing hover:bg-gray-700/50 transition-colors group ${
                      draggedId === task.id ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-medium text-white leading-tight">{task.title}</h4>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                        className="text-gray-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                    {task.body && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.body}</p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1.5">
                        {task.assignee && assigneeColors[task.assignee] && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${assigneeColors[task.assignee].bg} ${assigneeColors[task.assignee].text}`}>
                            {assigneeColors[task.assignee].label}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <span className={`w-2 h-2 rounded-full ${priorityIndicator[task.priority]?.dot || 'bg-gray-400'}`}></span>
                          <span className="text-[10px] text-gray-500">{priorityIndicator[task.priority]?.label || 'Medium'}</span>
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-600">{timeAgo(task.created_at)}</span>
                    </div>
                  </div>
                ))}
                {columnTasks.length === 0 && (
                  <div className="text-center py-8 text-gray-600 text-sm">
                    Drop tasks here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Task Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">New Task</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Title *</label>
                <input
                  type="text"
                  value={newTask.title}
                  onChange={e => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Task title..."
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <textarea
                  value={newTask.body}
                  onChange={e => setNewTask(prev => ({ ...prev, body: e.target.value }))}
                  className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 h-20 resize-none"
                  placeholder="Task details..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Assignee</label>
                  <select
                    value={newTask.assignee}
                    onChange={e => setNewTask(prev => ({ ...prev, assignee: e.target.value }))}
                    className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Unassigned</option>
                    <option value="fe-agent">FE Agent</option>
                    <option value="be-agent">BE Agent</option>
                    <option value="qa-agent">QA Agent</option>
                    <option value="pm-agent">PM Agent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Priority</label>
                  <select
                    value={newTask.priority}
                    onChange={e => setNewTask(prev => ({ ...prev, priority: Number(e.target.value) }))}
                    className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value={1}>🔴 High</option>
                    <option value={2}>🟡 Medium</option>
                    <option value={3}>⚪ Low</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={createTask}
                  disabled={!newTask.title.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Create Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
