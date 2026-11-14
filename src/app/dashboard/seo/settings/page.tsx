'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAutoRefresh } from '@/components/seo/autoRefresh';
import { Button, DataTableFrame, FormField, LoadingState, PageHeader, PageStack, Panel, StatusBadge, TextInput } from '@/components/ui/dashboard';

type Site = { id: string; name: string; site_url: string; gsc_property: string | null; active: boolean; last_synced_at: string | null };
type Run = { id: string; site_name: string; mode: string; status: 'running' | 'succeeded' | 'failed'; range_start: string | null; range_end: string | null; days_synced: number; rows_upserted: number; error: string | null; started_at: string };
type Settings = { sites: Site[]; serviceAccount: { configured: boolean; email: string | null; error: string | null }; runs: Run[] };

export default function SeoSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');

  // One in-flight request at a time; a reload requested mid-flight (e.g. after saving) runs once more afterwards.
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const mounted = useRef(true);
  const load = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const run = async () => {
      do {
        again.current = false;
        try {
          const response = await fetch('/api/seo/settings', { cache: 'no-store' });
          const data = await response.json().catch(() => ({}));
          if (!mounted.current) return;
          if (!response.ok) { setError(data.error || 'Could not load SEO settings.'); continue; }
          setError('');
          setSettings(data);
        } catch {
          if (mounted.current) setError('Could not load SEO settings.');
        }
      } while (again.current && mounted.current);
    };
    const request = run().finally(() => { inFlight.current = null; });
    inFlight.current = request;
    return request;
  }, []);
  const reload = useCallback(async () => { if (inFlight.current) again.current = true; await load(); }, [load]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  // Refetch on tab focus/visibility, after Sync now (any tab), and every ~60s while a run is still running.
  const anyRunning = Boolean(settings?.runs.some(run => run.status === 'running'));
  useAutoRefresh(load, { poll: anyRunning, intervalMs: 60_000 });

  if (!settings && !error) return <LoadingState label="Loading SEO settings" />;

  return <PageStack>
    <PageHeader eyebrow="SEO OS / Administration" title="SEO settings" description="Connect each site to its Google Search Console property and review sync runs." />
    {error && <Panel><p className="text-sm text-red-300">{error}</p></Panel>}

    {settings && <>
      <PagespeedKeyForm />
      <KeywordGapKeysForm />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-[var(--mos-text)]">Search Console service account</h2>
            <p className="mt-1 text-xs text-[var(--mos-text-muted)]">
              {settings.serviceAccount.configured
                ? <>Add <span className="font-mono text-[var(--mos-text-secondary)]">{settings.serviceAccount.email}</span> as a Restricted user on each Search Console property.</>
                : settings.serviceAccount.error}
            </p>
          </div>
          <StatusBadge tone={settings.serviceAccount.configured ? 'success' : 'warning'} dot>{settings.serviceAccount.configured ? 'Key loaded' : 'Not configured'}</StatusBadge>
        </div>
      </Panel>

      {settings.sites.map(site => <SiteForm key={site.id} site={site} onSaved={reload} />)}

      <DataTableFrame title="Recent sync runs" description="Daily cron and Sync now runs. Backfill runs from the server CLI.">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
            <tr><th className="p-3">Started</th><th className="p-3">Site</th><th className="p-3">Mode</th><th className="p-3">Status</th><th className="p-3">Range</th><th className="p-3 text-right">Days</th><th className="p-3 text-right">Rows</th><th className="p-3">Error</th></tr>
          </thead>
          <tbody>
            {settings.runs.map(run => <tr key={run.id} className="border-b border-[var(--mos-border)] text-[var(--mos-text-secondary)]">
              <td className="p-3 text-xs">{new Date(run.started_at).toLocaleString('en-GB')}</td>
              <td className="p-3">{run.site_name}</td>
              <td className="p-3">{run.mode}</td>
              <td className="p-3"><StatusBadge tone={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : 'info'}>{run.status}</StatusBadge></td>
              <td className="p-3 text-xs">{run.range_start ? `${run.range_start} to ${run.range_end}` : '—'}</td>
              <td className="p-3 text-right">{run.days_synced}</td>
              <td className="p-3 text-right">{run.rows_upserted}</td>
              <td className="max-w-[320px] p-3 text-xs text-red-300">{run.error || ''}</td>
            </tr>)}
            {!settings.runs.length && <tr><td colSpan={8} className="p-8 text-center text-[var(--mos-text-faint)]">No sync runs yet.</td></tr>}
          </tbody>
        </table>
      </DataTableFrame>
    </>}
  </PageStack>;
}

