'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, DataTableFrame, EmptyState, LoadingState, PageHeader, PageStack, Panel, Select, StatusBadge, TextArea, TextInput } from '@/components/ui/dashboard';
import { fetchJson, useSeoSites } from '@/components/seo/useSeoSites';
import { VISIBILITY_DISCLAIMER } from '@/lib/seo/visibility-copy';

type Prompt = { id: string; prompt: string; brand_terms: string[]; competitors: string[]; active: boolean; last_checked_at: string | null; checks: number; mentions: number };
type Run = { id: string; status: 'running' | 'succeeded' | 'partial' | 'failed'; models: string[]; checks_planned: number; checks_done: number; checks_failed: number; prompts_skipped: number; cost: number; error: string | null; trigger: string; triggered_by_name: string | null; started_at: string; finished_at: string | null };
type Cell = { check_id: string; prompt_id: string; model: string; mentioned: boolean | null; rank_in_answer: number | null; site_cited: boolean; fallback: boolean; error: string | null; created_at: string };
type Report = {
  weeks: number;
  weekly: Array<{ week: string; model: string; answers: number; mentions: number; rate: number | null }>;
  byModel: Array<{ model: string; answers: number; mentions: number; rate: number | null; fallbacks: number; errors: number }>;
  share: Array<{ name: string; isBrand: boolean; answers: number; share: number | null }>;
  totalAnswers: number;
  latest: Cell[];
};
type Settings = { models: string[]; classifierEnabled: boolean; classifierModel: string; maxChecksPerRun: number };
type SettingsResponse = { settings: Settings; hardMaxChecks: number; availableModels: Array<{ id: string; name: string }> };
type Check = { id: string; prompt_text: string; model: string; answered_model: string | null; fallback_label: string | null; response: string | null; mentioned: boolean | null; rank_in_answer: number | null; cited_urls: string[]; site_cited: boolean; competitors_mentioned: string[]; detection: string | null; classifier_evidence: string | null; cost: number; error: string | null; created_at: string };
type Loaded = { key: string; prompts: Prompt[]; runs: Run[]; report: Report | null; settings: SettingsResponse | null; error: string };

const COLORS = ['#7c9cff', '#3fd0a5', '#f5b14c', '#ef6f8b', '#b18cff', '#5cc8ff'];
const TEMPLATE = 'prompt,brand_terms,competitors,active\r\nbest cheerleading competition in Indonesia,ICA;Indonesian Cheer Association,Competitor A;Competitor B|alias,yes\r\n';

function shortDate(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB';
}
function pct(value: number | null): string { return value === null ? '–' : `${value}%`; }
function splitTerms(value: string): string[] { return value.split(/[\n,;]+/).map(term => term.trim()).filter(Boolean); }

function RunBadge({ run }: { run: Run }) {
  const tone = run.status === 'succeeded' ? 'success' : run.status === 'running' ? 'info' : run.status === 'partial' ? 'warning' : 'danger';
  return <StatusBadge tone={tone} dot>{run.status}</StatusBadge>;
}

function TrendChart({ weekly, models }: { weekly: Report['weekly']; models: string[] }) {
  const weeks = [...new Set(weekly.map(row => row.week))].sort();
  if (weeks.length < 2) return <p className="text-xs text-[var(--mos-text-muted)]">The trend line appears after two weeks of checks.</p>;
  const width = 640; const height = 180; const pad = 28;
  const x = (index: number) => pad + (index * (width - pad * 2)) / (weeks.length - 1);
  const y = (value: number) => height - pad - (value / 100) * (height - pad * 2);
  return <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-3xl" role="img" aria-label="Mention rate per model by week">
    {[0, 50, 100].map(value => <g key={value}>
      <line x1={pad} x2={width - pad} y1={y(value)} y2={y(value)} stroke="var(--mos-border-subtle)" />
      <text x={2} y={y(value) + 4} fontSize="10" fill="var(--mos-text-faint)">{value}%</text>
    </g>)}
    {weeks.map((week, index) => <text key={week} x={x(index)} y={height - 8} fontSize="10" textAnchor="middle" fill="var(--mos-text-faint)">{week.slice(5)}</text>)}
    {models.map((model, modelIndex) => {
      const points = weeks.map((week, index) => {
        const row = weekly.find(item => item.week === week && item.model === model);
        return row?.rate === null || row === undefined ? null : `${x(index)},${y(row.rate)}`;
      }).filter(Boolean);
      return <polyline key={model} points={points.join(' ')} fill="none" stroke={COLORS[modelIndex % COLORS.length]} strokeWidth="2" />;
    })}
  </svg>;
}

