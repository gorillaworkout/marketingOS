'use client';

import { useEffect, useState } from 'react';
import { Button, Panel, StatusBadge } from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import type { EntityVerdict, GapReport, PromptGap, Recommendation } from '@/lib/seo/visibility-gaps';

const VERDICT: Record<EntityVerdict, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  'described-as-recognised': { label: 'Describes the brand as the recognised body', tone: 'success' },
  'mentioned-not-recognised': { label: 'Mentions the brand, not as the recognised body', tone: 'warning' },
  contradictory: { label: 'Contradicts itself', tone: 'danger' },
  'not-mentioned': { label: 'Does not mention the brand', tone: 'danger' },
};
const STATUS: Record<PromptGap['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  unchecked: { label: 'not checked', tone: 'neutral' }, zero: { label: 'zero', tone: 'danger' }, weak: { label: 'weak', tone: 'warning' },
  partial: { label: 'partial', tone: 'info' }, strong: { label: 'all models', tone: 'success' },
};
const PRIORITY_TONE: Record<Recommendation['priority'], 'danger' | 'warning' | 'info'> = { high: 'danger', medium: 'warning', low: 'info' };
const pct = (value: number | null) => (value === null ? '–' : `${value}%`);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-lg border border-[var(--mos-border-subtle)] p-3">
    <p className="text-xs text-[var(--mos-text-muted)]">{label}</p>
    <p className="mt-1 text-lg font-semibold text-[var(--mos-text)]">{value}</p>
    {hint && <p className="text-xs text-[var(--mos-text-muted)]">{hint}</p>}
  </div>;
}

function Quote({ text }: { text: string }) {
  return <blockquote className="border-l-2 border-[var(--mos-border-subtle)] pl-3 text-xs italic leading-5 text-[var(--mos-text-secondary)]">“{text}”</blockquote>;
}

function RecommendationItem({ rec }: { rec: Recommendation }) {
  const [open, setOpen] = useState(rec.priority === 'high');
  const [copied, setCopied] = useState(false);
  return <li className="rounded-lg border border-[var(--mos-border-subtle)] p-3">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start justify-between gap-3 text-left">
      <span className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={PRIORITY_TONE[rec.priority]}>{rec.priority}</StatusBadge>
        <span className="text-xs uppercase tracking-wide text-[var(--mos-text-muted)]">{rec.category}</span>
        <span className="font-medium text-[var(--mos-text)]">{rec.title}</span>
      </span>
      <span className="shrink-0 text-xs text-[var(--mos-accent-soft)]">{open ? 'Hide' : 'Show'}</span>
    </button>
    {open && <div className="mt-2 flex flex-col gap-2 text-sm">
      <p className="text-xs text-[var(--mos-text-muted)]">{rec.why}</p>
      <ul className="list-disc pl-5 text-[var(--mos-text-secondary)]">{rec.actions.map(action => <li key={action}>{action}</li>)}</ul>
      {rec.pages?.map(page => <div key={page.slug + page.topic} className="rounded border border-[var(--mos-border-subtle)] p-2">
        <p className="text-xs text-[var(--mos-text-muted)]">{page.slug} · {page.prompts} prompt{page.prompts === 1 ? '' : 's'}</p>
        <p className="font-medium text-[var(--mos-text)]">H1: {page.h1}</p>
        <ul className="mt-1 list-disc pl-5 text-xs text-[var(--mos-text-secondary)]">{page.faq.map(question => <li key={question}>{question}</li>)}</ul>
      </div>)}
      {rec.snippet && <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--mos-text-muted)]">{rec.snippet.label}</span>
          <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(rec.snippet!.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
        <pre className="max-h-72 overflow-auto rounded bg-[var(--mos-surface-2,rgba(255,255,255,0.03))] p-2 text-[11px] leading-4 text-[var(--mos-text-secondary)]">{rec.snippet.code}</pre>
      </div>}
    </div>}
  </li>;
}

