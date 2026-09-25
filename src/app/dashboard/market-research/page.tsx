'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { buildMarketResearchDocxBlob, marketResearchDocxFilename } from '@/lib/market-research-docx';
import { formatMarketResearchEvidenceLevel, type MarketResearchEvidenceLevel, type MarketResearchInput, type MarketResearchItem } from '@/lib/market-research';
import { formatMarketResearchSourceStatus, type MarketResearchSourceStatus } from '@/lib/market-research-status';
import { Button, FormField, Panel, PageHeader, PageStack, SectionHeader, StatusBadge, TextArea, TextInput, Toolbar } from '@/components/ui/dashboard';
import InlineModelSelector from '@/components/InlineModelSelector';
import { TASK_EDITOR_QUERY, fetchOwnHistoryTask } from '@/lib/history-editor';

interface MarketResearchResult {
  items: MarketResearchItem[];
  input: MarketResearchInput;
  model: string;
  groupsSearched: string[];
  groupCandidateCounts: Record<string, number>;
  sourceStatus: MarketResearchSourceStatus[];
  candidateCount: number;
  themeCandidateCount?: number;
  historyId: string | null;
}

interface ShortlistCandidate {
  id: string;
  outlet: string;
  title: string;
  url: string;
  publishedAt: string;
  publicationTimeKnown: boolean;
  categories: string[];
  symbols: string[];
  importanceCategory: string;
  evidenceLevel: MarketResearchEvidenceLevel;
  excerpt: string;
}

interface ShortlistPayload {
  gatherToken: string;
  candidates: ShortlistCandidate[];
  groupsSearched: string[];
  groupCandidateCounts: Record<string, number>;
  sourceStatus: MarketResearchSourceStatus[];
  themeCandidateCount: number;
}

interface MarketResearchHistoryTask {
  id: string;
  title: string;
  brief?: string;
  output_data?: string;
  created_at: string;
}

function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function publishedLabel(publishedAt: string, timeKnown: boolean): string {
  const date = publishedAt.slice(0, 10);
  if (!timeKnown) return `${date} · time not stated`;
  return `${date} ${publishedAt.slice(11, 16)} WIB`;
}

function evidenceTone(level: MarketResearchEvidenceLevel | undefined): 'success' | 'warning' | 'neutral' {
  if (level === 'full-text') return 'success';
  if (level === 'search-snippet') return 'warning';
  return 'neutral';
}

