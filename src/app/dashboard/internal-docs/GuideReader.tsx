'use client';

import { useState } from 'react';
import { Button, Select, StatusBadge } from '@/components/ui/dashboard';
import {
  internalDocFilePath,
  parseMarkdownDocument,
  parsePlainDocument,
  sanitizeDocumentHtml,
  type DocumentBlock,
  type InlineNode,
} from '@/lib/internal-docs-reader';

type AccessLevel = 'company' | 'it-only';
type DocStatus = 'pending' | 'indexed' | 'failed';

export interface GuideDocument {
  id: string;
  title: string;
  originalName: string;
  extension: string;
  fileSize: number;
  accessLevel: AccessLevel;
  status: DocStatus;
  errorMessage: string | null;
  extractedText: string;
  previewHtml?: string | null;
}

const controlLink = 'inline-flex h-8 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 text-xs font-medium text-[var(--mos-text)] hover:border-[var(--mos-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)]';

const pageClass = 'max-h-[min(78vh,960px)] min-h-[20rem] overflow-y-auto bg-[#f4f1ea] px-5 py-8 text-[#1c1b17] sm:px-10 sm:py-10';
const proseClass = 'mx-auto max-w-[44rem] break-words text-[15px] leading-7 [&_a]:font-medium [&_a]:text-[#312e81] [&_a]:underline [&_a]:underline-offset-2 [&_h1]:mb-4 [&_h1]:text-[1.7rem] [&_h1]:font-semibold [&_h1]:leading-tight [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mb-2 [&_h4]:mt-5 [&_h4]:font-semibold [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-[#d9d3c5] [&_blockquote]:pl-4 [&_pre]:mb-4 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-[#ebe6dc] [&_pre]:p-3 [&_code]:rounded [&_code]:bg-[#ebe6dc] [&_code]:px-1 [&_table]:mb-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#e3ddd0] [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-[#e3ddd0] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left';

function accessLabel(level: AccessLevel): string {
  return level === 'it-only' ? 'IT-only' : 'Company';
}

function statusTone(status: DocStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'indexed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

function statusLabel(status: DocStatus): string {
  if (status === 'indexed') return 'Indexed';
  if (status === 'failed') return 'Failed';
  return 'Indexing';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InlineView({ nodes }: { nodes: InlineNode[] }) {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <span key={index}>{node.text}</span>;
    if (node.type === 'break') return <br key={index} />;
    if (node.type === 'code') return <code key={index}>{node.text}</code>;
    if (node.type === 'strong') return <strong key={index}><InlineView nodes={node.children} /></strong>;
    if (node.type === 'em') return <em key={index}><InlineView nodes={node.children} /></em>;
    return (
      <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
        {node.text}
      </a>
    );
  });
}

