import type { ReactNode } from 'react';
import {
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from '@/lib/ai-research-markdown';

function renderInline(nodes: MarkdownInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === 'text') return <span key={key}>{node.value}</span>;
    if (node.type === 'code') {
      return (
        <code
          key={key}
          className="rounded bg-black/25 px-1 py-0.5 font-mono text-[12.5px]"
        >
          {node.value}
        </code>
      );
    }
    if (node.type === 'strong') {
      return <strong key={key} className="font-semibold">{renderInline(node.children, key)}</strong>;
    }
    if (node.type === 'em') {
      return <em key={key}>{renderInline(node.children, key)}</em>;
    }
    return (
      <a
        key={key}
        href={node.href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-indigo-300 underline decoration-indigo-400/50 underline-offset-2 hover:text-indigo-200"
      >
        {renderInline(node.children, key)}
      </a>
    );
  });
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  if (block.type === 'paragraph') {
    return <p key={index} className="whitespace-pre-wrap">{renderInline(block.children, `p${index}`)}</p>;
  }
  if (block.type === 'heading') {
    const className = block.level === 1
      ? 'text-base font-semibold'
      : block.level === 2
        ? 'text-sm font-semibold'
        : 'text-sm font-medium';
    const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5';
    return <Tag key={index} className={className}>{renderInline(block.children, `h${index}`)}</Tag>;
  }
  if (block.type === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag key={index} className={block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item, `l${index}-${itemIndex}`)}</li>
        ))}
      </Tag>
    );
  }
  if (block.type === 'table') {
    return (
      <div key={index} className="max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr>
              {block.headers.map((header, headerIndex) => (
                <th key={headerIndex} className="border-b border-[var(--mos-border)] py-1 pr-3 font-semibold">
                  {renderInline(header, `th${index}-${headerIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border-b border-[var(--mos-border-subtle)] py-1 pr-3 align-top">
                    {renderInline(cell, `td${index}-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <pre
      key={index}
      className="max-w-full overflow-x-auto rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] leading-5"
    >
      <code>{block.value}</code>
    </pre>
  );
}

export function AiResearchMarkdown({
  text,
  className = '',
  trailing,
}: {
  text: string;
  className?: string;
  trailing?: ReactNode;
}) {
  const blocks = parseMarkdown(text);
  return (
    <div className={`min-w-0 max-w-full space-y-2 break-words ${className}`.trim()} data-markdown="assistant">
      {blocks.length === 0 ? <p className="whitespace-pre-wrap">{text}</p> : blocks.map(renderBlock)}
      {trailing}
    </div>
  );
}

export function AiResearchFileChip({
  name,
  onRemove,
}: {
  name: string;
  onRemove?: () => void;
}) {
  return (
    <span className="relative inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-2.5 py-1.5 text-[11px] text-[var(--mos-text)]">
      <svg className="h-3.5 w-3.5 flex-shrink-0 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75A2.25 2.25 0 016 4.5h7.5L18 8.25v9A2.25 2.25 0 0115.75 19.5H6A2.25 2.25 0 013.75 17.25V6.75z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5V8.25H18" />
      </svg>
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] text-white"
          title={`Remove ${name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
