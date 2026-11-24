'use client';

import { useEffect } from 'react';

/** Full navigation. A server redirect() from a nested layout crashes the Next router. */
export function CsReportGate({ href }: { href: string }) {
  useEffect(() => { window.location.replace(href); }, [href]);
  return <p className="p-8 text-sm text-[var(--mos-text-muted)]">You do not have access to CS Report.</p>;
}
