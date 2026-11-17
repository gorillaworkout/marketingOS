'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Panel, SectionHeader, StatusBadge, TextInput } from '@/components/ui/dashboard';
import { fetchJson } from '@/components/seo/useSeoSites';
import { SOCIAL_LABELS, SOCIAL_PLATFORMS, normalizeHandle, socialDisplay, socialProfileUrl, type SocialHandles, type SocialPlatform } from '@/lib/partnership/social';
import type { DiscoveryResult, SocialSuggestion } from '@/lib/partnership/social-discovery';

/**
 * Review step for "Find social accounts": runs discovery for each competitor (one at a
 * time), shows each suggested account with the page it was found on, and saves only
 * what the user ticks. An account that is already saved is never replaced unless the
 * user ticks the suggestion.
 */

export type DiscoveryCompetitor = {
  id: string; name: string; region: string; website: string | null; notes: string | null;
  instagramHandle: string | null; socialHandles?: SocialHandles;
};
type Row = { checked: boolean; value: string };
type Entry = {
  status: 'waiting' | 'loading' | 'done' | 'error' | 'saved';
  error?: string; result?: DiscoveryResult & { current?: SocialHandles }; rows: Partial<Record<SocialPlatform, Row>>;
};

const currentOf = (item: DiscoveryCompetitor): SocialHandles => ({ ...(item.socialHandles || {}), ...(item.instagramHandle && !item.socialHandles?.instagram ? { instagram: item.instagramHandle } : {}) });
const sameHandle = (a: string | undefined, b: string) => (a || '').toLowerCase() === b.toLowerCase();

function rowsFor(suggestions: SocialSuggestion[], current: SocialHandles): Entry['rows'] {
  const rows: Entry['rows'] = {};
  // Ticked by default only where nothing is saved yet; a different saved value needs an explicit tick.
  for (const item of suggestions) rows[item.platform] = { value: item.handle, checked: !current[item.platform] };
  return rows;
}

