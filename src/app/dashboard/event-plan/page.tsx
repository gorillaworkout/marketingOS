'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { buildEventPlanDownload, eventPlanDownloadFilename } from '@/lib/event-plan-download';
import {
  EVENT_PLAN_HISTORY_TYPE,
  restoreEventPlan,
  type EventPlanHistoryTask,
} from '@/lib/event-plan-history';
import { NO_PUBLIC_PRICE_NOTE } from '@/lib/event-plan-pricing';
import type { EventPlanResearch } from '@/lib/event-plan-research';
import { Button, DataTableFrame, FormField, Panel, PageHeader, PageStack, SectionHeader, StatusBadge, TextArea, TextInput, Toolbar } from '@/components/ui/dashboard';
import InlineModelSelector from '@/components/InlineModelSelector';
import { TASK_EDITOR_QUERY, fetchOwnHistoryTask } from '@/lib/history-editor';

type BudgetItem = { category: string; estimatedCost: number | null; notes: string; suggestedVendor?: string; venue?: string; sourceUrl?: string | null };
type Budget = { currency: 'IDR'; total?: number | null; items: BudgetItem[]; contingency?: number | null; preliminary?: boolean; publicPricesFound?: boolean; ceilingNote?: string };
type EventPlanOption = {
  style: string;
  styleLabel: string;
  objective?: string;
  concept?: string;
  theme?: string;
  venue?: string;
  speakers?: unknown;
  budget?: unknown;
  timeline?: string;
  research?: EventPlanResearch;
};
type GenerationEvent = {
  step?: string;
  progress?: number;
  message?: string;
  result?: { success?: boolean; options?: EventPlanOption[]; usage?: { plan?: unknown } };
};
type TokenUsage = { inputTokens?: number; outputTokens?: number; model?: string };
type ProgressState = { message: string; progress?: number; step?: string };

const EVENT_PLAN_LIVE_STEPS = ['Searching', 'Reading', 'Drafting'] as const;

function liveStepIndex(step?: string) {
  if (step === 'reading') return 1;
  if (step === 'draft' || step === 'done') return 2;
  return 0;
}

export function formatIDR(value: number | string) {
  const amount = typeof value === 'number' ? value : Number(String(value).replace(/\D/g, ''));
  return `Rp ${Number.isFinite(amount) ? Math.max(0, Math.floor(amount)).toLocaleString('id-ID') : '0'}`;
}

function formatBudgetAmount(value: number | null | undefined) {
  if (value === null || value === undefined) return 'Not known yet';
  return formatIDR(value);
}

function formatTargetDate(value: string) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(date);
}

function asRupiah(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const digits = value.replace(/\D/g, '');
    return digits ? Number(digits) : null;
  }
  return null;
}

function normalizeBudget(value: unknown): Budget | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const source = candidate as Record<string, unknown>;
  const items = Array.isArray(source.items) ? source.items.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    return [{
      category: typeof entry.category === 'string' ? entry.category : 'Other',
      estimatedCost: asRupiah(entry.estimatedCost),
      notes: typeof entry.notes === 'string' ? entry.notes : '—',
      suggestedVendor: typeof entry.suggestedVendor === 'string' ? entry.suggestedVendor : undefined,
      venue: typeof entry.venue === 'string' ? entry.venue : undefined,
      sourceUrl: typeof entry.sourceUrl === 'string' ? entry.sourceUrl : null,
    }];
  }) : [];
  return {
    currency: 'IDR',
    total: asRupiah(source.total),
    contingency: asRupiah(source.contingency),
    preliminary: source.preliminary === true,
    publicPricesFound: source.publicPricesFound === true,
    ceilingNote: typeof source.ceilingNote === 'string' ? source.ceilingNote : undefined,
    items,
  };
}

