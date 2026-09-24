'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { jakartaDate, validateGeneratedArticle, type ArticleMarketNewsInput, type ArticleQualityCheck } from '@/lib/article-market-news';
import { articleDocxFilename, buildArticleDocxBlob } from '@/lib/article-market-news-docx';
import {
  ARTICLE_MARKET_NEWS_HISTORY_TYPE,
  restoreArticleMarketNews,
  type ArticleMarketNewsHistoryTask,
} from '@/lib/article-market-news-history';
import { Button, FormField, Panel, SectionHeader, StatusBadge, TextArea, TextInput, Toolbar } from '@/components/ui/dashboard';
import {
  ARTICLE_MARKET_NEWS_EXAMPLE_ANGLE,
  ARTICLE_MARKET_NEWS_EXAMPLE_KEYWORD,
  exampleCompetitorHeadings,
  examplePaaText,
} from '@/lib/article-market-news-example';
import { AI_RESEARCH_HANDOFF_QUERY, AI_RESEARCH_HANDOFF_VALUE, readAiResearchHandoff } from '@/lib/ai-research-handoff';

interface SourceForm {
  outlet: string;
  title: string;
  url: string;
  publishedAt: string;
  verifiedFacts: string;
}

interface ArticleResult {
  title: string;
  metaDescription?: string;
  articleMarkdown: string;
  excerpt?: string;
  sourcesCited?: string[];
  wordCount: number;
  model: string;
  qc: ArticleQualityCheck;
  historyId?: string;
  normalizedInput?: ArticleMarketNewsInput;
}

const emptySource = (): SourceForm => ({ outlet: '', title: '', url: '', publishedAt: '', verifiedFacts: '' });

function ExampleSample({
  title,
  description,
  value,
  copyLabel,
  copied,
  onCopy,
}: {
  title: string;
  description: string;
  value: string;
  copyLabel: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-cyan-100">{title}</h4>
        <Button size="sm" onClick={onCopy}>{copied ? 'Copied' : copyLabel}</Button>
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--mos-text-muted)]">{description}</p>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-cyan-500/20 bg-black/30 p-3 font-mono text-xs leading-5 text-cyan-50">{value}</pre>
    </div>
  );
}