function Blocks({ blocks }: { blocks: DocumentBlock[] }) {
  return blocks.map((block, index) => {
    if (block.type === 'heading') {
      if (block.level === 1) return <h1 key={index}><InlineView nodes={block.children} /></h1>;
      if (block.level === 2) return <h2 key={index}><InlineView nodes={block.children} /></h2>;
      return <h3 key={index}><InlineView nodes={block.children} /></h3>;
    }
    if (block.type === 'list') {
      const items = block.items.map((item, itemIndex) => <li key={itemIndex}><InlineView nodes={item} /></li>);
      return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    if (block.type === 'quote') return <blockquote key={index}><InlineView nodes={block.children} /></blockquote>;
    if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>;
    return <p key={index}><InlineView nodes={block.children} /></p>;
  });
}

function ReadingPane({ document, showText }: { document: GuideDocument; showText: boolean }) {
  const extension = document.extension.toLowerCase();
  const isPdf = extension === '.pdf';
  const openHref = internalDocFilePath(document.id, isPdf);
  if (isPdf && !showText) {
    return (
      <iframe
        data-testid="guide-pdf"
        title={`${document.title} preview`}
        src={openHref}
        className="h-[min(78vh,960px)] min-h-[32rem] w-full border-0 bg-white"
      />
    );
  }

  const preview = extension === '.docx' && !showText ? sanitizeDocumentHtml(document.previewHtml || '') : '';
  const previewHasText = preview.replace(/<[^>]+>/g, '').trim().length > 0;
  if (preview && previewHasText) {
    return (
      <div className={pageClass}>
        <div data-testid="guide-body" className={proseClass} dangerouslySetInnerHTML={{ __html: preview }} />
      </div>
    );
  }

  const blocks = extension === '.md'
    ? parseMarkdownDocument(document.extractedText)
    : parsePlainDocument(document.extractedText);
  return (
    <div className={pageClass}>
      <article data-testid="guide-body" className={proseClass}>
        {blocks.length > 0 ? <Blocks blocks={blocks} /> : (
          <>
            <p>This document has no indexed text yet.</p>
            <p>
              <a href={openHref} {...(isPdf ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                Open {document.originalName}
              </a>
            </p>
          </>
        )}
      </article>
    </div>
  );
}

export function GuideReader({
  document,
  canManage,
  onAccessChange,
  onReindex,
  onDelete,
}: {
  document: GuideDocument;
  canManage: boolean;
  onAccessChange: (level: AccessLevel) => void;
  onReindex: () => void;
  onDelete: () => void;
}) {
  const [showText, setShowText] = useState(false);

  const isPdf = document.extension.toLowerCase() === '.pdf';
  const openHref = internalDocFilePath(document.id, isPdf);
  const downloadHref = internalDocFilePath(document.id, false);
  const openLinkProps = isPdf ? { target: '_blank' as const, rel: 'noopener noreferrer' } : {};
  const extensionLabel = document.extension.replace('.', '').toUpperCase() || 'FILE';

  return (
    <div data-testid="guide-reader">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--mos-border-subtle)] px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-lg font-[560] tracking-[-0.03em] text-[var(--mos-text)]">{document.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              data-testid="guide-filename"
              href={openHref}
              {...openLinkProps}
              aria-label={`Open ${document.originalName}`}
              className="break-all text-sm font-medium text-[var(--mos-accent-soft)] underline decoration-[var(--mos-accent-border)] underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mos-accent-ring)]"
            >
              {document.originalName}
            </a>
            <span className="text-xs text-[var(--mos-text-faint)]">{extensionLabel} · {formatSize(document.fileSize)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={document.accessLevel === 'it-only' ? 'info' : 'neutral'}>{accessLabel(document.accessLevel)}</StatusBadge>
          <StatusBadge tone={statusTone(document.status)}>{statusLabel(document.status)}</StatusBadge>
          {isPdf && (
            <Button size="sm" onClick={() => setShowText(current => !current)}>
              {showText ? 'Show PDF' : 'Show text'}
            </Button>
          )}
          <a data-testid="guide-open-file" href={openHref} {...openLinkProps} className={controlLink}>Open file</a>
          <a data-testid="guide-download" href={downloadHref} className={controlLink}>Download</a>
        </div>
      </header>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--mos-border-subtle)] px-4 py-2 sm:px-5">
          <label className="text-xs text-[var(--mos-text-muted)]">
            Access
            <Select
              aria-label="Change access level"
              value={document.accessLevel}
              onChange={event => onAccessChange(event.target.value as AccessLevel)}
              className="ml-2"
            >
              <option value="company">Company</option>
              <option value="it-only">IT-only</option>
            </Select>
          </label>
          <Button size="sm" onClick={onReindex}>Reindex</Button>
          <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
        </div>
      )}
      {document.errorMessage && <p className="px-4 py-2 text-sm text-red-300 sm:px-5">{document.errorMessage}</p>}
      <ReadingPane document={document} showText={showText} />
    </div>
  );
}