export default function EventPlanPage() {
  const [eventName, setEventName] = useState('');
  const [theme, setTheme] = useState('');
  const [location, setLocation] = useState('Jakarta');
  const [budget, setBudget] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [researchLinks, setResearchLinks] = useState('');
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<EventPlanOption[]>([]);
  const [selectedOption, setSelectedOption] = useState(0);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState('');
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [recent, setRecent] = useState<EventPlanHistoryTask[]>([]);
  const [recentError, setRecentError] = useState('');

  const fetchRecent = useCallback(async () => {
    try {
      const response = await fetch(`/api/dashboard/history?type=${EVENT_PLAN_HISTORY_TYPE}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `History request failed (${response.status}).`);
      setRecent(Array.isArray(data.tasks) ? data.tasks.slice(0, 10) : []);
      setRecentError('');
    } catch (cause) {
      setRecentError(cause instanceof Error ? cause.message : 'Could not load recent event plans.');
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const template = params.get('template');
    // Apply the template query after mount so the server render stays stable.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL is an external input read once on mount
    if (template) setTheme(template);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetch-on-mount pattern used across dashboard pages
    void fetchRecent();
  }, [fetchRecent]);

  const restoreHistory = (task: EventPlanHistoryTask) => {
    try {
      const restored = restoreEventPlan(task);
      setEventName(restored.eventName);
      setTheme(restored.theme);
      setLocation(restored.location);
      setBudget(restored.budget);
      setTargetDate(restored.targetDate);
      setResearchLinks(restored.researchLinks);
      setOptions(restored.options as EventPlanOption[]);
      setSelectedOption(0);
      setTokenUsage(restored.model ? { model: restored.model } : null);
      setError('');
      setProgress(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the saved event plan.');
    }
  };

  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get(TASK_EDITOR_QUERY);
    if (!taskId) return;
    let active = true;
    void fetchOwnHistoryTask(EVENT_PLAN_HISTORY_TYPE, taskId).then(task => {
      if (active && task) restoreHistory(task as EventPlanHistoryTask);
    });
    return () => { active = false; };
    // Open the history deep link once. restoreHistory closes over stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setOptions([]);
    setSelectedOption(0);
    setTokenUsage(null);
    setProgress({ message: 'Starting event plan generation…', progress: 0, step: 'research' });
    try {
      const res = await fetch('/api/event-plan/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName, theme, location, budget: budget ? Number(budget) : undefined, targetDate, researchUrls: researchLinks.split(/\r?\n/).map((url) => url.trim()).filter(Boolean) }),
      });
      if (!res.ok) throw new Error(`Generation failed (${res.status})`);
      if (!res.body) throw new Error('The generation stream was unavailable');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const consumeLines = (text: string) => {
        buffer += text;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice('data: '.length)) as GenerationEvent;
            if (event.message || event.step) {
              setProgress((current) => ({
                message: event.message || current?.message || 'Working on the event plan…',
                progress: event.progress ?? current?.progress,
                step: event.step || current?.step,
              }));
            }
            if (event.step === 'error') setError(event.message || 'Generation failed');
            if (event.step === 'done') {
              if (!event.result?.success) setError(event.message || 'Generation failed');
              else {
                const generatedOptions = Array.isArray(event.result.options) ? event.result.options : [];
                setOptions(generatedOptions);
                setSelectedOption(0);
                const usage = event.result.usage?.plan;
                setTokenUsage(usage && typeof usage === 'object' ? usage as TokenUsage : null);
                void fetchRecent();
              }
            }
          } catch {
            // Wait for the next line if a proxy delivered an incomplete SSE message.
          }
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        consumeLines(decoder.decode(value, { stream: true }));
      }
      consumeLines(decoder.decode());
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Network error');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const result = options[selectedOption];
  const displayBudget = normalizeBudget(result?.budget);
  const speakers = Array.isArray(result?.speakers) ? result.speakers.filter((speaker): speaker is string => typeof speaker === 'string') : [];
  const research = result?.research || { status: 'unverified' as const, sources: [], contacts: [] };
  const handleDownload = (format: 'doc' | 'json') => {
    if (!result) return;
    const download = buildEventPlanDownload({ eventName, location, theme, targetDate, option: { ...result, research } }, format);
    const blob = new Blob([download.content], { type: download.mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = eventPlanDownloadFilename(eventName, format);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  return (
    <PageStack className="max-w-5xl">
      <PageHeader eyebrow="Create / Events" title="Event plan" description="Research, proposal, and budgeting in one workflow with a clear source check." actions={<Link href={`/dashboard/history?type=${EVENT_PLAN_HISTORY_TYPE}`} className="inline-flex h-9 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3.5 text-sm font-medium text-[var(--mos-text-secondary)] hover:border-[var(--mos-border-strong)]">Open history</Link>} />
      <InlineModelSelector feature="event-plan" />

      <Panel>
      <form onSubmit={handleGenerate} className="space-y-5">
        <SectionHeader title="Event brief" description="Set the operating constraints and optional research sources." />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Event name" required><TextInput value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g., Bloomberg Awarding Night" required /></FormField>
          <FormField label="Location"><TextInput value={location} onChange={e => setLocation(e.target.value)} placeholder="Jakarta" /></FormField>
          <FormField label="Theme"><TextInput value={theme} onChange={e => setTheme(e.target.value)} placeholder="e.g., Financial Awards" /></FormField>
          <FormField label="Budget ceiling" hint="IDR"><TextInput inputMode="numeric" value={budget ? formatIDR(budget) : ''} onChange={e => setBudget(e.target.value.replace(/\D/g, ''))} placeholder="Rp 50.000.000" /></FormField>
          <FormField label="Event target date"><TextInput type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} /></FormField>
        </div>
        <FormField label="Research / quotation links" hint="Optional · maximum 5"><TextArea value={researchLinks} onChange={e => setResearchLinks(e.target.value)} rows={4} placeholder={'https://official-vendor.example/proposal\nhttps://hotel.example/price-list'} /><span className="mt-1.5 block text-xs leading-5 text-[var(--mos-text-faint)]">One public URL per line. The server reads that page and looks for venue rental prices and speaker fees. The result is not a verified quotation.</span></FormField>
        <Button type="submit" variant="primary" disabled={loading || !eventName}>{loading ? 'Generating…' : 'Generate plan'}</Button>
      </form>
      </Panel>

      {loading && progress && <div role="status" aria-live="polite"><Toolbar><span className="text-sm text-[var(--mos-text-secondary)]">{progress.message}</span>{progress.progress !== undefined && <StatusBadge tone="info" dot>{progress.progress}%</StatusBadge>}</Toolbar><ol className="mt-3 flex flex-wrap gap-2" aria-label="Event plan progress">{EVENT_PLAN_LIVE_STEPS.map((label, index) => { const active = liveStepIndex(progress.step) === index; const complete = liveStepIndex(progress.step) > index; return <li key={label}><StatusBadge tone={active ? 'info' : complete ? 'success' : 'neutral'} dot={active}>{label}</StatusBadge></li>; })}</ol></div>}
      {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg" role="alert">{error}</div>}

      {options.length > 0 && result && (
        <div className="space-y-6">
          <section><SectionHeader className="mb-3" title="Choose a plan style" description="Compare concepts and open the full operating plan." /><div className="grid grid-cols-1 md:grid-cols-3 gap-3">{options.map((option, index) => <button type="button" key={`${option.style}-${index}`} onClick={() => setSelectedOption(index)} className={`rounded-[var(--mos-radius-control)] border bg-[var(--mos-panel)] p-4 text-left transition-colors ${selectedOption === index ? 'border-[var(--mos-accent-border)] ring-2 ring-[var(--mos-accent-ring)]' : 'border-[var(--mos-border)] hover:border-[var(--mos-border-strong)]'}`}><p className="font-semibold text-white">{option.styleLabel || option.style}</p><p className="text-sm text-[var(--mos-text-secondary)] mt-2 line-clamp-3">{option.concept || option.objective || 'No concept preview available.'}</p><p className="text-xs text-[var(--mos-text-faint)] mt-3">{option.objective || 'View full plan'}</p></button>)}</div></section>
          <Panel>
            <SectionHeader className="mb-5" title={result.styleLabel || 'Event plan'} description="Selected plan details, budget, timeline, and research provenance." />
            {result.objective && <Detail label="Objective" value={result.objective} />}
            {result.concept && <Detail label="Concept" value={result.concept} />}
            {result.theme && <Detail label="Theme" value={result.theme} />}
            <Detail label="Venue / location" value={result.venue?.trim() || location || 'Jakarta'} />
            {targetDate && <Detail label="Event target date" value={formatTargetDate(targetDate)} />}
            {speakers.length > 0 && <div className="mb-4"><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Speakers</label><ul className="mt-2 divide-y divide-[var(--mos-border-subtle)] rounded-[var(--mos-radius-control)] border border-[var(--mos-border)]">{speakers.map((speaker, index) => <li key={index} className="px-3 py-2 text-[var(--mos-text-secondary)]">{speaker}</li>)}</ul></div>}
            <BudgetBreakdown budget={displayBudget} />
            {result.timeline && <Detail label="Timeline" value={result.timeline} preserveWhitespace />}
            <ResearchPanel research={research} />
          </Panel>
          <Toolbar><div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => handleDownload('doc')}>Download event plan (.doc)</Button><Button onClick={() => handleDownload('json')}>Download JSON</Button></div>{tokenUsage && <div className="text-right"><p className="text-xs font-medium text-[var(--mos-text-secondary)]">{(tokenUsage.inputTokens || 0) + (tokenUsage.outputTokens || 0)} tokens</p>{tokenUsage.model && <p className="text-[11px] text-[var(--mos-text-faint)]">{tokenUsage.model}</p>}</div>}</Toolbar>
        </div>
      )}

      <Panel padding="none">
        <div className="flex items-center justify-between border-b border-[var(--mos-border-subtle)] px-5 py-4">
          <SectionHeader title="Recent Generated" description="Open a saved event plan without generating again." />
          <Link href={`/dashboard/history?type=${EVENT_PLAN_HISTORY_TYPE}`} className="text-sm text-[var(--mos-accent-soft)] hover:underline">View all history</Link>
        </div>
        {recentError ? <p className="p-5 text-sm text-red-300">{recentError}</p> : recent.length === 0 ? <p className="p-5 text-sm text-[var(--mos-text-muted)]">No saved event plans yet.</p> : <div className="divide-y divide-[var(--mos-border-subtle)]">{recent.map(task => <button type="button" key={task.id} onClick={() => restoreHistory(task)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--mos-raised)]"><span className="min-w-0"><span className="block truncate text-sm font-medium text-white">{task.title}</span><span className="block text-xs text-[var(--mos-text-faint)]">{new Date(task.created_at).toLocaleString()}</span></span><span className="text-xs text-[var(--mos-accent-soft)]">Open</span></button>)}</div>}
      </Panel>
    </PageStack>
  );
}

function Detail({ label, value, preserveWhitespace = false }: { label: string; value: string; preserveWhitespace?: boolean }) {
  return <div className="mb-4"><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">{label}</label><p className={`mt-2 border-l border-[var(--mos-border-strong)] pl-3 text-sm leading-6 text-[var(--mos-text-secondary)] ${preserveWhitespace ? 'whitespace-pre-wrap' : ''}`}>{value}</p></div>;
}

function BudgetBreakdown({ budget }: { budget: Budget | null }) {
  if (!budget) return <div className="mb-4"><label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Budget breakdown</label><p className="mt-2 text-sm text-[var(--mos-text-muted)]">Budget details were unavailable for this plan.</p></div>;
  return (
    <div className="mb-4">
      <label className="text-xs text-[var(--mos-text-faint)] uppercase tracking-wide">Budget breakdown</label>
      <p className="mt-1 text-xs text-[var(--mos-text-faint)]">{NO_PUBLIC_PRICE_NOTE}. Figures in the table appear only when they are in a public source. This is not a verified quotation.</p>
      {budget.ceilingNote && <p className="mt-1 text-xs text-amber-300">{budget.ceilingNote}</p>}
      <DataTableFrame className="mt-2">
        <table className="w-full text-sm text-left">
          <thead className="bg-[var(--mos-raised)] text-[var(--mos-text-secondary)]">
            <tr>
              <th className="p-3">Category</th>
              <th className="p-3">Suggested vendor</th>
              <th className="p-3">Notes</th>
              <th className="p-3 text-right">Public price</th>
            </tr>
          </thead>
          <tbody>
            {budget.items.length ? budget.items.map((item, index) => (
              <tr key={index} className="border-t border-[var(--mos-border)] align-top text-[var(--mos-text-secondary)]">
                <td className="p-3 whitespace-nowrap">{item.category}</td>
                <td className="p-3 min-w-[12rem]">
                  <p>{item.suggestedVendor || '—'}</p>
                  {item.venue && <p className="mt-1 text-xs text-[var(--mos-text-faint)]">{item.venue}</p>}
                </td>
                <td className="p-3 max-w-xl whitespace-pre-wrap leading-6">{item.notes}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <p>{formatBudgetAmount(item.estimatedCost)}</p>
                  {item.sourceUrl && <a className="mt-1 inline-block text-xs underline" href={item.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
                </td>
              </tr>
            )) : (
              <tr className="border-t border-[var(--mos-border)] text-[var(--mos-text-muted)]">
                <td className="p-3" colSpan={4}>No itemized budget details were provided.</td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-[var(--mos-raised)] text-white">
            <tr>
              <td className="p-3 font-medium" colSpan={3}>Contingency</td>
              <td className="p-3 text-right whitespace-nowrap">{formatBudgetAmount(budget.contingency)}</td>
            </tr>
            <tr>
              <td className="p-3 font-semibold" colSpan={3}>Total public price</td>
              <td className="p-3 text-right font-semibold whitespace-nowrap">{formatBudgetAmount(budget.total)}</td>
            </tr>
          </tfoot>
        </table>
      </DataTableFrame>
    </div>
  );
}

function ResearchPanel({ research }: { research: EventPlanResearch }) {
  const contacts = research.contacts.filter((contact) => Boolean(contact.sourceUrl) && (contact.phone || contact.email));
  const hasSources = research.sources.length > 0;
  return (
    <section className={`mt-4 rounded-lg border p-4 ${hasSources ? 'border-blue-500/40 bg-blue-500/10 text-blue-100' : 'border-2 border-amber-400 bg-amber-500/15 text-amber-100'}`} role={hasSources ? undefined : 'alert'}>
      <h4 className="font-semibold">Budget research sources</h4>
      <p className="mt-1 text-sm">{NO_PUBLIC_PRICE_NOTE}. The public pages below are not a verified quotation.</p>
      {research.queries && research.queries.length > 0 && <p className="mt-2 text-xs">Searches: {research.queries.join(' · ')}</p>}
      {hasSources ? (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide">Sources</p>
          <ul className="mt-1 space-y-3 text-sm">
            {research.sources.map((source, index) => (
              <li key={`${source.url}-${source.query || source.claim}-${index}`}>
                {source.title && <p className="font-medium">{source.title}</p>}
                <a className="underline hover:text-white" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
                <p>{source.claim}</p>
                {source.snippet && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 opacity-90">{source.snippet}</p>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-sm">Public search did not find a price page for this budget.</p>
      )}
      {contacts.length > 0 && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide">Contacts</p>
          <ul className="mt-1 space-y-1 text-sm">
            {contacts.map((contact, index) => (
              <li key={`${contact.sourceUrl}-${index}`}>
                <span className="font-medium">{contact.vendor}</span>
                {contact.phone ? ` · ${contact.phone}` : ''}
                {contact.email ? ` · ${contact.email}` : ''}
                {' · '}
                <a className="underline hover:text-white" href={contact.sourceUrl} target="_blank" rel="noreferrer">Source</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