export function SocialDiscoveryPanel({ competitors, ids, onClose, onSaved }: {
  competitors: DiscoveryCompetitor[]; ids: string[]; onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>(() => Object.fromEntries(ids.map(id => [id, { status: 'waiting', rows: {} } as Entry])));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const started = useRef('');
  const byId = new Map(competitors.map(item => [item.id, item]));
  const patch = (id: string, next: Partial<Entry>) => setEntries(current => ({ ...current, [id]: { ...(current[id] || { status: 'waiting', rows: {} }), ...next } }));
  const setRow = (id: string, platform: SocialPlatform, next: Partial<Row>) => setEntries(current => {
    const entry = current[id];
    const row = entry?.rows[platform] || { checked: false, value: '' };
    return { ...current, [id]: { ...entry, rows: { ...entry.rows, [platform]: { ...row, ...next } } } };
  });

  useEffect(() => {
    const key = ids.join(',');
    if (started.current === key) return;
    started.current = key;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const id of ids) {
          if (cancelled) return;
          patch(id, { status: 'loading' });
          const { ok, data } = await fetchJson<DiscoveryResult & { current?: SocialHandles }>(`/api/partnership/competitors/${encodeURIComponent(id)}/discover-social`, { method: 'POST' });
          const competitor = byId.get(id);
          if (!ok || !competitor) { patch(id, { status: 'error', error: data.error || 'Could not read the website.' }); continue; }
          patch(id, { status: 'done', result: data, rows: rowsFor(data.suggestions, data.current || currentOf(competitor)) });
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // Runs once per set of competitors; byId/patch are recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const save = async (id: string) => {
    const competitor = byId.get(id);
    const entry = entries[id];
    if (!competitor || !entry?.result) return false;
    const merged: SocialHandles = { ...currentOf(competitor) };
    for (const platform of SOCIAL_PLATFORMS) {
      const row = entry.rows[platform];
      if (!row?.checked) continue;
      const value = normalizeHandle(platform, row.value);
      if (value === null) { patch(id, { error: `${SOCIAL_LABELS[platform]}: not a valid handle or profile link.` }); return false; }
      if (value) merged[platform] = value;
    }
    const { ok, data } = await fetchJson(`/api/partnership/competitors/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: competitor.name, region: competitor.region, website: competitor.website || '', notes: competitor.notes || '', socialHandles: merged }),
    });
    if (!ok) { patch(id, { error: data.error || 'Could not save.' }); return false; }
    patch(id, { status: 'saved', error: undefined });
    return true;
  };

  const checkedCount = (id: string) => Object.values(entries[id]?.rows || {}).filter(row => row?.checked).length;
  const saveAll = async () => {
    setSaving(true); setMessage('');
    let saved = 0;
    try {
      for (const id of ids) if (entries[id]?.status === 'done' && checkedCount(id) > 0 && await save(id)) saved += 1;
      setMessage(saved ? `Saved accounts for ${saved} competitor${saved === 1 ? '' : 's'}.` : 'Nothing ticked to save.');
      await onSaved();
    } finally { setSaving(false); }
  };
  const busy = ids.some(id => entries[id]?.status === 'loading' || entries[id]?.status === 'waiting');

  return <Panel data-testid="social-discovery">
    <SectionHeader title="Find social accounts"
      description="Read from each competitor's own website (home, Indonesian page, contact/about pages, llms.txt). Tick what is right, edit if needed, then save. Nothing is saved until you do."
      action={<div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={busy || saving} onClick={() => void saveAll()} data-testid="save-discovered">Save ticked</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>} className="mb-4" />
    {message && <p className="mb-3 text-sm text-[var(--mos-text-secondary)]">{message}</p>}
    <div className="space-y-4">
      {ids.map(id => {
        const competitor = byId.get(id);
        const entry = entries[id] || { status: 'waiting', rows: {} };
        if (!competitor) return null;
        const current = entry.result?.current || currentOf(competitor);
        const found = new Set(entry.result?.suggestions.map(item => item.platform) || []);
        const missing = SOCIAL_PLATFORMS.filter(platform => !found.has(platform));
        return <section key={id} className="rounded-[var(--mos-radius-control)] border border-[var(--mos-border)] p-3" data-testid="discovery-competitor">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-[var(--mos-text)]">{competitor.name} {competitor.website && <span className="text-xs font-normal text-[var(--mos-text-faint)]">{competitor.website}</span>}</p>
            <div className="flex items-center gap-2">
              <StatusBadge tone={entry.status === 'error' ? 'danger' : entry.status === 'saved' ? 'success' : entry.status === 'done' ? 'info' : 'neutral'}>
                {entry.status === 'loading' ? 'reading website…' : entry.status === 'done' ? `${found.size} found` : entry.status}
              </StatusBadge>
              {entry.status === 'done' && <Button size="sm" disabled={saving || !checkedCount(id)} onClick={() => { setSaving(true); void save(id).then(ok => (ok ? onSaved() : undefined)).finally(() => setSaving(false)); }}>Save {checkedCount(id) || ''}</Button>}
            </div>
          </div>
          {!competitor.website && <p className="mt-2 text-xs text-[var(--mos-text-muted)]">No website saved, so there is nothing to read. Add the official site first, or type the accounts in Edit.</p>}
          {entry.error && <p className="mt-2 text-xs text-red-300">{entry.error}</p>}
          {entry.result && entry.result.suggestions.length > 0 && <table className="mt-3 w-full text-xs">
            <thead><tr className="text-left text-[var(--mos-text-faint)]"><th className="w-8 py-1" /><th className="py-1">Platform</th><th className="py-1">Account</th><th className="py-1">Found on</th><th className="py-1">Saved now</th></tr></thead>
            <tbody>
              {entry.result.suggestions.map(item => {
                const row = entry.rows[item.platform] || { checked: false, value: item.handle };
                const saved = current[item.platform];
                const same = sameHandle(saved, row.value);
                return <tr key={item.platform} className="border-t border-[var(--mos-border)] align-top" data-testid="discovery-row">
                  <td className="py-1.5"><input type="checkbox" aria-label={`Use ${SOCIAL_LABELS[item.platform]}`} checked={row.checked && !same} disabled={same || entry.status === 'saved'} onChange={event => setRow(id, item.platform, { checked: event.target.checked })} /></td>
                  <td className="py-1.5 text-[var(--mos-text-secondary)]">{SOCIAL_LABELS[item.platform]}</td>
                  <td className="py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TextInput className="w-44 text-xs" value={row.value} spellCheck={false} disabled={entry.status === 'saved'} onChange={event => setRow(id, item.platform, { value: event.target.value, checked: true })} />
                      <a className="text-[var(--mos-accent-soft)] hover:underline" href={socialProfileUrl(item.platform, normalizeHandle(item.platform, row.value) || item.handle)} target="_blank" rel="noopener noreferrer nofollow">open</a>
                    </div>
                    {item.alternatives.length > 0 && <div className="mt-1 flex flex-wrap gap-1 text-[var(--mos-text-faint)]">also seen:
                      {item.alternatives.map(alt => <button key={alt.handle} type="button" title={`Found on ${alt.sourceUrl}`} className="rounded border border-[var(--mos-border)] px-1 text-[var(--mos-text-secondary)] hover:border-[var(--mos-accent)]" onClick={() => setRow(id, item.platform, { value: alt.handle, checked: true })}>{socialDisplay(item.platform, alt.handle)}</button>)}
                    </div>}
                  </td>
                  <td className="py-1.5"><a className="break-all text-[var(--mos-accent-soft)] hover:underline" href={item.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{item.sourceUrl.replace(/^https?:\/\//, '')}</a>{item.via === 'web-search' && <span className="ml-1 text-[var(--mos-text-faint)]">(web search)</span>}</td>
                  <td className="py-1.5 text-[var(--mos-text-muted)]">{saved ? (same ? 'same, already saved' : <span className="text-amber-200">{socialDisplay(item.platform, saved)} (tick to replace)</span>) : '—'}</td>
                </tr>;
              })}
            </tbody>
          </table>}
          {entry.result && <p className="mt-2 text-xs text-[var(--mos-text-muted)]">
            {entry.result.suggestions.length ? `Not found on the site: ${missing.map(platform => SOCIAL_LABELS[platform]).join(', ') || 'none'}.` : 'No social account links found on the pages read.'}
            {entry.result.notes.length > 0 && <> {entry.result.notes.join(' ')}</>}
          </p>}
          {entry.result && entry.result.pagesRead.length > 0 && <details className="mt-1 text-xs text-[var(--mos-text-faint)]"><summary className="cursor-pointer">Pages read ({entry.result.pagesRead.length})</summary>
            <ul className="mt-1 space-y-0.5">{entry.result.pagesRead.map(url => <li key={url}><a className="break-all hover:underline" href={url} target="_blank" rel="noopener noreferrer nofollow">{url}</a></li>)}</ul>
          </details>}
        </section>;
      })}
    </div>
  </Panel>;
}
