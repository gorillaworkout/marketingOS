import { redirect } from 'next/navigation';

/** Paid Media opens on Google Ads (the only Paid Media tool so far). */
export default function PaidMediaIndex() {
  redirect('/dashboard/paid-media/google-ads');
}