/** "Gaps & fixes": what AI gets wrong or misses about the brand, and what to fix. */
export function VisibilityGapsPanel({ siteId, version }: { siteId: string; version: number }) {
  const [loaded, setLoaded] = useState<{ key: string; report: GapReport | null; error: string } | null>(null);
  const [withAi, setWithAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const key = `${siteId}|${version}`;
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ report: GapReport }>(`/api/seo/visibility/export?siteId=${encodeURIComponent(siteId)}&format=json`).then(({ ok, data }) => {
      if (!cancelled) setLoaded({ key, report: ok ? data.report : null, error: ok ? '' : data.error || 'Could not load the gap report.' });
    }).catch(() => { if (!cancelled) setLoaded({ key, report: null, error: 'Could not load the gap report.' }); });
    return () => { cancelled = true; };
  }, [key, siteId]);
  const current = loaded?.key === key ? loaded : null;
  const report = current?.report ?? null;
  const exportHref = (format: string) => `/api/seo/visibility/export?siteId=${encodeURIComponent(siteId)}&format=${format}${withAi ? '&ai=1' : ''}`;

  const generateSummary = async () => {
    setAiBusy(true);
    const { ok, data } = await fetchJson<{ report: GapReport }>(`/api/seo/visibility/export?siteId=${encodeURIComponent(siteId)}&format=json&ai=1`);
    setAiBusy(false);
    if (ok) setLoaded({ key, report: data.report, error: '' });
  };

  const losing = report?.prompts.filter(prompt => prompt.status === 'zero' || prompt.status === 'weak' || prompt.status === 'partial') ?? [];
  const shown = showAll ? losing : losing.slice(0, 8);

  return <Panel>
    <div className="flex flex-col gap-4 text-sm" data-testid="visibility-gaps">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--mos-text)]">Gaps &amp; fixes</h2>
          <p className="text-xs text-[var(--mos-text-muted)]">What the stored AI answers miss or get wrong about this brand, and what to fix. Built from saved answers; no model is called unless you ask for an AI summary.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-[var(--mos-text-secondary)]" title="Adds one short gateway call to the export">
            <input type="checkbox" checked={withAi} onChange={event => setWithAi(event.target.checked)} /> Include AI summary
          </label>
          <Button size="sm" onClick={() => window.location.assign(exportHref('csv'))}>CSV</Button>
          <Button size="sm" onClick={() => window.location.assign(exportHref('xlsx'))}>Excel</Button>
          <Button size="sm" variant="primary" onClick={() => window.location.assign(exportHref('pdf'))}>PDF report</Button>
        </div>
      </div>

      {!current && <p className="text-xs text-[var(--mos-text-muted)]">Analysing stored answers…</p>}
      {current?.error && <p className="text-sm text-red-300">{current.error}</p>}
      {report && report.summary.latestAnswers === 0 && <p className="text-xs text-[var(--mos-text-muted)]">No answers yet. Run a check first; the gap report uses the stored answers.</p>}

      {report && report.summary.latestAnswers > 0 && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Latest run" value={pct(report.summary.latestRate)} hint={`${report.summary.latestMentions}/${report.summary.latestAnswers} answers mention the brand`} />
          <Kpi label="Lifetime" value={pct(report.summary.lifetimeRate)} hint={`${report.summary.lifetimeMentions}/${report.summary.lifetimeAnswers} answers`} />
          <Kpi label="Zero-visibility prompts" value={`${report.summary.zeroVisibility.length}`} hint={`of ${report.summary.promptsChecked} checked`} />
          <Kpi label="Weakest model" value={report.summary.weakestModel ?? '–'} hint={report.summary.weakestModel ? pct(report.summary.byModel.find(row => row.model === report.summary.weakestModel)?.latestRate ?? null) : undefined} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium text-[var(--mos-text)]">Summary</h3>
            {!report.aiSummary && <Button size="sm" variant="ghost" onClick={generateSummary} disabled={aiBusy}>{aiBusy ? 'Writing…' : 'Write AI summary (1 call)'}</Button>}
          </div>
          {report.aiSummary
            ? <pre className="whitespace-pre-wrap text-xs leading-5 text-[var(--mos-text-secondary)]">{report.aiSummary}</pre>
            : <p className="text-xs text-[var(--mos-text-muted)]">{report.recommendations.filter(rec => rec.priority === 'high').length} high-priority fixes below. {report.entity.contradictions.length ? `${report.entity.contradictions.length} contradiction(s) in how AI describes the brand.` : ''}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-[var(--mos-text)]">What AI says {report.entity.brandLabel} is</h3>
          <div className="grid gap-3 lg:grid-cols-3">
            {report.entity.byModel.map(model => <div key={model.model} className="flex flex-col gap-2 rounded-lg border border-[var(--mos-border-subtle)] p-3">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-xs text-[var(--mos-text)]">{model.model}</span>
                <StatusBadge tone={VERDICT[model.verdict].tone}>{VERDICT[model.verdict].label}</StatusBadge>
                <span className="text-xs text-[var(--mos-text-muted)]">Mentions the brand in {model.answersMentioning}/{model.answersTotal} latest answers</span>
              </div>
              {model.excerpts.slice(0, 2).map(text => <Quote key={text} text={text} />)}
              {model.otherBodyStatements.length > 0 && <><p className="text-xs text-red-300">Names another organisation as the official body:</p>{model.otherBodyStatements.slice(0, 2).map(text => <Quote key={text} text={text} />)}</>}
              {model.negativeStatements.length > 0 && <><p className="text-xs text-amber-300">Denies or questions the brand&apos;s status:</p>{model.negativeStatements.slice(0, 2).map(text => <Quote key={text} text={text} />)}</>}
              {model.uncertainStatements.length > 0 && <><p className="text-xs text-amber-300">Unsure:</p>{model.uncertainStatements.slice(0, 1).map(text => <Quote key={text} text={text} />)}</>}
            </div>)}
          </div>
          {report.entity.contradictions.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-200">{report.entity.contradictions.map(text => <li key={text}>{text}</li>)}</ul>}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-[var(--mos-text)]">Where the brand is missing ({losing.length})</h3>
          {losing.length === 0 ? <p className="text-xs text-[var(--mos-text-muted)]">Every checked prompt mentions the brand on every model.</p> : <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[var(--mos-text-muted)]"><th className="py-1 pr-3">Prompt</th><th className="pr-3">Status</th><th className="pr-3">AI named instead</th><th className="pr-3">Sources cited</th><th>Likely gap</th></tr></thead>
              <tbody>{shown.map(prompt => <tr key={prompt.id} className="border-t border-[var(--mos-border-subtle)] align-top text-[var(--mos-text-secondary)]">
                <td className="max-w-xs py-1.5 pr-3 text-[var(--mos-text)]">{prompt.prompt}</td>
                <td className="pr-3"><StatusBadge tone={STATUS[prompt.status].tone}>{STATUS[prompt.status].label} {prompt.latestYes}/{prompt.latestTotal}</StatusBadge></td>
                <td className="pr-3">{prompt.namedInstead.slice(0, 4).map(entity => `${entity.name}${entity.bestRank ? ` #${entity.bestRank}` : ''}`).join(', ') || '–'}</td>
                <td className="pr-3">{prompt.sourcesWhenMissing.slice(0, 3).join(', ') || 'none'}</td>
                <td className="max-w-sm">{prompt.likelyGap}</td>
              </tr>)}</tbody>
            </table>
            {losing.length > 8 && <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${losing.length}`}</Button>}
          </div>}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-[var(--mos-text)]">What to fix</h3>
          <p className="text-xs text-[var(--mos-text-muted)]">Suggested site copy never names competitors and never states a status as fact: publish documents that prove it, and AI can repeat it.</p>
          <ul className="flex flex-col gap-2">{report.recommendations.map(rec => <RecommendationItem key={rec.id} rec={rec} />)}</ul>
        </div>

        {report.flags.length > 0 && <div className="flex flex-col gap-2">
          <h3 className="font-medium text-[var(--mos-text)]">Tracking issues ({report.flags.length})</h3>
          <ul className="flex flex-col gap-1 text-xs text-[var(--mos-text-secondary)]">{report.flags.map(flag => <li key={flag.promptId + flag.kind + flag.message}>
            <StatusBadge tone="warning">{flag.kind}</StatusBadge> <span className="text-[var(--mos-text)]">{flag.prompt.length > 90 ? `${flag.prompt.slice(0, 87)}…` : flag.prompt}</span> — {flag.message}
          </li>)}</ul>
        </div>}
      </>}
    </div>
  </Panel>;
}
