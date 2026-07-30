'use client';
import { useState, useEffect, useCallback } from 'react';
import { Button, EmptyState, FormField, Panel, PageHeader, PageStack, SectionHeader, Select, TextArea, TextInput, Toolbar } from '@/components/ui/dashboard';

interface CalendarItem {
  id: string;
  task_id: string | null;
  platform: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  status: string;
  notes: string | null;
  task_title: string | null;
  task_type: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500',
  scheduled: 'bg-blue-500',
  published: 'bg-green-500',
  cancelled: 'bg-red-500',
};

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Twitter/X', 'LinkedIn', 'Facebook'];

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [form, setForm] = useState({ platform: '', scheduled_time: '', status: 'draft', notes: '', task_id: '' });

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const fetchItems = useCallback(async () => {
    const res = await fetch(`/api/calendar?start=${startDate}&end=${endDate}`);
    const data = await res.json();
    if (data.items) setItems(data.items);
  }, [startDate, endDate]);

  const fetchTasks = async () => {
    const res = await fetch('/api/dashboard/history');
    const data = await res.json();
    if (data.tasks) setTasks(data.tasks);
  };

  useEffect(() => { fetchItems(); fetchTasks(); }, [fetchItems]);

  const itemsByDate: Record<string, CalendarItem[]> = {};
  items.forEach(item => {
    const d = item.scheduled_date;
    if (!itemsByDate[d]) itemsByDate[d] = [];
    itemsByDate[d].push(item);
  });

  const selectedItems = selectedDate ? itemsByDate[selectedDate] || [] : [];

  const handlePrev = () => setCurrentDate(new Date(year, month - 1, 1));
  const handleNext = () => setCurrentDate(new Date(year, month + 1, 1));

  const handleAdd = (date: string) => {
    setSelectedDate(date);
    setEditingItem(null);
    setForm({ platform: '', scheduled_time: '', status: 'draft', notes: '', task_id: '' });
    setShowForm(true);
  };

  const handleEdit = (item: CalendarItem) => {
    setEditingItem(item);
    setForm({
      platform: item.platform || '',
      scheduled_time: item.scheduled_time || '',
      status: item.status,
      notes: item.notes || '',
      task_id: item.task_id || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!selectedDate) return;
    if (editingItem) {
      await fetch('/api/calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingItem.id, ...form, scheduled_date: selectedDate, task_id: form.task_id || null }),
      });
    } else {
      await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, scheduled_date: selectedDate, task_id: form.task_id || null }),
      });
    }
    setShowForm(false);
    setEditingItem(null);
    fetchItems();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/calendar?id=${id}`, { method: 'DELETE' });
    fetchItems();
  };

  const handleStatusChange = async (id: string, status: string) => {
    await fetch('/api/calendar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    fetchItems();
  };

  const monthName = currentDate.toLocaleString('default', { month: 'long' });
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <PageStack>
      <PageHeader eyebrow="Library / Publishing" title="Content calendar" description="Schedule and manage content publishing across channels." />

      <div className="flex flex-col gap-6 2xl:flex-row">
        {/* Calendar Grid */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          <Panel>
            <Toolbar className="mb-6 border-0 bg-transparent p-0">
              <Button size="sm" onClick={handlePrev}>Previous</Button>
              <h2 className="text-lg font-semibold text-white">{monthName} {year}</h2>
              <Button size="sm" onClick={handleNext}>Next</Button>
            </Toolbar>

            <div className="grid min-w-[680px] grid-cols-7 gap-1">
              {dayNames.map(d => (
                <div key={d} className="text-center text-xs font-medium text-[var(--mos-text-faint)] py-2">{d}</div>
              ))}
              {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayItems = itemsByDate[dateStr] || [];
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;

                return (
                  <div
                    key={day}
                    onClick={() => { setSelectedDate(dateStr); setShowForm(false); }}
                    className={`min-h-[80px] p-2 rounded-lg cursor-pointer border transition-colors ${
                      isSelected ? 'border-blue-500 bg-blue-500/10' :
                      isToday ? 'border-purple-500/50 bg-purple-500/5' :
                      'border-[var(--mos-border)] hover:border-[var(--mos-border)] hover:bg-[var(--mos-raised)]'
                    }`}
                  >
                    <span className={`text-sm ${isToday ? 'text-purple-400 font-bold' : 'text-[var(--mos-text-secondary)]'}`}>{day}</span>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {dayItems.slice(0, 3).map(item => (
                        <div
                          key={item.id}
                          className={`w-2 h-2 rounded-full ${STATUS_COLORS[item.status] || 'bg-gray-500'}`}
                          title={`${item.platform || 'No platform'} - ${item.status}`}
                        />
                      ))}
                      {dayItems.length > 3 && <span className="text-[10px] text-[var(--mos-text-faint)]">+{dayItems.length - 3}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex gap-4 mt-4 pt-4 border-t border-[var(--mos-border)]">
              {Object.entries(STATUS_COLORS).map(([status, color]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                  <span className="text-xs text-[var(--mos-text-muted)] capitalize">{status}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Side Panel */}
        <div className="w-full 2xl:w-80 2xl:shrink-0">
          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-medium">
                {selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'Select a date'}
              </h3>
              {selectedDate && (
                <Button size="sm" onClick={() => handleAdd(selectedDate)}>Add</Button>
              )}
            </div>

            {!selectedDate && <p className="text-[var(--mos-text-faint)] text-sm">Click on a day to see scheduled items</p>}

            {selectedDate && selectedItems.length === 0 && !showForm && (
              <EmptyState title="No items scheduled" description="Add an item for this date." className="min-h-32 px-2 py-8" />
            )}

            {selectedItems.map(item => (
              <div key={item.id} className="bg-[var(--mos-raised)] rounded-lg p-3 mb-2 border border-[var(--mos-border)]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white">{item.platform || 'No platform'}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    item.status === 'published' ? 'bg-green-500/20 text-green-400' :
                    item.status === 'scheduled' ? 'bg-blue-500/20 text-blue-400' :
                    item.status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
                    'bg-gray-500/20 text-[var(--mos-text-muted)]'
                  }`}>{item.status}</span>
                </div>
                {item.scheduled_time && <p className="text-xs text-[var(--mos-text-muted)]">⏰ {item.scheduled_time}</p>}
                {item.task_title && <p className="text-xs text-blue-400 mt-1">📎 {item.task_title}</p>}
                {item.notes && <p className="text-xs text-[var(--mos-text-muted)] mt-1">{item.notes}</p>}
                <div className="flex gap-2 mt-2">
                  <Select
                    value={item.status}
                    onChange={(e) => handleStatusChange(item.id, e.target.value)}
                    className="text-xs bg-[var(--mos-raised)] border border-[var(--mos-border)] rounded px-2 py-1 text-[var(--mos-text-secondary)]"
                  >
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="published">Published</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                  <Button size="sm" onClick={() => handleEdit(item)}>Edit</Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(item.id)}>Delete</Button>
                </div>
              </div>
            ))}

            {/* Add/Edit Form */}
            {showForm && selectedDate && (
              <div className="mt-4 pt-4 border-t border-[var(--mos-border)] space-y-3">
                <SectionHeader title={editingItem ? 'Edit item' : 'New item'} />
                <FormField label="Platform">
                  <Select
                    value={form.platform}
                    onChange={(e) => setForm({ ...form, platform: e.target.value })}
                    className="w-full bg-[var(--mos-raised)] border border-[var(--mos-border)] rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="">Select platform</option>
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </FormField>
                <FormField label="Time">
                  <TextInput
                    type="time"
                    value={form.scheduled_time}
                    onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })}
                  />
                </FormField>
                <div>
                  <label className="text-xs text-[var(--mos-text-muted)] mb-1 block">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full bg-[var(--mos-raised)] border border-[var(--mos-border)] rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="published">Published</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--mos-text-muted)] mb-1 block">Link to Task</label>
                  <select
                    value={form.task_id}
                    onChange={(e) => setForm({ ...form, task_id: e.target.value })}
                    className="w-full bg-[var(--mos-raised)] border border-[var(--mos-border)] rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="">None</option>
                    {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--mos-text-muted)] mb-1 block">Notes</label>
                  <TextArea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="primary" className="flex-1" onClick={handleSave}>
                    {editingItem ? 'Update' : 'Add'}
                  </Button>
                  <Button onClick={() => { setShowForm(false); setEditingItem(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </PageStack>
  );
}