export default function ArticleMarketNewsGenerator() {
  const [keyword, setKeyword] = useState('');
  const [researchDate, setResearchDate] = useState(jakartaDate);
  const [angle, setAngle] = useState('');
  const [competitorHeadings, setCompetitorHeadings] = useState('');
  const [paaText, setPaaText] = useState('');
  const [sources, setSources] = useState<SourceForm[]>([]);
  const [noCompetitorBroker, setNoCompetitorBroker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ArticleResult | null>(null);
  const [generatedInput, setGeneratedInput] = useState<ArticleMarketNewsInput | null>(null);
  const [factReviewConfirmed, setFactReviewConfirmed] = useState(false);
  const [recent, setRecent] = useState<ArticleMarketNewsHistoryTask[]>([]);
  const [recentError, setRecentError] = useState('');
  const [copiedSample, setCopiedSample] = useState<'competitors' | 'paa' | ''>('');
  const [researchHandoff, setResearchHandoff] = useState(false);

  const fetchRecent = useCallback(async () => {
    try {
      const response = await fetch(`/api/dashboard/history?type=${ARTICLE_MARKET_NEWS_HISTORY_TYPE}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `History request failed (${response.status}).`);
      setRecent(Array.isArray(data.tasks) ? data.tasks.slice(0, 10) : []);
      setRecentError('');
    } catch (cause) {
      setRecentError(cause instanceof Error ? cause.message : 'Could not load Article Market News history.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetch-on-mount pattern used across all dashboard pages
    void fetchRecent();
  }, [fetchRecent]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(AI_RESEARCH_HANDOFF_QUERY) !== AI_RESEARCH_HANDOFF_VALUE) return;
    const handoff = readAiResearchHandoff('article-market-news');
    if (!handoff?.keyword || !handoff.angle) return;
    // Prefill only. Do not call generateArticle.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read a same-tab handoff once on mount
    setKeyword(handoff.keyword);
    setAngle(handoff.angle);
    setResearchHandoff(true);
  }, []);

  const restoreHistory = (task: ArticleMarketNewsHistoryTask) => {
    try {
      const restored = restoreArticleMarketNews(task);
      setKeyword(restored.keyword);
      setResearchDate(restored.researchDate);
      setAngle(restored.angle);
      setCompetitorHeadings(restored.competitorHeadings);
      setPaaText(restored.paaText);
      setSources(restored.sources.map(source => ({
        outlet: source.outlet,
        title: source.title,
        url: source.url,
        publishedAt: source.publishedAt,
        verifiedFacts: source.verifiedFacts,
      })));
      setNoCompetitorBroker(restored.noCompetitorBroker);
      setResult(restored.result);
      setGeneratedInput(restored.generatedInput);
      setFactReviewConfirmed(restored.factReviewConfirmed);
      setError('');
      setProgress('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the saved article.');
    }
  };

  const paaQuestions = useMemo(() => paaText.split('\n').map(value => value.trim()).filter(Boolean), [paaText]);
  const competitorResearchCount = useMemo(() => new Set([...competitorHeadings.matchAll(/(?:competitor|artikel)\s*([1-5])\s*:/gi)].map(match => match[1])).size, [competitorHeadings]);
  const optionalReferencesReady = sources.length === 0 || Boolean(
    noCompetitorBroker && sources.every(source => source.outlet.trim() && source.title.trim() && source.url.trim() && source.publishedAt && source.verifiedFacts.trim()),
  );
  const ready = Boolean(
    keyword.trim() && researchDate && angle.trim() && competitorHeadings.trim() && competitorResearchCount === 5 &&
    paaQuestions.length === 5 && new Set(paaQuestions).size === 5 && optionalReferencesReady,
  );
  const currentValidation = useMemo(() => {
    if (!result || !generatedInput) return null;
    return validateGeneratedArticle(result.title, result.articleMarkdown, generatedInput, result.metaDescription || '');
  }, [result, generatedInput]);

  const updateSource = (index: number, field: keyof SourceForm, value: string) => {
    setSources(current => current.map((source, sourceIndex) => sourceIndex === index ? { ...source, [field]: value } : source));
  };

  const fillExample = () => {
    setKeyword(ARTICLE_MARKET_NEWS_EXAMPLE_KEYWORD);
    setAngle(ARTICLE_MARKET_NEWS_EXAMPLE_ANGLE);
    setCompetitorHeadings(exampleCompetitorHeadings);
    setPaaText(examplePaaText);
    setSources([]);
    setNoCompetitorBroker(false);
  };

  const copySample = async (kind: 'competitors' | 'paa', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopiedSample(kind);
    window.setTimeout(() => setCopiedSample(current => current === kind ? '' : current), 2000);
  };

  const generateArticle = async () => {
    if (!ready || loading) return;
    const requestInput: ArticleMarketNewsInput = {
      keyword, researchDate, angle, competitorHeadings, paaQuestions, sources,
      noCompetitorBroker, factsVerified: noCompetitorBroker,
    };
    setLoading(true);
    setError('');
    setResult(null);
    setGeneratedInput(null);
    setFactReviewConfirmed(false);
    setProgress('Validating research gate…');
    try {
      const response = await fetch('/api/article-market-news/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestInput),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Generation stream is unavailable.');
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          if (event.message) setProgress(event.message);
          if (event.step === 'error') throw new Error(event.message || 'Article generation failed.');
          if (event.step === 'done' && event.result) {
            setResult(event.result as ArticleResult);
            setGeneratedInput((event.result as ArticleResult).normalizedInput || requestInput);
            void fetchRecent();
            completed = true;
          }
        }
      }
      if (!completed) throw new Error('Generation ended without a completed article.');
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Article generation failed.');
    } finally {
      setLoading(false);
    }
  };

  const downloadDocx = async () => {
    if (!result || !generatedInput || !currentValidation || currentValidation.violations.length > 0 || !factReviewConfirmed) {
      setError(`Draft cannot be downloaded: ${currentValidation?.violations.join(' ') || (!factReviewConfirmed ? 'complete the manual nonnumeric fact review.' : 'publication gate is incomplete.')}`);
      return;
    }
    const blob = await buildArticleDocxBlob(result.title, result.metaDescription || '', result.articleMarkdown);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = articleDocxFilename(generatedInput.keyword, generatedInput.researchDate);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const currentWordCount = currentValidation?.wordCount || 0;

  return (
    <>
    <Panel aria-labelledby="article-generator-title">
      <SectionHeader title="Generate article market news" description="Enter a keyword, angle, competitor structure, and five PAA questions. The system always researches publisher feeds automatically; extra references from you are optional." action={
        <div className="flex flex-wrap gap-2">
          <Link href={`/dashboard/history?type=${ARTICLE_MARKET_NEWS_HISTORY_TYPE}`} className="rounded-lg border border-[var(--mos-border)] px-3 py-2 text-xs text-[var(--mos-text-secondary)] hover:border-[var(--mos-accent-border)]">Open History</Link>
          <Button size="sm" onClick={fillExample}>Fill example</Button>
        </div>
      } />
      {researchHandoff && (
        <p role="status" data-testid="article-research-handoff" className="mt-4 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs leading-5 text-indigo-100">
          Filled from Dupoin AI Research. Keyword and angle come from the summary. Not published yet — complete the competitor structure and PAA questions before generating.
        </p>
      )}

      <section aria-labelledby="article-input-examples" className="mt-5 rounded-[var(--mos-radius-panel)] border border-cyan-500/20 bg-cyan-950/20 p-4 text-sm text-[var(--mos-text-secondary)]">
        <h3 id="article-input-examples" className="font-semibold text-cyan-200">See example input</h3>
        <p className="mt-2 leading-6">
          Click <strong>Fill example</strong> to fill the keyword, angle, five competitor structures, and five PAA questions at once. Generate can run after that. Article references stay optional and will be cleared.
          Or copy the format below into the matching fields.
        </p>
        <div className="mt-3 space-y-2 leading-6">
          <p><strong className="text-cyan-100">Keyword:</strong> {ARTICLE_MARKET_NEWS_EXAMPLE_KEYWORD}</p>
          <p><strong className="text-cyan-100">Angle:</strong> {ARTICLE_MARKET_NEWS_EXAMPLE_ANGLE}</p>
        </div>
        <div className="mt-4 space-y-4">
          <ExampleSample
            title="5 competitor structures"
            description="Exactly five blocks in order, from Competitor 1 through Competitor 5. Each block has three lines: H1:, H2:, and H3:. Separate blocks with one blank line."
            value={exampleCompetitorHeadings}
            copyLabel="Copy structure"
            copied={copiedSample === 'competitors'}
            onCopy={() => { void copySample('competitors', exampleCompetitorHeadings); }}
          />
          <ExampleSample
            title="5 PAA questions"
            description="Exactly five unique questions, one per line, with no numbers. Each line must end with a question mark (?)."
            value={examplePaaText}
            copyLabel="Copy PAA"
            copied={copiedSample === 'paa'}
            onCopy={() => { void copySample('paa', examplePaaText); }}
          />
        </div>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <FormField label="Main keyword"><TextInput value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="Example: Gold price today" /></FormField>
          <FormField label="Research date"><TextInput type="date" value={researchDate} min={jakartaDate()} max={jakartaDate()} onChange={event => setResearchDate(event.target.value)} /></FormField>
          <FormField label="Article angle"><TextArea value={angle} onChange={event => setAngle(event.target.value)} rows={3} placeholder="Main angle chosen from the research" /></FormField>
          <FormField label="Competitor H1/H2/H3 structure" hint="Exactly 5 articles">
            <TextArea value={competitorHeadings} onChange={event => setCompetitorHeadings(event.target.value)} rows={12} placeholder={'Competitor 1:\nH1: Gold price today\nH2: What is moving the gold price\nH3: Risks to watch\n\nCompetitor 2:\nH1: ...\nH2: ...\nH3: ...'} className="font-mono" />
            <span className={`mt-1 block text-xs ${competitorResearchCount === 5 ? 'text-emerald-400' : 'text-[var(--mos-text-faint)]'}`}>{competitorResearchCount}/5 competitor structures</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--mos-text-muted)]">Write Competitor 1: through Competitor 5:. Each block must include H1:, H2:, and H3:.</span>
          </FormField>
          <FormField label="People Also Ask" hint="Exactly 5 questions">
            <TextArea value={paaText} onChange={event => setPaaText(event.target.value)} rows={6} placeholder={'What is moving the gold price today?\nWhy can the gold price rise or fall?'} />
            <span className={`mt-1 block text-xs ${paaQuestions.length === 5 && new Set(paaQuestions).size === 5 ? 'text-emerald-400' : 'text-[var(--mos-text-faint)]'}`}>{paaQuestions.length}/5 questions</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--mos-text-muted)]">One question per line, exactly five, all unique, each ending with a question mark (?).</span>
          </FormField>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div><h3 className="font-semibold text-white">Reference Articles (Optional)</h3><p className="text-xs text-[var(--mos-text-muted)]">Leave this empty if you want. If you add references, include at most five that you have already checked; automatic research still runs.</p></div>
            <Button size="sm" onClick={() => setSources(current => [...current, emptySource()])} disabled={sources.length >= 5}>Add source</Button>
          </div>
          {sources.map((source, index) => (
            <Panel key={index} padding="compact" className="space-y-3">
              <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-cyan-300">Source {index + 1}</h4><button type="button" onClick={() => setSources(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-xs text-red-300 hover:text-red-200">Remove</button></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput value={source.outlet} onChange={event => updateSource(index, 'outlet', event.target.value)} placeholder="Outlet: Investing.com" />
                <label className="text-xs text-[var(--mos-text-muted)]">
                  Publication Time (WIB)
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-lg border border-[var(--mos-border)] bg-[var(--mos-raised)] px-3 py-2 text-sm text-[var(--mos-text-secondary)]" title="The date follows the Research Date automatically">{researchDate}</span>
                    <TextInput type="time" value={source.publishedAt.split('T')[1] || ''} onChange={event => updateSource(index, 'publishedAt', event.target.value ? `${researchDate}T${event.target.value}` : '')} aria-label={`Source ${index + 1} publication time in WIB`} className="min-w-0 flex-1" />
                  </div>
                  <span className="mt-1 block text-[11px] text-[var(--mos-text-faint)]">The date follows the Research Date automatically.</span>
                </label>
              </div>
              <TextInput value={source.title} onChange={event => updateSource(index, 'title', event.target.value)} placeholder="Article title" />
              <TextInput type="url" value={source.url} onChange={event => updateSource(index, 'url', event.target.value)} placeholder="https://..." />
              <TextArea value={source.verifiedFacts} onChange={event => updateSource(index, 'verifiedFacts', event.target.value)} rows={5} placeholder="Verified facts / quotes: numbers, prices, percent changes, institutions, and quotes that actually appear in the source." />
            </Panel>
          ))}
          {sources.length > 0 && <label className="flex cursor-pointer gap-3 rounded-[var(--mos-radius-panel)] border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-100">
            <input type="checkbox" checked={noCompetitorBroker} onChange={event => setNoCompetitorBroker(event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-500" />
            <span>I have checked that the optional references do not name a competitor broker, and that every fact and quote I entered can be traced to its source.</span>
          </label>}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-[var(--mos-border)] pt-5 sm:flex-row sm:items-center">
        <Button variant="primary" onClick={generateArticle} disabled={!ready || loading}>
          {loading ? 'Generating Article…' : 'Generate Article'}
        </Button>
        {!ready && <p className="text-xs text-[var(--mos-text-muted)]">Complete the keyword, angle, five competitor structures, and exactly five PAA questions. Use Fill example if the format is unclear. References only need to be completed if you add them.</p>}
        {progress && <p className="text-sm text-cyan-200">{progress}</p>}
      </div>
      {error && <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">{error}</div>}

      {result && (
        <div className="mt-7 space-y-5 border-t border-[var(--mos-border)] pt-6">
          <Toolbar><div><StatusBadge tone="success" dot>Draft generated</StatusBadge><h3 className="mt-2 text-base font-semibold text-white">{result.title}</h3><p className="mt-1 text-xs text-[var(--mos-text-muted)]">Model: {result.model} · {currentWordCount} words</p></div><Button variant="primary" onClick={downloadDocx} disabled={!currentValidation || currentValidation.violations.length > 0 || !factReviewConfirmed}>Download DOCX</Button></Toolbar>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['Title ≤60', currentValidation?.qc.titleWithin60Characters || false],
              ['800–1,000 words', currentValidation?.qc.wordCountWithinRange || false],
              ['Keyword lead', currentValidation?.qc.keywordInFirstParagraph || false],
              ['Five PAA', currentValidation?.qc.fivePaaIncluded || false],
              ['Originality', false],
            ].map(([label, passed]) => <StatusBadge key={String(label)} tone={passed ? 'success' : 'warning'}>{passed ? 'Pass' : 'Manual'} · {label}</StatusBadge>)}
          </div>
          <label className="block text-sm text-[var(--mos-text-secondary)]">Editable Article Draft
            <TextArea value={result.articleMarkdown} onChange={event => { setFactReviewConfirmed(false); setResult(current => current ? { ...current, articleMarkdown: event.target.value } : current); }} rows={32} className="mt-2 font-mono" />
          </label>
          {currentValidation && currentValidation.violations.length > 0 && <div className="rounded-[var(--mos-radius-panel)] border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200"><strong>Download locked:</strong> {currentValidation.violations.join(' ')}</div>}
          <label className="flex cursor-pointer gap-3 rounded-[var(--mos-radius-panel)] border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
            <input type="checkbox" checked={factReviewConfirmed} onChange={event => setFactReviewConfirmed(event.target.checked)} disabled={!currentValidation || currentValidation.violations.length > 0} className="mt-0.5 h-4 w-4 accent-emerald-500" />
            <span>I have rechecked every non-numeric claim, institution or analyst name, market event, and quote against the source snapshot used at generation time.</span>
          </label>
          <div className="rounded-[var(--mos-radius-panel)] border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100"><strong>Manual publication gate:</strong> upload the DOCX to SmallSEOTools. The score must be above 90%. If it is below 90%, revise the flagged sections and check again.</div>
        </div>
      )}
    </Panel>

    <Panel padding="none">
      <div className="flex items-center justify-between border-b border-[var(--mos-border-subtle)] px-5 py-4">
        <SectionHeader title="Recent Generated" description="Open a saved Article Market News draft without generating it again." />
        <Link href={`/dashboard/history?type=${ARTICLE_MARKET_NEWS_HISTORY_TYPE}`} className="text-sm text-[var(--mos-accent-soft)] hover:underline">View all history</Link>
      </div>
      {recentError
        ? <p className="p-5 text-sm text-red-300">{recentError}</p>
        : recent.length === 0
          ? <p className="p-5 text-sm text-[var(--mos-text-muted)]">No saved Article Market News yet.</p>
          : <div className="divide-y divide-[var(--mos-border-subtle)]">{recent.map(task => (
              <button type="button" key={task.id} onClick={() => restoreHistory(task)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--mos-raised)]">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{task.title}</span>
                  <span className="block text-xs text-[var(--mos-text-faint)]">{new Date(task.created_at).toLocaleString()}</span>
                </span>
                <span className="text-xs text-[var(--mos-accent-soft)]">Open</span>
              </button>
            ))}</div>}
    </Panel>
    </>
  );
}
