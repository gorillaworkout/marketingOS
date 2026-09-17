'use client';

import { useCallback, useEffect, useState } from 'react';
import { conversationTitleFromMessages, type AiResearchChatMessage } from '@/lib/ai-research';
import {
  Button,
  DataTableFrame,
  EmptyState,
  FilterGroup,
  LoadingState,
  PageHeader,
  PageStack,
  Panel,
  Select,
  StatusBadge,
  TextInput,
  Toolbar,
} from '@/components/ui/dashboard';

interface FilterUser {
  id: string;
  name: string;
  username: string;
}

interface ConversationRow {
  id: string;
  userId: string;
  userName: string;
  username: string;
  title: string;
  model: string;
  messageCount: number;
  updatedAt: string;
}

interface ConversationDetail {
  id: string;
  user: { id: string; name: string; username: string };
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: AiResearchChatMessage[];
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AdminAiResearchPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [users, setUsers] = useState<FilterUser[]>([]);
  const [userId, setUserId] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setTitle(titleInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [titleInput]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (title) params.set('title', title);
      const query = params.toString();
      const response = await fetch(`/api/admin/ai-research${query ? `?${query}` : ''}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as {
        conversations?: ConversationRow[];
        users?: FilterUser[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      setConversations(payload.conversations || []);
      setUsers(payload.users || []);
    } catch (cause) {
      setConversations([]);
      setError(cause instanceof Error ? cause.message : 'Failed to load conversations.');
    } finally {
      setLoading(false);
    }
  }, [title, userId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openConversation = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await fetch(`/api/admin/ai-research?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({})) as ConversationDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      setDetail(payload);
    } catch (cause) {
      setDetail(null);
      setDetailError(cause instanceof Error ? cause.message : 'Failed to load conversation.');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setDetailError('');
  };

  const threadTitle = detail
    ? conversationTitleFromMessages(detail.messages)
    : conversations.find(row => row.id === selectedId)?.title || 'Conversation';

  return (
    <PageStack>
      <PageHeader
        eyebrow="Administration / AI Research"
        title="AI Research log"
        description="Read-only view of every AI Research conversation. Use this to learn how the team prompts, iterates, and attaches images."
        actions={<Button onClick={() => void loadList()}>Refresh</Button>}
      />

      <Toolbar>
        <FilterGroup>
          <Select
            aria-label="Filter by user"
            value={userId}
            onChange={event => setUserId(event.target.value)}
            className="w-full sm:max-w-56"
          >
            <option value="">All users</option>
            {users.map(user => (
              <option key={user.id} value={user.id}>
                {user.name}{user.username && user.username !== user.name ? ` (@${user.username})` : ''}
              </option>
            ))}
          </Select>
          <TextInput
            aria-label="Search title"
            placeholder="Search title"
            value={titleInput}
            onChange={event => setTitleInput(event.target.value)}
            className="w-full sm:max-w-72"
          />
        </FilterGroup>
        <StatusBadge tone="info">Read only</StatusBadge>
      </Toolbar>

      {error && (
        <div className="rounded-[var(--mos-radius-panel)] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
          <Button className="ml-3" onClick={() => void loadList()}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className={selectedId ? 'hidden xl:block xl:col-span-3' : 'xl:col-span-3'}>
          {loading ? (
            <LoadingState label="Loading conversations" />
          ) : (
            <DataTableFrame
              title="Conversations"
              description={`${conversations.length} thread${conversations.length === 1 ? '' : 's'} across users`}
            >
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
                  <tr>
                    <th className="p-3">User</th>
                    <th className="p-3">Title</th>
                    <th className="p-3">Model</th>
                    <th className="p-3 text-right">Messages</th>
                    <th className="p-3">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map(row => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)] transition-colors hover:bg-[var(--mos-raised)] ${selectedId === row.id ? 'bg-indigo-600/10' : ''}`}
                      onClick={() => void openConversation(row.id)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void openConversation(row.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-pressed={selectedId === row.id}
                    >
                      <td className="p-3">
                        <p className="font-medium text-[var(--mos-text)]">{row.userName}</p>
                        <p className="text-[11px] text-[var(--mos-text-faint)]">@{row.username || 'unknown'}</p>
                      </td>
                      <td className="max-w-[280px] p-3">
                        <p className="truncate text-[var(--mos-text-secondary)]" title={row.title}>{row.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-[var(--mos-text-faint)]">{row.id.slice(0, 8)}</p>
                      </td>
                      <td className="p-3 text-xs" title={row.model}>{row.model}</td>
                      <td className="p-3 text-right tabular-nums">{row.messageCount}</td>
                      <td className="whitespace-nowrap p-3 text-xs">{formatWhen(row.updatedAt)}</td>
                    </tr>
                  ))}
                  {!conversations.length && (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState title="No conversations" description="No AI Research threads match the current filters." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </DataTableFrame>
          )}
        </div>

        <div className={selectedId ? 'xl:col-span-2' : 'hidden xl:block xl:col-span-2'}>
          {detailLoading ? (
            <LoadingState label="Loading thread" />
          ) : detailError ? (
            <Panel className="text-sm text-red-300">
              {detailError}
              {selectedId && <Button className="ml-3" onClick={() => void openConversation(selectedId)}>Retry</Button>}
            </Panel>
          ) : detail ? (
            <Panel padding="none">
              <div className="flex items-start justify-between gap-3 border-b border-[var(--mos-border-subtle)] px-5 py-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--mos-text-faint)]">Read-only thread</p>
                  <h2 className="mt-1 truncate text-sm font-[560] text-[var(--mos-text)]">{threadTitle}</h2>
                  <p className="mt-1 text-xs text-[var(--mos-text-muted)]">
                    {detail.user.name} (@{detail.user.username || 'unknown'}) · {detail.model}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--mos-text-faint)]">
                    Updated {formatWhen(detail.updatedAt)} · {detail.messages.length} messages
                  </p>
                </div>
                <Button className="xl:hidden" onClick={closeDetail}>Back</Button>
              </div>
              <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
                {detail.messages.length === 0 && (
                  <EmptyState title="Empty thread" description="This conversation has no stored messages." className="min-h-32" />
                )}
                {detail.messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[92%] min-w-0">
                      <p className="mb-1 px-1 text-[10px] font-semibold text-[var(--mos-text-muted)]">
                        {message.role === 'user' ? detail.user.name : 'GorillaWorkout AI'}
                      </p>
                      {message.images && message.images.length > 0 && (
                        <div className={`mb-2 flex flex-wrap gap-2 ${message.role === 'user' ? 'justify-end' : ''}`}>
                          {message.images.map((image, imageIndex) => (
                            <img
                              key={`${image.name || 'image'}-${imageIndex}`}
                              src={image.dataUrl}
                              alt={image.name || `Attached image ${imageIndex + 1}`}
                              className="max-h-40 max-w-[160px] rounded-xl border border-[var(--mos-border)] object-cover"
                            />
                          ))}
                        </div>
                      )}
                      {message.content && (
                        <div className={`whitespace-pre-wrap px-4 py-2.5 text-sm leading-relaxed ${
                          message.role === 'user'
                            ? 'rounded-2xl rounded-tr-md bg-indigo-600 text-white'
                            : 'rounded-2xl rounded-tl-md border border-[var(--mos-border)] bg-[var(--mos-raised)] text-[var(--mos-text)]'
                        }`}>
                          {message.content}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : (
            <Panel padding="none">
              <EmptyState title="Select a conversation" description="Open a thread to inspect messages and attached images. Nothing here can be edited or sent." />
            </Panel>
          )}
        </div>
      </div>
    </PageStack>
  );
}
