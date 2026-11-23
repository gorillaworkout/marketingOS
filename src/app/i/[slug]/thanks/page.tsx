// src/app/i/[slug]/thanks/page.tsx
// PUBLIC page (no login). Never import @/lib/auth. Same text for new and updated answers, no personal data.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isRegistrationOpen } from '@/lib/dpm-invitation/rules';
import { getEventBySlug } from '@/lib/dpm-invitation/store';
import { ClosedNotice, InvitationShell } from '../InvitationShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Thank you', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function ThanksPage({ params }: { params: Promise<{ slug: string }> }) {
  const event = await getEventBySlug((await params).slug.toLowerCase());
  if (!event) notFound();
  const open = isRegistrationOpen(event, new Date());
  return (
    <InvitationShell event={event}>
      <p className="eyebrow">{event.name}</p>
      <h1>Thank you</h1>
      {open ? (
        <>
          <p className="to">Your response has been recorded. You can submit again with the same email to change it.</p>
          <p className="fine"><Link className="link" href={`/i/${event.slug}`}>Change my answer</Link></p>
        </>
      ) : <ClosedNotice />}
    </InvitationShell>
  );
}