export default function SeoVisibilityPage() {
  const { data: sitesData, site, siteId, setSiteId, error: sitesError, loading } = useSeoSites();
  const isAdmin = !!sitesData?.isAdmin;
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ id: '', prompt: '', brandTerms: '', competitors: '', active: true });
  const [file, setFile] = useState<File | null>(null);
  const [importNote, setImportNote] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [draftSettings, setDraftSettings] = useState<Settings | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const key = site ? `${site.id}|${version}` : null;
  useEffect(() => {
    if (!key || !site) return;
    let cancelled = false;
    const q = `siteId=${encodeURIComponent(site.id)}`;
    Promise.all([
      fetchJson<{ prompts: Prompt[] }>(`/api/seo/visibility/prompts?${q}`),
      fetchJson<{ runs: Run[] }>(`/api/seo/visibility/runs?${q}`),
      fetchJson<{ report: Report }>(`/api/seo/visibility/report?${q}`),
      fetchJson<SettingsResponse>(`/api/seo/visibility/settings?${q}`),
    ]).then(([prompts, runs, report, settings]) => {
      if (cancelled) return;
      const failed = [prompts, runs, report, settings].find(result => !result.ok);
      setLoaded({
        key,
        prompts: prompts.ok ? prompts.data.prompts : [],
        runs: runs.ok ? runs.data.runs : [],
        report: report.ok ? report.data.report : null,
        settings: settings.ok ? settings.data : null,
        error: failed ? failed.data.error || 'Could not load AI Visibility.' : '',
      });
    }).catch(() => { if (!cancelled) setLoaded({ key, prompts: [], runs: [], report: null, settings: null, error: 'Could not load AI Visibility.' }); });
    return () => { cancelled = true; };
  }, [key, site]);

  const current = key && loaded?.key === key ? loaded : null;
  const running = current?.runs.find(run => run.status === 'running') ?? null;

  // While a run is in progress, refresh every 5 seconds.
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setVersion(value => value + 1), 5_000);
    return () => clearTimeout(timer);
  }, [running, current]);

  const models = useMemo(() => {
    const fromReport = current?.report?.byModel.map(row => row.model) ?? [];
    return [...new Set([...(current?.settings?.settings.models ?? []), ...fromReport])];
  }, [current]);

  if (loading) return <LoadingState label="Loading SEO OS" />;
  const q = site ? `siteId=${encodeURIComponent(site.id)}` : '';
  const error = sitesError || current?.error || '';
  const report = current?.report ?? null;
  const settings = draftSettings ?? current?.settings?.settings ?? null;
  const activePrompts = current?.prompts.filter(prompt => prompt.active).length ?? 0;
  const plannedNext = settings ? Math.min(settings.maxChecksPerRun, activePrompts * settings.models.length) : 0;

  const runNow = async () => {
    setBusy(true); setMessage('');
    const { ok, data } = await fetchJson<{ planned: number; skippedPrompts: number }>(`/api/seo/visibility/runs?${q}`, { method: 'POST' });
    setBusy(false);
    if (!ok) setMessage(data.error || 'Could not start the run.');
    else setMessage(`Run started: ${data.planned} checks${data.skippedPrompts ? `, ${data.skippedPrompts} prompts wait for the next run` : ''}.`);
    setVersion(value => value + 1);
  };

  const savePrompt = async () => {
    setBusy(true); setMessage('');
    const body = JSON.stringify({ prompt: form.prompt, brandTerms: splitTerms(form.brandTerms), competitors: splitTerms(form.competitors), active: form.active });
    const { ok, data } = form.id
      ? await fetchJson(`/api/seo/visibility/prompts/${encodeURIComponent(form.id)}?${q}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      : await fetchJson(`/api/seo/visibility/prompts?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    setBusy(false);
    if (!ok) { setMessage(data.error || 'Could not save the prompt.'); return; }
    setForm({ id: '', prompt: '', brandTerms: '', competitors: '', active: true });
    setVersion(value => value + 1);
  };

  const toggle = async (prompt: Prompt) => {
    const body = JSON.stringify({ prompt: prompt.prompt, brandTerms: prompt.brand_terms, competitors: prompt.competitors, active: !prompt.active });
    const { ok, data } = await fetchJson(`/api/seo/visibility/prompts/${encodeURIComponent(prompt.id)}?${q}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    if (!ok) setMessage(data.error || 'Could not update the prompt.');
    setVersion(value => value + 1);
  };

  const remove = async (prompt: Prompt) => {
    if (!window.confirm('Delete this prompt? Past answers stay in the history.')) return;
    const { ok, data } = await fetchJson(`/api/seo/visibility/prompts/${encodeURIComponent(prompt.id)}?${q}`, { method: 'DELETE' });
    if (!ok) setMessage(data.error || 'Could not delete the prompt.');
    setVersion(value => value + 1);
  };

  const upload = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true); setImportNote('');
    const { ok, data } = await fetchJson<{ dataRows: number; valid: number; inserted: number; updated: number; errorCount: number; errors: Array<{ line: number; error: string }> }>(
      `/api/seo/visibility/prompts?${q}&import=1${dryRun ? '&dryRun=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.arrayBuffer() });
    setBusy(false);
    if (!ok) { setImportNote(data.error || 'Import failed.'); return; }
    const errors = data.errors.map(item => `line ${item.line}: ${item.error}`).join('; ');
    setImportNote(`${dryRun ? 'Check' : 'Import'}: ${data.dataRows} rows, ${data.valid} valid${dryRun ? '' : `, ${data.inserted} added, ${data.updated} updated`}${data.errorCount ? `, ${data.errorCount} errors (${errors})` : ''}.`);
    if (!dryRun) { setFile(null); if (fileInput.current) fileInput.current.value = ''; setVersion(value => value + 1); }
  };

  const openCheck = async (checkId: string) => {
    const { ok, data } = await fetchJson<{ check: Check }>(`/api/seo/visibility/checks/${encodeURIComponent(checkId)}?${q}`);
    if (ok) setCheck(data.check); else setMessage(data.error || 'Could not load the answer.');
  };

  const saveSettings = async () => {
    if (!draftSettings) return;
    setBusy(true); setMessage('');
    const { ok, data } = await fetchJson(`/api/seo/visibility/settings?${q}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftSettings) });
    setBusy(false);
    if (!ok) { setMessage(data.error || 'Could not save settings.'); return; }
    setDraftSettings(null);
    setVersion(value => value + 1);
  };

  const cellFor = (promptId: string, model: string) => report?.latest.find(cell => cell.prompt_id === promptId && cell.model === model);
  const lastRun = current?.runs[0] ?? null;
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

  return <PageStack>
    <PageHeader eyebrow="SEO OS / AI Visibility" title="AI Visibility"
      description="How often AI models mention this site when asked the questions your customers ask. Each prompt is asked on every configured model through the gateway."
      actions={<>
        {sitesData && sitesData.sites.length > 0 && <Select aria-label="Site" value={siteId} onChange={event => { setSiteId(event.target.value); setCheck(null); setDraftSettings(null); }} className="w-auto">
          {sitesData.sites.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactive)'}</option>)}
        </Select>}
        {isAdmin && site && <Button variant="primary" onClick={runNow} disabled={busy || !!running || activePrompts === 0}>{running ? 'Running…' : 'Run now'}</Button>}
      </>} />

    <Panel padding="compact">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge tone="warning">Note</StatusBadge>
        <span className="text-[var(--mos-text-secondary)]">{VISIBILITY_DISCLAIMER}</span>
      </div>
    </Panel>

    {error && <Panel><p className="text-sm text-red-300">{error}</p></Panel>}
    {message && <Panel><p className="text-sm text-[var(--mos-text-secondary)]">{message}</p></Panel>}

    {site && current && <>
      <Panel>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--mos-text-secondary)]">
          {lastRun ? <>
            <RunBadge run={lastRun} />
            <span>Last run {shortDate(lastRun.started_at)} ({lastRun.trigger}{lastRun.triggered_by_name ? `, ${lastRun.triggered_by_name}` : ''})</span>
            <span>{lastRun.checks_done + lastRun.checks_failed}/{lastRun.checks_planned} checks{lastRun.checks_failed ? `, ${lastRun.checks_failed} failed` : ''}</span>
            {lastRun.prompts_skipped > 0 && <span>{lastRun.prompts_skipped} prompts left for the next run (cap)</span>}
            <span>cost ${lastRun.cost.toFixed(4)}</span>
            {lastRun.error && <span className="text-red-300">{lastRun.error}</span>}
          </> : <span>No runs yet.</span>}
          {settings && <span className="text-[var(--mos-text-muted)]">Next run: about {plannedNext} checks ({activePrompts} active prompts × {settings.models.length} models, cap {settings.maxChecksPerRun}).</span>}
        </div>
      </Panel>

      <DataTableFrame title="Mention rate by model" description={`Last ${report?.weeks ?? 12} weeks. Answers the gateway served from a fallback model are left out of the rate and counted separately.`}>
        {report && report.byModel.length ? <div className="flex flex-col gap-4 p-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[var(--mos-text-muted)]"><th className="py-2">Model</th><th>Answers</th><th>Mentions</th><th>Mention rate</th><th>Fallbacks</th><th>Errors</th></tr></thead>
            <tbody>{report.byModel.map(row => <tr key={row.model} className="border-t border-[var(--mos-border-subtle)]">
              <td className="py-2"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: COLORS[models.indexOf(row.model) % COLORS.length] }} />{row.model}</td>
              <td>{row.answers}</td><td>{row.mentions}</td><td className="font-medium text-[var(--mos-text)]">{pct(row.rate)}</td><td>{row.fallbacks}</td><td>{row.errors}</td>
            </tr>)}</tbody>
          </table>
          <TrendChart weekly={report.weekly} models={models} />
        </div> : <EmptyState title="No answers yet" description="Add prompts, then run a check (admins: Run now; or the weekly cron)." />}
      </DataTableFrame>

      {report && report.totalAnswers > 0 && <DataTableFrame title="Share of voice" description="How many answers mention each name, as a share of all brand and competitor mentions. Competitors come from each prompt's list.">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[var(--mos-text-muted)]"><th className="px-4 py-2">Name</th><th>Answers mentioning</th><th>Of all answers</th><th className="w-1/3">Share of mentions</th></tr></thead>
          <tbody>{report.share.map(row => <tr key={`${row.isBrand}-${row.name}`} className="border-t border-[var(--mos-border-subtle)]">
            <td className="px-4 py-2">{row.name}{row.isBrand && <StatusBadge tone="info" className="ml-2">you</StatusBadge>}</td>
            <td>{row.answers}</td>
            <td>{pct(report.totalAnswers ? Math.round((row.answers / report.totalAnswers) * 1000) / 10 : null)}</td>
            <td><div className="flex items-center gap-2"><div className="h-2 rounded bg-[var(--mos-accent-soft)]" style={{ width: `${row.share ?? 0}%`, minWidth: 2 }} /><span>{pct(row.share)}</span></div></td>
          </tr>)}</tbody>
        </table>
      </DataTableFrame>}

      <DataTableFrame title="Prompts" description="Questions to ask the models. Brand terms are matched as whole words (the site's domain and links to it always count); leave them empty to use the site name. Write competitors as Name or Name|alias.">
        <div className="flex flex-col gap-3 p-4">
          <TextArea aria-label="Prompt" placeholder="e.g. Which organisation runs cheerleading competitions in Indonesia" value={form.prompt} onChange={event => setForm({ ...form, prompt: event.target.value })} className="min-h-16" />
          <div className="grid gap-2 md:grid-cols-2">
            <TextInput aria-label="Brand terms" placeholder="Brand terms, comma separated (e.g. ICA, Indonesian Cheer Association)" value={form.brandTerms} onChange={event => setForm({ ...form, brandTerms: event.target.value })} />
            <TextInput aria-label="Competitors" placeholder="Competitors, comma separated (e.g. Rival|RivalCheer, Other Org)" value={form.competitors} onChange={event => setForm({ ...form, competitors: event.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--mos-text-secondary)]"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Active</label>
            <Button variant="primary" size="sm" onClick={savePrompt} disabled={busy || !form.prompt.trim()}>{form.id ? 'Save prompt' : 'Add prompt'}</Button>
            {form.id && <Button size="sm" variant="ghost" onClick={() => setForm({ id: '', prompt: '', brandTerms: '', competitors: '', active: true })}>Cancel edit</Button>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--mos-border-subtle)] pt-3 text-sm">
            <span className="text-[var(--mos-text-muted)]">Or import CSV (prompt, brand_terms, competitors, active; separate terms in a cell with ;). <a href={templateHref} download="ai-visibility-prompts-template.csv" className="text-[var(--mos-accent-soft)] hover:underline">Template</a></span>
            <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Prompt CSV file" onChange={event => { setFile(event.target.files?.[0] ?? null); setImportNote(''); }} className="text-sm text-[var(--mos-text-secondary)]" />
            <Button size="sm" onClick={() => upload(true)} disabled={!file || busy}>Check file</Button>
            <Button size="sm" variant="primary" onClick={() => upload(false)} disabled={!file || busy}>Import</Button>
          </div>
          {importNote && <p className="text-xs text-[var(--mos-text-secondary)]">{importNote}</p>}
        </div>
        {current.prompts.length ? <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-[var(--mos-text-muted)]">
            <th className="px-4 py-2">Prompt</th>
            {models.map(model => <th key={model} className="px-2">{model}</th>)}
            <th className="px-2">Mentioned</th><th className="px-2">Last checked</th><th className="px-2" />
          </tr></thead>
          <tbody>{current.prompts.map(prompt => <tr key={prompt.id} className="border-t border-[var(--mos-border-subtle)] align-top">
            <td className="max-w-md px-4 py-2">
              <p className={prompt.active ? 'text-[var(--mos-text)]' : 'text-[var(--mos-text-faint)] line-through'}>{prompt.prompt}</p>
              <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Brand: {prompt.brand_terms.join(', ') || `${site.name} (site name)`}{prompt.competitors.length ? ` · Competitors: ${prompt.competitors.join(', ')}` : ''}</p>
            </td>
            {models.map(model => {
              const cell = cellFor(prompt.id, model);
              if (!cell) return <td key={model} className="px-2 py-2 text-[var(--mos-text-faint)]">–</td>;
              const label = cell.error ? 'error' : cell.mentioned ? `yes${cell.rank_in_answer ? ` #${cell.rank_in_answer}` : ''}${cell.site_cited ? ' · cited' : ''}` : 'no';
              const tone = cell.error ? 'danger' : cell.mentioned ? 'success' : 'neutral';
              return <td key={model} className="px-2 py-2"><button type="button" onClick={() => openCheck(cell.check_id)} title={`Answer from ${shortDate(cell.created_at)}${cell.fallback ? ' (fallback model)' : ''}`}>
                <StatusBadge tone={tone}>{label}{cell.fallback ? ' *' : ''}</StatusBadge>
              </button></td>;
            })}
            <td className="px-2 py-2">{prompt.checks ? `${prompt.mentions}/${prompt.checks}` : '–'}</td>
            <td className="px-2 py-2 text-xs text-[var(--mos-text-muted)]">{shortDate(prompt.last_checked_at)}</td>
            <td className="px-2 py-2"><div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setForm({ id: prompt.id, prompt: prompt.prompt, brandTerms: prompt.brand_terms.join(', '), competitors: prompt.competitors.join(', '), active: prompt.active })}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => toggle(prompt)}>{prompt.active ? 'Pause' : 'Resume'}</Button>
              <Button size="sm" variant="danger" onClick={() => remove(prompt)}>Delete</Button>
            </div></td>
          </tr>)}</tbody>
        </table>
        <p className="px-4 py-2 text-xs text-[var(--mos-text-faint)]">Latest answer per model. #n = position in the answer&apos;s list (or order of first mention); * = served by a fallback model. Click a cell to read the answer.</p>
        </div> : <EmptyState title="No prompts yet" description="Add the questions your customers would ask an AI assistant." />}
      </DataTableFrame>

      {check && <Panel>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-[var(--mos-text)]">{check.prompt_text}</p>
            <Button size="sm" variant="ghost" onClick={() => setCheck(null)}>Close</Button>
          </div>
          <p className="text-xs text-[var(--mos-text-muted)]">
            Asked {check.model}{check.answered_model && check.answered_model !== check.model ? `, answered by ${check.answered_model} (fallback)` : ''} · {shortDate(check.created_at)} · cost ${Number(check.cost).toFixed(4)}
            {check.mentioned !== null && ` · mentioned: ${check.mentioned ? 'yes' : 'no'}${check.detection === 'classifier' ? ' (classifier)' : ''}`}
            {check.rank_in_answer ? ` · rank #${check.rank_in_answer}` : ''}
            {check.competitors_mentioned.length ? ` · competitors: ${check.competitors_mentioned.join(', ')}` : ''}
          </p>
          {check.classifier_evidence && <p className="text-xs text-[var(--mos-text-secondary)]">Classifier evidence: “{check.classifier_evidence}”</p>}
          {check.error ? <p className="text-red-300">{check.error}</p> : <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-[var(--mos-surface-2,rgba(255,255,255,0.03))] p-3 text-xs leading-5 text-[var(--mos-text-secondary)]">{check.response}</pre>}
          {check.cited_urls.length > 0 && <div className="text-xs"><p className="text-[var(--mos-text-muted)]">Cited URLs{check.site_cited ? ' (includes this site)' : ''}:</p>
            <ul className="list-disc pl-5">{check.cited_urls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer noopener" className="text-[var(--mos-accent-soft)] hover:underline">{url}</a></li>)}</ul></div>}
        </div>
      </Panel>}

      {current.runs.length > 0 && <DataTableFrame title="Runs">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[var(--mos-text-muted)]"><th className="px-4 py-2">Started</th><th>Status</th><th>Trigger</th><th>Checks</th><th>Failed</th><th>Cost</th></tr></thead>
          <tbody>{current.runs.map(run => <tr key={run.id} className="border-t border-[var(--mos-border-subtle)]">
            <td className="px-4 py-2">{shortDate(run.started_at)}</td><td><RunBadge run={run} /></td>
            <td>{run.trigger}{run.triggered_by_name ? ` (${run.triggered_by_name})` : ''}</td>
            <td>{run.checks_done + run.checks_failed}/{run.checks_planned}</td><td>{run.checks_failed}</td><td>${run.cost.toFixed(4)}</td>
          </tr>)}</tbody>
        </table>
      </DataTableFrame>}

      {isAdmin && current.settings && settings && <Panel>
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium text-[var(--mos-text)]">Run settings (admin)</p>
          <div className="flex flex-wrap gap-3">
            {current.settings.availableModels.map(model => <label key={model.id} className="flex items-center gap-2 text-[var(--mos-text-secondary)]">
              <input type="checkbox" checked={settings.models.includes(model.id)} onChange={event => setDraftSettings({
                ...settings, models: event.target.checked ? [...settings.models, model.id] : settings.models.filter(id => id !== model.id),
              })} /> {model.id}
            </label>)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[var(--mos-text-secondary)]">Max checks per run
              <TextInput type="number" min={1} max={current.settings.hardMaxChecks} value={settings.maxChecksPerRun} onChange={event => setDraftSettings({ ...settings, maxChecksPerRun: Number(event.target.value) })} className="w-24" />
            </label>
            <label className="flex items-center gap-2 text-[var(--mos-text-secondary)]">
              <input type="checkbox" checked={settings.classifierEnabled} onChange={event => setDraftSettings({ ...settings, classifierEnabled: event.target.checked })} /> LLM classifier when no term matches
            </label>
            <Select aria-label="Classifier model" value={settings.classifierModel} onChange={event => setDraftSettings({ ...settings, classifierModel: event.target.value })} className="w-auto">
              {current.settings.availableModels.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
            </Select>
          </div>
          <p className="text-xs text-[var(--mos-text-muted)]">Each check is one gateway call (up to about 1,500 output tokens); the classifier adds one short call for answers with no term match. Prompts over the cap wait for the next run, least recently checked first.</p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={saveSettings} disabled={busy || !draftSettings || !settings.models.length}>Save settings</Button>
            {draftSettings && <Button size="sm" variant="ghost" onClick={() => setDraftSettings(null)}>Discard</Button>}
          </div>
        </div>
      </Panel>}
    </>}
    {site && !current && !error && <LoadingState label="Loading AI Visibility" />}
  </PageStack>;
}
