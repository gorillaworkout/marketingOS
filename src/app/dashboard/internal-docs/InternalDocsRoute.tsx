'use client';

import { useLayoutEffect } from 'react';
import { useInternalDocsState } from './InternalDocsState';

export function documentIdFromInternalDocsPath(pathname: string): string | undefined {
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const base = '/dashboard/internal-docs';
  if (path === base) return undefined;
  if (!path.startsWith(`${base}/`)) return undefined;
  const id = path.slice(base.length + 1);
  if (!id || id.includes('/')) return undefined;
  try {
    return decodeURIComponent(id);
  } catch {
    return undefined;
  }
}

export function InternalDocsRoute({ documentId, highlight = '' }: { documentId?: string; highlight?: string }) {
  const { setRoute } = useInternalDocsState();
  useLayoutEffect(() => {
    setRoute({ documentId, highlight });
  }, [documentId, highlight, setRoute]);
  return null;
}
