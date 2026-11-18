'use client';

import { useEffect, useState } from 'react';

/** Fetch JSON for a URL (null = skip). Results are keyed by URL so stale responses never show. */
export function useInsight<T>(url: string | null, version = 0): { data: T | null; error: string; loading: boolean } {
  const key = url ? `${url}#${version}` : null;
  const [state, setState] = useState<{ key: string; data: T | null; error: string } | null>(null);
  useEffect(() => {
    if (!key || !url) return;
    let cancelled = false;
    fetch(url, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => ({})) as T & { error?: string };
        if (!cancelled) setState({ key, data: response.ok ? data : null, error: response.ok ? '' : data.error || 'Could not load this view.' });
      })
      .catch(() => { if (!cancelled) setState({ key, data: null, error: 'Could not load this view.' }); });
    return () => { cancelled = true; };
  }, [key, url]);
  const current = key && state?.key === key ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? '', loading: Boolean(key) && !current };
}
