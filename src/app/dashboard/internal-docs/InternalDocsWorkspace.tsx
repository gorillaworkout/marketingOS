'use client';

import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
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
import {
  INTERNAL_DOC_FILE_ACCEPT,
  internalDocUploadIssue,
  titleForInternalDocUpload,
} from '@/lib/internal-docs-upload';

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

type UploadStatus = 'ready' | 'uploading' | 'done' | 'error';

interface UploadItem {
  key: string;
  file: File;
  status: UploadStatus;
  message: string;
  retryable: boolean;
  accessLevel?: AccessLevel;
}

function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes('Files');
}

function dragPointerLeftZone(event: DragEvent<HTMLElement>): boolean {
  if (event.clientX === 0 && event.clientY === 0) return true;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left
    || event.clientX > rect.right
    || event.clientY < rect.top
    || event.clientY > rect.bottom;
}

function uploadStatusLabel(status: UploadStatus): string {
  if (status === 'uploading') return 'Uploading';
  if (status === 'done') return 'Indexed';
  if (status === 'error') return 'Failed';
  return 'Ready';
}

function uploadStatusTone(status: UploadStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'done') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'uploading') return 'warning';
  return 'neutral';
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
  const [uploadNote, setUploadNote] = useState('');
  const [uploadNoteIsError, setUploadNoteIsError] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [title, setTitle] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('company');
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
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

  useEffect(() => () => { uploadAbortRef.current?.abort(); }, []);

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

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (!incoming.length || uploading) return;
    setUploadNote('');
    setUploadNoteIsError(false);
    setItems(current => [
      ...current,
      ...incoming.map(file => {
        const issue = internalDocUploadIssue(file);
        return {
          key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          status: issue ? 'error' as const : 'ready' as const,
          message: issue || '',
          retryable: false,
        };
      }),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeItem = (key: string) => {
    if (uploading) return;
    setItems(current => current.filter(item => item.key !== key));
  };

  const onDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    if (uploading || !dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  };

  const onDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = uploading ? 'none' : 'copy';
    if (!uploading) setDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    if (!dragActive && !dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (dragPointerLeftZone(event)) setDragActive(false);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    const files = event.dataTransfer?.files;
    const isFileDrop = dragHasFiles(event.dataTransfer) || Boolean(files && files.length > 0);
    if (!isFileDrop) return;
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (uploading) return;
    addFiles(files || []);
  };

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    const pending = items.filter(item => item.status === 'ready' || (item.status === 'error' && item.retryable));
    if (!pending.length) {
      setUploadNote(items.length
        ? 'Fix the files above, or add a PDF, DOCX, MD, or TXT file.'
        : 'Choose a PDF, DOCX, MD, or TXT file.');
      setUploadNoteIsError(true);
      return;
    }
    const level = accessLevel;
    const blockedSiblings = items.some(item => item.status === 'error' && !pending.includes(item));
    const batchTitle = titleForInternalDocUpload(pending.length, title);
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploading(true);
    setUploadNote('');
    setUploadNoteIsError(false);
    let indexed = 0;
    let attention = 0;
    let onlyId: string | null = null;
    let singleError = '';
    try {
      for (let index = 0; index < pending.length; index += 1) {
        if (controller.signal.aborted) return;
        const item = pending[index];
        setUploadProgress({ current: index + 1, total: pending.length, name: item.file.name });
        setItems(current => current.map(row => row.key === item.key
          ? { ...row, status: 'uploading', message: '', accessLevel: level }
          : row));
        const body = new FormData();
        body.set('file', item.file);
        if (batchTitle) body.set('title', batchTitle);
        body.set('accessLevel', level);
        try {
          const response = await fetch('/api/internal-docs', { method: 'POST', body, signal: controller.signal });
          const data = await response.json().catch(() => ({}));
          if (controller.signal.aborted) return;
          if (!response.ok) {
            attention += 1;
            singleError = data.error || 'Upload failed.';
            setItems(current => current.map(row => row.key === item.key
              ? { ...row, status: 'error', message: singleError, retryable: true, accessLevel: level }
              : row));
            continue;
          }
          const created = data.status === 'indexed';
          if (created) indexed += 1;
          else {
            attention += 1;
            singleError = data.errorMessage || 'Indexing failed.';
          }
          if (pending.length === 1 && data.id) onlyId = data.id;
          setItems(current => current.map(row => row.key === item.key
            ? {
              ...row,
              status: created ? 'done' : 'error',
              message: created ? '' : (data.errorMessage || 'Indexing failed.'),
              retryable: false,
              accessLevel: level,
            }
            : row));
        } catch (error) {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
          attention += 1;
          singleError = 'Upload failed.';
          setItems(current => current.map(row => row.key === item.key
            ? { ...row, status: 'error', message: singleError, retryable: true, accessLevel: level }
            : row));
        }
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      if (!controller.signal.aborted) {
        setUploading(false);
        setUploadProgress(null);
        setDragActive(false);
      }
    }
    if (controller.signal.aborted) return;
    await loadList(search);
    if (pending.length === 1 && onlyId && !blockedSiblings) {
      setItems([]);
      setTitle('');
      setAccessLevel('company');
      setUploadNote('');
      router.push(`/dashboard/internal-docs/${onlyId}`);
      return;
    }
    if (pending.length === 1 && !onlyId) {
      setUploadNote(singleError || 'Upload failed.');
      setUploadNoteIsError(true);
      return;
    }
    const indexedLabel = `${indexed} ${indexed === 1 ? 'file' : 'files'} indexed as ${accessLabel(level)}`;
    setUploadNote(attention
      ? `${indexedLabel}. ${attention} ${attention === 1 ? 'file needs' : 'files need'} attention.`
      : `${indexedLabel}.`);
    setUploadNoteIsError(attention > 0);
    if (indexed > 0 && attention === 0) setTitle('');
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

  const uploadableCount = items.filter(item => item.status === 'ready' || (item.status === 'error' && item.retryable)).length;

  return (
    <PageStack>
      <PageHeader
        eyebrow="Guidance"
        title="FAQ & Guides"
        description="Browse company guidance you are allowed to read. Ask questions grounded in those guides."
      />

      {canManage && (
        <Panel>
          <h2 className="text-sm font-[560] text-[var(--mos-text)]">Upload documents</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">Drop PDF, DOCX, MD, or TXT files, or choose them. Each file is saved and indexed on its own. Company or IT-only applies to every file in this upload.</p>
          <form onSubmit={upload} className="mt-4 space-y-3">
            <label
              data-testid="internal-docs-dropzone"
              data-drag-active={dragActive ? 'true' : 'false'}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-[var(--mos-radius-control)] border border-dashed px-4 py-8 text-center transition ${dragActive ? 'border-[var(--mos-accent)] bg-[var(--mos-accent)]/10' : 'border-[var(--mos-border-strong)] bg-[var(--mos-raised)] hover:border-[var(--mos-accent-border)]'} ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={INTERNAL_DOC_FILE_ACCEPT}
                disabled={uploading}
                aria-label="Choose FAQ and guide files"
                className="sr-only"
                onChange={event => addFiles(event.target.files || [])}
              />
              <svg aria-hidden="true" className="mb-2 h-5 w-5 text-[var(--mos-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4m0 0 4 4m-4-4-4 4" />
                <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              <span className="text-sm text-[var(--mos-text)]">{dragActive ? 'Drop to add files' : 'Drop files here, or choose files'}</span>
              <span className="mt-1 text-xs text-[var(--mos-text-muted)]">PDF, DOCX, MD, or TXT. Several files can go in at once.</span>
            </label>
            {items.length > 0 && (
              <ul className="space-y-2" aria-label="Files to upload">
                {items.map(item => {
                  const level = item.accessLevel || accessLevel;
                  return (
                    <li key={item.key} className="flex items-start justify-between gap-3 rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-[var(--mos-text)]">{item.file.name}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--mos-text-faint)]">
                          <span>{formatSize(item.file.size)}</span>
                          <StatusBadge tone={level === 'it-only' ? 'info' : 'neutral'}>{accessLabel(level)}</StatusBadge>
                          <StatusBadge tone={uploadStatusTone(item.status)}>{uploadStatusLabel(item.status)}</StatusBadge>
                        </p>
                        {item.message && <p className="mt-1 text-xs text-red-300">{item.message}</p>}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={uploading}
                        aria-label={item.status === 'done' ? `Dismiss ${item.file.name}` : `Remove ${item.file.name}`}
                        onClick={() => removeItem(item.key)}
                      >
                        {item.status === 'done' ? 'Dismiss' : 'Remove'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
              <label className="block text-xs text-[var(--mos-text-muted)]">
                Title
                <TextInput
                  value={title}
                  onChange={event => setTitle(event.target.value)}
                  placeholder={uploadableCount > 1 ? 'Each file uses its name' : 'Optional title'}
                  disabled={uploading || uploadableCount > 1}
                  className="mt-1"
                />
              </label>
              <label className="block text-xs text-[var(--mos-text-muted)]">
                Access
                <Select value={accessLevel} onChange={event => setAccessLevel(event.target.value as AccessLevel)} disabled={uploading} className="mt-1" aria-label="Access level">
                  <option value="company">Company</option>
                  <option value="it-only">IT-only</option>
                </Select>
              </label>
              <Button type="submit" variant="primary" disabled={uploading}>
                {uploading && uploadProgress
                  ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}`
                  : uploadableCount > 1
                    ? `Upload ${uploadableCount} files`
                    : 'Upload and index'}
              </Button>
            </div>
            <p className="text-[11px] leading-5 text-[var(--mos-text-faint)]">
              {uploadableCount > 1
                ? 'A title is used only when you upload one file. This batch keeps each file name, with the access level above.'
                : 'Leave the title blank to use the file name. The access level applies to this upload.'}
            </p>
            {uploadProgress && (
              <p className="text-xs text-[var(--mos-text-muted)]" aria-live="polite">
                Uploading {uploadProgress.current} of {uploadProgress.total}: {uploadProgress.name}
              </p>
            )}
            {uploadNote && (
              <p className={`text-xs ${uploadNoteIsError ? 'text-red-300' : 'text-[var(--mos-text-muted)]'}`} role={uploadNoteIsError ? 'alert' : 'status'}>
                {uploadNote}
              </p>
            )}
          </form>
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
                title={search.trim() ? 'No matching guides' : 'No guides yet'}
                description={search.trim() ? 'Try another title or phrase.' : 'FAQ and guides you can read will appear here.'}
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
              <EmptyState title="Select a guide" description="Open an item from the list to read it." />
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
                aria-label="Ask FAQ & Guides"
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
