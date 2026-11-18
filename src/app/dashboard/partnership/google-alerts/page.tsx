'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button, DataTableFrame, EmptyState, FormField, LoadingState, PageHeader, PageStack, Panel, SectionHeader, Select, StatusBadge, TextInput,
} from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';

type Feed = {
  id: string; url: string; label: string; feedTitle: string | null; lastFetchedAt: string | null; lastItemCount: number | null;
  lastError: string | null; articleCount: number; createdAt: string;
};
type Article = { id: string; url: string; title: string; snippet: string; sourceName: string | null; publishedAt: string | null; firstSeenAt: string; feedIds: string[] };
type Overview = { feeds: Feed[]; articles: Article[]; feedId: string | null };
type FetchSummary = { feeds: number; failed: number; items: number; inserted: number; updated: number; results: Array<{ label: string; ok: boolean; items: number; error: string | null }> };

const when = (value: string | null) => (value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB' : '—');
const feedName = (feed: Feed, index: number) => feed.label || feed.feedTitle || `Alert ${index + 1}`;
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const shortUrl = (url: string) => url.replace('https://www.google.com/alerts/feeds/', 'alerts/feeds/');

function HowTo({ open }: { open: boolean }) {
  return <Panel data-testid="google-alerts-howto">
    <details open={open}>
      <summary className="cursor-pointer text-sm font-[560] text-[var(--mos-text)]">How to get a Google Alerts RSS link</summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[var(--mos-text-secondary)]">
        <li>Open <a href="https://www.google.com/alerts" target="_blank" rel="noopener noreferrer" className="text-[var(--mos-accent-soft)] hover:underline">google.com/alerts</a> and sign in with a Google account.</li>
        <li>Type what to watch in the top box, e.g. <span className="font-mono text-xs">Dupoin</span>.</li>
        <li>Click <b>Show options</b> under the box.</li>
        <li>Set <b>Deliver to</b> to <b>RSS feed</b>, then click <b>Create Alert</b>.</li>
        <li>In <b>My alerts</b>, right-click the orange RSS icon next to the alert, choose <b>Copy link</b>, and paste it below.</li>
      </ol>
      <p className="mt-3 text-xs text-[var(--mos-text-muted)]">The link looks like <span className="font-mono">https://www.google.com/alerts/feeds/123…/456…</span>. Already have an email alert? Click its pencil icon and switch Deliver to RSS feed. One link per alert; add as many as you need (up to 20).</p>
    </details>
  </Panel>;
}

function FeedRow({ feed, index, busy, onFetch, onSaved, onRemove }: {
  feed: Feed; index: number; busy: boolean; onFetch: () => void; onSaved: (label: string) => Promise<boolean>; onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(feed.label);
  return <tr className="border-b border-[var(--mos-border)] align-top text-[var(--mos-text-secondary)]" data-testid="google-alerts-feed-row">
    <td className="p-3">
      {editing
        ? <div className="flex gap-2"><TextInput aria-label="Label" value={label} maxLength={80} autoFocus onChange={event => setLabel(event.target.value)} onKeyDown={async event => { if (event.key === 'Enter' && await onSaved(label)) setEditing(false); }} />
          <Button size="sm" variant="primary" onClick={async () => { if (await onSaved(label)) setEditing(false); }}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => { setLabel(feed.label); setEditing(false); }}>Cancel</Button></div>
        : <><span className="font-medium text-[var(--mos-text)]">{feedName(feed, index)}</span>
          {feed.feedTitle && feed.label && feed.feedTitle !== feed.label && <span className="ml-2 text-xs text-[var(--mos-text-faint)]">Google: “{feed.feedTitle}”</span>}</>}
      <p className="mt-1 break-all font-mono text-[11px] text-[var(--mos-text-faint)]" title={feed.url}>{shortUrl(feed.url)}</p>
    </td>
    <td className="p-3 text-xs">{when(feed.lastFetchedAt)}
      {feed.lastError
        ? <p className="mt-1"><StatusBadge tone="danger">Could not read</StatusBadge> <span className="text-red-300">{feed.lastError}</span></p>
        : feed.lastFetchedAt ? <p className="mt-1 text-[var(--mos-text-muted)]">{feed.lastItemCount ?? 0} item(s) in the feed</p> : <p className="mt-1 text-[var(--mos-text-muted)]">Not fetched yet</p>}
    </td>
    <td className="p-3 text-right text-sm">{feed.articleCount}</td>
    <td className="p-3">
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button size="sm" disabled={busy} onClick={onFetch}>Fetch</Button>
        {!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Rename</Button>}
        <Button size="sm" variant="danger" onClick={onRemove}>Remove</Button>
      </div>
    </td>
  </tr>;
}

export default function GoogleAlertsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [filter, setFilter] = useState('all');
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { ok, data } = await fetchJson<Overview>(`/api/partnership/google-alerts${filter !== 'all' ? `?feed=${encodeURIComponent(filter)}` : ''}`);
    if (!ok) { setMessage({ tone: 'error', text: data.error || 'Could not load Google Alerts.' }); return; }
    setOverview(data);
  }, [filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const names = useMemo(() => new Map((overview?.feeds ?? []).map((feed, index) => [feed.id, feedName(feed, index)])), [overview]);

  const add = async () => {
    setAdding(true); setMessage(null);
    const { ok, data } = await fetchJson<{ feed: Feed }>('/api/partnership/google-alerts/feeds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, label }) });
    setAdding(false);
    if (!ok) { setMessage({ tone: 'error', text: data.error || 'Could not add the feed.' }); return; }
    setUrl(''); setLabel('');
    setMessage({ tone: 'ok', text: 'Feed added. Click Fetch now to pull its latest articles.' });
    await load();
  };

  const fetchNow = async (feedId?: string) => {
    setFetching(true); setMessage(null);
    const { ok, data } = await fetchJson<FetchSummary>('/api/partnership/google-alerts/fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(feedId ? { feedId } : {}) });
    setFetching(false);
    if (!ok) { setMessage({ tone: 'error', text: data.error || 'Could not fetch.' }); return; }
    const failed = data.results.filter(result => !result.ok);
    setMessage({
      tone: failed.length ? 'error' : 'ok',
      text: `Fetched ${data.feeds} feed(s): ${data.items} article(s), ${data.inserted} new.${failed.length ? ` Could not read: ${failed.map(result => result.label || 'a feed').join(', ')}.` : ''}`,
    });
    await load();
  };

  const rename = async (id: string, next: string) => {
    const { ok, data } = await fetchJson(`/api/partnership/google-alerts/feeds/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: next }) });
    if (!ok) { setMessage({ tone: 'error', text: data.error || 'Could not rename.' }); return false; }
    await load();
    return true;
  };

  const remove = async (feed: Feed, index: number) => {
    if (!window.confirm(`Remove “${feedName(feed, index)}”? Articles it already brought in stay in Media Monitoring.`)) return;
    const { ok, data } = await fetchJson(`/api/partnership/google-alerts/feeds/${encodeURIComponent(feed.id)}`, { method: 'DELETE' });
    if (!ok) { setMessage({ tone: 'error', text: data.error || 'Could not remove.' }); return; }
    if (filter === feed.id) setFilter('all');
    await load();
  };

  if (!overview) return <PageStack><PageHeader eyebrow="Partnership" title="Google Alerts" />{message ? <p className="text-sm text-red-300">{message.text}</p> : <LoadingState label="Loading Google Alerts" />}</PageStack>;
  const { feeds, articles } = overview;

  return <PageStack>
    <PageHeader
      eyebrow="Partnership"
      title="Google Alerts"
      description="Paste the RSS link of each Google Alert, then read the latest articles here. Fetching is free. Every article also feeds Media Monitoring (same data, no duplicates), which adds sentiment, reach and the report."
      actions={<Link href="/dashboard/partnership/media-monitoring" className="text-sm text-[var(--mos-accent-soft)] hover:underline">Open Media Monitoring →</Link>}
    />

    <HowTo open={!feeds.length} />

    <Panel data-testid="google-alerts-feeds">
      <SectionHeader title="Your alerts" description={`${feeds.length} of 20 feeds. Feeds are also read automatically by the scheduled Media Monitoring refresh (free).`}
        action={<Button variant="primary" disabled={fetching || !feeds.length} onClick={() => fetchNow()} data-testid="google-alerts-fetch-all">{fetching ? 'Fetching…' : 'Fetch now (free)'}</Button>} />
      <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
        <FormField label="Google Alerts RSS link"><TextInput spellCheck={false} placeholder="https://www.google.com/alerts/feeds/…/…" value={url} onChange={event => setUrl(event.target.value)} data-testid="google-alerts-url" /></FormField>
        <FormField label="Label (optional)" hint="e.g. Dupoin brand"><TextInput maxLength={80} value={label} onChange={event => setLabel(event.target.value)} data-testid="google-alerts-label" /></FormField>
        <Button variant="primary" disabled={adding || !url.trim()} onClick={add} data-testid="google-alerts-add">{adding ? 'Adding…' : 'Add feed'}</Button>
      </div>
      {message && <p className={`mt-3 text-sm ${message.tone === 'error' ? 'text-red-300' : 'text-emerald-300'}`} data-testid="google-alerts-message">{message.text}</p>}
      {feeds.length > 0 && <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-[var(--mos-border)] text-left text-xs uppercase tracking-wide text-[var(--mos-text-faint)]">
            <tr><th className="p-3">Alert</th><th className="p-3">Last fetched</th><th className="p-3 text-right">Articles saved</th><th className="p-3" /></tr>
          </thead>
          <tbody>{feeds.map((feed, index) => <FeedRow key={feed.id} feed={feed} index={index} busy={fetching}
            onFetch={() => fetchNow(feed.id)} onSaved={next => rename(feed.id, next)} onRemove={() => remove(feed, index)} />)}</tbody>
        </table>
      </div>}
    </Panel>

    <DataTableFrame title="Latest articles" description="Newest first. Click a title to open the article."
      action={feeds.length > 0 ? <Select aria-label="Filter by alert" value={filter} onChange={event => setFilter(event.target.value)} data-testid="google-alerts-filter">
        <option value="all">All alerts</option>
        {feeds.map((feed, index) => <option key={feed.id} value={feed.id}>{feedName(feed, index)}</option>)}
      </Select> : undefined}>
      {!articles.length
        ? <EmptyState title={feeds.length ? 'No articles yet' : 'Add your first alert'} description={feeds.length ? 'Click Fetch now. A brand-new alert can stay empty until Google finds something new.' : 'Paste a Google Alerts RSS link above, then click Fetch now.'} />
        : <ul className="divide-y divide-[var(--mos-border)]" data-testid="google-alerts-articles">
          {articles.map(article => <li key={article.id} className="px-5 py-4">
            <a href={article.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[15px] font-medium text-[var(--mos-accent-soft)] hover:underline">{article.title || article.url}</a>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--mos-text-muted)]">
              <span>{article.sourceName || hostOf(article.url)}</span><span>·</span><span>{when(article.publishedAt ?? article.firstSeenAt)}</span>
              {article.feedIds.map(id => <StatusBadge key={id} tone="info">{names.get(id) ?? 'Removed alert'}</StatusBadge>)}
            </p>
            {article.snippet && <p className="mt-1.5 line-clamp-3 text-sm text-[var(--mos-text-secondary)]">{article.snippet}</p>}
          </li>)}
        </ul>}
    </DataTableFrame>
  </PageStack>;
}
