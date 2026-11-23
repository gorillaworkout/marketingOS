// src/app/i/[slug]/InvitationShell.tsx
// PUBLIC. Never import @/lib/auth. If a middleware.ts or proxy.ts is ever added, it must allow /i/.
import type { ReactNode } from 'react';
import '../invitation.css';
import { imageVersion } from '@/lib/dpm-invitation/present';
import type { InvitationEvent } from '@/lib/dpm-invitation/types';

export function InvitationShell({ event, children }: { event: InvitationEvent; children: ReactNode }) {
  return (
    <div className="pg-dpm-inv">
      <div className="shell">
        <aside className="panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/i/${event.slug}/image?v=${imageVersion(event.imageKey)}`} alt={event.name} width={event.imageWidth} height={event.imageHeight} />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

export function ClosedNotice() {
  return <div className="notice" style={{ marginTop: 32 }}>Registration for this event is closed. If you need help, please contact the DPM event team.</div>;
}
