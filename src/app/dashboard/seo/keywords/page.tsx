'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, DataTableFrame, LoadingState, PageHeader, PageStack, Panel, Select, StatusBadge } from '@/components/ui/dashboard';
import { fetchJson, useSeoSites } from '@/components/seo/useSeoSites';

type Keyword = { id: string; keyword: string; target_page_url: string | null; intent: string | null; updated_at: string };
type ImportResult = { dryRun: boolean; encoding: string; dataRows: number; valid: number; duplicates: number; inserted: number; updated: number; errorCount: number; errors: Array<{ row: number; message: string }> };

const TEMPLATE = 'keyword,target_page_url,intent\r\ncheerleading competition jakarta,,commercial\r\n';

export default function SeoKeywordsPage() {
  const { data: sitesData, site, siteId, setSiteId, error: sitesError, loading } = useSeoSites();
  const [version, setVersion] = useState(0);
  const [keywords, setKeywords] = useState<{ key: string; rows: Keyword[]; error: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const listKey = site ? `${site.id}|${version}` : null;
  useEffect(() => {
    if (!listKey || !site) return;
    let cancelled = false;
    fetchJson<{ keywords: Keyword[] }>(`/api/seo/keywords?siteId=${encodeURIComponent(site.id)}`).then(({ ok, data }) => {
      if (!cancelled) setKeywords({ key: listKey, rows: ok ? data.keywords : [], error: ok ? '' : data.error || 'Could not load keywords.' });
    }).catch(() => { if (!cancelled) setKeywords({ key: listKey, rows: [], error: 'Could not load keywords.' }); });
    return () => { cancelled = true; };
  }, [listKey, site]);

  const upload = async (dryRun: boolean) => {
    if (!site || !file) return;
    setBusy(true); setMessage(''); setResult(null);
    try {
      const { ok, data } = await fetchJson<ImportResult>(`/api/seo/keywords?siteId=${encodeURIComponent(site.id)}${dryRun ? '&dryRun=1' : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.arrayBuffer(),
      });
      if (!ok) { setMessage(data.error || 'Import failed.'); return; }
      setResult(data);
      if (!dryRun) { setVersion(value => value + 1); setFile(null); if (fileInput.current) fileInput.current.value = ''; }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (keyword: Keyword) => {
    if (!site) return;
    const { ok, data } = await fetchJson(`/api/seo/keywords?siteId=${encodeURIComponent(site.id)}&id=${encodeURIComponent(keyword.id)}`, { method: 'DELETE' });
    if (!ok) setMessage(data.error || 'Could not delete the keyword.');
    setVersion(value => value + 1);
  };

  if (loading) return <LoadingState label="Loading SEO OS" />;
  const current = listKey && keywords?.key === listKey ? keywords : null;
  const error = sitesError || current?.error || '';
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

  return <PageStack>
    <PageHeader eyebrow="SEO OS / Keywords" title="Keywords" description="Keywords you want to rank for, per site. Keywords with no target page and no Search Console impressions show up as No page opportunities."
      actions={<>
        {sitesData && sitesData.sites.length > 0 && <Select aria-label="Site" value={siteId} onChange={event => { setSiteId(event.target.value); setResult(null); }} className="w-auto">
          {sitesData.sites.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactive)'}</option>)}
        </Select>}
        {site && <a href={`/api/seo/keywords?siteId=${encodeURIComponent(site.id)}&format=csv`} className="inline-flex h-9 items-center rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] px-3 text-sm text-[var(--mos-text-secondary)] hover:text-[var(--mos-text)]">Export CSV</a>}
      </>} />

    {error && <Panel><p className="text-sm text-red-300">{error}</p></Panel>}
    {message && <Panel><p className="text-sm text-red-300">{message}</p></Panel>}

    {site && <Panel>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--mos-text-secondary)]">Import a CSV with the columns <code>keyword</code>, <code>target_page_url</code> (optional), and <code>intent</code> (optional: informational, commercial, transactional, navigational).</p>
        <p className="text-xs text-[var(--mos-text-muted)]">UTF-8 (with or without BOM) and UTF-16 files from Excel or Google Sheets are fine; comma, semicolon, and tab separators all work. Duplicate keywords are merged, and re-importing a keyword updates it. Empty cells keep the saved value. Target pages must be on {site.site_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}. <a href={templateHref} download="seo-keywords-template.csv" className="text-[var(--mos-accent-soft)] hover:underline">Download a template</a>.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" aria-label="Keyword CSV file" onChange={event => { setFile(event.target.files?.[0] ?? null); setResult(null); }} className="text-sm text-[var(--mos-text-secondary)]" />
          <Button onClick={() => upload(true)} disabled={!file || busy}>Check file</Button>
          <Button variant="primary" onClick={() => upload(false)} disabled={!file || busy}>{busy ? 'Working…' : 'Import'}</Button>
        </div>
        {result && <ImportSummary result={result} />}
      </div>
    </Panel>}

    {site && (!current ? <Panel><p className="text-sm text-[var(--mos-text-muted)]">Loading keywords…</p></Panel> : <DataTableFrame title={`Tracked keywords (${current.rows.length})`}>
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]"><tr><th className="p-3">Keyword</th><th className="p-3">Target page</th><th className="p-3">Intent</th><th className="p-3 text-right" /></tr></thead>
        <tbody>
          {current.rows.map(row => <tr key={row.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
            <td className="p-3 text-white">{row.keyword}</td>
            <td className="max-w-[360px] truncate p-3" title={row.target_page_url ?? ''}>{row.target_page_url ? <a href={row.target_page_url} target="_blank" rel="noreferrer" className="hover:underline">{row.target_page_url}</a> : <StatusBadge tone="warning">No page</StatusBadge>}</td>
            <td className="p-3">{row.intent ?? '—'}</td>
            <td className="p-3 text-right"><Button size="sm" onClick={() => remove(row)}>Delete</Button></td>
          </tr>)}
          {!current.rows.length && <tr><td colSpan={4} className="p-8 text-center text-[var(--mos-text-faint)]">No keywords yet. Import a CSV to start.</td></tr>}
        </tbody>
      </table>
    </DataTableFrame>)}
  </PageStack>;
}

function ImportSummary({ result }: { result: ImportResult }) {
  return <div className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3 text-xs text-[var(--mos-text-secondary)]">
    <p>
      {result.dryRun ? 'Check only, nothing saved. ' : ''}
      {result.dataRows} rows read ({result.encoding.toUpperCase()}): {result.valid} valid, {result.duplicates} duplicates merged, {result.errorCount} with errors.
      {!result.dryRun && ` Saved ${result.inserted} new and updated ${result.updated} existing keywords.`}
    </p>
    {result.errors.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-200">
      {result.errors.map(issue => <li key={`${issue.row}-${issue.message}`}>Row {issue.row}: {issue.message}</li>)}
      {result.errorCount > result.errors.length && <li>…and {result.errorCount - result.errors.length} more</li>}
    </ul>}
  </div>;
}
