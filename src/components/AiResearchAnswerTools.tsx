'use client';

import { useState } from 'react';
import { COMPLIANCE_BANNER_TEXT, scanResearchCompliance } from '@/lib/ai-research-compliance';
import {
  AI_RESEARCH_HANDOFF_MODULES,
  writeAiResearchHandoff,
  type AiResearchHandoffSource,
  type AiResearchHandoffTarget,
} from '@/lib/ai-research-handoff';

const chipClass = 'rounded-full border border-[var(--mos-border)] bg-[var(--mos-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--mos-text)] hover:bg-[var(--mos-hover)] disabled:opacity-40';

export function AiResearchAnswerTools({
  query,
  answer,
  sources,
  conversationId,
}: {
  query: string;
  answer: string;
  sources: AiResearchHandoffSource[];
  conversationId?: string | null;
}) {
  const scan = scanResearchCompliance(answer);
  const [shareState, setShareState] = useState<'idle' | 'working' | 'done'>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [handoffNote, setHandoffNote] = useState('');

  const share = async () => {
    if (shareState === 'working') return;
    if (!conversationId) {
      setShareError('This conversation is not saved yet.');
      return;
    }
    setShareState('working');
    setShareError('');
    try {
      const response = await fetch('/api/ai-research/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, answer }),
      });
      const data = await response.json().catch(() => ({})) as { path?: string; error?: string; ttlDays?: number };
      if (!response.ok || !data.path) throw new Error(data.error || 'Could not create the link');
      const url = `${window.location.origin}${data.path}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // The URL stays visible so it can be copied by hand.
      }
      setShareState('done');
    } catch (error) {
      setShareState('idle');
      setShareError(error instanceof Error ? error.message : 'Could not create the link');
    }
  };

  const handoff = (target: AiResearchHandoffTarget, href: string) => {
    writeAiResearchHandoff({
      target,
      query,
      answer,
      sources,
    });
    setHandoffNote('Opening the form. Not published yet.');
    window.location.assign(href);
  };

  return (
    <div className="mt-2 space-y-2" data-testid="ai-research-answer-tools">
      {scan.flagged && (
        <div
          role="status"
          data-testid="ai-research-compliance"
          className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-[11px] leading-5 text-amber-100"
        >
          <p className="font-semibold">{COMPLIANCE_BANNER_TEXT}</p>
          <ul className="mt-1 space-y-0.5 text-amber-50/90">
            {scan.flags.map(flag => (
              <li key={flag.kind}>
                {flag.label}{flag.excerpt ? ` — “${flag.excerpt}”` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          data-testid="ai-research-share"
          onClick={() => { void share(); }}
          disabled={shareState === 'working' || !conversationId}
          className={chipClass}
        >
          {shareState === 'working' ? 'Sharing…' : shareState === 'done' ? 'Link copied' : 'Share'}
        </button>
        {AI_RESEARCH_HANDOFF_MODULES.map(module => (
          <button
            key={module.id}
            type="button"
            data-testid={`ai-research-handoff-${module.id}`}
            onClick={() => handoff(module.id, module.href)}
            className={chipClass}
          >
            {module.label}
          </button>
        ))}
      </div>
      {shareUrl && (
        <p className="break-all px-1 text-[10px] leading-4 text-[var(--mos-text-muted)]">
          Read-only link for 30 days:{' '}
          <a
            href={shareUrl}
            data-testid="ai-research-share-url"
            className="text-indigo-300 underline underline-offset-2"
          >
            {shareUrl}
          </a>
        </p>
      )}
      {shareError && <p className="px-1 text-[10px] text-red-300">{shareError}</p>}
      {handoffNote && <p className="px-1 text-[10px] text-[var(--mos-text-muted)]">{handoffNote}</p>}
    </div>
  );
}