function PagespeedKeyForm() {
  const [hint, setHint] = useState('');
  const [source, setSource] = useState('none');
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch('/api/seo/settings/pagespeed', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    setHint(data.hint || '');
    setSource(data.source || 'none');
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async (clear = false) => {
    setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/seo/settings/pagespeed', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clear ? { clear: true } : { pagespeedKey: key }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || 'Could not save the key.'); return; }
      setKey('');
      setMessage(clear ? 'Saved key cleared.' : 'Key saved.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  return <Panel>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium text-[var(--mos-text)]">PageSpeed Insights API key</h2>
        <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Optional. Website Audit calls PageSpeed without a key on the public quota. A saved key is encrypted and is never shown again.</p>
      </div>
      <StatusBadge tone={source === 'none' ? 'warning' : 'success'} dot>{source === 'environment' ? 'Server environment' : source === 'settings' ? `Saved ${hint}` : 'Not configured'}</StatusBadge>
    </div>
    <div className="mt-4 flex flex-wrap items-end gap-2">
      <FormField label="API key" hint="Leave blank to keep the current key" error={error || undefined} className="min-w-[260px] flex-1">
        <TextInput type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} />
      </FormField>
      <Button variant="primary" disabled={saving || !key.trim()} onClick={() => save(false)}>{saving ? 'Saving…' : 'Save key'}</Button>
      <Button disabled={saving || source !== 'settings'} onClick={() => save(true)}>Clear saved key</Button>
    </div>
    {message && <p className="mt-2 text-xs text-emerald-300">{message}</p>}
  </Panel>;
}

function KeywordGapKeysForm() {
  const [status, setStatus] = useState<{ semrush: { configured: boolean; hint: string | null; source: string }; dataforseo: { configured: boolean; hint: string | null; source: string } } | null>(null);
  const [semrushKey, setSemrushKey] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/seo/settings/keyword-gap', { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (response.ok && data) setStatus(data);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async (body: Record<string, unknown>) => {
    setMessage(''); setError('');
    const response = await fetch('/api/seo/settings/keyword-gap', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || 'Could not save.'); return; }
    setStatus(data);
    setSemrushKey(''); setLogin(''); setPassword('');
    setMessage('Saved.');
  };

  return <Panel>
    <h2 className="text-sm font-medium text-[var(--mos-text)]">Keyword Gap provider keys</h2>
    <p className="mt-1 text-xs text-[var(--mos-text-muted)]">Optional. Semrush and DataForSEO stay Not configured until a key is saved. Keys are encrypted and never shown again.</p>
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <div>
        <StatusBadge tone={status?.semrush.configured ? 'success' : 'warning'} dot>{status?.semrush.configured ? `Semrush ${status.semrush.hint || 'configured'}` : 'Semrush not configured'}</StatusBadge>
        <div className="mt-2 flex gap-2">
          <TextInput type="password" value={semrushKey} onChange={event => setSemrushKey(event.target.value)} placeholder="Semrush API key" autoComplete="off" />
          <Button size="sm" disabled={!semrushKey.trim()} onClick={() => save({ semrushKey })}>Save</Button>
          <Button size="sm" disabled={status?.semrush.source !== 'settings'} onClick={() => save({ clearSemrush: true })}>Clear</Button>
        </div>
      </div>
      <div>
        <StatusBadge tone={status?.dataforseo.configured ? 'success' : 'warning'} dot>{status?.dataforseo.configured ? `DataForSEO ${status.dataforseo.hint || 'configured'}` : 'DataForSEO not configured'}</StatusBadge>
        <div className="mt-2 grid gap-2">
          <TextInput value={login} onChange={event => setLogin(event.target.value)} placeholder="DataForSEO login" autoComplete="off" />
          <TextInput type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="DataForSEO password" autoComplete="off" />
          <div className="flex gap-2">
            <Button size="sm" disabled={!login.trim() || !password.trim()} onClick={() => save({ dataforseoLogin: login, dataforseoPassword: password })}>Save</Button>
            <Button size="sm" disabled={status?.dataforseo.source !== 'settings'} onClick={() => save({ clearDataforseo: true })}>Clear</Button>
          </div>
        </div>
      </div>
    </div>
    {message && <p className="mt-2 text-xs text-emerald-300">{message}</p>}
    {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
  </Panel>;
}

function SiteForm({ site, onSaved }: { site: Site; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(site.name);
  const [property, setProperty] = useState(site.gsc_property ?? '');
  const [active, setActive] = useState(site.active);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/seo/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: site.id, name, gscProperty: property.trim() || null, active }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || 'Could not save.'); return; }
      setMessage('Saved.');
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return <Panel>
    <form onSubmit={save} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--mos-text)]">{site.name}</h2>
          <a href={site.site_url} target="_blank" rel="noreferrer" className="text-xs text-[var(--mos-text-muted)] hover:underline">{site.site_url}</a>
        </div>
        <StatusBadge tone={site.gsc_property ? (site.last_synced_at ? 'success' : 'info') : 'warning'} dot>
          {site.gsc_property ? (site.last_synced_at ? 'Connected' : 'Awaiting first sync') : 'Not connected'}
        </StatusBadge>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Name" required><TextInput value={name} onChange={event => setName(event.target.value)} maxLength={120} required /></FormField>
        <FormField label="GSC property" hint="sc-domain:example.com or https://example.com/" error={error || undefined}>
          <TextInput value={property} onChange={event => setProperty(event.target.value)} placeholder="Not connected" spellCheck={false} />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-[var(--mos-text-secondary)]">
          <input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} /> Active (included in the daily sync and shown first)
        </label>
        <div className="flex items-center gap-3">
          {message && <span className="text-xs text-emerald-300">{message}</span>}
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </form>
  </Panel>;
}
