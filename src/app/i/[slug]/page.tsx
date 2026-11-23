// src/app/i/[slug]/page.tsx
// PUBLIC page (no login). Never import @/lib/auth. If a middleware.ts or proxy.ts is ever added, it must allow /i/.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isRegistrationOpen } from '@/lib/dpm-invitation/rules';
import { getEventBySlug } from '@/lib/dpm-invitation/store';
import { ClosedNotice, InvitationShell } from './InvitationShell';
import { InvitationForm } from './InvitationForm';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEventBySlug((await params).slug.toLowerCase());
  return { title: event ? event.name : 'Invitation', robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function InvitationPage({ params }: Props) {
  const event = await getEventBySlug((await params).slug.toLowerCase());
  if (!event) notFound();
  const open = isRegistrationOpen(event, new Date());
  return (
    <InvitationShell event={event}>
      <p className="eyebrow">RSVP</p>
      <h1>Confirm your attendance</h1>
      <p className="to">{event.name}</p>
      {open ? (
        <>
          <InvitationForm slug={event.slug} />
          <p className="fine">Your answers are only visible to the DPM event team.</p>
        </>
      ) : <ClosedNotice />}
    </InvitationShell>
  );
}
