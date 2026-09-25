'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  EmptyState,
  PageHeader,
  PageStack,
  Panel,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
} from '@/components/ui/dashboard';

type AccessLevel = 'company' | 'it-only';
type DocStatus = 'pending' | 'indexed' | 'failed';

interface DocSummary {
  id: string;
  title: string;
  originalName: string;
  extension: string;
  fileSize: number;
  accessLevel: AccessLevel;
  status: DocStatus;
  errorMessage: string | null;
  createdAt: string;
  snippet: string;
}

interface DocDetail extends DocSummary {
  extractedText: string;
}

interface Citation {
  documentId: string;
  title: string;
  url: string;
  excerpt: string;
}

interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

function accessLabel(level: AccessLevel): string {
  return level === 'it-only' ? 'IT-only' : 'Company';
}

function statusTone(status: DocStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'indexed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function InternalDocsWorkspace({ documentId }: { documentId?: string }) {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [search, setSearch] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [active, setActive] = useState<DocDetail | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [docError, setDocError] = useState<{ id: string; message: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [title, setTitle] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('company');
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [askInput, setAskInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [messages, setMessages] = useState<AskMessage[]>([]);

  const loadList = useCallback(async (query: string) => {
    setLoadingList(true);
    setListError('');
    try {
      const response = await fetch(`/api/internal-docs?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) {
        setListError(data.error || 'Could not load documents.');
        setDocuments([]);
        return;
      }
      setCanManage(Boolean(data.canManage));
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
    } catch {
      setListError('Could not load documents.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadList(search); }, 250);
    return () => window.clearTimeout(timer);
  }, [loadList, search]);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    const requestedId = documentId;
    fetch(`/api/internal-docs/${requestedId}`)
      .then(async response => {
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setActive(null);
          setLoadedId(requestedId);
          setDocError({ id: requestedId, message: data.error || 'Document not found.' });
          return;
        }
        setDocError(null);
        setActive(data.document);
        setLoadedId(requestedId);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedId(requestedId);
          setDocError({ id: requestedId, message: 'Could not open this document.' });
        }
      });
    return () => { cancelled = true; };
  }, [documentId]);

  const openDocument = documentId && loadedId === documentId ? active : null;
  const openError = documentId && docError?.id === documentId ? docError.message : '';

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setUploadError('Choose a PDF, DOCX, MD, or TXT file.');
      return;
    }
    setUploading(true);
    setUploadError('');
    const body = new FormData();
    body.set('file', file);
    body.set('title', title);
    body.set('accessLevel', accessLevel);
    try {
      const response = await fetch('/api/internal-docs', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) {
        setUploadError(data.error || 'Upload failed.');
        return;
      }
      setTitle('');
      setFile(null);
      setFileInputKey(key => key + 1);
      setAccessLevel('company');
      await loadList(search);
      if (data.id) router.push(`/dashboard/internal-docs/${data.id}`);
    } catch {
      setUploadError('Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const changeAccess = async (next: AccessLevel) => {
    if (!openDocument) return;
    const response = await fetch(`/api/internal-docs/${openDocument.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessLevel: next }),
    });
    const data = await response.json();
    if (!response.ok) {
      setDocError({ id: openDocument.id, message: data.error || 'Could not update access.' });
      return;
    }
    setActive(data.document);
    setLoadedId(openDocument.id);
    await loadList(search);
  };

  const removeDocument = async () => {
    if (!openDocument) return;
    if (!window.confirm(`Delete “${openDocument.title}”?`)) return;
    const response = await fetch(`/api/internal-docs/${openDocument.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setDocError({ id: openDocument.id, message: data.error || 'Could not delete this document.' });
      return;
    }
    setActive(null);
    setLoadedId(null);
    await loadList(search);
    router.push('/dashboard/internal-docs');
  };

  const reindex = async () => {
    if (!openDocument) return;
    const response = await fetch(`/api/internal-docs/${openDocument.id}/reindex`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) {
      setDocError({ id: openDocument.id, message: data.error || 'Could not index this document.' });
      return;
    }
    const refreshed = await fetch(`/api/internal-docs/${openDocument.id}`);
    const body = await refreshed.json();
    if (refreshed.ok) setActive(body.document);
    await loadList(search);
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const question = askInput.trim();
    if (!question || asking) return;
    const history = messages.map(message => ({ role: message.role, content: message.content }));
    setMessages(current => [...current, { role: 'user', content: question }]);
    setAskInput('');
    setAsking(true);
    setAskError('');
    try {
      const response = await fetch('/api/internal-docs/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAskError(data.error || 'Could not answer that question.');
        return;
      }
      setMessages(current => [...current, {
        role: 'assistant',
        content: data.answer || '',
        citations: Array.isArray(data.citations) ? data.citations : [],
      }]);
    } catch {
      setAskError('Could not answer that question.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <PageStack>
      <PageHeader
        eyebrow="Library"
        title="Internal Docs"
        description="Browse company documentation you are allowed to read. Ask questions grounded in those documents."
      />

      {canManage && (
        <Panel>
          <h2 className="text-sm font-[560] text-[var(--mos-text)]">Upload a document</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">PDF, DOCX, MD, or TXT. Choose Company for every employee, or IT-only for the IT department and admins.</p>
          <form onSubmit={upload} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px_auto] md:items-end">
            <label className="block text-xs text-[var(--mos-text-muted)]">
              File
              <input
                key={fileInputKey}
                type="file"
                accept=".pdf,.docx,.md,.txt,application/pdf,text/plain,text/markdown"
                className="mt-1 block w-full text-sm text-[var(--mos-text-secondary)] file:mr-3 file:rounded-[var(--mos-radius-control)] file:border file:border-[var(--mos-border)] file:bg-[var(--mos-raised)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--mos-text)]"
                onChange={event => setFile(event.target.files?.[0] || null)}
              />
            </label>
            <label className="block text-xs text-[var(--mos-text-muted)]">
              Title
              <TextInput value={title} onChange={event => setTitle(event.target.value)} placeholder="Optional title" className="mt-1" />
            </label>
            <label className="block text-xs text-[var(--mos-text-muted)]">
              Access
              <Select value={accessLevel} onChange={event => setAccessLevel(event.target.value as AccessLevel)} className="mt-1" aria-label="Access level">
                <option value="company">Company</option>
                <option value="it-only">IT-only</option>
              </Select>
            </label>
            <Button type="submit" variant="primary" disabled={uploading}>{uploading ? 'Uploading' : 'Upload and index'}</Button>
          </form>
          {uploadError && <p className="mt-3 text-xs text-red-300">{uploadError}</p>}
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Panel padding="none" className="min-h-[28rem]">
          <div className="border-b border-[var(--mos-border-subtle)] p-4">
            <label className="block text-xs text-[var(--mos-text-muted)]" htmlFor="internal-docs-search">Search documents</label>
            <TextInput
              id="internal-docs-search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search title or body"
              className="mt-1"
            />
          </div>
          <div className="max-h-[40rem] overflow-y-auto">
            {loadingList && <p className="px-4 py-6 text-xs text-[var(--mos-text-muted)]">Loading documents</p>}
            {!loadingList && listError && <p className="px-4 py-6 text-xs text-red-300">{listError}</p>}
            {!loadingList && !listError && documents.length === 0 && (
              <EmptyState
                title={search.trim() ? 'No matching documents' : 'No documents yet'}
                description={search.trim() ? 'Try another title or phrase.' : 'Documents you can read will appear here.'}
              />
            )}
            <ul>
              {documents.map(document => {
                const selected = document.id === documentId;
                return (
                  <li key={document.id} className="border-b border-[var(--mos-border-subtle)] last:border-b-0">
                    <Link
                      href={`/dashboard/internal-docs/${document.id}`}
                      className={`block px-4 py-3 transition ${selected ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]'}`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--mos-text)]">{document.title}</span>
                        <StatusBadge tone={document.accessLevel === 'it-only' ? 'info' : 'neutral'}>{accessLabel(document.accessLevel)}</StatusBadge>
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-[var(--mos-text-faint)]">
                        <span className="uppercase">{document.extension.replace('.', '')}</span>
                        <span>{formatSize(document.fileSize)}</span>
                        {document.status !== 'indexed' && <StatusBadge tone={statusTone(document.status)}>{document.status === 'failed' ? 'Failed' : 'Indexing'}</StatusBadge>}
                      </span>
                      {document.snippet && <span className="mt-1 block text-xs leading-5 text-[var(--mos-text-muted)]">{document.snippet}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel className="min-h-64">
            {!documentId && (
              <EmptyState title="Select a document" description="Open an item from the list to read it." />
            )}
            {documentId && !openDocument && !openError && <p className="text-xs text-[var(--mos-text-muted)]">Opening document</p>}
            {openError && <p className="text-sm text-red-300">{openError}</p>}
            {openDocument && (
              <article>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-[560] tracking-[-0.03em] text-[var(--mos-text)]">{openDocument.title}</h2>
                    <p className="mt-1 text-xs text-[var(--mos-text-faint)]">{openDocument.originalName}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={openDocument.accessLevel === 'it-only' ? 'info' : 'neutral'}>{accessLabel(openDocument.accessLevel)}</StatusBadge>
                    <StatusBadge tone={statusTone(openDocument.status)}>{openDocument.status === 'indexed' ? 'Indexed' : openDocument.status === 'failed' ? 'Failed' : 'Indexing'}</StatusBadge>
                    <a href={`/api/internal-docs/${openDocument.id}/file`} className="inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-xs text-[var(--mos-text-secondary)]">Download</a>
                  </div>
                </div>
                {canManage && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <label className="text-xs text-[var(--mos-text-muted)]">
                      Access
                      <Select
                        aria-label="Change access level"
                        value={openDocument.accessLevel}
                        onChange={event => { void changeAccess(event.target.value as AccessLevel); }}
                        className="ml-2"
                      >
                        <option value="company">Company</option>
                        <option value="it-only">IT-only</option>
                      </Select>
                    </label>
                    <Button size="sm" onClick={() => { void reindex(); }}>Reindex</Button>
                    <Button size="sm" variant="danger" onClick={() => { void removeDocument(); }}>Delete</Button>
                  </div>
                )}
                {openDocument.errorMessage && <p className="mt-4 text-sm text-red-300">{openDocument.errorMessage}</p>}
                <div className="mt-5 max-h-[32rem] overflow-y-auto whitespace-pre-wrap border-t border-[var(--mos-border-subtle)] pt-4 text-sm leading-6 text-[var(--mos-text-secondary)]">
                  {openDocument.extractedText || 'This document has no indexed text yet.'}
                </div>
              </article>
            )}
          </Panel>

          <Panel>
            <h2 className="text-sm font-[560] text-[var(--mos-text)]">Ask</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">Answers use only the documents you are allowed to read, with links back to the source.</p>
            <div className="mt-4 space-y-3">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'text-sm text-[var(--mos-text)]' : 'rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] p-3 text-sm leading-6 text-[var(--mos-text-secondary)]'}>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.citations && message.citations.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {message.citations.map(citation => (
                        <li key={citation.documentId}>
                          <Link href={`/dashboard/internal-docs/${citation.documentId}`} className="text-[var(--mos-accent-soft)] hover:underline">{citation.title}</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {asking && <p className="text-xs text-[var(--mos-text-muted)]">Looking through documents</p>}
              {askError && <p className="text-xs text-red-300">{askError}</p>}
            </div>
            <form onSubmit={ask} className="mt-4 flex flex-col gap-2">
              <TextArea
                value={askInput}
                onChange={event => setAskInput(event.target.value)}
                placeholder="Ask a question about the documents you can read"
                aria-label="Ask internal documents"
                className="min-h-20"
              />
              <div className="flex justify-end">
                <Button type="submit" variant="primary" disabled={asking || !askInput.trim()}>Ask</Button>
              </div>
            </form>
          </Panel>
        </div>
      </div>
    </PageStack>
  );
}