export default function MarketResearchPage() {
  const [brief, setBrief] = useState('');
  const [researchDate] = useState(todayWib);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [errorSourceStatus, setErrorSourceStatus] = useState<MarketResearchSourceStatus[]>([]);
  const [result, setResult] = useState<MarketResearchResult | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistPayload | null>(null);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [recent, setRecent] = useState<MarketResearchHistoryTask[]>([]);
  const [recentError, setRecentError] = useState('');

  const fetchRecent = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/history?type=market-research');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `History request failed (${response.status}).`);
      setRecent(Array.isArray(data.tasks) ? data.tasks.slice(0, 10) : []);
      setRecentError('');
    } catch (cause) {
      setRecentError(cause instanceof Error ? cause.message : 'Failed to load recent Market Research.');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchRecent();
    })();
  }, [fetchRecent]);

  const restoreHistory = (task: MarketResearchHistoryTask) => {
    try {
      const stored = JSON.parse(task.output_data || '{}');
      const items = stored.report?.items;
      if (!stored.input || !Array.isArray(items) || items.length === 0) throw new Error('Saved report is incomplete.');
      setBrief(stored.input.brief || task.brief || '');
      setResult({
        items,
        input: stored.input,
        model: stored.model || 'Unknown',
        groupsSearched: stored.groupsSearched || [],
        groupCandidateCounts: stored.groupCandidateCounts || {},
        sourceStatus: stored.sourceStatus || [],
        candidateCount: Number(stored.candidateCount || items.length),
        themeCandidateCount: Number(stored.themeCandidateCount || 0),
        historyId: task.id,
      });
      setShortlist(null);
      setPickedIds([]);
      setReviewConfirmed(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to restore saved report.');
    }
  };

  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get(TASK_EDITOR_QUERY);
    if (!taskId) return;
    let active = true;
    void fetchOwnHistoryTask('market-research', taskId).then(task => {
      if (active && task) restoreHistory(task as MarketResearchHistoryTask);
    });
    return () => { active = false; };
    // Open the history deep link once. restoreHistory closes over stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fillExample = () => setBrief('Prepare a morning briefing for the Dupoin marketing team. Prioritize central-bank decisions, official economic data, geopolitics, OPEC+, and the factual developments that matter most for trading sentiment today.');
  const fillThemeExample = () => setBrief('Brief the semiconductor export-control sector for today. Focus on confirmed policy actions and what they mean for US stocks sentiment.');

  const readStream = async (response: Response, onShortlist: (payload: ShortlistPayload) => void) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed with HTTP ${response.status}.`);
    }
    if (!response.body) throw new Error('Research stream is unavailable.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const rawEvent of events) {
        const line = rawEvent.split('\n').find(part => part.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        setProgress(Number(event.progress) || 0);
        setStatus(event.message || '');
        if (event.step === 'error') {
          if (Array.isArray(event.sourceStatus)) setErrorSourceStatus(event.sourceStatus as MarketResearchSourceStatus[]);
          throw new Error(event.message || 'Market research failed.');
        }
        if (event.step === 'shortlist' && event.shortlist) {
          onShortlist(event.shortlist as ShortlistPayload);
          completed = true;
        }
        if (event.step === 'done') {
          setResult(event.result as MarketResearchResult);
          setShortlist(null);
          void fetchRecent();
          completed = true;
        }
      }
    }
    if (!completed) throw new Error('Research stream ended without a completed report.');
  };

  const generate = async () => {
    setLoading(true); setError(''); setErrorSourceStatus([]); setResult(null); setShortlist(null); setPickedIds([]); setReviewConfirmed(false); setProgress(4); setStatus('Preparing secure same-day research…');
    try {
      const response = await fetch('/api/market-research/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief, researchDate }),
      });
      await readStream(response, payload => {
        setShortlist(payload);
        setPickedIds(payload.candidates.map(candidate => candidate.id));
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Market research failed.');
    } finally {
      setLoading(false);
    }
  };

  const briefSelected = async () => {
    if (!shortlist || pickedIds.length === 0) return;
    setLoading(true); setError(''); setErrorSourceStatus([]); setReviewConfirmed(false); setProgress(64); setStatus('Briefing the confirmed shortlist…');
    try {
      const response = await fetch('/api/market-research/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, researchDate, gatherToken: shortlist.gatherToken, candidateIds: pickedIds }),
      });
      await readStream(response, payload => {
        setShortlist(payload);
        setPickedIds(payload.candidates.map(candidate => candidate.id));
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Market research failed.');
    } finally {
      setLoading(false);
    }
  };

  const toggleCandidate = (id: string) => {
    setPickedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };

  const download = async () => {
    if (!result || !reviewConfirmed || result.items.length === 0) return;
    const blob = await buildMarketResearchDocxBlob(result.input.brief, result.input.researchDate, result.items);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = marketResearchDocxFilename(result.input.researchDate);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageStack>
      <PageHeader eyebrow="Create / Market intelligence" title="Market research" description="Give a brief. MarketingOS scans Forex, Commodity, US Indices, and US Stocks, and searches the open web for that theme. When several candidates match, confirm a shortlist before the briefing." actions={<Link href="/dashboard/history?type=market-research" className="inline-flex h-9 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3.5 text-sm font-medium text-[var(--mos-text-secondary)] hover:border-[var(--mos-border-strong)]">Open history</Link>} />
      <InlineModelSelector feature="market-research" />

      <Panel>
        <SectionHeader title="Research brief" description="The research date is locked to today in WIB. A theme or sector brief is searched beyond the fixed feeds." action={<div className="flex gap-2"><Button size="sm" onClick={fillExample}>Fill example</Button><Button size="sm" onClick={fillThemeExample}>Fill theme example</Button></div>} />
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_220px]">
          <FormField label="Brief" hint={`${brief.trim().length}/2000 characters`}><TextArea value={brief} onChange={event => setBrief(event.target.value)} rows={6} maxLength={2000} placeholder="Example: Brief the semiconductor export-control sector for today…" /></FormField>
          <FormField label="Research date" hint="WIB"><TextInput type="date" value={researchDate} readOnly /></FormField>
        </div>
        <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--mos-text-faint)]">Product groups always scanned</p><div className="mt-2 flex flex-wrap gap-2">{['Forex', 'Commodity', 'US Indices', 'US Stocks'].map(group => <StatusBadge key={group}>{group}</StatusBadge>)}<StatusBadge tone="info">Open web theme</StatusBadge></div></div>
        <div className="mt-5 rounded-[var(--mos-radius-panel)] border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100"><strong>Verification boundary:</strong> selection uses the publisher headline and summary, or the retrieved page text when a source could be read. Open every link and read the article before using the result externally.</div>
        <Button type="button" variant="primary" onClick={generate} disabled={loading || brief.trim().length < 20} className="mt-5">{loading ? 'Researching…' : shortlist ? 'Search again' : 'Generate market research'}</Button>
        {loading && <div className="mt-4"><div className="h-2 overflow-hidden rounded-full bg-[var(--mos-raised)]"><div className="h-full bg-cyan-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-sm text-[var(--mos-text-muted)]">{status}</p></div>}
        {error && <div className="mt-4 rounded-[var(--mos-radius-panel)] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"><p>{error}</p>{errorSourceStatus.length > 0 && <div className="mt-3 space-y-1">{errorSourceStatus.map(source => <p key={source.outlet} className={source.status === 'ok' ? 'text-xs text-emerald-200' : 'text-xs text-red-300'}>{source.outlet}: {formatMarketResearchSourceStatus(source)}</p>)}</div>}</div>}
      </Panel>

      {shortlist && <Panel>
        <SectionHeader title="Candidate shortlist" description="Uncheck stories you do not want in the briefing. At least one must stay selected." action={<Button size="sm" onClick={() => { setShortlist(null); setPickedIds([]); }}>Discard shortlist</Button>} />
        <div className="mt-4 flex flex-wrap gap-2">{shortlist.groupsSearched.map(group => <StatusBadge key={group}>{group}: {shortlist.groupCandidateCounts?.[group] ?? 0}</StatusBadge>)}{shortlist.themeCandidateCount > 0 && <StatusBadge tone="info">Theme: {shortlist.themeCandidateCount}</StatusBadge>}</div>
        <div className="mt-4 space-y-3">{shortlist.candidates.map(candidate => <div key={candidate.id} className="flex items-start gap-3 rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-surface)] p-4">
          <input id={`candidate-${candidate.id}`} type="checkbox" checked={pickedIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate.id)} className="mt-1 h-4 w-4 accent-cyan-500" />
          <div className="min-w-0 flex-1">
            <label htmlFor={`candidate-${candidate.id}`} className="block cursor-pointer text-sm font-medium text-white">{candidate.title}</label>
            <p className="mt-1 text-xs text-[var(--mos-text-muted)]">{candidate.outlet} · {(candidate.symbols.join(', ') || candidate.categories.join(', '))} · {candidate.importanceCategory} · {publishedLabel(candidate.publishedAt, candidate.publicationTimeKnown)}</p>
            <p className="mt-2 text-xs leading-5 text-[var(--mos-text-secondary)]">{candidate.excerpt}</p>
            <a href={candidate.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-[var(--mos-accent-soft)] hover:underline">Open source</a>
          </div>
          <StatusBadge tone={evidenceTone(candidate.evidenceLevel)}>{formatMarketResearchEvidenceLevel(candidate.evidenceLevel)}</StatusBadge>
        </div>)}</div>
        <Button type="button" variant="primary" onClick={() => void briefSelected()} disabled={loading || pickedIds.length === 0} className="mt-5">Brief selected candidates</Button>
        {pickedIds.length === 0 && <p className="mt-2 text-sm text-amber-200">Select at least one candidate.</p>}
      </Panel>}

      {result && <section className="space-y-4">
        <Toolbar><SectionHeader title="Selected market news" description={`${result.items.length} selected from ${result.candidateCount} candidates · Model: ${result.model}`} /><Button variant="primary" onClick={() => void download()} disabled={!reviewConfirmed || result.items.length === 0}>Download DOCX</Button></Toolbar>
        <div className="grid gap-3 md:grid-cols-2">
          <Panel padding="compact"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--mos-text-faint)]">Candidate coverage per product</p><div className="mt-3 flex flex-wrap gap-2">{result.groupsSearched.map(group => <StatusBadge key={group}>{group}: {result.groupCandidateCounts?.[group] ?? 0}</StatusBadge>)}{(result.themeCandidateCount ?? 0) > 0 && <StatusBadge tone="info">Theme: {result.themeCandidateCount}</StatusBadge>}</div></Panel>
          <Panel padding="compact"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--mos-text-faint)]">Publisher feed status</p><div className="mt-3 space-y-2">{result.sourceStatus?.map(source => <div key={source.outlet} className="flex items-start justify-between gap-3 text-xs"><span className="text-[var(--mos-text-secondary)]">{source.outlet}</span><StatusBadge tone={source.status === 'ok' ? 'success' : 'danger'} dot>{formatMarketResearchSourceStatus(source)}</StatusBadge></div>)}</div></Panel>
        </div>
        {result.items.length === 0 && <Panel><p className="text-sm text-[var(--mos-text-secondary)]">No briefing was saved. The evidence gate did not accept a selection.</p></Panel>}
        {result.items.map((item, index) => <Panel key={item.candidateId}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[var(--mos-accent-soft)]">#{index + 1} · {item.symbol || item.productCategory} · {item.productCategory}{item.importanceCategory ? ` · ${item.importanceCategory}` : ''}</p><h3 className="mt-1 text-base font-semibold text-white">{item.articleTitle}</h3><p className="mt-1 text-sm text-[var(--mos-text-muted)]">{item.newsSource}</p></div><div className="text-right text-xs text-[var(--mos-text-muted)]"><p>Published: {item.publicationDate} {item.publicationTime ? `${item.publicationTime} WIB` : 'time not stated'}</p><p>Latest Update Time: {item.latestUpdateTime ? `${item.latestUpdateTime} WIB` : 'Not provided'}</p><div className="mt-2"><StatusBadge tone={evidenceTone(item.evidenceLevel)}>{formatMarketResearchEvidenceLevel(item.evidenceLevel)}</StatusBadge></div></div></div><dl className="mt-5 grid gap-4 divide-y divide-[var(--mos-border-subtle)] md:grid-cols-3 md:divide-x md:divide-y-0">{[['Main event', item.mainEvent], ['Latest factual development', item.latestFactualDevelopment], ['Market relevance', item.marketRelevance]].map(([label, value]) => <div key={label} className="py-3 md:px-4 md:py-0 first:pl-0"><dt className="text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">{label}</dt><dd className="mt-2 text-sm leading-6 text-[var(--mos-text-secondary)]">{value}</dd></div>)}</dl><a href={item.articleUrl} target="_blank" rel="noreferrer" className="mt-4 block break-all text-sm text-[var(--mos-accent-soft)] hover:underline">Open publisher article: {item.articleUrl}</a></Panel>)}
        {result.items.length > 0 && <label className="flex cursor-pointer gap-3 rounded-[var(--mos-radius-panel)] border border-amber-500/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-500" /><span>I have opened every link, read the full articles, and checked the title, time, main event, factual development, and market relevance. Confirm to enable Download DOCX.</span></label>}
      </section>}

      <Panel padding="none">
        <div className="flex items-center justify-between border-b border-[var(--mos-border-subtle)] px-5 py-4">
          <SectionHeader title="Recent Generated" description="Open a saved Market Research report without generating again." />
          <Link href="/dashboard/history?type=market-research" className="text-sm text-[var(--mos-accent-soft)] hover:underline">View all history</Link>
        </div>
        {recentError ? <p className="p-5 text-sm text-red-300">{recentError}</p> : recent.length === 0 ? <p className="p-5 text-sm text-[var(--mos-text-muted)]">No saved Market Research yet.</p> : <div className="divide-y divide-[var(--mos-border-subtle)]">{recent.map(task => <button type="button" key={task.id} onClick={() => restoreHistory(task)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--mos-raised)]"><span className="min-w-0"><span className="block truncate text-sm font-medium text-white">{task.title}</span><span className="block text-xs text-[var(--mos-text-faint)]">{new Date(task.created_at).toLocaleString()}</span></span><span className="text-xs text-[var(--mos-accent-soft)]">Open</span></button>)}</div>}
      </Panel>
    </PageStack>
  );
}
