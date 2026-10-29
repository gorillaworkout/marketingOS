'use client';

import { useEffect, useState } from 'react';

export type SeoSiteStatus = 'not-configured' | 'missing-key' | 'never-synced' | 'connected';
export interface SeoSite { id: string; name: string; site_url: string; gsc_property: string | null; active: boolean; last_synced_at: string | null; status: SeoSiteStatus }
export interface SeoSitesResponse { sites: SeoSite[]; defaultSiteId: string | null; isAdmin: boolean }

export async function fetchJson<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

/** Loads SEO sites once and keeps the picked site (defaults to the first active site). */
export function useSeoSites() {
  const [data, setData] = useState<SeoSitesResponse | null>(null);
  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchJson<SeoSitesResponse>('/api/seo/sites').then(({ ok, data: body }) => {
      if (cancelled) return;
      if (!ok) { setError(body.error || 'Could not load SEO sites.'); return; }
      setData(body);
      setSiteId(current => current || body.defaultSiteId || body.sites[0]?.id || '');
    }).catch(() => { if (!cancelled) setError('Could not load SEO sites.'); });
    return () => { cancelled = true; };
  }, []);

  const site = data?.sites.find(item => item.id === siteId) ?? null;
  return { data, site, siteId, setSiteId, error, loading: !data && !error };
}
